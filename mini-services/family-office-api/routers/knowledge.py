"""Knowledge & planning: research notes, succession rules, emergency,
goals, projection (compound growth), time capsules."""
import json
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from db import execute, get_conn, guard_mutation, now_iso, query, query_one, r2, write_audit
from errors import ApiError, ok
from prices import compute_portfolio
from security import require_auth

router = APIRouter(tags=["knowledge-planning"])

NOTE_STATUS = {"draft", "active", "closed"}
RULE_STATUS = {"active", "draft", "revoked"}
PLANNER_ROLES = ("owner", "beneficiary")  # beneficiary = read semua; write tetap owner

RULE_SQL = ('SELECT id, beneficiary_name, relation, entity_name, asset_scope, conditions, "trigger", '
            'status, created_at, updated_at FROM succession_rules')


# ------------------------------------------------------------ research notes

def _note_row(r: dict) -> dict:
    try:
        tags = json.loads(r.get("tags") or "[]")
    except (TypeError, ValueError):
        tags = []
    return {
        "id": r["id"], "title": r["title"], "assetId": r["asset_id"],
        "assetName": r.get("asset_name"), "thesis": r["thesis"],
        "targetPriceUsd": r["target_price_usd"], "exitPlan": r["exit_plan"],
        "status": r["status"], "tags": tags,
        "createdAt": r["created_at"], "updatedAt": r["updated_at"],
    }


NOTE_SQL = ("SELECT n.*, a.name AS asset_name FROM research_notes n "
            "LEFT JOIN assets a ON a.id = n.asset_id")


@router.get("/research/notes")
def list_notes(user: dict = Depends(require_auth("owner", "beneficiary", "advisor"))):
    conn = get_conn()
    try:
        return ok([_note_row(r) for r in query(conn, NOTE_SQL + " ORDER BY n.updated_at DESC")])
    finally:
        conn.close()


class NoteBody(BaseModel):
    title: str
    thesis: Optional[str] = ""
    assetId: Optional[int] = None
    targetPriceUsd: Optional[float] = None
    exitPlan: Optional[str] = ""
    status: str = "draft"
    tags: List[str] = []


@router.post("/research/notes", status_code=201)
def create_note(body: NoteBody, user: dict = Depends(require_auth("owner", "advisor"))):
    if body.status not in NOTE_STATUS:
        raise ApiError(400, "status harus draft|active|closed")
    conn = get_conn()
    try:
        guard_mutation(conn)
        if body.assetId is not None and not query_one(conn, "SELECT id FROM assets WHERE id = ?", (body.assetId,)):
            raise ApiError(400, "assetId tidak ditemukan")
        ts = now_iso()
        new_id = execute(
            conn,
            "INSERT INTO research_notes(title, asset_id, thesis, target_price_usd, exit_plan, status, tags, "
            "created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
            (body.title.strip(), body.assetId, body.thesis or "", body.targetPriceUsd, body.exitPlan or "",
             body.status, json.dumps(body.tags, ensure_ascii=False), ts, ts),
        )
        write_audit(conn, user, "research.create", "research_note", f"Catatan riset baru: {body.title}")
        return ok(_note_row(query_one(conn, NOTE_SQL + " WHERE n.id = ?", (new_id,))))
    finally:
        conn.close()


class NoteUpdate(BaseModel):
    title: Optional[str] = None
    thesis: Optional[str] = None
    assetId: Optional[int] = None
    targetPriceUsd: Optional[float] = None
    exitPlan: Optional[str] = None
    status: Optional[str] = None
    tags: Optional[List[str]] = None


NOTE_COLMAP = {"title": "title", "thesis": "thesis", "assetId": "asset_id",
               "targetPriceUsd": "target_price_usd", "exitPlan": "exit_plan",
               "status": "status", "tags": "tags"}


