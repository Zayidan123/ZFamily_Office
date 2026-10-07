"""Analytics: cost basis FIFO per aset + laporan kinerja bulanan (Task U-a).

FITUR 1 — Cost basis FIFO/LIFO/Average:
  GET /assets/{id}/pnl?method=fifo|lifo|average   (default fifo, 400 utk selain itu)
  - Lot dibuat dari transaksi type buy/transfer_in (qty, priceUsd).
  - fifo   : sell/transfer_out mengonsumsi lot TERLAMA.
  - lifo   : sell/transfer_out mengonsumsi lot TERBARU.
  - average: rata-rata bergerak (moving average) — buy menaikkan avg,
             sell merealisasikan (price - avg) * qty; tanpa lot rincian
             (lots = []), cost basis = avg * sisa qty.
  - realized pnl = (sellPrice - lotCost/avg) * qty dikonsumsi, dijumlahkan.
  - income/expense/valuation_update diabaikan (bukan pergerakan lot).
  - Konversi USD memakai kolom price_usd yang SUDAH tersimpan di tabel
    transactions (dihitung saat insert oleh assets_tx.py: harga currency aset
    / USDIDR bila IDR) — konsisten dengan seluruh backend, tidak ada
    konversi ulang saat perhitungan.
  - avgCostUsd = costBasisUsd / remainingQty (dari sisa lot).
  - unrealizedPnl memakai harga live unitPriceUsd (prices.price_asset —
    sumber yang sama dengan endpoint /assets).
  - Keputusan aset TANPA transaksi lot: remainingQty = quantity aset
    sekarang, costBasisUsd = 0, avgCostUsd = null, unrealizedPnlUsd = null,
    unrealizedPnlPct = null, lots = []. Tanpa histori lot tidak ada dasar
    biaya; mengisi avgCost dengan harga live akan membuat unrealized = 0
    yang menyesatkan, jadi dikembalikan null.

FITUR 2 — Laporan kinerja bulanan:
  GET /reports/monthly?months=12   (clamp 3..24)
  GET /reports/monthly.csv?months=12  (CSV mentah, pola export.py)
  - Bucket kalender per bulan dari portfolio_snapshots (date YYYY-MM-DD):
    startUsd = endUsd bulan sebelumnya (carry-over; untuk bulan pertama
    dipakai snapshot terakhir SEBELUM window, fallback snapshot pertama
    bulan itu), endUsd = snapshot terakhir bulan itu.
  - Keputusan: bulan tanpa snapshot DILEWATI (lebih sederhana & jujur —
    tidak merekayasa nilai start=end). Dengan seed mingguan 18 bulan,
    semua bulan window 3..24 terisi.
  - inflow  = SUM(total_usd) transaksi buy + transfer_in + income.
    outflow = SUM(total_usd) transaksi sell + transfer_out + expense.
    valuation_update bukan arus kas -> tidak dihitung; txCount = SEMUA
    transaksi bulan itu.
  - summary.totalChangeUsd = penjumlahan changeUsd antar-bulan;
    totalChangePct = totalChangeUsd / startUsd bulan pertama * 100.

FITUR 3 — Benchmark perbandingan (Task V-a):
  GET /reports/benchmark?months=12   (clamp 3..24, read-only, tanpa panic guard)
  - 4 seri dgn baseline 100 = AWAL window (bukan close bulan pertama):
      portfolio : endUsd bulan / startUsd bulan pertama * 100 (carry-over U-a) —
                  titik terakhir = totalChangePct + 100 (konsisten /reports/monthly).
      btc_hold  : close bulanan BTC / close hari terakhir SEBELUM bulan pertama.
      gold_hold : idem XAU.
      balanced  : rebalancing bulanan 50% return emas + 50% rata-rata sama-berat
                  return bulanan simbol equity di engine (NVDA, BBCA, BBRI, TLKM;
                  yang tak dikenal engine dilewati dari rata-rata).
  - Close bulanan = titik harian TERAKHIR tiap bulan dari histori deterministik
    market.history_points(sym, days=800 tetap) — seed hanya bergantung simbol,
    jadi kunci bulan yang sama menghasilkan close yang sama utk semua panjang
    window (sifat sufiks). Harga live berubah tiap 30 dtk & tanggal bergeser ->
    nilai histori absolut ikut bergeser per hari (artefak engine harga sandbox,
    perilaku sama dengan /market/history).
  - Seri market dialign ke kunci bulan portofolio yang SAMA (bulan tanpa
    snapshot dilewati, mewarisi keputusan U-a — dgn seed 18 bulan, window
    3..18 penuh; 19..24 menyusut ke 19 bulan berisi snapshot).
  - summary.portfolioPct = totalChangePct laporan bulanan; best = seri dgn
    (nilai terakhir - 100) tertinggi TERMASUK portofolio (tie -> seri pertama
    urut evaluasi: portfolio, btc_hold, gold_hold, balanced);
    winningMonths = bulan dgn return bulanan portofolio > return bulanan
    balanced (head-to-head vs benchmark seimbang, bukan sekadar > 0), dihitung
    dari nilai series terpublikasi (bulat 2 desimal; bulan pertama dibanding
    baseline 100).

RBAC read (semua endpoint): owner/advisor/beneficiary — executor 403.
Semua endpoint read-only; POST read/read-all (di trading.py) yang
panic-guarded. CSV export tetap menulis audit log (pola export.py).
"""
import csv
import io
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response

