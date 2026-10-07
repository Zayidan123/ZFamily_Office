"""Assets CRUD + Transactions (auto-adjust quantity aset)."""
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from db import execute, get_conn, guard_mutation, now_iso, query, query_one, r2, write_audit
from errors import ApiError, ok
from prices import compute_portfolio, get_price_map, price_asset
from security import require_auth

router = APIRouter(tags=["assets-transactions"])

ASSET_CLASSES = {"crypto", "stocks", "forex_gold", "property", "vehicle", "cash", "business"}
TX_TYPES = {"buy", "sell", "transfer_in", "transfer_out", "income", "expense", "valuation_update"}
SOURCE_TYPES = {"exchange", "wallet", "broker", "bank", "physical", "other"}

ASSET_WITH_ENTITY_SQL = (
    "SELECT a.*, e.name AS entity_name FROM assets a "
    "LEFT JOIN entities e ON e.id = a.entity_id"
)


def _present(row: dict) -> dict:
    """Bentuk respons aset sesuai contract v1 (harga live dari engine)."""
    pm = get_price_map()
    unit_usd, unit_idr, chg = price_asset(row, pm)
    qty = float(row["quantity"] or 0.0)
    cur = (row["currency"] or "USD").upper()
    return {
        "id": row["id"],
        "name": row["name"],
        "assetClass": row["asset_class"],
        "symbol": row["symbol"],
        "entityId": row["entity_id"],
        "entityName": row.get("entity_name"),
        "quantity": qty,
        "unitPrice": r2(unit_idr if cur == "IDR" else unit_usd),
        "currency": cur,
        "unitPriceUsd": r2(unit_usd),
        "valueUsd": r2(unit_usd * qty),
        "valueIdr": r2(unit_idr * qty),
        "sourceType": row["source_type"],
        "sourceLabel": row.get("source_label") or "",
        "notes": row.get("notes") or "",
        "change24hPct": r2(chg),
        "updatedAt": row["updated_at"],
    }


# ------------------------------------------------------------------ assets

@router.get("/assets")
def list_assets(
    class_: Optional[str] = Query(None, alias="class"),
    entityId: Optional[int] = None,
    search: Optional[str] = None,
    user: dict = Depends(require_auth()),
):
    conn = get_conn()
    try:
        items, _, _ = compute_portfolio(conn)
        out = []
        for it in items:
            if class_ and it["asset_class"] != class_:
                continue
            if entityId is not None and it["entity_id"] != entityId:
                continue
            if search:
                hay = f"{it['name']} {it['symbol'] or ''} {it['source_label'] or ''}".lower()
                if search.lower() not in hay:
                    continue
            out.append(_present(it))
        return ok(out)
    finally:
        conn.close()


@router.get("/assets/classes")
def asset_classes(user: dict = Depends(require_auth())):
    conn = get_conn()
    try:
        items, net, _ = compute_portfolio(conn)
        groups = {}
        for it in items:
            g = groups.setdefault(it["asset_class"], {"value": 0.0, "count": 0, "weighted": 0.0})
            g["value"] += it["valueUsd"]
            g["count"] += 1
            g["weighted"] += it["valueUsd"] * (it["change24hPct"] or 0.0)
        data = [
            {
                "class": cls,
                "valueUsd": r2(g["value"]),
                "pct": r2(g["value"] / net * 100) if net else 0.0,
                "count": g["count"],
                "change24hPct": r2(g["weighted"] / g["value"]) if g["value"] else 0.0,
            }
            for cls, g in sorted(groups.items(), key=lambda kv: kv[1]["value"], reverse=True)
        ]
        return ok(data)
    finally:
        conn.close()


class AssetBody(BaseModel):
    name: str
    assetClass: str
    symbol: Optional[str] = None
    entityId: Optional[int] = None
    quantity: float
    unitPrice: float
    currency: str = "USD"
    sourceType: str = "other"
    sourceLabel: Optional[str] = ""
    notes: Optional[str] = ""


