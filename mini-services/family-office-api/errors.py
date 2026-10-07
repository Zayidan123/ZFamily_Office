"""API contract helpers: error type + response envelope.

Kontrak respons:
- sukses -> {"ok": true, "data": ...}
- error  -> {"ok": false, "error": "pesan"} + HTTP 400/401/403/404/423/500
"""


class ApiError(Exception):
    """Error bisnis/aplikasi yang akan dikonversi menjadi envelope error."""

    def __init__(self, status: int, message: str):
        self.status = int(status)
        self.message = str(message)
        super().__init__(self.message)


def ok(data) -> dict:
    """Envelope sukses standar."""
    return {"ok": True, "data": data}


def err(message: str) -> dict:
    """Envelope error standar (dipakai manual bila perlu)."""
    return {"ok": False, "error": message}
