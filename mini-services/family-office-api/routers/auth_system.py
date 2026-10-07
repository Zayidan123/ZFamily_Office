"""Auth, system (status/panic), rates publik, settings, admin export."""
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from db import (execute, get_conn, get_setting, guard_mutation, is_panic, now_iso,
                query, query_one, set_setting, write_audit)
from errors import ApiError, ok
from prices import get_rates
from security import hash_password, require_auth, sign_token

router = APIRouter(tags=["auth-system"])

VERSION = "1.1.0"  # selaraskan dengan VERSION di main.py
ALLOWED_CURRENCIES = {"USD", "IDR"}
ALLOWED_TARGET_KEYS = {"crypto", "stocks", "forexGold", "property", "cash"}


class LoginBody(BaseModel):
    email: str
    password: str


class PanicBody(BaseModel):
    enabled: bool


class SettingsBody(BaseModel):
    displayCurrency: Optional[str] = None
    allocationTargets: Optional[dict] = None


@router.post("/auth/login")
def login(body: LoginBody):
    conn = get_conn()
    try:
        user = query_one(conn, "SELECT * FROM users WHERE lower(email) = lower(?)", (body.email.strip(),))
        if not user or user["password_hash"] != hash_password(body.password):
            audit_user = ({"sub": user["id"], "name": user["name"], "role": user["role"]}
                          if user else {"sub": None, "name": body.email, "role": "unknown"})
            write_audit(conn, audit_user, "auth.login_failed", "auth", f"Percobaan login gagal: {body.email}")
            raise ApiError(401, "Email atau password salah")
        token = sign_token({"sub": user["id"], "role": user["role"], "name": user["name"]})
        write_audit(conn, {"sub": user["id"], "name": user["name"], "role": user["role"]},
                    "auth.login", "auth", f"Login berhasil ({user['role']})")
        return ok({"token": token,
                   "user": {"id": user["id"], "name": user["name"], "email": user["email"], "role": user["role"]}})
    finally:
        conn.close()


@router.get("/auth/me")
def me(user: dict = Depends(require_auth())):
    conn = get_conn()
    try:
        row = query_one(conn, "SELECT id, name, email, role, created_at FROM users WHERE id = ?", (user["sub"],))
        if not row:
            raise ApiError(404, "User tidak ditemukan")
        return ok(row)
    finally:
        conn.close()


@router.get("/system/status")
def system_status():
    conn = get_conn()
    try:
        return ok({"panicMode": is_panic(conn), "version": VERSION, "serverTime": now_iso()})
    finally:
        conn.close()


@router.post("/system/panic")
def set_panic(body: PanicBody, user: dict = Depends(require_auth("owner"))):
    """Kill-switch. Sengaja TANPA guard_mutation agar owner selalu bisa mematikan."""
    conn = get_conn()
    try:
        set_setting(conn, "panicMode", bool(body.enabled))
        write_audit(conn, user, "system.panic", "system", f"Panic mode {'ON' if body.enabled else 'OFF'}")
        return ok({"panicMode": bool(body.enabled)})
    finally:
        conn.close()


@router.get("/rates")
def rates():
    """Publik: harga market live (random walk halus, cache 30 detik)."""
    return ok(get_rates())


@router.get("/settings")
def get_settings(user: dict = Depends(require_auth())):
    conn = get_conn()
    try:
        return ok({
            "displayCurrency": get_setting(conn, "displayCurrency", "USD"),
            "allocationTargets": get_setting(conn, "allocationTargets", {}),
            "panicMode": is_panic(conn),
        })
    finally:
        conn.close()


@router.put("/settings")
def update_settings(body: SettingsBody, user: dict = Depends(require_auth("owner"))):
    conn = get_conn()
    try:
        guard_mutation(conn)
        if body.displayCurrency is not None:
            if body.displayCurrency not in ALLOWED_CURRENCIES:
                raise ApiError(400, "displayCurrency harus USD atau IDR")
            set_setting(conn, "displayCurrency", body.displayCurrency)
        if body.allocationTargets is not None:
            current = get_setting(conn, "allocationTargets", {}) or {}
            bad = [k for k in body.allocationTargets.keys() if k not in ALLOWED_TARGET_KEYS]
            if bad:
                raise ApiError(400, f"Key allocationTargets tidak dikenal: {', '.join(bad)}")
            merged = {**current, **body.allocationTargets}
            for k, v in merged.items():
                try:
                    merged[k] = max(0.0, min(100.0, float(v)))
                except (TypeError, ValueError):
                    raise ApiError(400, f"Nilai target '{k}' harus angka")
            set_setting(conn, "allocationTargets", merged)
        write_audit(conn, user, "settings.update", "settings", "Update settings")
        return ok({
            "displayCurrency": get_setting(conn, "displayCurrency", "USD"),
            "allocationTargets": get_setting(conn, "allocationTargets", {}),
            "panicMode": is_panic(conn),
        })
    finally:
        conn.close()


@router.get("/admin/export")
def admin_export(user: dict = Depends(require_auth("owner"))):
    """JSON dump penuh (portabilitas data). Owner saja."""
    conn = get_conn()
    try:
        data = {
            "exportedAt": now_iso(),
            "version": VERSION,
            "users": query(conn, "SELECT id, name, email, role, created_at FROM users"),
            "entities": query(conn, "SELECT * FROM entities"),
            "assets": query(conn, "SELECT * FROM assets"),
            "transactions": query(conn, "SELECT * FROM transactions"),
            "strategies": query(conn, "SELECT * FROM strategies"),
            "trades": query(conn, "SELECT * FROM trades"),
            "alerts": query(conn, "SELECT * FROM alerts"),
            "approvals": query(conn, "SELECT * FROM approvals"),
            "researchNotes": query(conn, "SELECT * FROM research_notes"),
            "successionRules": query(conn, "SELECT * FROM succession_rules"),
            "emergencyInstructions": query(conn, "SELECT * FROM emergency_instructions"),
            "goals": query(conn, "SELECT * FROM goals"),
            "timeCapsules": query(conn, "SELECT * FROM time_capsules"),
            "settings": query(conn, "SELECT * FROM settings"),
            "portfolioSnapshots": query(conn, "SELECT * FROM portfolio_snapshots"),
            "auditLogs": query(conn, "SELECT * FROM audit_logs ORDER BY id DESC LIMIT 1000"),
        }
        return ok(data)
    finally:
        conn.close()