@router.post("/assets", status_code=201)
def create_asset(body: AssetBody, user: dict = Depends(require_auth("owner"))):
    if body.assetClass not in ASSET_CLASSES:
        raise ApiError(400, f"assetClass tidak valid: {body.assetClass}")
    if body.currency not in ("USD", "IDR"):
        raise ApiError(400, "currency harus USD atau IDR")
    if body.sourceType not in SOURCE_TYPES:
        raise ApiError(400, f"sourceType tidak valid: {body.sourceType}")
    if body.quantity < 0 or body.unitPrice < 0:
        raise ApiError(400, "quantity dan unitPrice tidak boleh negatif")
    conn = get_conn()
    try:
        guard_mutation(conn)
        if body.entityId is not None and not query_one(conn, "SELECT id FROM entities WHERE id = ?", (body.entityId,)):
            raise ApiError(400, f"Entity {body.entityId} tidak ditemukan")
        ts = now_iso()
        new_id = execute(
            conn,
            "INSERT INTO assets(name, asset_class, symbol, entity_id, quantity, unit_price, currency, "
            "source_type, source_label, notes, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (body.name.strip(), body.assetClass, (body.symbol or "").strip().upper() or None, body.entityId,
             body.quantity, body.unitPrice, body.currency, body.sourceType,
             body.sourceLabel or "", body.notes or "", ts, ts),
        )
        write_audit(conn, user, "asset.create", "asset",
                    f"Tambah aset: {body.name} ({body.assetClass}) — {body.quantity} {body.symbol or ''}")
        row = query_one(conn, ASSET_WITH_ENTITY_SQL + " WHERE a.id = ?", (new_id,))
        return ok(_present(row))
    finally:
        conn.close()


class AssetUpdate(BaseModel):
    name: Optional[str] = None
    assetClass: Optional[str] = None
    symbol: Optional[str] = None
    entityId: Optional[int] = None
    quantity: Optional[float] = None
    unitPrice: Optional[float] = None
    currency: Optional[str] = None
    sourceType: Optional[str] = None
    sourceLabel: Optional[str] = None
    notes: Optional[str] = None


COLMAP_ASSET = {
    "name": "name", "assetClass": "asset_class", "symbol": "symbol", "entityId": "entity_id",
    "quantity": "quantity", "unitPrice": "unit_price", "currency": "currency",
    "sourceType": "source_type", "sourceLabel": "source_label", "notes": "notes",
}


@router.put("/assets/{asset_id}")
def update_asset(asset_id: int, body: AssetUpdate, user: dict = Depends(require_auth("owner"))):
    conn = get_conn()
    try:
        guard_mutation(conn)
        if not query_one(conn, "SELECT id FROM assets WHERE id = ?", (asset_id,)):
            raise ApiError(404, "Aset tidak ditemukan")
        fields = body.model_dump(exclude_unset=True)
        if not fields:
            raise ApiError(400, "Tidak ada field yang diubah")
        if "assetClass" in fields and fields["assetClass"] not in ASSET_CLASSES:
            raise ApiError(400, "assetClass tidak valid")
        if "currency" in fields and fields["currency"] not in ("USD", "IDR"):
            raise ApiError(400, "currency harus USD atau IDR")
        if "sourceType" in fields and fields["sourceType"] not in SOURCE_TYPES:
            raise ApiError(400, "sourceType tidak valid")
        if "entityId" in fields and fields["entityId"] is not None and \
                not query_one(conn, "SELECT id FROM entities WHERE id = ?", (fields["entityId"],)):
            raise ApiError(400, "Entity tidak ditemukan")
        if fields.get("quantity", 0) < 0 or fields.get("unitPrice", 0) < 0:
            raise ApiError(400, "quantity dan unitPrice tidak boleh negatif")
        sets, params = [], []
        for k, v in fields.items():
            if k == "symbol" and isinstance(v, str):
                v = v.strip().upper() or None
            sets.append(f"{COLMAP_ASSET[k]} = ?")
            params.append(v)
        sets.append("updated_at = ?")
        params.append(now_iso())
        params.append(asset_id)
        execute(conn, f"UPDATE assets SET {', '.join(sets)} WHERE id = ?", tuple(params))
        write_audit(conn, user, "asset.update", "asset", f"Update aset #{asset_id}: {', '.join(fields.keys())}")
        row = query_one(conn, ASSET_WITH_ENTITY_SQL + " WHERE a.id = ?", (asset_id,))
        return ok(_present(row))
    finally:
        conn.close()


@router.delete("/assets/{asset_id}")
def delete_asset(asset_id: int, user: dict = Depends(require_auth("owner"))):
    conn = get_conn()
    try:
        guard_mutation(conn)
        row = query_one(conn, "SELECT * FROM assets WHERE id = ?", (asset_id,))
        if not row:
            raise ApiError(404, "Aset tidak ditemukan")
        execute(conn, "DELETE FROM assets WHERE id = ?", (asset_id,))
        write_audit(conn, user, "asset.delete", "asset",
                    f"Hapus aset: {row['name']} (transaksi terkait ikut terhapus)")
        return ok({"id": asset_id, "deleted": True})
    finally:
        conn.close()


