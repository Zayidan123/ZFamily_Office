"""Family Office API — FastAPI entry point (port 8001).

Jalankan: `bun run dev` (package.json -> python3 main.py) dari folder ini.
"""
import sqlite3
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from db import create_tables, get_conn
from errors import ApiError
from routers import (alerts_price, analytics, assets_tx, auth_system, dashboard, export,
                     governance, knowledge, market, paper, risk, tax, trading)
from seed import seed_if_empty, seed_market_tax_if_empty, seed_price_alerts_if_empty

VERSION = "1.4.0"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # startup: buat tabel + seed sekali (jika users kosong)
    conn = get_conn()
    try:
        create_tables(conn)
        if seed_if_empty(conn):
            print("[family-office-api] Seed data awal dibuat (demo keluarga Mr.Z)")
        if seed_market_tax_if_empty(conn):
            print("[family-office-api] Seed watchlist + tax obligations dibuat")
        if seed_price_alerts_if_empty(conn):
            print("[family-office-api] Seed price alerts dibuat (4 alert, 1 terpicu)")
    finally:
        conn.close()
    yield


app = FastAPI(
    title="Family Office API",
    version=VERSION,
    description="REST API platform Family Office pribadi (Mr.Z) — kripto, saham, forex/emas, aset fisik.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/v1/health")
def health():
    return {"ok": True, "data": {"status": "healthy", "service": "family-office-api", "version": VERSION}}


# --------------------------------------------------------------- routers

for _r in (auth_system.router, dashboard.router, assets_tx.router, governance.router,
           risk.router, trading.router, paper.router, knowledge.router, market.router, tax.router,
           export.router, alerts_price.router, analytics.router):
    app.include_router(_r, prefix="/api/v1")


# ------------------------------------------------------ exception handlers
# Semua error memakai envelope konsisten: {"ok": false, "error": "pesan"}

@app.exception_handler(ApiError)
async def api_error_handler(_request: Request, exc: ApiError):
    return JSONResponse(status_code=exc.status, content={"ok": False, "error": exc.message})


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(_request: Request, exc: StarletteHTTPException):
    detail = exc.detail if isinstance(exc.detail, str) else "Terjadi kesalahan pada request"
    return JSONResponse(status_code=exc.status_code, content={"ok": False, "error": detail})


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_request: Request, exc: RequestValidationError):
    msg = "Payload tidak valid"
    try:
        e0 = exc.errors()[0]
        loc = ".".join(str(p) for p in e0.get("loc", []) if p != "body")
        msg = f"Payload tidak valid: {loc} — {e0.get('msg', '')}"
    except Exception:
        pass
    return JSONResponse(status_code=400, content={"ok": False, "error": msg})


@app.exception_handler(sqlite3.IntegrityError)
async def integrity_error_handler(_request: Request, exc: sqlite3.IntegrityError):
    return JSONResponse(status_code=400,
                        content={"ok": False, "error": f"Data tidak valid (constraint database): {exc}"})


@app.exception_handler(Exception)
async def unhandled_error_handler(_request: Request, exc: Exception):
    return JSONResponse(status_code=500,
                        content={"ok": False, "error": f"Kesalahan server internal: {type(exc).__name__}: {exc}"})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8001)
