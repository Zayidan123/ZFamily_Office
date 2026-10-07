"""Risk: overview alokasi/konsentrasi/VaR + stress test."""
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from db import get_conn, get_setting, guard_mutation, r2
from errors import ApiError, ok
from prices import compute_portfolio
from security import require_auth

router = APIRouter(tags=["risk"])

READ_ROLES = ("owner", "beneficiary", "advisor")
ASSET_CLASSES = {"crypto", "stocks", "forex_gold", "property", "vehicle", "cash", "business"}

# Volatilitas per kelas untuk estimasi VaR 95% (z = 1.645)
CLASS_VOL = {"crypto": 0.08, "stocks": 0.03, "forex_gold": 0.02}
DEFAULT_VOL = 0.005
Z95 = 1.645

# asset_class -> key di settings.allocationTargets
TARGET_KEY = {"crypto": "crypto", "stocks": "stocks", "forex_gold": "forexGold",
              "property": "property", "cash": "cash"}


def _level(pct: float) -> str:
    if pct > 40:
        return "critical"
    if pct > 25:
        return "warning"
    return "normal"


@router.get("/risk/overview")
def risk_overview(user: dict = Depends(require_auth(*READ_ROLES))):
    conn = get_conn()
    try:
        items, net, _ = compute_portfolio(conn)
        targets = get_setting(conn, "allocationTargets", {}) or {}

        class_agg = {}
        plat_agg = {}
        for it in items:
            class_agg.setdefault(it["asset_class"], 0.0)
            class_agg[it["asset_class"]] += it["valueUsd"]
            label = (it.get("source_label") or it.get("source_type") or "Lainnya").strip() or "Lainnya"
            plat_agg.setdefault(label, 0.0)
            plat_agg[label] += it["valueUsd"]

        # allocation vs target
        allocation = []
        for cls, value in sorted(class_agg.items(), key=lambda kv: kv[1], reverse=True):
            pct = r2(value / net * 100) if net else 0.0
            tkey = TARGET_KEY.get(cls)
            target = float(targets.get(tkey, 0) or 0) if tkey else 0.0
            allocation.append({
                "class": cls,
                "valueUsd": r2(value),
                "pct": pct,
                "targetPct": r2(target),
                "driftPct": r2(pct - target),
            })

        # konsentrasi: per kelas (semua), top-3 platform (sourceLabel), top-3 aset
        concentration = []
        for cls, value in class_agg.items():
            pct = value / net * 100 if net else 0.0
            concentration.append({"type": "class", "label": cls, "pct": r2(pct), "level": _level(pct)})
        for label, value in sorted(plat_agg.items(), key=lambda kv: kv[1], reverse=True)[:3]:
            pct = value / net * 100 if net else 0.0
            concentration.append({"type": "platform", "label": label, "pct": r2(pct), "level": _level(pct)})
        for it in items[:3]:
            pct = it["valueUsd"] / net * 100 if net else 0.0
            concentration.append({"type": "asset", "label": it["name"], "pct": r2(pct), "level": _level(pct)})
        concentration.sort(key=lambda x: x["pct"], reverse=True)

        var_usd = sum(i["valueUsd"] * CLASS_VOL.get(i["asset_class"], DEFAULT_VOL) for i in items) * Z95
        largest = r2(items[0]["valueUsd"] / net * 100) if items and net else 0.0

        return ok({
            "allocation": allocation,
            "concentration": concentration,
            "var95Usd": r2(var_usd),
            "var95Pct": r2(var_usd / net * 100) if net else 0.0,
            "largestPositionPct": largest,
        })
    finally:
        conn.close()


class Scenario(BaseModel):
    assetClass: str
    changePct: float


class StressBody(BaseModel):
    scenarios: list[Scenario]


@router.post("/risk/stress-test")
def stress_test(body: StressBody, user: dict = Depends(require_auth(*READ_ROLES))):
    """Simulasi dampak perubahan harga per kelas terhadap net worth.

    Endpoint POST (bukan GET-cacheable) — ikut aturan panic mode:
    saat kill-switch ON, semua POST/PUT/DELETE selain /system/panic -> 423.
    """
    if not body.scenarios:
        raise ApiError(400, "scenarios tidak boleh kosong")
    for s in body.scenarios:
        if s.assetClass not in ASSET_CLASSES:
            raise ApiError(400, f"assetClass tidak valid: {s.assetClass}")
    conn = get_conn()
    try:
        guard_mutation(conn)
        items, net, _ = compute_portfolio(conn)
        class_agg: dict = {}
        for it in items:
            class_agg[it["asset_class"]] = class_agg.get(it["asset_class"], 0.0) + it["valueUsd"]
        by_class = []
        total_impact = 0.0
        for s in body.scenarios:
            before = class_agg.get(s.assetClass, 0.0)
            after = before * (1 + s.changePct / 100.0)
            impact = after - before
            total_impact += impact
            by_class.append({"class": s.assetClass, "beforeUsd": r2(before),
                             "afterUsd": r2(after), "impactUsd": r2(impact)})
        stressed = net + total_impact
        return ok({
            "baselineUsd": r2(net),
            "stressedUsd": r2(stressed),
            "impactUsd": r2(total_impact),
            "impactPct": r2(total_impact / net * 100) if net else 0.0,
            "byClass": by_class,
        })
    finally:
        conn.close()