from db import get_conn, query, query_one, r2, write_audit
from errors import ApiError, ok
# PENTING: cross-import antar router WAJIB pakai prefix paket `routers.` —
# entry app adalah main.py (sys.path root = folder service), bukan folder routers.
from routers.market import history_points
from prices import get_price_map, price_asset
from security import require_auth

router = APIRouter(tags=["analytics"])

READ_ROLES = ("owner", "beneficiary", "advisor")   # executor -> 403
IN_TYPES = ("buy", "transfer_in", "income")
OUT_TYPES = ("sell", "transfer_out", "expense")
MONTHS_MIN, MONTHS_MAX = 3, 24

# Benchmark (V-a): simbol pembanding + panjang histori tetap.
BTC_SYMBOL = "BTC"
GOLD_SYMBOL = "XAU"
EQUITY_SYMBOLS = ("NVDA", "BBCA", "BBRI", "TLKM")   # proxy saham sama-berat
BENCH_HISTORY_DAYS = 800   # > 24 bulan (max 731 hari) + buffer bulan baseline
SERIES_META = (   # urutan evaluasi "best"; label UI bahasa Indonesia
    ("portfolio", "Portofolio Keluarga"),
    ("btc_hold", "BTC Buy & Hold"),
    ("gold_hold", "Emas (XAU) Buy & Hold"),
    ("balanced", "Seimbang 50% Emas + 50% Saham"),
)

_QTY_EPS = 1e-9


def _clamp_months(months: int) -> int:
    return max(MONTHS_MIN, min(MONTHS_MAX, int(months)))


# ---------------------------------------------------------------- FIFO / LIFO / Average PnL

def _load_tx_rows(conn, asset_id: int) -> list:
    """Baris transaksi terurut kronologis (at ASC, id ASC) utk engine cost basis."""
    return query(
        conn,
        "SELECT type, quantity, price_usd, at FROM transactions "
        "WHERE asset_id = ? ORDER BY at ASC, id ASC",
        (asset_id,),
    )


def _lot_rows(rows: list, consume_from_end: bool) -> tuple:
    """Engine lot FIFO (consume_from_end=False) / LIFO (True).

    Return (realizedPnlUsd, sisa_lot_oldest_first).
    Lot = {at, type, qty (qty awal), priceUsd, remainingQty}.
    """
    lots: list = []
    realized = 0.0
    for r in rows:
        qty = float(r["quantity"] or 0.0)
        price_usd = float(r["price_usd"] or 0.0)
        if r["type"] in ("buy", "transfer_in"):
            lots.append({"at": r["at"], "type": r["type"], "qty": qty,
                         "priceUsd": price_usd, "remainingQty": qty})
        elif r["type"] in ("sell", "transfer_out"):
            need = qty
            # FIFO konsumsi lot terlama; LIFO konsumsi lot terbaru (iterasi dari belakang).
            order = reversed(lots) if consume_from_end else lots
            for lot in order:
                if need <= _QTY_EPS:
                    break
                if lot["remainingQty"] <= _QTY_EPS:
                    continue
                take = min(lot["remainingQty"], need)
                realized += (price_usd - lot["priceUsd"]) * take
                lot["remainingQty"] -= take
                need -= take
            # sell melebihi total lot -> sisanya diabaikan (tidak ada posisi short)
        # income/expense/valuation_update -> bukan pergerakan lot
    remaining = [l for l in lots if l["remainingQty"] > _QTY_EPS]
    return realized, remaining


