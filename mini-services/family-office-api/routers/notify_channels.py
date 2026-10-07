"""Kanal Notifikasi keluar (mock delivery) — Email & Telegram (ronde 9).

- GET  /settings/notification-channels       -> konfigurasi kanal + riwayat pengiriman
                                                (owner/beneficiary/advisor; executor 403).
- PUT  /settings/notification-channels       -> simpan konfigurasi (owner; panic-guard).
- POST /settings/notification-channels/test  -> kirim pesan tes (owner; panic-guard).
- deliver_notification(conn, source, message)-> helper SISTEM: dipanggil saat price
                                                alert terpicu utk fan-out ke kanal aktif.

Delivery adalah MOCK (simulasi lokal — tanpa network call nyata): setiap percobaan
dicatat ke riwayat (settings key `notifyLog`, maks NOTIFY_LOG_MAX entri terbaru) +
audit log append-only. Status "delivered" berarti "disimulasikan terkirim".

Konfigurasi disimpan di settings key `notifyChannels`:
  {"email":    {"enabled": bool, "target": str},
   "telegram": {"enabled": bool, "target": str}}
"""
import re

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from typing import Optional

from db import get_conn, guard_mutation, now_iso, write_audit
from errors import ApiError, ok
from security import require_auth

router = APIRouter(tags=["settings"])

READ_ROLES = ("owner", "beneficiary", "advisor")   # executor -> 403

CHANNELS = ("email", "telegram")
NOTIFY_LOG_MAX = 50          # riwayat pengiriman maksimum (terbaru dipertahankan)
LOG_RETURN_LIMIT = 20        # berapa entri dikembalikan ke UI

DEFAULT_CHANNELS = {
    "email": {"enabled": False, "target": "owner@zfamily.id"},
    "telegram": {"enabled": False, "target": ""},
}

# target email longgar (mock) — cukup ada @ + domain
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
# telegram: @handle alfanumerik/underscore (5-64) ATAU chat_id numerik
TELEGRAM_RE = re.compile(r"^(@[A-Za-z0-9_]{4,64}|-?\d{3,})$")


def _get_channels(conn) -> dict:
    """Baca konfigurasi kanal dari settings (fallback default utk key hilang)."""
    from db import get_setting

    raw = get_setting(conn, "notifyChannels", {}) or {}
    merged: dict = {}
    for ch in CHANNELS:
        cur = dict(DEFAULT_CHANNELS[ch])
        saved = raw.get(ch) or {}
        cur["enabled"] = bool(saved.get("enabled", cur["enabled"]))
        cur["target"] = str(saved.get("target") or cur["target"] or "")
        merged[ch] = cur
    return merged


def _get_log(conn) -> list:
    from db import get_setting

    log = get_setting(conn, "notifyLog", []) or []
    return log if isinstance(log, list) else []


def _append_log(conn, channel: str, target: str, message: str, source: str) -> dict:
    """Append 1 entri riwayat pengiriman (cap NOTIFY_LOG_MAX, terbaru di depan)."""
    entry = {
        "id": f"{now_iso()}-{channel}",
        "channel": channel,
        "target": target,
        "message": message,
        "status": "delivered",
        "source": source,
        "sentAt": now_iso(),
    }
    log = _get_log(conn)
    log.insert(0, entry)
    del log[NOTIFY_LOG_MAX:]
    from db import set_setting

    set_setting(conn, "notifyLog", log)
    return entry


def _validate_target(channel: str, target: str) -> str:
    """Validasi target per kanal; return target yang sudah dibersihkan."""
    t = (target or "").strip()
    if not t:
        raise ApiError(400, f"Target {channel} belum diisi")
    if channel == "email" and not EMAIL_RE.match(t):
        raise ApiError(400, "Format email tidak valid (mis. nama@zfamily.id)")
    if channel == "telegram" and not TELEGRAM_RE.match(t):
        raise ApiError(400, "Target Telegram harus @handle (min. 5 karakter) atau chat_id angka")
    return t


