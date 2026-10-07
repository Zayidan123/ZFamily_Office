"""SQLite layer: koneksi per-request (WAL + foreign keys), DDL lengkap, settings, audit log."""
import json
import os
import sqlite3
from datetime import datetime, timezone

from errors import ApiError

DB_DIR = "/home/z/my-project/db"
DB_PATH = os.path.join(DB_DIR, "family_office.db")


def now_iso() -> str:
    """Timestamp UTC ISO-8601 dengan akhiran Z (konsisten utk seluruh API)."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def r2(x) -> float:
    """Round aman ke 2 desimal (money formatter)."""
    try:
        return round(float(x or 0) + 0.0, 2)
    except (TypeError, ValueError):
        return 0.0


def get_conn() -> sqlite3.Connection:
    """Buka koneksi SQLite baru per-request dengan PRAGMA yang wajib."""
    os.makedirs(DB_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    conn.execute("PRAGMA busy_timeout=5000;")
    return conn


# ---------------------------------------------------------------- query utils

def query(conn: sqlite3.Connection, sql: str, params=()) -> list:
    """SELECT -> list[dict] (rows sebagai dict biasa)."""
    cur = conn.execute(sql, params)
    return [dict(r) for r in cur.fetchall()]


def query_one(conn: sqlite3.Connection, sql: str, params=()):
    rows = query(conn, sql, params)
    return rows[0] if rows else None


def execute(conn: sqlite3.Connection, sql: str, params=()) -> int:
    """INSERT/UPDATE/DELETE + commit. Return lastrowid."""
    cur = conn.execute(sql, params)
    conn.commit()
    return cur.lastrowid


# ------------------------------------------------------- settings (key-value)

def get_setting(conn: sqlite3.Connection, key: str, default=None):
    row = query_one(conn, "SELECT value FROM settings WHERE key = ?", (key,))
    if row is None:
        return default
    try:
        return json.loads(row["value"])
    except (TypeError, ValueError):
        return row["value"]


def set_setting(conn: sqlite3.Connection, key: str, value) -> None:
    execute(
        conn,
        "INSERT INTO settings(key, value, updated_at) VALUES(?, ?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        (key, json.dumps(value, ensure_ascii=False), now_iso()),
    )


# ------------------------------------------------------------- panic mode

def is_panic(conn: sqlite3.Connection) -> bool:
    return bool(get_setting(conn, "panicMode", False))


def guard_mutation(conn: sqlite3.Connection) -> None:
    """Panic mode ON -> semua mutasi (POST/PUT/DELETE) ditolak 423.

    Pengecualian: POST /system/panic (owner mematikan kill-switch) tidak
    memanggil helper ini.
    """
    if is_panic(conn):
        raise ApiError(423, "Panic mode aktif — semua operasi tulis dinonaktifkan sementara (kill-switch)")


# ------------------------------------------------------------- audit log

def write_audit(conn: sqlite3.Connection, user, action: str, entity_type: str, detail: str) -> None:
    """Audit log append-only — dipanggil di SETIAP mutasi + login.

    `user` = token payload {sub, role, name} (atau dict {id, name, role});
    boleh None untuk aksi sistem.
    """
    uid = None
    uname, role = "system", "system"
    if isinstance(user, dict):
        uid = user.get("sub", user.get("id"))
        uname = user.get("name") or "unknown"
        role = user.get("role") or "unknown"
    execute(
        conn,
        "INSERT INTO audit_logs(user_id, user_name, role, action, entity_type, detail, created_at) "
        "VALUES(?, ?, ?, ?, ?, ?, ?)",
        (uid, uname, role, action, entity_type, detail, now_iso()),
    )


# ------------------------------------------------------------------- DDL

DDL = """
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK(role IN ('owner','beneficiary','advisor','executor')),
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entities (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK(type IN ('personal','holding','family')),
  description TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  asset_class  TEXT NOT NULL CHECK(asset_class IN ('crypto','stocks','forex_gold','property','vehicle','cash','business')),
  symbol       TEXT,
  entity_id    INTEGER REFERENCES entities(id) ON DELETE SET NULL,
  quantity     REAL NOT NULL DEFAULT 0,
  unit_price   REAL NOT NULL DEFAULT 0,
  currency     TEXT NOT NULL DEFAULT 'USD' CHECK(currency IN ('USD','IDR')),
  source_type  TEXT NOT NULL DEFAULT 'other',
  source_label TEXT NOT NULL DEFAULT '',
  notes        TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_class ON assets(asset_class);

CREATE TABLE IF NOT EXISTS transactions (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id  INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  type      TEXT NOT NULL CHECK(type IN ('buy','sell','transfer_in','transfer_out','income','expense','valuation_update')),
  quantity  REAL NOT NULL DEFAULT 0,
  price     REAL NOT NULL DEFAULT 0,
  currency  TEXT NOT NULL DEFAULT 'USD',
  price_usd REAL NOT NULL DEFAULT 0,
  total_usd REAL NOT NULL DEFAULT 0,
  fee_usd   REAL NOT NULL DEFAULT 0,
  note      TEXT NOT NULL DEFAULT '',
  at        TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_asset ON transactions(asset_id);
CREATE INDEX IF NOT EXISTS idx_tx_at ON transactions(at);

CREATE TABLE IF NOT EXISTS strategies (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  platform       TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','archived')),
  description    TEXT NOT NULL DEFAULT '',
  win_rate_pct   REAL NOT NULL DEFAULT 0,
  pnl_usd        REAL NOT NULL DEFAULT 0,
  last_signal_at TEXT,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trades (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy_id INTEGER NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  symbol      TEXT NOT NULL,
  side        TEXT NOT NULL DEFAULT 'long',
  quantity    REAL NOT NULL DEFAULT 0,
  entry_price REAL NOT NULL DEFAULT 0,
  exit_price  REAL,
  pnl_usd     REAL,
  opened_at   TEXT NOT NULL,
  closed_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_trades_strategy ON trades(strategy_id);

CREATE TABLE IF NOT EXISTS alerts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL DEFAULT 'system' CHECK(kind IN ('system','trading')),
  source     TEXT NOT NULL,
  level      TEXT NOT NULL CHECK(level IN ('info','warning','critical')),
  message    TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alerts_at ON alerts(created_at);

CREATE TABLE IF NOT EXISTS approvals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  amount_usd   REAL NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL,
  decided_at   TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  user_name  TEXT NOT NULL,
  role       TEXT NOT NULL,
  action     TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT '',
  detail     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS research_notes (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  title            TEXT NOT NULL,
  asset_id         INTEGER REFERENCES assets(id) ON DELETE SET NULL,
  thesis           TEXT NOT NULL DEFAULT '',
  target_price_usd REAL,
  exit_plan        TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','closed')),
  tags             TEXT NOT NULL DEFAULT '[]',
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS succession_rules (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  beneficiary_name TEXT NOT NULL,
  relation         TEXT NOT NULL DEFAULT '',
  entity_name      TEXT,
  asset_scope      TEXT NOT NULL DEFAULT '',
  conditions       TEXT NOT NULL DEFAULT '',
  "trigger"        TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','draft','revoked')),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS emergency_instructions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,
  sealed     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS goals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  target_usd  REAL NOT NULL DEFAULT 0,
  current_usd REAL NOT NULL DEFAULT 0,
  deadline    TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS time_capsules (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  title            TEXT NOT NULL,
  content          TEXT NOT NULL,
  unlock_condition TEXT NOT NULL DEFAULT '',
  unlock_date      TEXT,
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL,
  value_usd  REAL NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snap_date ON portfolio_snapshots(date);

CREATE TABLE IF NOT EXISTS watchlist (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol   TEXT NOT NULL UNIQUE,
  note     TEXT,
  addedAt  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tax_obligations (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL,
  type      TEXT NOT NULL,
  period    TEXT NOT NULL,
  dueDate   TEXT NOT NULL,
  amountUsd REAL,
  paid      INTEGER NOT NULL DEFAULT 0,
  paidAt    TEXT,
  notes     TEXT,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tax_due ON tax_obligations(dueDate);

CREATE TABLE IF NOT EXISTS paper_state (
  id             INTEGER PRIMARY KEY CHECK(id = 1),
  cashUsd        REAL NOT NULL DEFAULT 100000,
  realizedPnlUsd REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS paper_trades (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol         TEXT NOT NULL,
  side           TEXT NOT NULL CHECK(side IN ('buy','sell')),
  qty            REAL NOT NULL,
  priceUsd       REAL NOT NULL,
  realizedPnlUsd REAL,
  at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_paper_at ON paper_trades(at);
"""

# Kolom MFA (PRD #42) — ditambahkan via ALTER TABLE agar aman untuk DB existing.
MFA_COLUMNS = (("mfaSecret", "TEXT"), ("mfaEnabled", "INTEGER NOT NULL DEFAULT 0"))


def _migrate_users_mfa(conn: sqlite3.Connection) -> None:
    """Tambah kolom mfaSecret/mfaEnabled ke users bila belum ada (idempotent)."""
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(users)").fetchall()}
    for name, decl in MFA_COLUMNS:
        if name not in cols:
            conn.execute(f"ALTER TABLE users ADD COLUMN {name} {decl}")


def create_tables(conn: sqlite3.Connection) -> None:
    """Jalankan DDL lengkap (idempotent) + migrasi ringan + seed paper_state."""
    conn.executescript(DDL)
    _migrate_users_mfa(conn)
    # Paper trading sandbox: state awal $100.000 cash, PnL riil 0 (sekali saja).
    if not query_one(conn, "SELECT id FROM paper_state WHERE id = 1"):
        execute(conn, "INSERT INTO paper_state(id, cashUsd, realizedPnlUsd) VALUES(1, 100000, 0)")
    conn.commit()
