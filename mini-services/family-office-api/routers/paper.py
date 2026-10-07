"""Paper Trading Sandbox (PRD #23) — trading virtual, tidak menyentuh aset riil.

State:
- paper_state  (baris tunggal id=1): cashUsd (awal 100.000) + realizedPnlUsd.
- paper_trades : log semua order virtual (buy/sell) dengan harga fill dari
  price engine pada saat order.

Posisi turunan dari paper_trades (moving average cost):
- buy  : avg = (avg*qty_lama + price*qty) / qty_baru ; cash -= price*qty
- sell : avg tetap ; realized = (price - avg) * qty ; cash += price*qty
         realized ditambahkan ke paper_state.realizedPnlUsd dan disimpan di
         kolom realizedPnlUsd pada row trade tsb.

RBAC: read owner/beneficiary/advisor (executor 403); POST owner saja.
Semua mutasi melewati panic guard (423) + audit log.
"""
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from db import execute, get_conn, guard_mutation, now_iso, query, query_one, r2, write_audit
from errors import ApiError, ok
from prices import get_rates
from security import require_auth

router = APIRouter(prefix="/trading/paper", tags=["paper-trading"])

READ_ROLES = ("owner", "beneficiary", "advisor")
SIDES = {"buy", "sell"}
EPS = 1e-9


class OrderBody(BaseModel):
    symbol: str
    side: str
    qty: float


def _load_state(conn) -> dict:
    row = query_one(conn, "SELECT * FROM paper_state WHERE id = 1")
    if not row:  # defensive: state hilang -> reseed
        execute(conn, "INSERT INTO paper_state(id, cashUsd, realizedPnlUsd) VALUES(1, 100000, 0)")
        row = query_one(conn, "SELECT * FROM paper_state WHERE id = 1")
    return {"cashUsd": float(row["cashUsd"] or 0.0), "realizedPnlUsd": float(row["realizedPnlUsd"] or 0.0)}


def _derive_positions(conn) -> tuple:
    """Replay paper_trades (urut id) -> (positions_map, cash, realized).

    positions_map: {symbol: {"qty": float, "avg": float}}
    """
    rows = query(conn, "SELECT * FROM paper_trades ORDER BY id ASC")
    cash = _load_state(conn)  # placeholder agar state selalu ada; nilai dihitung ulang di bawah
    positions: dict = {}
    realized_total = 0.0
    cash_bal = 0.0
    for t in rows:
        sym, side = (t["symbol"] or "").upper(), t["side"]
        qty, price = float(t["qty"] or 0.0), float(t["priceUsd"] or 0.0)
        pos = positions.setdefault(sym, {"qty": 0.0, "avg": 0.0})
        if side == "buy":
            new_qty = pos["qty"] + qty
            pos["avg"] = ((pos["avg"] * pos["qty"]) + (price * qty)) / new_qty if new_qty > EPS else 0.0
            pos["qty"] = new_qty
            cash_bal -= price * qty
        else:  # sell
            if pos["qty"] + EPS >= qty:
                realized = (price - pos["avg"]) * qty
                realized_total += realized
                pos["qty"] -= qty
                cash_bal += price * qty
                if pos["qty"] <= EPS:
                    pos["qty"] = 0.0
                    pos["avg"] = 0.0
    return positions, cash_bal, realized_total


def _account_payload(conn) -> dict:
    state = _load_state(conn)
    prices = get_rates()["prices"]
    positions, _cash, _realized = _derive_positions(conn)
    # Nilai resmi diambil dari paper_state (authoritative) — replay hanya untuk posisi.
    out_positions = []
    equity = state["cashUsd"]
    for sym in sorted(positions.keys()):
        p = positions[sym]
        if p["qty"] <= EPS:
            continue
        cur = float((prices.get(sym) or {}).get("usd") or 0.0)
        value = p["qty"] * cur
        equity += value
        out_positions.append({
            "symbol": sym,
            "qty": round(p["qty"], 10),
            "avgPriceUsd": r2(p["avg"]),
            "currentPriceUsd": r2(cur),
            "valueUsd": r2(value),
            "unrealizedPnlUsd": r2((cur - p["avg"]) * p["qty"]),
        })
    return {
        "cashUsd": r2(state["cashUsd"]),
        "realizedPnlUsd": r2(state["realizedPnlUsd"]),
        "equityUsd": r2(equity),
        "positions": out_positions,
    }