@router.put("/research/notes/{note_id}")
def update_note(note_id: int, body: NoteUpdate, user: dict = Depends(require_auth("owner", "advisor"))):
    conn = get_conn()
    try:
        guard_mutation(conn)
        if not query_one(conn, "SELECT id FROM research_notes WHERE id = ?", (note_id,)):
            raise ApiError(404, "Catatan riset tidak ditemukan")
        fields = body.model_dump(exclude_unset=True)
        if not fields:
            raise ApiError(400, "Tidak ada field yang diubah")
        if "status" in fields and fields["status"] not in NOTE_STATUS:
            raise ApiError(400, "status tidak valid")
        sets, params = [], []
        for k, v in fields.items():
            if k == "tags" and v is not None:
                v = json.dumps(v, ensure_ascii=False)
            sets.append(f"{NOTE_COLMAP[k]} = ?")
            params.append(v)
        sets.append("updated_at = ?")
        params.append(now_iso())
        params.append(note_id)
        execute(conn, f"UPDATE research_notes SET {', '.join(sets)} WHERE id = ?", tuple(params))
        write_audit(conn, user, "research.update", "research_note",
                    f"Update riset #{note_id}: {', '.join(fields.keys())}")
        return ok(_note_row(query_one(conn, NOTE_SQL + " WHERE n.id = ?", (note_id,))))
    finally:
        conn.close()


@router.delete("/research/notes/{note_id}")
def delete_note(note_id: int, user: dict = Depends(require_auth("owner", "advisor"))):
    conn = get_conn()
    try:
        guard_mutation(conn)
        row = query_one(conn, "SELECT * FROM research_notes WHERE id = ?", (note_id,))
        if not row:
            raise ApiError(404, "Catatan riset tidak ditemukan")
        execute(conn, "DELETE FROM research_notes WHERE id = ?", (note_id,))
        write_audit(conn, user, "research.delete", "research_note", f"Hapus riset: {row['title']}")
        return ok({"id": note_id, "deleted": True})
    finally:
        conn.close()


# ------------------------------------------------------------ succession rules

def _rule_row(r: dict) -> dict:
    return {
        "id": r["id"], "beneficiaryName": r["beneficiary_name"], "relation": r["relation"],
        "entityName": r["entity_name"] or None, "assetScope": r["asset_scope"],
        "conditions": r["conditions"], "trigger": r["trigger"], "status": r["status"],
        "createdAt": r["created_at"], "updatedAt": r["updated_at"],
    }


@router.get("/succession/rules")
def list_rules(user: dict = Depends(require_auth(*PLANNER_ROLES))):
    conn = get_conn()
    try:
        return ok([_rule_row(r) for r in query(conn, RULE_SQL + " ORDER BY id")])
    finally:
        conn.close()


class RuleBody(BaseModel):
    beneficiaryName: str
    relation: Optional[str] = ""
    entityName: Optional[str] = None
    assetScope: str = ""
    conditions: str = ""
    trigger: str = ""
    status: str = "active"


@router.post("/succession/rules", status_code=201)
def create_rule(body: RuleBody, user: dict = Depends(require_auth("owner"))):
    if body.status not in RULE_STATUS:
        raise ApiError(400, "status tidak valid (active|draft|revoked)")
    conn = get_conn()
    try:
        guard_mutation(conn)
        ts = now_iso()
        new_id = execute(
            conn,
            'INSERT INTO succession_rules(beneficiary_name, relation, entity_name, asset_scope, conditions, '
            '"trigger", status, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
            (body.beneficiaryName.strip(), body.relation or "", body.entityName or "", body.assetScope or "",
             body.conditions or "", body.trigger or "", body.status, ts, ts),
        )
        write_audit(conn, user, "succession.create", "succession_rule",
                    f"Rule suksesi: {body.beneficiaryName}")
        return ok(_rule_row(query_one(conn, RULE_SQL + " WHERE id = ?", (new_id,))))
    finally:
        conn.close()