def _fifo_lots(conn, asset_id: int) -> tuple:
    """Engine FIFO (kompatibilitas nama lama — dipakai _lot_rows)."""
    return _lot_rows(_load_tx_rows(conn, asset_id), consume_from_end=False)


def _average_cost(conn, asset_id: int) -> tuple:
    """Engine moving average. Return (realizedPnlUsd, heldQty, avgCostUsd|None, hasHistory).

    Buy/transfer_in menaikkan rata-rata bergerak; sell/transfer_out merealisasikan
    (price - avg) * qty dan menurunkan held. Harga sell melebihi held dibatasi ke
    held (tanpa posisi short, konsisten dgn engine lot).
    """
    avg_cost = 0.0
    held = 0.0
    realized = 0.0
    has_history = False
    for r in _load_tx_rows(conn, asset_id):
        qty = float(r["quantity"] or 0.0)
        price_usd = float(r["price_usd"] or 0.0)
        if r["type"] in ("buy", "transfer_in"):
            has_history = True
            total_cost = avg_cost * held + price_usd * qty
            held += qty
            avg_cost = total_cost / held if held > _QTY_EPS else 0.0
        elif r["type"] in ("sell", "transfer_out"):
            take = min(qty, held)
            if take > _QTY_EPS:
                realized += (price_usd - avg_cost) * take
                held -= take
                if held <= _QTY_EPS:
                    held = 0.0
                    avg_cost = 0.0
    return realized, held, (avg_cost if held > _QTY_EPS else None), has_history


COST_METHODS = ("fifo", "lifo", "average")


@router.get("/assets/{asset_id}/pnl")
def asset_pnl(
    asset_id: int,
    method: str = Query("fifo", description="fifo | lifo | average"),
    user: dict = Depends(require_auth(*READ_ROLES)),
):
    conn = get_conn()
    try:
        asset = query_one(conn, "SELECT * FROM assets WHERE id = ?", (asset_id,))
        if not asset:
            raise ApiError(404, "Aset tidak ditemukan")

        method_n = (method or "fifo").strip().lower()
        if method_n not in COST_METHODS:
            raise ApiError(400, "Metode cost basis tidak valid — gunakan fifo, lifo, atau average")

        avg_from_lot = None
        if method_n == "average":
            realized, remaining_qty, avg_from_lot, has_history = _average_cost(conn, asset_id)
            if not has_history:
                # Aset tanpa transaksi lot sama sekali (keputusan desain sama dgn lot engine):
                # tampilkan quantity aset sekarang, tanpa dasar biaya.
                remaining_qty = float(asset["quantity"] or 0.0)
                cost_raw = 0.0
                avg_raw = None
            else:
                avg_raw = avg_from_lot
                cost_raw = (avg_raw * remaining_qty) if avg_raw is not None else 0.0
            lots = []   # rata-rata bergerak tidak memakai lot
        else:
            realized, lots = _lot_rows(_load_tx_rows(conn, asset_id),
                                       consume_from_end=(method_n == "lifo"))
            cost_raw = sum(l["remainingQty"] * l["priceUsd"] for l in lots)
            remaining_qty = sum(l["remainingQty"] for l in lots)

            if lots:
                avg_raw = cost_raw / remaining_qty if remaining_qty > _QTY_EPS else None
            else:
                # Aset tanpa transaksi lot sama sekali (keputusan desain):
                # tampilkan quantity aset sekarang, tanpa dasar biaya.
                remaining_qty = float(asset["quantity"] or 0.0)
                cost_raw = 0.0
                avg_raw = None

        unreal = pct = None
        if avg_raw is not None:
            live_usd = price_asset(asset, get_price_map())[0]   # unitPriceUsd, sama dgn /assets
            unreal = (live_usd - avg_raw) * remaining_qty
            pct = (unreal / cost_raw * 100.0) if cost_raw > _QTY_EPS else None

        return ok({
            "assetId": asset["id"],
            "assetName": asset["name"],
            "symbol": asset["symbol"],
            "currency": (asset["currency"] or "USD").upper(),
            "method": method_n,
            "realizedPnlUsd": r2(realized),
            "avgCostUsd": r2(avg_raw) if avg_raw is not None else None,
            "remainingQty": round(remaining_qty, 8),
            "costBasisUsd": r2(cost_raw),
            "unrealizedPnlUsd": r2(unreal) if unreal is not None else None,
            "unrealizedPnlPct": r2(pct) if pct is not None else None,
            "lots": [
                {"at": l["at"], "type": l["type"], "qty": round(l["qty"], 8),
                 "priceUsd": round(l["priceUsd"], 6),
                 "remainingQty": round(l["remainingQty"], 8)}
                for l in lots   # sudah urut oldest-first sesuai urutan konsumsi
            ],
        })
    finally:
        conn.close()


