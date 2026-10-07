"""Price Alert: alert threshold per simbol + evaluasi LAZY terhadap harga live.

- GET    /market/alerts              -> daftar alert; SEBELUM return, semua alert
                                        'active' dievaluasi ke harga live (prices.get_rates).
                                        Yang menembus threshold -> status 'triggered' +
                                        audit + 1 notifikasi ke tabel alerts (pusat dashboard).
- POST   /market/alerts              -> buat alert (owner; panic-guard).
- POST   /market/alerts/{id}/dismiss -> active/triggered -> dismissed (owner; panic-guard).
- DELETE /market/alerts/{id}         -> hapus alert (owner; panic-guard).

Konvensi notifikasi pusat (tabel `alerts`): message diawali prefix "[alert#<id>]"
agar dedupe 24 jam & tracing tetap bisa dilakukan tanpa kolom tambahan.
Harga pembanding memakai mata uang kutipan simbol (IDR utk BBCA/BBRI/TLKM, USD lainnya).
"""
import math
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from db import execute, get_conn, guard_mutation, now_iso, query, query_one, r2, write_audit
from errors import ApiError, ok
from prices import get_rates
from security import require_auth
from .notify_channels import deliver_notification

router = APIRouter(tags=["market"])

READ_ROLES = ("owner", "beneficiary", "advisor")   # executor -> 403
NOTIFY_SOURCE = "price-watch"
NOTIFY_LEVEL = "warning"
DEDUP_HOURS = 24
_STATUS_RANK = {"triggered": 0, "active": 1, "dismissed": 2}


# ------------------------------------------------------------------ helpers

def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _rates_prices() -> dict:
    """Peta harga live engine: {SYM: {usd, idr?, quote?, change24hPct}}."""
    return get_rates()["prices"]


def _quote_price(symbol: str, prices: dict) -> tuple:
    """(hargaPembanding, mataUangKutipan) — IDR utk saham IDX, USD untuk lainnya.

    Payload get_rates() hanya menyertakan key "idr" untuk simbol kutipan-IDR
    (BBCA/BBRI/TLKM) — itu penanda kutipannya, bukan konversi.
    """
    e = prices.get(symbol)
    if not e:
        return None, None
    if "idr" in e:
        return float(e["idr"]), "IDR"
    return float(e["usd"]), "USD"


def _fmt_price(price: float, currency: str) -> str:
    if currency == "IDR":
        return f"Rp {price:,.0f}"
    if price >= 1000:
        return f"${price:,.0f}"
    if price >= 1:
        return f"${price:,.2f}"
    return f"${price:,.4f}"


def _alert_row(r: dict, prices: dict) -> dict:
    price, cur = _quote_price(r["symbol"], prices)
    return {
        "id": r["id"],
        "symbol": r["symbol"],
        "direction": r["direction"],
        "threshold": r2(r["threshold"]),
        "status": r["status"],
        "note": r["note"] or "",
        "createdAt": r["createdAt"],
        "triggeredAt": r["triggeredAt"],
        "currentPrice": r2(price) if price is not None else None,
        "quote": cur,
    }


def _notify_trigger(conn, alert_id: int, symbol: str, direction: str,
                    threshold: float, price: float, currency: str) -> None:
    """Append 1 row ke tabel alerts (pusat notifikasi) — anti duplikat 24 jam."""
    prefix = f"[alert#{alert_id}]"
    cutoff = _iso(datetime.now(timezone.utc) - timedelta(hours=DEDUP_HOURS))
    dup = query_one(
        conn,
        "SELECT id FROM alerts WHERE source = ? AND message LIKE ? AND created_at >= ? LIMIT 1",
        (NOTIFY_SOURCE, f"{prefix}%", cutoff),
    )
    if dup:
        return
    arah = "ke atas" if direction == "above" else "ke bawah"
    message = (f"{prefix} 🔔 {symbol} menembus {arah} {_fmt_price(threshold, currency)} "
               f"— sekarang {_fmt_price(price, currency)}")
    execute(
        conn,
        "INSERT INTO alerts(kind, source, level, message, created_at) VALUES('trading', ?, ?, ?, ?)",
        (NOTIFY_SOURCE, NOTIFY_LEVEL, message, now_iso()),
    )
    # ronde 9: fan-out ke kanal eksternal aktif (email/telegram — mock delivery)
    deliver_notification(conn, NOTIFY_SOURCE, message)


# --------------------------------------------------------------------- list