class RuleUpdate(BaseModel):
    beneficiaryName: Optional[str] = None
    relation: Optional[str] = None
    entityName: Optional[str] = None
    assetScope: Optional[str] = None
    conditions: Optional[str] = None
    trigger: Optional[str] = None
    status: Optional[str] = None


RULE_COLMAP = {"beneficiaryName": "beneficiary_name", "relation": "relation", "entityName": "entity_name",
               "assetScope": "asset_scope", "conditions": "conditions", "trigger": "trigger", "status": "status"}


@router.put("/succession/rules/{rule_id}")
def update_rule(rule_id: int, body: RuleUpdate, user: dict = Depends(require_auth("owner"))):
    conn = get_conn()
    try:
        guard_mutation(conn)
        if not query_one(conn, 'SELECT id FROM succession_rules WHERE id = ?', (rule_id,)):
            raise ApiError(404, "Rule suksesi tidak ditemukan")
        fields = body.model_dump(exclude_unset=True)
        if not fields:
            raise ApiError(400, "Tidak ada field yang diubah")
        if "status" in fields and fields["status"] not in RULE_STATUS:
            raise ApiError(400, "status tidak valid")
        sets, params = [], []
        for k, v in fields.items():
            col = RULE_COLMAP[k]
            sets.append(f'"{col}" = ?' if col == "trigger" else f"{col} = ?")
            params.append(v)
        sets.append("updated_at = ?")
        params.append(now_iso())
        params.append(rule_id)
        execute(conn, f"UPDATE succession_rules SET {', '.join(sets)} WHERE id = ?", tuple(params))
        write_audit(conn, user, "succession.update", "succession_rule", f"Update rule suksesi #{rule_id}")
        return ok(_rule_row(query_one(conn, RULE_SQL + " WHERE id = ?", (rule_id,))))
    finally:
        conn.close()


# ------------------------------------------------------------ emergency

@router.get("/succession/emergency")
def list_emergency(user: dict = Depends(require_auth())):
    """Konten penuh hanya untuk owner; peran lain menerima preview terpotong + sealed=true."""
    conn = get_conn()
    try:
        is_owner = user.get("role") == "owner"
        rows = query(conn, "SELECT * FROM emergency_instructions ORDER BY id")
        data = []
        for r in rows:
            if is_owner:
                content = r["content"]
            else:
                content = (r["content"][:120].rstrip() + "…") if len(r["content"]) > 120 else r["content"]
            data.append({"id": r["id"], "title": r["title"], "content": content,
                         "sealed": (not is_owner) or bool(r["sealed"])})
        return ok(data)
    finally:
        conn.close()


class EmergencyBody(BaseModel):
    title: str
    content: str


@router.post("/succession/emergency", status_code=201)
def create_emergency(body: EmergencyBody, user: dict = Depends(require_auth("owner"))):
    conn = get_conn()
    try:
        guard_mutation(conn)
        ts = now_iso()
        new_id = execute(
            conn,
            "INSERT INTO emergency_instructions(title, content, sealed, created_at, updated_at) VALUES(?,?,0,?,?)",
            (body.title.strip(), body.content, ts, ts),
        )
        write_audit(conn, user, "emergency.create", "emergency", f"Instruksi darurat: {body.title}")
        row = query_one(conn, "SELECT id, title, content, sealed FROM emergency_instructions WHERE id = ?", (new_id,))
        return ok({"id": row["id"], "title": row["title"], "content": row["content"], "sealed": bool(row["sealed"])})
    finally:
        conn.close()


# ------------------------------------------------------------ planning: goals

def _goal_row(r: dict) -> dict:
    target = float(r["target_usd"] or 0)
    current = float(r["current_usd"] or 0)
    return {
        "id": r["id"], "name": r["name"], "targetUsd": r2(target), "currentUsd": r2(current),
        "progressPct": r2(current / target * 100) if target else 0.0,
        "deadline": r["deadline"], "createdAt": r["created_at"],
    }


