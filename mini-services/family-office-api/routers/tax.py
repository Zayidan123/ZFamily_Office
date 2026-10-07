"""Tax & Kepatuhan: kewajiban pajak keluarga + ringkasan estimasi."""
import re
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from db import execute, get_conn, guard_mutation, now_iso, query, query_one, r2, write_audit
from errors import ApiError, ok
from security import require_auth

router = APIRouter(tags=["tax"])

# Flat demo rate — estimasi sederhana PPh orang pribadi (bukan konsultasi pajak riil).
TAX_RATE_DEMO = 0.05

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _parse_date(s: str) -> date:
    """Validasi format YYYY-MM-DD (lempar 400 bila tidak valid)."""
    if not s or not DATE_RE.match(s):
        raise ApiError(400, "dueDate harus format YYYY-MM-DD")
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        raise ApiError(400, "dueDate bukan tanggal kalender yang valid")


def _today() -> date:
    return datetime.now(timezone.utc).date()


def _status(row: dict) -> str:
    """Status dihitung backend: paid > overdue > due_soon > upcoming."""
    if row["paid"]:
        return "paid"
    due = _parse_date(row["dueDate"])
    today = _today()
    if due < today:
        return "overdue"
    if due <= today + timedelta(days=7):
        return "due_soon"
    return "upcoming"


def _tax_row(r: dict) -> dict:
    return {
        "id": r["id"],
        "name": r["name"],
        "type": r["type"],
        "period": r["period"],
        "dueDate": r["dueDate"],
        "amountUsd": r2(r["amountUsd"]) if r["amountUsd"] is not None else None,
        "paid": bool(r["paid"]),
        "paidAt": r["paidAt"],
        "notes": r.get("notes") or "",
        "status": _status(r),
    }


@router.get("/tax/obligations")
def list_obligations(user: dict = Depends(require_auth("owner", "beneficiary", "advisor"))):
    conn = get_conn()
    try:
        rows = query(conn, "SELECT * FROM tax_obligations ORDER BY dueDate ASC, id ASC")
        return ok([_tax_row(r) for r in rows])
    finally:
        conn.close()


class TaxBody(BaseModel):
    name: str
    type: str
    period: str
    dueDate: str
    amountUsd: Optional[float] = None
    notes: Optional[str] = ""


@router.post("/tax/obligations", status_code=201)
def create_obligation(body: TaxBody, user: dict = Depends(require_auth("owner"))):
    name = (body.name or "").strip()
    type_ = (body.type or "").strip()
    period = (body.period or "").strip()
    if not name:
        raise ApiError(400, "name wajib diisi")
    if not type_:
        raise ApiError(400, "type wajib diisi")
    if not period:
        raise ApiError(400, "period wajib diisi")
    _parse_date(body.dueDate)  # validasi format + kalender
    if body.amountUsd is not None and body.amountUsd < 0:
        raise ApiError(400, "amountUsd tidak boleh negatif")
    conn = get_conn()
    try:
        guard_mutation(conn)
        new_id = execute(
            conn,
            "INSERT INTO tax_obligations(name, type, period, dueDate, amountUsd, paid, paidAt, notes, createdAt) "
            "VALUES(?,?,?,?,?,0,NULL,?,?)",
            (name, type_, period, body.dueDate, body.amountUsd, (body.notes or "").strip(), now_iso()),
        )
        write_audit(conn, user, "tax.create", "tax_obligation",
                    f"Tambah kewajiban pajak: {name} (jatuh tempo {body.dueDate})")
        row = query_one(conn, "SELECT * FROM tax_obligations WHERE id = ?", (new_id,))
        return ok(_tax_row(row))
    finally:
        conn.close()


class TaxUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    period: Optional[str] = None
    dueDate: Optional[str] = None
    amountUsd: Optional[float] = None
    notes: Optional[str] = None
    paid: Optional[bool] = None