# ------------------------------------------------------- laporan bulanan

def _month_keys(months: int) -> list:
    """N kunci bulan kalender (YYYY-MM) terakhir, terlama dulu, termasuk bulan ini."""
    today = datetime.now(timezone.utc)
    y, m = today.year, today.month
    keys = []
    for _ in range(months):
        keys.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    keys.reverse()
    return keys


def _monthly_report(conn, months: int) -> dict:
    """Susun buckets bulanan + summary dari snapshots & transactions."""
    keys = _month_keys(months)

    snaps = query(
        conn,
        "SELECT date, value_usd FROM portfolio_snapshots "
        "WHERE substr(date, 1, 7) >= ? ORDER BY date ASC, id ASC",
        (keys[0],),
    )
    by_month: dict = {}
    for s in snaps:
        by_month.setdefault(str(s["date"])[:7], []).append(float(s["value_usd"]))

    # endUsd carry-over: snapshot terakhir sebelum window (jika ada)
    prev = query_one(
        conn,
        "SELECT value_usd FROM portfolio_snapshots WHERE substr(date, 1, 7) < ? "
        "ORDER BY date DESC, id DESC LIMIT 1",
        (keys[0],),
    )
    prev_end = float(prev["value_usd"]) if prev else None

    flows: dict = {}
    for f in query(
        conn,
        "SELECT substr(at, 1, 7) AS ym, type, COUNT(*) AS c, "
        "COALESCE(SUM(total_usd), 0) AS total FROM transactions GROUP BY ym, type",
    ):
        bucket = flows.setdefault(f["ym"], {"inflow": 0.0, "outflow": 0.0, "txCount": 0})
        bucket["txCount"] += int(f["c"] or 0)
        if f["type"] in IN_TYPES:
            bucket["inflow"] += float(f["total"] or 0.0)
        elif f["type"] in OUT_TYPES:
            bucket["outflow"] += float(f["total"] or 0.0)

    months_out = []
    for key in keys:
        vals = by_month.get(key)
        if not vals:
            continue   # bulan tanpa snapshot dilewati (keputusan desain)
        start = prev_end if prev_end is not None else vals[0]
        end = vals[-1]
        change = end - start
        flow = flows.get(key, {"inflow": 0.0, "outflow": 0.0, "txCount": 0})
        months_out.append({
            "month": key,
            "startUsd": r2(start),
            "endUsd": r2(end),
            "changeUsd": r2(change),
            "changePct": r2(change / start * 100.0) if start else 0.0,
            "inflowUsd": r2(flow["inflow"]),
            "outflowUsd": r2(flow["outflow"]),
            "netFlowUsd": r2(flow["inflow"] - flow["outflow"]),
            "txCount": flow["txCount"],
        })
        prev_end = end

    total_change = sum(m["changeUsd"] for m in months_out)
    first_start = months_out[0]["startUsd"] if months_out else 0.0
    summary = {
        "totalChangeUsd": r2(total_change),
        "totalChangePct": r2(total_change / first_start * 100.0) if first_start else 0.0,
        "bestMonth": None,
        "worstMonth": None,
        "avgMonthlyChangeUsd": r2(total_change / len(months_out)) if months_out else 0.0,
        "totalInflowUsd": r2(sum(m["inflowUsd"] for m in months_out)),
        "totalOutflowUsd": r2(sum(m["outflowUsd"] for m in months_out)),
    }
    if months_out:
        best = max(months_out, key=lambda m: m["changeUsd"])
        worst = min(months_out, key=lambda m: m["changeUsd"])
        summary["bestMonth"] = {"month": best["month"], "changeUsd": best["changeUsd"]}
        summary["worstMonth"] = {"month": worst["month"], "changeUsd": worst["changeUsd"]}
    return {"months": months_out, "summary": summary}