@router.get("/planning/goals")
def list_goals(user: dict = Depends(require_auth(*PLANNER_ROLES))):
    conn = get_conn()
    try:
        return ok([_goal_row(r) for r in query(conn, "SELECT * FROM goals ORDER BY id")])
    finally:
        conn.close()


class GoalBody(BaseModel):
    name: str
    targetUsd: float
    currentUsd: float = 0.0
    deadline: Optional[str] = None


@router.post("/planning/goals", status_code=201)
def create_goal(body: GoalBody, user: dict = Depends(require_auth("owner"))):
    if body.targetUsd <= 0:
        raise ApiError(400, "targetUsd harus > 0")
    conn = get_conn()
    try:
        guard_mutation(conn)
        new_id = execute(
            conn,
            "INSERT INTO goals(name, target_usd, current_usd, deadline, created_at) VALUES(?,?,?,?,?)",
            (body.name.strip(), body.targetUsd, body.currentUsd, body.deadline, now_iso()),
        )
        write_audit(conn, user, "goal.create", "goal",
                    f"Goal baru: {body.name} (target USD {body.targetUsd:,.0f})")
        return ok(_goal_row(query_one(conn, "SELECT * FROM goals WHERE id = ?", (new_id,))))
    finally:
        conn.close()


# ------------------------------------------------------------ planning: projection

@router.get("/planning/projection")
def projection(
    years: int = Query(30, ge=1, le=100),
    growthPct: float = Query(10.0, ge=-50.0, le=100.0),
    annualContributionUsd: float = Query(50000.0, ge=-1e9, le=1e9),
    user: dict = Depends(require_auth(*PLANNER_ROLES)),
):
    """Compound growth: value(y) = value(y-1) * (1+g) + contribution; value(0) = net worth."""
    conn = get_conn()
    try:
        _, net, _ = compute_portfolio(conn)
        g = growthPct / 100.0
        c = annualContributionUsd
        out = [{"year": 0, "valueUsd": r2(net)}]
        v = net
        for y in range(1, years + 1):
            v = v * (1 + g) + c
            out.append({"year": y, "valueUsd": r2(v)})
        return ok(out)
    finally:
        conn.close()


# ------------------------------------------------------------ planning: capsules

def _capsule_row(r: dict) -> dict:
    unlock_date = r["unlock_date"]
    unlocked = bool(unlock_date) and unlock_date <= now_iso()
    return {
        "id": r["id"], "title": r["title"], "unlockCondition": r["unlock_condition"],
        "unlockDate": unlock_date, "unlocked": unlocked,
        "content": r["content"] if unlocked else None,
    }


@router.get("/planning/capsules")
def list_capsules(user: dict = Depends(require_auth(*PLANNER_ROLES))):
    conn = get_conn()
    try:
        return ok([_capsule_row(r) for r in query(conn, "SELECT * FROM time_capsules ORDER BY id")])
    finally:
        conn.close()


class CapsuleBody(BaseModel):
    title: str
    content: str
    unlockCondition: str = ""
    unlockDate: Optional[str] = None


@router.post("/planning/capsules", status_code=201)
def create_capsule(body: CapsuleBody, user: dict = Depends(require_auth("owner"))):
    conn = get_conn()
    try:
        guard_mutation(conn)
        new_id = execute(
            conn,
            "INSERT INTO time_capsules(title, content, unlock_condition, unlock_date, created_at) "
            "VALUES(?,?,?,?,?)",
            (body.title.strip(), body.content, body.unlockCondition or "", body.unlockDate, now_iso()),
        )
        write_audit(conn, user, "capsule.create", "capsule", f"Time capsule: {body.title}")
        return ok(_capsule_row(query_one(conn, "SELECT * FROM time_capsules WHERE id = ?", (new_id,))))
    finally:
        conn.close()
