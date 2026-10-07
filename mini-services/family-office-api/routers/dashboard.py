"""Dashboard: summary (net worth live), history snapshot, snapshot manual."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query

from db import execute, get_conn, guard_mutation, now_iso, query, query_one, r2, write_audit
from errors import ok
from prices import compute_portfolio
from security import require_auth

router = APIRouter(tags=["dashboard"])


def _tx_row(t: dict) -> dict:
    return {
        "id": t["id"],
        "assetId": t["asset_id"],
        "assetName": t.get("asset_name"),
        "type": t["type"],
        "quantity": t["quantity"],
        "priceUsd": r2(t.get("price_usd")),
        "totalUsd": r2(t.get("total_usd")),
        "feeUsd": r2(t.get("fee_usd")),
        "note": t.get("note") or "",
        "at": t["at"],
    }


@router.get("/dashboard/summary")
def summary(user: dict = Depends(require_auth())):
    conn = get_conn()
    try:
        items, net_usd, net_idr = compute_portfolio(conn)
        net = net_usd or 0.0

        # agregasi per kelas + change24h berbobot value
        by_class = {}
        for it in items:
            c = by_class.setdefault(it["asset_class"], {"value": 0.0, "weighted": 0.0})
            c["value"] += it["valueUsd"]
            c["weighted"] += it["valueUsd"] * (it["change24hPct"] or 0.0)
        byClass = [
            {
                "class": cls,
                "valueUsd": r2(c["value"]),
                "pct": r2(c["value"] / net * 100) if net else 0.0,
                "change24hPct": r2(c["weighted"] / c["value"]) if c["value"] else 0.0,
            }
            for cls, c in sorted(by_class.items(), key=lambda kv: kv[1]["value"], reverse=True)
        ]

        change24h = r2(sum(i["valueUsd"] * (i["change24hPct"] or 0.0) for i in items) / net) if net else 0.0

        counts = {
            "assets": len(items),
            "entities": query_one(conn, "SELECT COUNT(*) AS c FROM entities")["c"],
            "strategies": query_one(conn, "SELECT COUNT(*) AS c FROM strategies")["c"],
            "pendingApprovals": query_one(conn, "SELECT COUNT(*) AS c FROM approvals WHERE status = 'pending'")["c"],
        }

        txs = query(
            conn,
            "SELECT t.*, a.name AS asset_name FROM transactions t LEFT JOIN assets a ON a.id = t.asset_id "
            "ORDER BY t.at DESC, t.id DESC LIMIT 6",
        )
        alerts = query(conn, "SELECT id, kind, source, level, message, created_at FROM alerts "
                             "ORDER BY created_at DESC LIMIT 5")

        top = [
            {
                "id": it["id"], "name": it["name"], "assetClass": it["asset_class"], "symbol": it["symbol"],
                "valueUsd": r2(it["valueUsd"]), "pct": r2(it["valueUsd"] / net * 100) if net else 0.0,
            }
            for it in items[:5]
        ]

        return ok({
            "netWorthUsd": r2(net),
            "netWorthIdr": r2(net_idr),
            "change24hPct": change24h,
            "byClass": byClass,
            "counts": counts,
            "recentTransactions": [_tx_row(t) for t in txs],
            "alerts": [
                {"id": a["id"], "kind": a["kind"], "source": a["source"], "level": a["level"],
                 "message": a["message"], "createdAt": a["created_at"]}
                for a in alerts
            ],
            "topHoldings": top,
        })
    finally:
        conn.close()


@router.get("/dashboard/history")
def history(months: int = Query(18, ge=1, le=240), user: dict = Depends(require_auth())):
    conn = get_conn()
    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=months * 30)).strftime("%Y-%m-%d")
        rows = query(conn, "SELECT date, value_usd FROM portfolio_snapshots WHERE date >= ? ORDER BY date ASC",
                     (cutoff,))
        return ok([{"date": r["date"], "valueUsd": r2(r["value_usd"])} for r in rows])
    finally:
        conn.close()


@router.post("/dashboard/snapshot")
def snapshot(user: dict = Depends(require_auth("owner"))):
    """Simpan total net worth USD sekarang ke portfolio_snapshots."""
    conn = get_conn()
    try:
        guard_mutation(conn)
        _, net_usd, _ = compute_portfolio(conn)
        snap_id = execute(conn, "INSERT INTO portfolio_snapshots(date, value_usd, created_at) VALUES(?,?,?)",
                          (now_iso()[:10], r2(net_usd), now_iso()))
        write_audit(conn, user, "snapshot.create", "snapshot", f"Snapshot portofolio: ${r2(net_usd):,.2f}")
        row = query_one(conn, "SELECT id, date, value_usd FROM portfolio_snapshots WHERE id = ?", (snap_id,))
        return ok({"id": row["id"], "date": row["date"], "valueUsd": r2(row["value_usd"])})
    finally:
        conn.close()
