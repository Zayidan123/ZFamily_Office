"""Governance: entities, users, approvals, audit log (append-only)."""
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from db import execute, get_conn, guard_mutation, now_iso, query, query_one, r2, write_audit
from errors import ApiError, ok
from prices import compute_portfolio
from security import require_auth

router = APIRouter(tags=["governance"])

ENTITY_TYPES = {"personal", "holding", "family"}

APPROVAL_SQL = (
    "SELECT ap.*, u1.name AS requested_by_name, u2.name AS decided_by_name "
    "FROM approvals ap "
    "LEFT JOIN users u1 ON u1.id = ap.requested_by "
    "LEFT JOIN users u2 ON u2.id = ap.decided_by"
)


# ---------------------------------------------------------------- entities

@router.get("/entities")
def list_entities(user: dict = Depends(require_auth("owner", "beneficiary", "advisor"))):
    conn = get_conn()
    try:
        items, _, _ = compute_portfolio(conn)
        agg = {}
        for it in items:
            eid = it["entity_id"]
            if eid is None:
                continue
            a = agg.setdefault(eid, {"count": 0, "value": 0.0})
            a["count"] += 1
            a["value"] += it["valueUsd"]
        rows = query(conn, "SELECT * FROM entities ORDER BY id")
        return ok([
            {**r,
             "assetCount": agg.get(r["id"], {}).get("count", 0),
             "valueUsd": r2(agg.get(r["id"], {}).get("value", 0.0))}
            for r in rows
        ])
    finally:
        conn.close()


class EntityBody(BaseModel):
    name: str
    type: str
    description: Optional[str] = ""


@router.post("/entities", status_code=201)
def create_entity(body: EntityBody, user: dict = Depends(require_auth("owner"))):
    if body.type not in ENTITY_TYPES:
        raise ApiError(400, f"type tidak valid: {body.type} (personal|holding|family)")
    conn = get_conn()
    try:
        guard_mutation(conn)
        new_id = execute(conn, "INSERT INTO entities(name, type, description, created_at) VALUES(?,?,?,?)",
                         (body.name.strip(), body.type, body.description or "", now_iso()))
        write_audit(conn, user, "entity.create", "entity", f"Tambah entitas: {body.name} ({body.type})")
        return ok(query_one(conn, "SELECT * FROM entities WHERE id = ?", (new_id,)))
    finally:
        conn.close()


class EntityUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    description: Optional[str] = None


@router.put("/entities/{entity_id}")
def update_entity(entity_id: int, body: EntityUpdate, user: dict = Depends(require_auth("owner"))):
    conn = get_conn()
    try:
        guard_mutation(conn)
        if not query_one(conn, "SELECT id FROM entities WHERE id = ?", (entity_id,)):
            raise ApiError(404, "Entitas tidak ditemukan")
        fields = body.model_dump(exclude_unset=True)
        if not fields:
            raise ApiError(400, "Tidak ada field yang diubah")
        if "type" in fields and fields["type"] not in ENTITY_TYPES:
            raise ApiError(400, "type tidak valid")
        sets, params = [], []
        for k, v in fields.items():
            sets.append(f"{k} = ?")
            params.append(v)
        params.append(entity_id)
        execute(conn, f"UPDATE entities SET {', '.join(sets)} WHERE id = ?", tuple(params))
        write_audit(conn, user, "entity.update", "entity", f"Update entitas #{entity_id}: {', '.join(fields.keys())}")
        return ok(query_one(conn, "SELECT * FROM entities WHERE id = ?", (entity_id,)))
    finally:
        conn.close()


# ---------------------------------------------------------------- users

@router.get("/users")
def list_users(user: dict = Depends(require_auth("owner", "beneficiary", "advisor"))):
    conn = get_conn()
    try:
        return ok(query(conn, "SELECT id, name, email, role, created_at FROM users ORDER BY id"))
    finally:
        conn.close()


# ---------------------------------------------------------------- approvals

def _approval_row(r: dict) -> dict:
    return {
        "id": r["id"],
        "title": r["title"],
        "description": r.get("description") or "",
        "amountUsd": r2(r["amount_usd"]),
        "status": r["status"],
        "requestedByName": r.get("requested_by_name"),
        "decidedByName": r.get("decided_by_name"),
        "createdAt": r["created_at"],
        "decidedAt": r.get("decided_at"),
    }


