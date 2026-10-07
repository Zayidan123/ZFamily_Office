"""Price engine: base price lokal + random walk halus (±0.4% per refresh, cache 30 detik).

- get_rates()      -> payload endpoint /api/v1/rates (USDIDR, updatedAt, prices:{SYM:{usd, change24hPct}})
- get_price_map()  -> peta harga internal (USD & IDR) termasuk simbol derivatif EMASANTAM
                      (emas Antam per gram = XAU / 31.1035, dikutip dalam IDR).
- price_asset()    -> harga satuan sebuah aset (fallback ke unit_price statis di DB bila
                      simbol tidak dikenal engine).
- compute_portfolio()-> semua aset + valuasi live (valueUsd/valueIdr) + net worth.
"""
import random
import threading
import time
from typing import Optional

from db import now_iso, query

BASE_PRICES = {
    "BTC": 97000.0,
    "ETH": 3400.0,
    "BNB": 640.0,
    "SUI": 3.2,
    "XAU": 2650.0,      # per troy ounce
    "USDIDR": 15850.0,
    "BBCA": 9750.0,     # IDR per lembar
    "BBRI": 4300.0,
    "TLKM": 3450.0,
    "NVDA": 138.0,
}

# Volatilitas harian per simbol -> dipakai untuk change24hPct awal (seed tetap).
VOLATILITY = {
    "BTC": 0.030, "ETH": 0.035, "BNB": 0.032, "SUI": 0.045, "XAU": 0.008,
    "USDIDR": 0.0015, "BBCA": 0.012, "BBRI": 0.014, "TLKM": 0.012, "NVDA": 0.022,
}

IDR_QUOTED = {"BBCA", "BBRI", "TLKM"}
RATE_SYMBOLS = ["BTC", "ETH", "BNB", "SUI", "XAU", "BBCA", "BBRI", "TLKM", "NVDA"]
REFRESH_SECS = 30.0
WALK_PCT = 0.004          # ±0.4% per refresh
GOLD_OZ_GRAM = 31.1035    # troy ounce -> gram

_lock = threading.Lock()
_prices: Optional[dict] = None
_change24h: dict = {}
_ts: float = 0.0
_rng = random.Random(20241207)


def _tick_locked(now: float) -> None:
    """Random walk halus; hanya jalan bila cache lebih tua dari REFRESH_SECS."""
    global _prices, _ts
    if _prices is None:
        _prices = dict(BASE_PRICES)
        _ts = now
        return
    if now - _ts >= REFRESH_SECS:
        _prices = {s: px * (1.0 + _rng.uniform(-WALK_PCT, WALK_PCT)) for s, px in _prices.items()}
        _ts = now


def get_price_map() -> dict:
    """{USDIDR, prices:{SYM:{usd, idr, quote, change24hPct}}} — termasuk EMASANTAM."""
    global _change24h
    with _lock:
        now = time.time()
        _tick_locked(now)
        if not _change24h:
            _change24h = {s: round(_rng.uniform(-v, v) * 100.0, 2) for s, v in VOLATILITY.items()}
        px = dict(_prices)
        chg = dict(_change24h)

    usdidr = px["USDIDR"]
    out = {"USDIDR": usdidr, "prices": {}}
    for sym in RATE_SYMBOLS:
        p = px[sym]
        if sym in IDR_QUOTED:
            out["prices"][sym] = {"usd": p / usdidr, "idr": p, "quote": "IDR", "change24hPct": chg.get(sym, 0.0)}
        else:
            out["prices"][sym] = {"usd": p, "idr": p * usdidr, "quote": "USD", "change24hPct": chg.get(sym, 0.0)}
    # derivatif: emas fisik per gram (Antam) — dikutip IDR, turunan XAU per troy oz
    g_usd = px["XAU"] / GOLD_OZ_GRAM
    out["prices"]["EMASANTAM"] = {"usd": g_usd, "idr": g_usd * usdidr, "quote": "IDR", "change24hPct": chg.get("XAU", 0.0)}
    return out


def get_rates() -> dict:
    """Payload endpoint publik /api/v1/rates."""
    pm = get_price_map()
    prices = {}
    for sym in RATE_SYMBOLS:
        e = pm["prices"][sym]
        item = {"usd": round(e["usd"], 6), "change24hPct": e["change24hPct"]}
        if e["quote"] == "IDR":
            item["idr"] = round(e["idr"], 1)
        prices[sym] = item
    return {"USDIDR": round(pm["USDIDR"], 1), "updatedAt": now_iso(), "prices": prices}


def price_asset(row: dict, pm: dict):
    """Harga satuan satu aset.

    Return (unitUsd, unitIdr, change24hPct).
    Simbol engine -> harga live; selain itu fallback ke unit_price statis di DB
    (dikonversi sesuai currency aset).
    """
    sym = (row.get("symbol") or "").strip().upper()
    if sym and sym in pm["prices"]:
        e = pm["prices"][sym]
        return e["usd"], e["idr"], e["change24hPct"]
    p = float(row.get("unit_price") or 0.0)
    usdidr = pm["USDIDR"]
    if (row.get("currency") or "USD").upper() == "IDR":
        return p / usdidr, p, 0.0
    return p, p * usdidr, 0.0


def compute_portfolio(conn) -> tuple:
    """Semua aset dengan valuasi live, diurutkan valueUsd terbesar.

    Return (items, netWorthUsd, netWorthIdr).
    Tiap item = kolom aset + entity_name + unitPriceUsd/unitPriceIdr +
    valueUsd/valueIdr + change24hPct.
    """
    rows = query(conn, "SELECT a.*, e.name AS entity_name FROM assets a LEFT JOIN entities e ON e.id = a.entity_id")
    pm = get_price_map()
    items = []
    for r in rows:
        unit_usd, unit_idr, chg = price_asset(r, pm)
        qty = float(r["quantity"] or 0.0)
        items.append({
            **r,
            "unitPriceUsd": unit_usd,
            "unitPriceIdr": unit_idr,
            "valueUsd": unit_usd * qty,
            "valueIdr": unit_idr * qty,
            "change24hPct": chg,
        })
    items.sort(key=lambda x: x["valueUsd"], reverse=True)
    net_usd = sum(i["valueUsd"] for i in items)
    net_idr = sum(i["valueIdr"] for i in items)
    return items, net_usd, net_idr
