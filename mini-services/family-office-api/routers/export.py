"""Export CSV transaksi (PRD #13) — respons MENTAH (bukan envelope {ok,data}).

GET /api/v1/transactions/export.csv
- RBAC: owner & advisor saja (beneficiary/executor 403).
- Content-Type: text/csv; charset=utf-8
- Content-Disposition: attachment; filename="transaksi-YYYYMMDD.csv"
- Kolom (header Indonesia): tanggal,tipe,aset,simbol,jumlah,harga,total,fee,catatan
- Angka desimal titik; field berisi koma/kutip di-escape otomatis (csv module,
  kutip ganda). Audit log tetap ditulis (transactions.export).

CATATAN: endpoint ini sengaja TIDAK memakai helper ok() — return fastapi.Response
mentah, sehingga tidak terbungkus envelope JSON.
"""
import csv
import io
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from fastapi.responses import Response

from db import get_conn, query, write_audit
from security import require_auth

router = APIRouter(tags=["export"])

TX_WITH_ASSET_SQL = (
    "SELECT t.*, a.name AS asset_name, a.symbol AS asset_symbol "
    "FROM transactions t LEFT JOIN assets a ON a.id = t.asset_id "
    "ORDER BY t.at DESC, t.id DESC"
)

CSV_HEADER = ["tanggal", "tipe", "aset", "simbol", "jumlah", "harga", "total", "fee", "catatan"]


def _num(value, decimals: int) -> str:
    """Angka desimal titik, nol dibelakang dipangkas ('0.02', '97000', '-0' -> '0')."""
    try:
        s = f"{float(value or 0):.{decimals}f}".rstrip("0").rstrip(".")
    except (TypeError, ValueError):
        s = "0"
    if s in ("", "-0", "-"):
        s = "0"
    return s


@router.get("/transactions/export.csv")
def export_transactions_csv(user: dict = Depends(require_auth("owner", "advisor"))):
    conn = get_conn()
    try:
        rows = query(conn, TX_WITH_ASSET_SQL)

        buf = io.StringIO()
        writer = csv.writer(buf, quoting=csv.QUOTE_MINIMAL, lineterminator="\n")
        writer.writerow(CSV_HEADER)
        for r in rows:
            writer.writerow([
                r["at"] or "",                                   # tanggal (ISO)
                r["type"] or "",                                 # tipe
                r.get("asset_name") or "",                       # aset (nama)
                r.get("asset_symbol") or "",                     # simbol
                _num(r["quantity"], 8),                          # jumlah
                _num(r["price_usd"], 6),                         # harga (USD)
                _num(r["total_usd"], 2),                         # total (USD)
                _num(r["fee_usd"], 4),                           # fee (USD)
                r.get("note") or "",                             # catatan
            ])
        content = buf.getvalue().encode("utf-8")

        write_audit(conn, user, "transactions.export", "transaction",
                    f"Export CSV transaksi ({len(rows)} baris)")

        filename = datetime.now(timezone.utc).strftime("transaksi-%Y%m%d.csv")
        return Response(
            content=content,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    finally:
        conn.close()