@router.get("/approvals")
def list_approvals(status: Optional[str] = None,
                   user: dict = Depends(require_auth("owner", "beneficiary", "advisor"))):
    conn = get_conn()
    try:
        sql, params = APPROVAL_SQL, []
        if status:
            sql += " WHERE ap.status = ?"
            params.append(status)
        sql += " ORDER BY ap.created_at DESC"
        return ok([_approval_row(r) for r in query(conn, sql, tuple(params))])
    finally:
        conn.close()


class ApprovalBody(BaseModel):
    title: str
    description: Optional[str] = ""
    amountUsd: float


@router.post("/approvals", status_code=201)
def create_approval(body: ApprovalBody, user: dict = Depends(require_auth("owner"))):
    if body.amountUsd < 0:
        raise ApiError(400, "amountUsd tidak boleh negatif")
    conn = get_conn()
    try:
        guard_mutation(conn)
        new_id = execute(
            conn,
            "INSERT INTO approvals(title, description, amount_usd, status, requested_by, created_at) "
            "VALUES(?,?,?,'pending',?,?)",
            (body.title.strip(), body.description or "", body.amountUsd, user["sub"], now_iso()),
        )
        write_audit(conn, user, "approval.create", "approval",
                    f"Pengajuan: {body.title} (USD {body.amountUsd:,.2f})")
        row = query_one(conn, APPROVAL_SQL + " WHERE ap.id = ?", (new_id,))
        return ok(_approval_row(row))
    finally:
        conn.close()


def _decide(approval_id: int, decision: str, user: dict):
    conn = get_conn()
    try:
        guard_mutation(conn)
        row = query_one(conn, "SELECT * FROM approvals WHERE id = ?", (approval_id,))
        if not row:
            raise ApiError(404, "Approval tidak ditemukan")
        if row["status"] != "pending":
            raise ApiError(400, f"Approval sudah diputuskan ({row['status']})")
        execute(conn, "UPDATE approvals SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?",
                (decision, user["sub"], now_iso(), approval_id))
        verb = "Menyetujui" if decision == "approved" else "Menolak"
        write_audit(conn, user, f"approval.{decision}", "approval", f"{verb}: {row['title']}")
        row2 = query_one(conn, APPROVAL_SQL + " WHERE ap.id = ?", (approval_id,))
        return ok(_approval_row(row2))
    finally:
        conn.close()


@router.post("/approvals/{approval_id}/approve")
def approve_approval(approval_id: int, user: dict = Depends(require_auth("owner", "beneficiary"))):
    return _decide(approval_id, "approved", user)


@router.post("/approvals/{approval_id}/reject")
def reject_approval(approval_id: int, user: dict = Depends(require_auth("owner", "beneficiary"))):
    return _decide(approval_id, "rejected", user)


# ---------------------------------------------------------------- audit

@router.get("/audit")
def list_audit(
    limit: int = Query(200, ge=1, le=1000),
    action: Optional[str] = None,
    userId: Optional[int] = None,
    user: dict = Depends(require_auth()),
):
    """Append-only. Owner & advisor lihat semua; peran lain terbatas ke audit-nya sendiri."""
    conn = get_conn()
    try:
        sql = ("SELECT id, user_id, user_name, role, action, entity_type, detail, created_at "
               "FROM audit_logs WHERE 1=1")
        params: list = []
        if user.get("role") not in ("owner", "advisor"):
            sql += " AND user_id = ?"
            params.append(user.get("sub"))
        elif userId is not None:
            sql += " AND user_id = ?"
            params.append(userId)
        if action:
            sql += " AND action = ?"
            params.append(action)
        sql += " ORDER BY id DESC LIMIT ?"
        params.append(limit)
        rows = query(conn, sql, tuple(params))
        return ok([
            {"id": r["id"], "userName": r["user_name"], "role": r["role"], "action": r["action"],
             "entityType": r["entity_type"], "detail": r["detail"], "createdAt": r["created_at"]}
            for r in rows
        ])
    finally:
        conn.close()