@router.get("/account")
def paper_account(user: dict = Depends(require_auth(*READ_ROLES))):
    conn = get_conn()
    try:
        return ok(_account_payload(conn))
    finally:
        conn.close()


@router.get("/trades")
def paper_trades(limit: int = Query(100, ge=1, le=500),
                 user: dict = Depends(require_auth(*READ_ROLES))):
    conn = get_conn()
    try:
        rows = query(conn, "SELECT * FROM paper_trades ORDER BY id DESC LIMIT ?", (limit,))
        return ok([
            {
                "id": r["id"],
                "symbol": (r["symbol"] or "").upper(),
                "side": r["side"],
                "qty": float(r["qty"] or 0.0),
                "priceUsd": r2(r["priceUsd"]),
                "realizedPnlUsd": r2(r["realizedPnlUsd"]) if r["realizedPnlUsd"] is not None else None,
                "at": r["at"],
            }
            for r in rows
        ])
    finally:
        conn.close()


@router.post("/orders")
def paper_order(body: OrderBody, user: dict = Depends(require_auth("owner"))):
    symbol = (body.symbol or "").strip().upper()
    side = (body.side or "").strip().lower()
    if not symbol:
        raise ApiError(400, "symbol wajib diisi")
    if side not in SIDES:
        raise ApiError(400, "side harus 'buy' atau 'sell'")
    if body.qty is None or body.qty <= 0:
        raise ApiError(400, "qty harus lebih besar dari 0")

    prices = get_rates()["prices"]
    if symbol not in prices:
        raise ApiError(404, f"Simbol {symbol} tidak dikenal di price engine")
    price = float(prices[symbol]["usd"])

    conn = get_conn()
    try:
        guard_mutation(conn)
        positions, _, _ = _derive_positions(conn)
        pos = positions.get(symbol, {"qty": 0.0, "avg": 0.0})
        state = _load_state(conn)
        cash, realized = state["cashUsd"], state["realizedPnlUsd"]

        realized_row = None
        if side == "buy":
            cash = r2(cash - price * body.qty)
        else:
            if pos["qty"] + EPS < body.qty:
                raise ApiError(400, f"Posisi tidak cukup — {symbol} tersedia {round(pos['qty'], 10)} di paper trading")
            realized_row = (price - pos["avg"]) * body.qty
            realized = r2(realized + realized_row)
            cash = r2(cash + price * body.qty)

        trade_id = execute(
            conn,
            "INSERT INTO paper_trades(symbol, side, qty, priceUsd, realizedPnlUsd, at) VALUES(?,?,?,?,?,?)",
            (symbol, side, body.qty, price, realized_row, now_iso()),
        )
        execute(conn, "UPDATE paper_state SET cashUsd = ?, realizedPnlUsd = ? WHERE id = 1", (cash, realized))
        write_audit(conn, user, "paper.order", "paper_trade",
                    f"Paper {side} {body.qty} {symbol} @ ${r2(price)} (fill engine live) — trade #{trade_id}")
        return ok(_account_payload(conn))
    finally:
        conn.close()


@router.post("/reset")
def paper_reset(user: dict = Depends(require_auth("owner"))):
    conn = get_conn()
    try:
        guard_mutation(conn)
        execute(conn, "DELETE FROM paper_trades")
        execute(conn, "UPDATE paper_state SET cashUsd = 100000, realizedPnlUsd = 0 WHERE id = 1")
        write_audit(conn, user, "paper.reset", "paper_state",
                    "Reset paper trading sandbox — trade log dihapus, cash kembali $100.000")
        return ok(_account_payload(conn))
    finally:
        conn.close()
