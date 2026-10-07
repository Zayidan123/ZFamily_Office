"""Security: HMAC token (JWT-lite) + password hash + dependency RBAC FastAPI.

- Token: base64url(JSON payload {sub, role, name, exp}) + "." + HMAC-SHA256 hex.
- Secret disimpan di file `secret.key` (auto-generate saat pertama kali).
- Password: sha256(password + "::zfo-salt").
- require_auth(*roles) -> FastAPI dependency; tanpa roles = semua user login.
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from typing import Optional

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from errors import ApiError

SECRET_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "secret.key")
TOKEN_TTL_HOURS = 12
SALT_SUFFIX = "::zfo-salt"

_bearer = HTTPBearer(auto_error=False)


def _load_secret() -> bytes:
    if not os.path.exists(SECRET_FILE):
        with open(SECRET_FILE, "w", encoding="utf-8") as f:
            f.write(secrets.token_hex(32))
        try:
            os.chmod(SECRET_FILE, 0o600)
        except OSError:
            pass
    with open(SECRET_FILE, "r", encoding="utf-8") as f:
        return f.read().strip().encode("utf-8")


def hash_password(password: str) -> str:
    return hashlib.sha256((password + SALT_SUFFIX).encode("utf-8")).hexdigest()


def _b64e(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _b64d(data: str) -> bytes:
    pad = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + pad)


def sign_token(payload: dict, ttl_hours: int = TOKEN_TTL_HOURS) -> str:
    body = dict(payload)
    body["exp"] = int(time.time()) + ttl_hours * 3600
    raw = _b64e(json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    sig = hmac.new(_load_secret(), raw.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{raw}.{sig}"


def verify_token(token: str) -> Optional[dict]:
    """Return payload bila valid & belum expired, selain itu None."""
    try:
        raw, sig = token.split(".", 1)
        expect = hmac.new(_load_secret(), raw.encode("ascii"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expect):
            return None
        payload = json.loads(_b64d(raw).decode("utf-8"))
        if int(payload.get("exp", 0)) < time.time():
            return None
        return payload
    except Exception:
        return None


def require_auth(*roles: str):
    """Dependency RBAC: verifikasi Bearer token; batasi peran bila diberikan.

    Pemakaian: user: dict = Depends(require_auth("owner", "beneficiary"))
    """

    def dep(creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer)) -> dict:
        if creds is None or not creds.credentials:
            raise ApiError(401, "Token tidak ditemukan — login terlebih dahulu")
        payload = verify_token(creds.credentials)
        if not payload:
            raise ApiError(401, "Token tidak valid atau kedaluwarsa")
        if roles and payload.get("role") not in roles:
            raise ApiError(403, f"Akses ditolak untuk peran '{payload.get('role')}'")
        return payload

    return dep
