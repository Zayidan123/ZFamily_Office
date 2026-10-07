"""MFA TOTP (RFC 6238) — STDLIB SAJA (hmac, base64, struct, hashlib, secrets).

- gen_secret()        -> base32 secret 20 byte random (tanpa padding, kompatibel
                         Google Authenticator / Authy).
- totp_code(secret, at) -> kode 6 digit pada waktu `at` (epoch detik; None = now).
- verify_totp(secret, code, window=1) -> cek step -1..+1 (toleransi clock 30s*window).
- otpauth_url(secret, email) -> URL otpauth:// untuk QR authenticator app.

Parameter standar: SHA1, 6 digit, periode 30 detik (default semua authenticator).
"""
import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

TOTP_PERIOD = 30
TOTP_DIGITS = 6
TOTP_ISSUER = "Family Office Mr.Z"


def _b32decode(secret_b32: str) -> bytes:
    """Decode base32 (terima lowercase, terima tanpa padding)."""
    s = (secret_b32 or "").strip().replace(" ", "").upper()
    if not s:
        raise ValueError("Secret TOTP kosong")
    pad = "=" * (-len(s) % 8)
    return base64.b32decode(s + pad)


def totp_code(secret_b32: str, at: float = None) -> str:
    """Kode TOTP 6 digit pada waktu epoch `at` (None = sekarang)."""
    key = _b32decode(secret_b32)
    counter = int(at if at is not None else time.time()) // TOTP_PERIOD
    msg = struct.pack(">Q", counter)
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code_int = (struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF) % (10 ** TOTP_DIGITS)
    return str(code_int).zfill(TOTP_DIGITS)


def verify_totp(secret_b32: str, code: str, window: int = 1, at: float = None) -> bool:
    """Verifikasi kode; cek step -window..+window (default ±30 detik)."""
    if not code or not str(code).strip().isdigit():
        return False
    code = str(code).strip()
    base_at = at if at is not None else time.time()
    for step in range(-int(window), int(window) + 1):
        candidate = totp_code(secret_b32, at=base_at + step * TOTP_PERIOD)
        if hmac.compare_digest(candidate, code):
            return True
    return False


def gen_secret() -> str:
    """Secret base32 20 byte acak (tanpa padding '=') — simpan ke users.mfaSecret."""
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def otpauth_url(secret_b32: str, email: str, issuer: str = TOTP_ISSUER) -> str:
    """URL otpauth://totp/... untuk QR code authenticator (issuer + account)."""
    label = quote(f"{issuer}:{email or 'user'}")
    return (
        f"otpauth://totp/{label}?"
        f"secret={secret_b32}&issuer={quote(issuer)}"
        f"&algorithm=SHA1&digits={TOTP_DIGITS}&period={TOTP_PERIOD}"
    )
