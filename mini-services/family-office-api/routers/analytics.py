"""Analytics: cost basis FIFO per aset + laporan kinerja bulanan (Task U-a).

FITUR 1 — Cost basis FIFO:
  GET /assets/{id}/pnl
  - Lot dibuat dari transaksi type buy/transfer_in (qty, priceUsd).
  - sell/transfer_out mengonsumsi lot TERLAMA (FIFO); realized pnl =
    (sellPrice - lotCost) * qty dikonsumsi, dijumlahkan.
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
from prices import get_price_map, price_asset
from security import require_auth

router = APIRouter(tags=["analytics"])

READ_ROLES = ("owner", "beneficiary", "advisor")   # executor -> 403
IN_TYPES = ("buy", "transfer_in", "income")
OUT_TYPES = ("sell", "transfer_out", "expense")
MONTHS_MIN, MONTHS_MAX = 3, 24

_QTY_EPS = 1e-9


def _clamp_months(months: int) -> int:
    return max(MONTHS_MIN, min(MONTHS_MAX, int(months)))


# ---------------------------------------------------------------- FIFO PnL

def _fifo_lots(conn, asset_id: int) -> tuple:
    """Engine FIFO. Return (realizedPnlUsd, sisa_lot_oldest_first).

    Lot = {at, type, qty (qty awal), priceUsd, remainingQty}.
    """
    rows = query(
        conn,
        "SELECT type, quantity, price_usd, at FROM transactions "
        "WHERE asset_id = ? ORDER BY at ASC, id ASC",
        (asset_id,),
    )
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
            for lot in lots:
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


@router.get("/assets/{asset_id}/pnl")
def asset_pnl(asset_id: int, user: dict = Depends(require_auth(*READ_ROLES))):
    conn = get_conn()
    try:
        asset = query_one(conn, "SELECT * FROM assets WHERE id = ?", (asset_id,))
        if not asset:
            raise ApiError(404, "Aset tidak ditemukan")

        realized, lots = _fifo_lots(conn, asset_id)
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
