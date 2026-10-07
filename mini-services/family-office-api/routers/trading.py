"""Trading: strategies, trades, performance, alerts."""
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from db import execute, get_conn, guard_mutation, query, query_one, r2, write_audit
from errors import ApiError, ok
from security import require_auth

router = APIRouter(tags=["trading"])

READ_ROLES = ("owner", "beneficiary", "advisor")
STRAT_STATUS = {"active", "paused", "archived"}


def _stats_map(conn) -> dict:
    rows = query(
        conn,
        "SELECT strategy_id, COUNT(*) AS total, "
        "SUM(CASE WHEN pnl_usd IS NOT NULL THEN 1 ELSE 0 END) AS closed, "
        "SUM(CASE WHEN pnl_usd > 0 THEN 1 ELSE 0 END) AS wins, "
        "SUM(COALESCE(pnl_usd, 0)) AS pnl, MAX(opened_at) AS last_open "
        "FROM trades GROUP BY strategy_id",
    )
    return {r["strategy_id"]: r for r in rows}


@router.get("/trading/strategies")
def list_strategies(user: dict = Depends(require_auth(*READ_ROLES))):
    conn = get_conn()
    try:
        stats = _stats_map(conn)
        rows = query(conn, "SELECT * FROM strategies ORDER BY id")
        data = []
        for s in rows:
            st = stats.get(s["id"])
            total = int(st["total"] or 0) if st else 0
            closed = int(st["closed"] or 0) if st else 0
            wins = int(st["wins"] or 0) if st else 0
            pnl = float(st["pnl"] or 0) if st else 0.0
            win_rate = r2(wins / closed * 100) if closed else float(s["win_rate_pct"] or 0)
            last_signal = (st["last_open"] if st and st["last_open"] else None) or s["last_signal_at"]
            data.append({
                "id": s["id"], "name": s["name"], "platform": s["platform"], "status": s["status"],
                "description": s["description"], "winRatePct": r2(win_rate), "pnlUsd": r2(pnl),
                "tradeCount": total, "lastSignalAt": last_signal,
            })
        return ok(data)
    finally:
        conn.close()


class StrategyStatusBody(BaseModel):
    status: str


@router.put("/trading/strategies/{strategy_id}")
def update_strategy(strategy_id: int, body: StrategyStatusBody, user: dict = Depends(require_auth("owner"))):
    if body.status not in STRAT_STATUS:
        raise ApiError(400, f"status tidak valid: {body.status} (active|paused|archived)")
    conn = get_conn()
    try:
        guard_mutation(conn)
        row = query_one(conn, "SELECT * FROM strategies WHERE id = ?", (strategy_id,))
        if not row:
            raise ApiError(404, "Strategi tidak ditemukan")
        execute(conn, "UPDATE strategies SET status = ? WHERE id = ?", (body.status, strategy_id))
        write_audit(conn, user, "strategy.update", "strategy", f"{row['name']}: status -> {body.status}")
        return ok({"id": strategy_id, "name": row["name"], "status": body.status})
    finally:
        conn.close()


@router.get("/trading/trades")
def list_trades(strategyId: Optional[int] = None, limit: int = Query(100, ge=1, le=500),
                user: dict = Depends(require_auth(*READ_ROLES))):
    conn = get_conn()
    try:
        sql = ("SELECT t.*, s.name AS strategy_name FROM trades t "
               "LEFT JOIN strategies s ON s.id = t.strategy_id WHERE 1=1")
        params: list = []
        if strategyId is not None:
            sql += " AND t.strategy_id = ?"
            params.append(strategyId)
        sql += " ORDER BY t.opened_at DESC LIMIT ?"
        params.append(limit)
        rows = query(conn, sql, tuple(params))
        return ok([
            {
                "id": r["id"], "strategyId": r["strategy_id"], "strategyName": r.get("strategy_name"),
                "symbol": r["symbol"], "side": r["side"], "quantity": r["quantity"],
                "entryPrice": r["entry_price"], "exitPrice": r["exit_price"],
                "pnlUsd": (r2(r["pnl_usd"]) if r["pnl_usd"] is not None else None),
                "openedAt": r["opened_at"], "closedAt": r["closed_at"],
            }
            for r in rows
        ])
    finally:
        conn.close()


