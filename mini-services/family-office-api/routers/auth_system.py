"""Auth, system (status/panic), rates publik, settings, admin export."""
import threading
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from db import (execute, get_conn, get_setting, guard_mutation, is_panic, now_iso,
                query, query_one, set_setting, write_audit)
from errors import ApiError, ok
from mfa import gen_secret, otpauth_url, verify_totp
from prices import get_rates
from security import hash_password, require_auth, sign_token, verify_token

router = APIRouter(tags=["auth-system"])

VERSION = "1.2.0"  # selaraskan dengan VERSION di main.py
ALLOWED_CURRENCIES = {"USD", "IDR"}
ALLOWED_TARGET_KEYS = {"crypto", "stocks", "forexGold", "property", "cash"}

# Rate-limit MFA: max percobaan verify GAGAL per challengeToken (in-memory).
_MFA_FAILS: dict = {}
_MFA_FAILS_LOCK = threading.Lock()
_MFA_MAX_FAILS = 5


def _mfa_fail_count(token: str, bump: bool = False) -> int:
    with _MFA_FAILS_LOCK:
        if len(_MFA_FAILS) > 2048:  # housekeeping sederhana
            _MFA_FAILS.clear()
        cur = _MFA_FAILS.get(token, 0)
        if bump:
            cur += 1
            _MFA_FAILS[token] = cur
        return cur


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
        audit_user = {"sub": user["id"], "name": user["name"], "role": user["role"]}
        if user["mfaEnabled"]:
            # MFA aktif -> langkah 1: keluarkan challengeToken (5 menit, TANPA role).
            challenge = sign_token({"sub": user["id"], "kind": "mfa"}, ttl_seconds=300)
            write_audit(conn, audit_user, "auth.mfa_challenge", "auth",
                        f"Login step 1 — challenge MFA dikirim ({user['role']})")
            return ok({"mfaRequired": True, "challengeToken": challenge})
        # Tanpa MFA -> perilaku lama (satu langkah).
        token = sign_token({"sub": user["id"], "role": user["role"], "name": user["name"]})
        write_audit(conn, audit_user, "auth.login", "auth", f"Login berhasil ({user['role']})")
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


# ------------------------------------------------------------------- MFA TOTP
class MfaCodeBody(BaseModel):
    code: str


class MfaVerifyBody(BaseModel):
    challengeToken: str
    code: str


def _mfa_user_row(conn, user_id) -> dict:
    row = query_one(conn, "SELECT id, name, email, role, mfaSecret, mfaEnabled FROM users WHERE id = ?", (user_id,))
    if not row:
        raise ApiError(404, "User tidak ditemukan")
    return row


@router.post("/auth/mfa/setup")
def mfa_setup(user: dict = Depends(require_auth())):
    """Generate (atau regenerate) secret TOTP — mfaEnabled tetap 0 sampai enable."""
    conn = get_conn()
    try:
        row = _mfa_user_row(conn, user["sub"])
        if row["mfaEnabled"]:
            raise ApiError(400, "MFA sudah aktif — panggil /auth/mfa/disable dulu untuk reset")
        secret = gen_secret()
        execute(conn, "UPDATE users SET mfaSecret = ? WHERE id = ?", (secret, user["sub"]))
        write_audit(conn, user, "auth.mfa_setup", "auth",
                    f"Secret TOTP dibuat/diperbarui untuk {row['email']} (belum aktif)")
        return ok({"secret": secret, "otpauthUrl": otpauth_url(secret, row["email"])})
    finally:
        conn.close()


@router.post("/auth/mfa/enable")
def mfa_enable(body: MfaCodeBody, user: dict = Depends(require_auth())):
    conn = get_conn()
    try:
        row = _mfa_user_row(conn, user["sub"])
        if not row["mfaSecret"]:
            raise ApiError(400, "Belum ada secret TOTP — panggil /auth/mfa/setup dulu")
        if row["mfaEnabled"]:
            raise ApiError(400, "MFA sudah aktif")
        if not verify_totp(row["mfaSecret"], body.code):
            raise ApiError(400, "Kode TOTP salah")
        execute(conn, "UPDATE users SET mfaEnabled = 1 WHERE id = ?", (user["sub"],))
        write_audit(conn, user, "auth.mfa_enable", "auth", f"MFA TOTP diaktifkan untuk {row['email']}")
        return ok({"enabled": True})
    finally:
        conn.close()


@router.post("/auth/mfa/disable")
def mfa_disable(body: MfaCodeBody, user: dict = Depends(require_auth())):
    conn = get_conn()
    try:
        row = _mfa_user_row(conn, user["sub"])
        if not row["mfaEnabled"]:
            raise ApiError(400, "MFA belum aktif")
        if not verify_totp(row["mfaSecret"] or "", body.code):
            raise ApiError(400, "Kode TOTP salah")
        execute(conn, "UPDATE users SET mfaEnabled = 0, mfaSecret = NULL WHERE id = ?", (user["sub"],))
        write_audit(conn, user, "auth.mfa_disable", "auth", f"MFA TOTP dimatikan untuk {row['email']}")
        return ok({"enabled": False})
    finally:
        conn.close()


@router.get("/auth/mfa/status")
def mfa_status(user: dict = Depends(require_auth())):
    conn = get_conn()
    try:
        row = _mfa_user_row(conn, user["sub"])
        return ok({"enabled": bool(row["mfaEnabled"]), "hasSecret": bool(row["mfaSecret"])})
    finally:
        conn.close()


@router.post("/auth/mfa/verify")
def mfa_verify(body: MfaVerifyBody):
    """Langkah 2 login MFA: challengeToken + kode TOTP -> token sesi penuh."""
    payload = verify_token(body.challengeToken)
    if not payload or payload.get("kind") != "mfa":
        raise ApiError(401, "Challenge token tidak valid atau kedaluwarsa")
    token_raw = body.challengeToken
    if _mfa_fail_count(token_raw) >= _MFA_MAX_FAILS:
        raise ApiError(429, "Terlalu banyak percobaan MFA gagal — login ulang untuk challenge baru")

    conn = get_conn()
    try:
        row = _mfa_user_row(conn, payload["sub"])
        if not row["mfaEnabled"] or not row["mfaSecret"]:
            raise ApiError(401, "MFA tidak aktif untuk user ini — login normal")
        if not verify_totp(row["mfaSecret"], body.code):
            fails = _mfa_fail_count(token_raw, bump=True)
            write_audit(conn, {"sub": row["id"], "name": row["name"], "role": row["role"]},
                        "auth.mfa_verify_failed", "auth", "Kode TOTP salah pada challenge login")
            if fails >= _MFA_MAX_FAILS:
                raise ApiError(429, "Terlalu banyak percobaan MFA gagal — login ulang untuk challenge baru")
            raise ApiError(401, f"Kode TOTP salah ({_MFA_MAX_FAILS - fails} percobaan tersisa)")
        with _MFA_FAILS_LOCK:
            _MFA_FAILS.pop(token_raw, None)  # sukses -> reset counter
        token = sign_token({"sub": row["id"], "role": row["role"], "name": row["name"]})
        write_audit(conn, {"sub": row["id"], "name": row["name"], "role": row["role"]},
                    "auth.login", "auth", f"Login berhasil via MFA ({row['role']})")
        return ok({"token": token,
                   "user": {"id": row["id"], "name": row["name"], "email": row["email"], "role": row["role"]}})
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