@router.get("/reports/monthly")
def report_monthly(months: int = Query(12), user: dict = Depends(require_auth(*READ_ROLES))):
    conn = get_conn()
    try:
        return ok(_monthly_report(conn, _clamp_months(months)))
    finally:
        conn.close()


CSV_HEADER = ["bulan", "awal_usd", "akhir_usd", "perubahan_usd", "perubahan_pct",
              "inflow_usd", "outflow_usd", "net_flow", "transaksi"]


def _num(value, decimals: int) -> str:
    """Angka desimal titik, nol dibelakang dipangkas (pola export.py)."""
    try:
        s = f"{float(value or 0):.{decimals}f}".rstrip("0").rstrip(".")
    except (TypeError, ValueError):
        s = "0"
    if s in ("", "-0", "-"):
        s = "0"
    return s


@router.get("/reports/monthly.csv")
def report_monthly_csv(months: int = Query(12), user: dict = Depends(require_auth(*READ_ROLES))):
    conn = get_conn()
    try:
        report = _monthly_report(conn, _clamp_months(months))
        rows = report["months"]

        buf = io.StringIO()
        writer = csv.writer(buf, quoting=csv.QUOTE_MINIMAL, lineterminator="\n")
        writer.writerow(CSV_HEADER)
        for m in rows:
            writer.writerow([
                m["month"],
                _num(m["startUsd"], 2),
                _num(m["endUsd"], 2),
                _num(m["changeUsd"], 2),
                _num(m["changePct"], 2),
                _num(m["inflowUsd"], 2),
                _num(m["outflowUsd"], 2),
                _num(m["netFlowUsd"], 2),
                m["txCount"],
            ])
        content = buf.getvalue().encode("utf-8")

        write_audit(conn, user, "reports.export", "report",
                    f"Export CSV laporan kinerja bulanan ({len(rows)} bulan)")

        filename = datetime.now(timezone.utc).strftime("laporan-kinerja-%Y%m.csv")
        return Response(
            content=content,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    finally:
        conn.close()


# ------------------------------------------------------------- benchmark V-a

def _baseline_close(points: list, cutoff: str):
    """Close harian TERAKHIR sebelum tanggal cutoff (YYYY-MM-01) = awal window.

    None bila histori tidak menjangkau (fallback pemanggil: close bulan
    pertama simbol — tidak pernah terjadi dgn BENCH_HISTORY_DAYS=800).
    """
    baseline = None
    for p in points:
        if p["date"] < cutoff:
            baseline = p["price"]
        else:
            break   # points urut waktu naik
    return baseline


def _monthly_closes(points: list, key_set: set) -> dict:
    """{ym: close} — titik harian TERAKHIR tiap bulan window (last wins)."""
    closes = {}
    for p in points:
        ym = p["date"][:7]
        if ym in key_set:
            closes[ym] = p["price"]
    return closes


def _indexed_values(sym: str, keys: list, key_set: set) -> dict:
    """Nilai terindeks (baseline=100 di awal window) per bulan utk satu simbol."""
    points = history_points(sym, BENCH_HISTORY_DAYS)
    closes = _monthly_closes(points, key_set)
    base = _baseline_close(points, f"{keys[0]}-01")
    if base is None:
        base = closes.get(keys[0])   # fallback: anchor bulan pertama simbol
    if not base:
        return {}
    return {k: closes[k] / base * 100.0 for k in keys if k in closes}


def _monthly_rets_by_month(values: dict, keys: list) -> dict:
    """{ym: return bulanan} dari nilai terindeks (bulan pertama vs baseline 100)."""
    rets = {}
    prev = 100.0
    for k in keys:
        if k not in values or not prev:
            continue
        rets[k] = values[k] / prev - 1.0
        prev = values[k]
    return rets


def _rets_from_points(points: list) -> dict:
    """{ym: return bulanan} dari points terpublikasi (baseline 100 implisit)."""
    rets = {}
    prev = 100.0
    for p in points:
        if not prev:
            break
        rets[p["month"]] = p["value"] / prev - 1.0
        prev = p["value"]
    return rets


@router.get("/reports/benchmark")
def report_benchmark(months: int = Query(12), user: dict = Depends(require_auth(*READ_ROLES))):
    """Perbandingan kinerja portofolio vs BTC/XAU buy & hold + portofolio seimbang.

    Lihat docstring modul (FITUR 3). Read-only, tanpa panic guard, tanpa audit
    (konsisten GET /reports/monthly).
    """
    conn = get_conn()
    try:
        months = _clamp_months(months)
        report = _monthly_report(conn, months)
        rows = report["months"]
        keys = [m["month"] for m in rows]
        key_set = set(keys)

        # Seri portofolio: indeks 100 = startUsd bulan pertama (carry-over U-a).
        portfolio_pts = []
        if rows:
            first_start = rows[0]["startUsd"]
            if first_start:
                portfolio_pts = [
                    {"month": m["month"], "value": r2(m["endUsd"] / first_start * 100.0)}
                    for m in rows
                ]

        # Tanpa snapshot sama sekali -> seri kosong berbentuk konsisten.
        if not keys or not portfolio_pts:
            return ok({
                "months": months,
                "series": [
                    {"key": k, "label": lbl, "points": []} for k, lbl in SERIES_META
                ],
                "summary": {"portfolioPct": 0.0, "best": None,
                            "winningMonths": 0, "totalMonths": 0},
            })

        # BTC & XAU buy & hold (simbol inti engine — selalu ada di BASE_PRICES).
        btc_idx = _indexed_values(BTC_SYMBOL, keys, key_set)
        gold_idx = _indexed_values(GOLD_SYMBOL, keys, key_set)

        # Balanced: rebalancing bulanan 50% emas + 50% rata-rata sama-berat
        # return bulanan simbol equity yang tersedia di engine.
        gold_rets = _monthly_rets_by_month(gold_idx, keys)
        eq_rets_per_sym = []
        for sym in EQUITY_SYMBOLS:
            try:
                idx = _indexed_values(sym, keys, key_set)
            except ApiError:
                continue   # simbol tak dikenal engine -> keluar dari rata-rata
            if idx:
                eq_rets_per_sym.append(_monthly_rets_by_month(idx, keys))
        eq_rets = {}
        for k in keys:
            legs = [r[k] for r in eq_rets_per_sym if k in r]
            if legs:
                eq_rets[k] = sum(legs) / len(legs)

        balanced_pts = []
        v = 100.0
        for k in keys:
            legs = []
            if k in gold_rets:
                legs.append(0.5 * gold_rets[k])
            if k in eq_rets:
                legs.append(0.5 * eq_rets[k])
            if not legs:
                break   # kedua kaki hilang -> seri berhenti (tak diharapkan terjadi)
            v *= (1.0 + sum(legs))
            balanced_pts.append({"month": k, "value": r2(v)})

        meta = dict(SERIES_META)
        series = [
            {"key": "portfolio", "label": meta["portfolio"], "points": portfolio_pts},
            {"key": "btc_hold", "label": meta["btc_hold"],
             "points": [{"month": k, "value": r2(btc_idx[k])} for k in keys if k in btc_idx]},
            {"key": "gold_hold", "label": meta["gold_hold"],
             "points": [{"month": k, "value": r2(gold_idx[k])} for k in keys if k in gold_idx]},
            {"key": "balanced", "label": meta["balanced"], "points": balanced_pts},
        ]

        # best: (nilai terakhir - 100) tertinggi di SEMUA seri, termasuk portofolio.
        best = None
        best_raw = None
        for s in series:
            if not s["points"]:
                continue
            pct = s["points"][-1]["value"] - 100.0
            if best_raw is None or pct > best_raw:
                best_raw = pct
                best = {"key": s["key"], "label": s["label"], "pct": r2(pct)}

        # winningMonths: return bulanan portofolio > return bulanan balanced
        # (head-to-head vs benchmark seimbang), dari nilai terpublikasi.
        port_rets = _rets_from_points(portfolio_pts)
        bal_rets = _rets_from_points(balanced_pts)
        winning = sum(
            1 for k in keys
            if k in port_rets and k in bal_rets and port_rets[k] > bal_rets[k]
        )

        return ok({
            "months": months,
            "series": series,
            "summary": {
                "portfolioPct": report["summary"]["totalChangePct"],
                "best": best,
                "winningMonths": winning,
                "totalMonths": len(keys),
            },
        })
    finally:
        conn.close()