@router.put("/tax/obligations/{item_id}")
def update_obligation(item_id: int, body: TaxUpdate, user: dict = Depends(require_auth("owner"))):
    conn = get_conn()
    try:
        guard_mutation(conn)
        if not query_one(conn, "SELECT id FROM tax_obligations WHERE id = ?", (item_id,)):
            raise ApiError(404, "Kewajiban pajak tidak ditemukan")
        fields = body.model_dump(exclude_unset=True)
        if not fields:
            raise ApiError(400, "Tidak ada field yang diubah")
        if "dueDate" in fields and fields["dueDate"] is not None:
            _parse_date(fields["dueDate"])
        if fields.get("amountUsd") is not None and fields["amountUsd"] < 0:
            raise ApiError(400, "amountUsd tidak boleh negatif")

        sets, params = [], []
        for k in ("name", "type", "period", "dueDate", "amountUsd", "notes"):
            if k in fields and fields[k] is not None:
                v = fields[k]
                sets.append(f"{k} = ?")
                params.append(v.strip() if isinstance(v, str) else v)
        if "paid" in fields and fields["paid"] is not None:
            # Khusus paid: toggle status bayar -> set/bersihkan paidAt (ISO sekarang)
            paid = bool(fields["paid"])
            sets.append("paid = ?")
            params.append(1 if paid else 0)
            sets.append("paidAt = ?")
            params.append(now_iso() if paid else None)
        if not sets:
            raise ApiError(400, "Tidak ada field yang diubah")
        params.append(item_id)
        execute(conn, f"UPDATE tax_obligations SET {', '.join(sets)} WHERE id = ?", tuple(params))
        write_audit(conn, user, "tax.update", "tax_obligation",
                    f"Update kewajiban pajak #{item_id}: {', '.join(fields.keys())}")
        row = query_one(conn, "SELECT * FROM tax_obligations WHERE id = ?", (item_id,))
        return ok(_tax_row(row))
    finally:
        conn.close()


@router.delete("/tax/obligations/{item_id}")
def delete_obligation(item_id: int, user: dict = Depends(require_auth("owner"))):
    conn = get_conn()
    try:
        guard_mutation(conn)
        row = query_one(conn, "SELECT * FROM tax_obligations WHERE id = ?", (item_id,))
        if not row:
            raise ApiError(404, "Kewajiban pajak tidak ditemukan")
        execute(conn, "DELETE FROM tax_obligations WHERE id = ?", (item_id,))
        write_audit(conn, user, "tax.delete", "tax_obligation", f"Hapus kewajiban pajak: {row['name']}")
        return ok({"id": item_id, "deleted": True})
    finally:
        conn.close()


# ------------------------------------------------------------------ summary

@router.get("/tax/summary")
def tax_summary(user: dict = Depends(require_auth("owner", "beneficiary", "advisor"))):
    conn = get_conn()
    try:
        year_start = f"{_today().year}-01-01"
        income_row = query_one(
            conn,
            "SELECT COALESCE(SUM(total_usd), 0) AS total FROM transactions "
            "WHERE type = 'income' AND at >= ?",
            (year_start,),
        )
        income = r2(income_row["total"])
        rows = query(conn, "SELECT * FROM tax_obligations")

        paid_count = upcoming = due_soon = overdue = 0
        next_due = None
        today = _today()
        for r in rows:
            st = _status(r)
            if st == "paid":
                paid_count += 1
            elif st == "overdue":
                overdue += 1
            elif st == "due_soon":
                due_soon += 1
            else:
                upcoming += 1
            if not r["paid"] and (next_due is None or r["dueDate"] < next_due["dueDate"]):
                next_due = {"name": r["name"], "dueDate": r["dueDate"], "amountUsd": r2(r["amountUsd"])}

        return ok({
            "estimatedAnnualIncomeUsd": income,
            "estimatedTaxUsd": r2(income * TAX_RATE_DEMO),
            "paidCount": paid_count,
            "upcomingCount": upcoming,
            "dueSoonCount": due_soon,
            "overdueCount": overdue,
            "nextDue": next_due,
        })
    finally:
        conn.close()