@router.get("/market/alerts")
def list_price_alerts(user: dict = Depends(require_auth(*READ_ROLES))):
    """Daftar price alert + evaluasi lazy terhadap harga live.

    triggeredCount = jumlah alert berstatus 'triggered' SETELAH evaluasi
    (termasuk yang terpicu di request ini / dari seed).
    Urutan: triggered (triggeredAt desc) -> active (createdAt desc) -> dismissed.
    """
    conn = get_conn()
    try:
        prices = _rates_prices()

        # ---- evaluasi lazy semua alert active ---------------------------
        for r in query(conn, "SELECT * FROM price_alerts WHERE status = 'active'"):
            price, cur = _quote_price(r["symbol"], prices)
            if price is None:
                continue  # simbol tidak lagi ada di engine -> biarkan
            hit = price >= r["threshold"] if r["direction"] == "above" else price <= r["threshold"]
            if not hit:
                continue
            execute(conn, "UPDATE price_alerts SET status = 'triggered', triggeredAt = ? WHERE id = ?",
                    (now_iso(), r["id"]))
            write_audit(conn, user, "price_alert.triggered", "price_alert",
                        f"{r['symbol']} {r['direction']} {r2(r['threshold'])}")
            _notify_trigger(conn, r["id"], r["symbol"], r["direction"], r["threshold"], price, cur)

        # ---- susun respons ----------------------------------------------
        rows = query(conn, "SELECT * FROM price_alerts")
        rows.sort(key=lambda r: (r["triggeredAt"] if r["status"] == "triggered"
                                 else (r["createdAt"] or "")), reverse=True)
        rows.sort(key=lambda r: _STATUS_RANK.get(r["status"], 3))  # stable sort
        items = [_alert_row(r, prices) for r in rows]
        return ok({"alerts": items, "triggeredCount": sum(1 for i in items if i["status"] == "triggered")})
    finally:
        conn.close()


# -------------------------------------------------------------------- create

class AlertBody(BaseModel):
    symbol: str
    direction: str
    threshold: float
    note: Optional[str] = ""


@router.post("/market/alerts", status_code=201)
def create_price_alert(body: AlertBody, user: dict = Depends(require_auth("owner"))):
    prices = _rates_prices()
    symbol = (body.symbol or "").strip().upper()
    direction = (body.direction or "").strip().lower()
    threshold = float(body.threshold)
    if not symbol or symbol not in prices:
        raise ApiError(400, "Simbol tidak dikenal")
    if direction not in ("above", "below"):
        raise ApiError(400, "direction harus 'above' atau 'below'")
    if not math.isfinite(threshold) or threshold <= 0:
        raise ApiError(400, "threshold harus angka > 0")
    conn = get_conn()
    try:
        guard_mutation(conn)
        new_id = execute(
            conn,
            "INSERT INTO price_alerts(symbol, direction, threshold, status, note, createdAt, triggeredAt) "
            "VALUES(?, ?, ?, 'active', ?, ?, NULL)",
            (symbol, direction, threshold, (body.note or "").strip(), now_iso()),
        )
        _, cur = _quote_price(symbol, prices)
        write_audit(conn, user, "price_alert.create", "price_alert",
                    f"Price alert dibuat: {symbol} {direction} {_fmt_price(threshold, cur)}")
        row = query_one(conn, "SELECT * FROM price_alerts WHERE id = ?", (new_id,))
        return ok(_alert_row(row, prices))
    finally:
        conn.close()


# ------------------------------------------------------------------- dismiss

@router.post("/market/alerts/{alert_id}/dismiss")
def dismiss_price_alert(alert_id: int, user: dict = Depends(require_auth("owner"))):
    conn = get_conn()
    try:
        guard_mutation(conn)
        row = query_one(conn, "SELECT * FROM price_alerts WHERE id = ?", (alert_id,))
        if not row:
            raise ApiError(404, "Price alert tidak ditemukan")
        if row["status"] == "dismissed":
            raise ApiError(400, "Alert sudah dalam status dismissed")
        execute(conn, "UPDATE price_alerts SET status = 'dismissed' WHERE id = ?", (alert_id,))
        write_audit(conn, user, "price_alert.dismiss", "price_alert",
                    f"Dismiss price alert #{alert_id}: {row['symbol']} {row['direction']} {r2(row['threshold'])}")
        row = query_one(conn, "SELECT * FROM price_alerts WHERE id = ?", (alert_id,))
        return ok(_alert_row(row, _rates_prices()))
    finally:
        conn.close()


# -------------------------------------------------------------------- delete

@router.delete("/market/alerts/{alert_id}")
def delete_price_alert(alert_id: int, user: dict = Depends(require_auth("owner"))):
    conn = get_conn()
    try:
        guard_mutation(conn)
        row = query_one(conn, "SELECT * FROM price_alerts WHERE id = ?", (alert_id,))
        if not row:
            raise ApiError(404, "Price alert tidak ditemukan")
        execute(conn, "DELETE FROM price_alerts WHERE id = ?", (alert_id,))
        write_audit(conn, user, "price_alert.delete", "price_alert",
                    f"Hapus price alert #{alert_id}: {row['symbol']} {row['direction']} {r2(row['threshold'])}")
        return ok({"id": alert_id, "deleted": True})
    finally:
        conn.close()