@router.get("/trading/performance")
def performance(user: dict = Depends(require_auth(*READ_ROLES))):
    """PnL per strategi + contributionPct = pnl / totalPnl."""
    conn = get_conn()
    try:
        stats = _stats_map(conn)
        rows = query(conn, "SELECT id, name FROM strategies ORDER BY id")
        data = []
        for s in rows:
            st = stats.get(s["id"], {})
            closed = int(st.get("closed") or 0)
            wins = int(st.get("wins") or 0)
            pnl = float(st.get("pnl") or 0)
            data.append({
                "strategyId": s["id"], "name": s["name"], "pnlUsd": r2(pnl),
                "tradeCount": int(st.get("total") or 0),
                "winRatePct": r2(wins / closed * 100) if closed else 0.0,
                "_raw": pnl,
            })
        total_pnl = sum(d["_raw"] for d in data)
        for d in data:
            d["contributionPct"] = r2(d["_raw"] / total_pnl * 100) if total_pnl else 0.0
            del d["_raw"]
        data.sort(key=lambda x: x["pnlUsd"], reverse=True)
        return ok(data)
    finally:
        conn.close()


@router.get("/trading/alerts")
def trading_alerts(limit: int = Query(30, ge=1, le=200), user: dict = Depends(require_auth(*READ_ROLES))):
    """Daftar notifikasi trading + status baca (isRead, Task U-a).

    Field existing TIDAK diubah (backward-compatible utk dashboard/view Pasar);
    isRead 0/1 dari DB dipetakan ke boolean JSON.
    """
    conn = get_conn()
    try:
        rows = query(conn, "SELECT id, source, level, message, created_at, isRead FROM alerts "
                           "WHERE kind = 'trading' ORDER BY created_at DESC LIMIT ?", (limit,))
        return ok([
            {"id": r["id"], "source": r["source"], "level": r["level"],
             "message": r["message"], "createdAt": r["created_at"],
             "isRead": bool(r["isRead"])}
            for r in rows
        ])
    finally:
        conn.close()


@router.get("/trading/alerts/unread-count")
def trading_alerts_unread_count(user: dict = Depends(require_auth(*READ_ROLES))):
    """Jumlah notifikasi trading yang belum dibaca (isRead = 0)."""
    conn = get_conn()
    try:
        row = query_one(conn, "SELECT COUNT(*) AS c FROM alerts WHERE kind = 'trading' AND isRead = 0")
        return ok({"unread": int(row["c"] if row else 0)})
    finally:
        conn.close()


@router.post("/trading/alerts/read-all")
def trading_alerts_read_all(user: dict = Depends(require_auth(*READ_ROLES))):
    """Tandai SEMUA notifikasi trading sudah dibaca (idempotent)."""
    conn = get_conn()
    try:
        guard_mutation(conn)
        row = query_one(conn, "SELECT COUNT(*) AS c FROM alerts WHERE kind = 'trading' AND isRead = 0")
        unread = int(row["c"] if row else 0)
        if unread:
            execute(conn, "UPDATE alerts SET isRead = 1 WHERE kind = 'trading'")
        write_audit(conn, user, "alert.read_all", "alert",
                    f"Tandai semua alert trading dibaca ({unread} item)")
        return ok({"updated": unread})
    finally:
        conn.close()


@router.post("/trading/alerts/{alert_id}/read")
def trading_alert_read(alert_id: int, user: dict = Depends(require_auth(*READ_ROLES))):
    """Tandai satu notifikasi trading sudah dibaca (idempotent)."""
    conn = get_conn()
    try:
        guard_mutation(conn)
        row = query_one(conn, "SELECT id, message FROM alerts WHERE id = ? AND kind = 'trading'", (alert_id,))
        if not row:
            raise ApiError(404, "Alert tidak ditemukan")
        execute(conn, "UPDATE alerts SET isRead = 1 WHERE id = ?", (alert_id,))
        write_audit(conn, user, "alert.read", "alert",
                    f"Tandai dibaca alert #{alert_id}: {(row['message'] or '')[:60]}")
        return ok({"id": alert_id, "isRead": True})
    finally:
        conn.close()
