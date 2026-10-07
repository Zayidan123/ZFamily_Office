"""Market: watchlist pribadi + daftar simbol engine + histori harga deterministik."""
import random
from datetime import timedelta, timezone, datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from db import execute, get_conn, guard_mutation, now_iso, query, query_one, write_audit
from errors import ApiError, ok
from prices import VOLATILITY, get_rates
from security import require_auth

router = APIRouter(tags=["market"])

DEFAULT_VOL = 0.020  # volatilitas harian fallback bila simbol tidak ada di prices.VOLATILITY


def _rates_prices() -> dict:
    """Peta harga live engine: {SYM: {usd, change24hPct, ...}}."""
    return get_rates()["prices"]


# --------------------------------------------------------------- watchlist

def _watch_row(r: dict, prices: dict) -> dict:
    sym = (r["symbol"] or "").upper()
    e = prices.get(sym) or {}
    return {
        "id": r["id"],
        "symbol": sym,
        "note": r.get("note") or "",
        "addedAt": r["addedAt"],
        "price": {"usd": e.get("usd"), "change24hPct": e.get("change24hPct", 0.0)},
    }


@router.get("/market/watchlist")
def list_watchlist(user: dict = Depends(require_auth("owner", "beneficiary", "advisor"))):
    conn = get_conn()
    try:
        prices = _rates_prices()
        rows = query(conn, "SELECT * FROM watchlist ORDER BY id ASC")
        return ok([_watch_row(r, prices) for r in rows])
    finally:
        conn.close()


class WatchBody(BaseModel):
    symbol: str
    note: Optional[str] = ""


@router.post("/market/watchlist", status_code=201)
def add_watchlist(body: WatchBody, user: dict = Depends(require_auth("owner"))):
    symbol = (body.symbol or "").strip().upper()
    if not symbol:
        raise ApiError(400, "Simbol tidak dikenal")
    prices = _rates_prices()
    if symbol not in prices:
        raise ApiError(400, "Simbol tidak dikenal")
    conn = get_conn()
    try:
        guard_mutation(conn)
        if query_one(conn, "SELECT id FROM watchlist WHERE symbol = ?", (symbol,)):
            raise ApiError(400, f"Simbol {symbol} sudah ada di watchlist")
        new_id = execute(conn, "INSERT INTO watchlist(symbol, note, addedAt) VALUES(?,?,?)",
                         (symbol, (body.note or "").strip(), now_iso()))
        write_audit(conn, user, "watchlist.create", "watchlist", f"Tambah watchlist: {symbol}")
        row = query_one(conn, "SELECT * FROM watchlist WHERE id = ?", (new_id,))
        return ok(_watch_row(row, prices))
    finally:
        conn.close()


@router.delete("/market/watchlist/{item_id}")
def delete_watchlist(item_id: int, user: dict = Depends(require_auth("owner"))):
    conn = get_conn()
    try:
        guard_mutation(conn)
        row = query_one(conn, "SELECT * FROM watchlist WHERE id = ?", (item_id,))
        if not row:
            raise ApiError(404, "Item watchlist tidak ditemukan")
        execute(conn, "DELETE FROM watchlist WHERE id = ?", (item_id,))
        write_audit(conn, user, "watchlist.delete", "watchlist", f"Hapus watchlist: {row['symbol']}")
        return ok({"id": item_id, "deleted": True})
    finally:
        conn.close()


# ----------------------------------------------------------------- symbols

@router.get("/market/symbols")
def list_symbols(user: dict = Depends(require_auth())):
    """Semua simbol yang tersedia di price engine (untuk dropdown watchlist)."""
    prices = _rates_prices()
    return ok([
        {"symbol": sym, "usd": e.get("usd"), "change24hPct": e.get("change24hPct", 0.0)}
        for sym, e in sorted(prices.items())
    ])


# ----------------------------------------------------------------- history

def _round_price(p: float) -> float:
    return round(p, 2) if p >= 100 else round(p, 4)


def history_points(symbol: str, days: int) -> list:
    """Histori harga harian DETERMINISTIK (seed tetap per symbol+days).

    Walk mundur dari harga live sekarang; langkah harian memakai volatilitas
    per simbol yang sama polanya dengan prices.py (uniform ±vol).
    Raises ApiError(404) bila simbol tidak dikenal engine. `days` TIDAK
    di-clamp di sini (pemanggil yang menentukan).

    Dipakai endpoint /market/history DAN benchmark analytics (Task V-a):
    analytics memanggil dgn days TETAP (BENCH_HISTORY_DAYS) sehingga seed
    hanya bergantung simbol -> kunci bulan yang sama selalu menghasilkan
    close bulanan yang sama di semua panjang window (sifat sufiks).
    """
    sym = (symbol or "").strip().upper()
    prices = _rates_prices()
    if sym not in prices:
        raise ApiError(404, "Simbol tidak dikenal")
    days = int(days)

    now_usd = float(prices[sym]["usd"])
    vol = VOLATILITY.get(sym, DEFAULT_VOL)
    rng = random.Random(f"{sym}-{days}")  # seed tetap -> respons identik antar-request

    today = datetime.now(timezone.utc).date()
    # Bangun harga mundur: p[t-1] = p[t] / (1 + r), r = uniform(-vol, vol)
    series = [now_usd]
    for _ in range(days - 1):
        r = rng.uniform(-vol, vol)
        series.append(series[-1] / (1.0 + r))
    series.reverse()  # urut waktu naik; titik terakhir = harga sekarang

    points = []
    for i, p in enumerate(series):
        d = today - timedelta(days=(days - 1 - i))
        points.append({"date": d.strftime("%Y-%m-%d"), "price": _round_price(p)})
    return points


@router.get("/market/history")
def market_history(symbol: str, days: int = Query(30), user: dict = Depends(require_auth())):
    """Histori harga harian DETERMINISTIK (seed tetap per symbol+days) — lihat history_points()."""
    sym = (symbol or "").strip().upper()
    days = max(7, min(90, int(days or 30)))  # clamp 7..90 (default 30)
    return ok({"symbol": sym, "days": days, "points": history_points(sym, days)})