# ------------------------------------------------------------- transactions

class TxBody(BaseModel):
    assetId: int
    type: str
    quantity: float
    price: Optional[float] = None
    fee: Optional[float] = None
    note: Optional[str] = None
    at: Optional[str] = None


def _tx_full_row(r: dict) -> dict:
    return {
        "id": r["id"],
        "assetId": r["asset_id"],
        "assetName": r.get("asset_name"),
        "type": r["type"],
        "quantity": r["quantity"],
        "priceUsd": r2(r["price_usd"]),
        "totalUsd": r2(r["total_usd"]),
        "feeUsd": r2(r["fee_usd"]),
        "note": r.get("note") or "",
        "at": r["at"],
    }


TX_WITH_ASSET_SQL = (
    "SELECT t.*, a.name AS asset_name FROM transactions t LEFT JOIN assets a ON a.id = t.asset_id"
)


@router.get("/transactions")
def list_transactions(
    assetId: Optional[int] = None,
    type: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
    user: dict = Depends(require_auth("owner", "beneficiary", "advisor")),
):
    conn = get_conn()
    try:
        sql = TX_WITH_ASSET_SQL + " WHERE 1=1"
        params: list = []
        if assetId is not None:
            sql += " AND t.asset_id = ?"
            params.append(assetId)
        if type:
            if type not in TX_TYPES:
                raise ApiError(400, f"type tidak valid: {type}")
            sql += " AND t.type = ?"
            params.append(type)
        sql += " ORDER BY t.at DESC, t.id DESC LIMIT ?"
        params.append(limit)
        return ok([_tx_full_row(r) for r in query(conn, sql, tuple(params))])
    finally:
        conn.close()


@router.post("/transactions", status_code=201)
def create_transaction(body: TxBody, user: dict = Depends(require_auth("owner"))):
    """Insert transaksi; buy/transfer_in menambah quantity aset, sell/transfer_out
    mengurangi (ditolak bila hasil minus). price & fee dianggap dalam currency aset."""
    if body.type not in TX_TYPES:
        raise ApiError(400, f"type tidak valid: {body.type}")
    if body.quantity < 0:
        raise ApiError(400, "quantity tidak boleh negatif")
    if body.type in ("buy", "sell", "transfer_in", "transfer_out") and body.quantity <= 0:
        raise ApiError(400, "quantity harus > 0 untuk transaksi ini")
    conn = get_conn()
    try:
        guard_mutation(conn)
        asset = query_one(conn, "SELECT * FROM assets WHERE id = ?", (body.assetId,))
        if not asset:
            raise ApiError(404, "Aset tidak ditemukan")
        pm = get_price_map()
        usdidr = pm["USDIDR"]
        currency = (asset["currency"] or "USD").upper()
        price = float(body.price or 0.0)
        fee = float(body.fee or 0.0)
        price_usd = price if currency == "USD" else price / usdidr
        fee_usd = fee if currency == "USD" else fee / usdidr
        total_usd = body.quantity * price_usd
        at = body.at or now_iso()

        qty_change = 0.0
        if body.type in ("buy", "transfer_in"):
            qty_change = body.quantity
        elif body.type in ("sell", "transfer_out"):
            qty_change = -body.quantity
        new_qty = float(asset["quantity"] or 0.0) + qty_change
        if new_qty < -1e-9:
            raise ApiError(400, f"Quantity tidak boleh minus — '{asset['name']}' hanya tersedia {asset['quantity']}")
        new_qty = max(0.0, new_qty)

        tx_id = execute(
            conn,
            "INSERT INTO transactions(asset_id, type, quantity, price, currency, price_usd, total_usd, "
            "fee_usd, note, at, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (asset["id"], body.type, body.quantity, price, currency, round(price_usd, 6),
             r2(total_usd), r2(fee_usd), body.note or "", at, now_iso()),
        )
        if qty_change or (body.type == "valuation_update" and price > 0):
            sets, params = ["quantity = ?", "updated_at = ?"], [new_qty, now_iso()]
            if body.type == "valuation_update" and price > 0:
                sets.append("unit_price = ?")
                params.append(price)
            params.append(asset["id"])
            execute(conn, f"UPDATE assets SET {', '.join(sets)} WHERE id = ?", tuple(params))
        write_audit(conn, user, "transaction.create", "transaction",
                    f"{body.type} {body.quantity} {asset['symbol'] or asset['name']} @ {price} {currency}")
        row = query_one(conn, TX_WITH_ASSET_SQL + " WHERE t.id = ?", (tx_id,))
        return ok(_tx_full_row(row))
    finally:
        conn.close()