def deliver_notification(conn, source: str, message: str) -> list:
    """Fan-out SISTEM ke semua kanal aktif (dipanggil saat price alert terpicu).

    Tidak melempar error — kegagalan konfigurasi hanya menghasilkan entri log
    berstatus "failed" agar riwayat tetap informatif. Return daftar entri log.
    """
    channels = _get_channels(conn)
    entries: list = []
    for ch in CHANNELS:
        conf = channels.get(ch) or {}
        if not conf.get("enabled"):
            continue
        target = (conf.get("target") or "").strip()
        if not target:
            continue
        entry = {
            "id": f"{now_iso()}-{ch}",
            "channel": ch,
            "target": target,
            "message": message,
            "status": "delivered",
            "source": source,
            "sentAt": now_iso(),
        }
        entries.append(entry)
    if entries:
        log = _get_log(conn)
        log[:0] = entries
        del log[NOTIFY_LOG_MAX:]
        from db import set_setting

        set_setting(conn, "notifyLog", log)
        write_audit(conn, None, "notify.deliver", "notification",
                    f"Kirim notifikasi ke {len(entries)} kanal: " +
                    ", ".join(f"{e['channel']}({e['target']})" for e in entries))
    return entries


# ------------------------------------------------------------------ GET

@router.get("/settings/notification-channels")
def get_notification_channels(user: dict = Depends(require_auth(*READ_ROLES))):
    conn = get_conn()
    try:
        channels = _get_channels(conn)
        log = _get_log(conn)
        return ok({
            "channels": channels,
            "log": log[:LOG_RETURN_LIMIT],
            "deliveredCount": len(log),
            "mock": True,
        })
    finally:
        conn.close()


# ------------------------------------------------------------------ PUT

class ChannelConf(BaseModel):
    enabled: Optional[bool] = None
    target: Optional[str] = None


class NotifyChannelsBody(BaseModel):
    channels: dict = Field(default_factory=dict)


@router.put("/settings/notification-channels")
def update_notification_channels(body: NotifyChannelsBody,
                                 user: dict = Depends(require_auth("owner"))):
    conn = get_conn()
    try:
        guard_mutation(conn)
        current = _get_channels(conn)
        incoming = body.channels or {}
        unknown = [k for k in incoming.keys() if k not in CHANNELS]
        if unknown:
            raise ApiError(400, f"Kanal tidak dikenal: {', '.join(unknown)}")

        changed: list = []
        for ch in CHANNELS:
            patch = incoming.get(ch)
            if not isinstance(patch, dict):
                continue
            conf = current[ch]
            if patch.get("enabled") is not None:
                conf["enabled"] = bool(patch["enabled"])
            if patch.get("target") is not None:
                t = str(patch["target"]).strip()
                if t:
                    _validate_target(ch, t)   # format salah -> 400
                    conf["target"] = t
            # mengaktifkan kanal tanpa target valid -> tolak
            if conf["enabled"] and not conf["target"]:
                raise ApiError(400, f"Kanal {ch} aktif memerlukan target terlebih dahulu")
            current[ch] = conf
            changed.append(f"{ch}={'on' if conf['enabled'] else 'off'}")

        from db import set_setting

        set_setting(conn, "notifyChannels", current)
        write_audit(conn, user, "notify.channels_update", "settings",
                    "Update kanal notifikasi: " + ", ".join(changed))
        return ok({
            "channels": current,
            "log": _get_log(conn)[:LOG_RETURN_LIMIT],
            "deliveredCount": len(_get_log(conn)),
            "mock": True,
        })
    finally:
        conn.close()


# ------------------------------------------------------------------ TEST

class NotifyTestBody(BaseModel):
    channel: str
    message: Optional[str] = ""


@router.post("/settings/notification-channels/test")
def test_notification_channel(body: NotifyTestBody,
                              user: dict = Depends(require_auth("owner"))):
    conn = get_conn()
    try:
        guard_mutation(conn)
        ch = (body.channel or "").strip().lower()
        if ch not in CHANNELS:
            raise ApiError(400, f"Kanal harus salah satu dari: {', '.join(CHANNELS)}")
        conf = _get_channels(conn)[ch]
        if not conf["enabled"]:
            raise ApiError(400, f"Kanal {ch} masih nonaktif — aktifkan dahulu")
        target = _validate_target(ch, conf["target"])
        message = (body.message or "").strip() or (
            "🔔 Pesan tes dari Z Family Office — konfigurasi kanal Anda berfungsi.")
        entry = _append_log(conn, ch, target, message, source="test")
        write_audit(conn, user, "notify.test", "notification",
                    f"Tes kirim notifikasi via {ch} ke {target}")
        return ok(entry)
    finally:
        conn.close()
