"""Seed data Family Office Mr.Z — dijalankan SEKALI (jika tabel users kosong).

Data realistis konteks keluarga Indonesia. Random memakai seed tetap
(random.Random(20241207)) agar konsisten antar-generate.
"""
import json
import random
from datetime import datetime, timedelta, timezone

import prices
from db import execute, query_one, set_setting, write_audit
from security import hash_password

RNG = random.Random(20241207)
USDIDR = prices.BASE_PRICES["USDIDR"]
GOLD_OZ_GRAM = 31.1035


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _ago(days: float = 0.0, hours: float = 0.0) -> str:
    return _iso(datetime.now(timezone.utc) - timedelta(days=days, hours=hours))


# ------------------------------------------------------------------ data

USERS = [
    ("Zayidan Muttaqin", "owner@zfamily.id", "owner123", "owner"),
    ("Aisyah Zaydan", "aisyah@zfamily.id", "family123", "beneficiary"),
    ("Budi Santoso", "budi@partner.id", "advisor123", "advisor"),
    ("Raka Pratama", "raka@zfamily.id", "executor123", "executor"),
]

ENTITIES = [
    ("personal", "Personal — Mr.Z", "Aset pribadi Mr.Z: kripto, saham global, emas kertas."),
    ("holding", "Z Capital Holding", "Kendaraan holding aset produktif: saham IDX, properti, kendaraan."),
    ("family", "Keluarga Zaydan", "Aset bersama keluarga inti: kas & emas fisik."),
]

# key, name, class, symbol, entity, qty, unit_price, currency, source_type, source_label, notes
ASSETS = [
    ("BTCX", "Bitcoin — Binance", "crypto", "BTC", "personal", 1.15, 97000.0, "USD", "exchange", "Binance", "Akumulasi DCA bulanan + profit strategi Zaytrix"),
    ("BTCL", "Bitcoin — Ledger Nano X", "crypto", "BTC", "personal", 0.5, 97000.0, "USD", "wallet", "Ledger Nano X (cold storage)", "Cold storage jangka panjang — seed phrase di brankas notaris"),
    ("ETH", "Ethereum", "crypto", "ETH", "personal", 12.4, 3400.0, "USD", "exchange", "Binance", "Rencana staking (lihat catatan riset)"),
    ("BNB", "BNB", "crypto", "BNB", "personal", 38.0, 640.0, "USD", "exchange", "Binance", "Posisi spot + utility"),
    ("SUI", "Sui", "crypto", "SUI", "personal", 8500.0, 3.2, "USD", "exchange", "OKX", "Posisi layer-1 baru"),
    ("BBCA", "BBCA — Bank Central Asia", "stocks", "BBCA", "holding", 500000.0, 9750.0, "IDR", "broker", "IDX — BNI Sekuritas", "5.000 lot (lembar) — blue chip perbankan"),
    ("BBRI", "BBRI — Bank Rakyat Indonesia", "stocks", "BBRI", "holding", 300000.0, 4300.0, "IDR", "broker", "IDX — BNI Sekuritas", "Dividend yield tinggi"),
    ("TLKM", "TLKM — Telkom Indonesia", "stocks", "TLKM", "holding", 500000.0, 3450.0, "IDR", "broker", "IDX — BNI Sekuritas", "Dividen interim & final rutin"),
    ("NVDA", "NVIDIA Corp", "stocks", "NVDA", "personal", 60.0, 138.0, "USD", "broker", "Interactive Brokers", "Eksposur AI supply chain"),
    ("XAU", "XAUUSD — Gold Spot", "forex_gold", "XAU", "personal", 500.0, 2650.0, "USD", "broker", "Exness", "5 lot × 100 oz — CFD gold"),
    ("ANTAM", "Emas Antam 200 gram", "forex_gold", "EMASANTAM", "family", 200.0, 1350000.0, "IDR", "physical", "Brankas rumah — sertifikat Antam", "Emas fisik, harga per gram"),
    ("RUMAH", "Rumah Pondok Indah", "property", None, "holding", 1.0, 4500000000.0, "IDR", "physical", "SHM — atas nama holding", "Hunian keluarga + aset apresiasi"),
    ("ALPHARD", "Toyota Alphard 2023", "vehicle", None, "holding", 1.0, 950000000.0, "IDR", "physical", "BPKB — lunas", "Kendaraan keluarga"),
    ("KASIDR", "Kas — Bank Mandiri", "cash", None, "family", 1.0, 750000000.0, "IDR", "bank", "Bank Mandiri — giro", "Dana operasional & cadangan"),
    ("USDCASH", "USD Cash — Safe Deposit", "cash", None, "family", 25000.0, 1.0, "USD", "physical", "Safe rumah", "Kas dolar fisik"),
]

STRATEGIES = [
    ("Zaytrix — AI Portfolio System", "Zaytrix Engine", "active",
     "Sistem alokasi & rebalancing otomatis berbasis AI untuk portofolio keluarga. Risk per trade maks 1% equity.", 2),
    ("AI Signal Generator", "TradingView + Webhook", "active",
     "Generator sinyal entry/exit multi-asset dengan konfirmasi model AI. Notifikasi ke Telegram keluarga.", 6),
    ("EA Scalping XAUUSD", "MetaTrader 5", "paused",
     "Expert advisor scalping gold timeframe M5. Risk 0.5%/trade — dipause otomatis setelah drawdown 3.2%.", 26),
]

# strategy index -> (symbol, side, qty, entry, exit, pnl, open_days_ago, close_days_ago); exit None = posisi terbuka
TRADES = {
    0: [
        ("BTC", "long", 0.3, 62500.0, 71800.0, 2790.0, 230, 222),
        ("ETH", "long", 6.0, 2450.0, 3120.0, 4020.0, 200, 192),
        ("SUI", "long", 5000.0, 2.35, 3.05, 3500.0, 150, 140),
        ("BNB", "long", 25.0, 545.0, 592.0, 1175.0, 140, 132),
        ("NVDA", "long", 40.0, 102.0, 138.0, 1440.0, 120, 100),
        ("BTC", "long", 0.25, 68900.0, 66200.0, -675.0, 110, 104),
        ("ETH", "long", 4.0, 3350.0, 3210.0, -560.0, 85, 80),
        ("BTC", "long", 0.35, 84500.0, 94200.0, 3405.0, 60, 52),
        ("ETH", "long", 8.0, 3180.0, 3390.0, 1680.0, 40, 33),
        ("BTC", "long", 0.2, 95500.0, None, None, 5, None),
    ],
    1: [
        ("BTC", "long", 0.2, 67800.0, 72400.0, 920.0, 210, 205),
        ("ETH", "long", 3.0, 2890.0, 3010.0, 360.0, 160, 155),
        ("NVDA", "long", 20.0, 118.0, 109.0, -180.0, 130, 126),
        ("BTC", "short", 0.15, 70500.0, 68900.0, 240.0, 95, 90),
        ("ETH", "long", 5.0, 3420.0, 3355.0, -325.0, 55, 50),
        ("XAU", "long", 20.0, 2480.0, 2635.0, 3100.0, 45, 38),
        ("SUI", "long", 4000.0, 3.05, None, None, 3, None),
    ],
    2: [
        ("XAU", "long", 10.0, 2648.0, 2655.0, 70.0, 70, 69),
        ("XAU", "long", 10.0, 2652.0, 2641.0, -110.0, 66, 65),
        ("XAU", "long", 5.0, 2645.0, 2652.0, 35.0, 62, 61),
        ("XAU", "long", 10.0, 2660.0, 2644.0, -160.0, 58, 57),
        ("XAU", "long", 10.0, 2638.0, 2650.0, 120.0, 54, 53),
        ("XAU", "long", 15.0, 2655.0, 2622.0, -495.0, 48, 47),
    ],
}


def _btc_hist(days_ago: int) -> float:
    """Harga BTC historis: tren naik 8 bulan terakhir (60k -> 97k) + noise seed tetap."""
    f = 1.0 - 0.38 * min(days_ago, 260) / 240.0
    f = max(0.55, f)
    return round(97000.0 * f * RNG.uniform(0.985, 1.015))


def _build_transactions():
    """±28 transaksi dalam 8 bulan terakhir: (asset_key, type, qty, price, fee, note, days_ago)."""
    txs = []
    dca_qty = [0.02, 0.015, 0.02, 0.025, 0.02, 0.015, 0.02, 0.02]
    for i, q in enumerate(dca_qty):
        d = 238 - i * 30
        p = _btc_hist(d)
        txs.append(("BTCX", "buy", q, float(p), round(q * p * 0.001, 2), f"DCA BTC bulanan #{i + 1:02d}", d))

    fixed = [
        ("ETH", "buy", 2.5, 2450.0, "Buy ETH — akumulasi posisi awal", 210, 0.001),
        ("BNB", "buy", 20.0, 545.0, "Buy BNB — akumulasi", 150, 0.001),
        ("BBCA", "buy", 100000.0, 9200.0, "Buy BBCA 1.000 lot", 200, 0.0015),
        ("BBRI", "buy", 200000.0, 4150.0, "Buy BBRI — positioning dividen", 180, 0.0015),
        ("TLKM", "buy", 300000.0, 3350.0, "Buy TLKM — posisi awal", 160, 0.0015),
        ("NVDA", "buy", 30.0, 102.0, "Buy NVDA — batch 1", 140, 0.001),
        ("ANTAM", "buy", 50.0, 1240000.0, "Buy Emas Antam 50 gram (sertifikat)", 120, 0.0),
        ("ETH", "buy", 1.5, 2890.0, "Buy ETH — tambah posisi", 105, 0.001),
        ("SUI", "buy", 3000.0, 2.35, "Buy SUI — entry layer-1", 90, 0.001),
        ("BBCA", "buy", 150000.0, 9400.0, "Buy BBCA 1.500 lot", 100, 0.0015),
        ("BBRI", "buy", 100000.0, 4250.0, "Buy BBRI — tambahan", 75, 0.0015),
        ("TLKM", "buy", 200000.0, 3400.0, "Buy TLKM — tambahan", 80, 0.0015),
        ("NVDA", "buy", 30.0, 118.0, "Buy NVDA — batch 2", 70, 0.001),
        ("XAU", "expense", 1.0, 45.0, "Biaya admin & swap Exness", 50, 0.0),
        ("RUMAH", "expense", 1.0, 12500000.0, "PBB & perawatan rumah (tahunan)", 60, 0.0),
        ("TLKM", "income", 300000.0, 59.5, "Dividen TLKM DT11 (interim)", 45, 0.0),
        ("KASIDR", "income", 1.0, 3650000.0, "Bunga giro Bank Mandiri", 20, 0.0),
        ("BTCX", "transfer_in", 0.15, 93000.0, "Tarik profit strategi Zaytrix ke Binance", 35, 0.0),
        ("BTCX", "transfer_out", 0.08, 95000.0, "Withdraw BTC ke Ledger Nano X (cold storage)", 25, 0.0),
        ("RUMAH", "valuation_update", 1.0, 4500000000.0, "Revaluasi KJPP — kenaikan nilai wajar", 15, 0.0),
        ("ALPHARD", "valuation_update", 1.0, 950000000.0, "Penilaian ulang — depresiasi kendaraan", 10, 0.0),
    ]
    for key, t, q, p, note, d, fp in fixed:
        fee = round(q * p * fp, 2) if fp else 0.0
        txs.append((key, t, q, p, fee, note, d))
    return txs


EMERGENCY_CONTENT = (
    "LANGKAH DARURAT (kondisi kritis keluarga):\n"
    "1. Hubungi Raka Pratama (executor): +62-812-9000-4321 — telepon/WA.\n"
    "2. Buka brankas kantor notaris — Kantor Notaris Dr. Siti H., M.H., "
    "Jl. Kemang Raya No. 12, Jakarta Selatan (jam kerja 09:00–16:00).\n"
    "3. Ambil amplop 'ZFO-EMERGENCY': dokumen seed phrase tersegel — 2 ampun, "
    "wajib 2 tanda tangan saksi keluarga untuk dibuka.\n"
    "4. Akses bursa (Binance/OKX): backup 2FA codes & API key cadangan ada di brankas yang sama.\n"
    "5. Kontak pendukung: Budi Santoso (pajak & akuntansi) +62-811-2200-991; "
    "notaris untuk surat kuasa khusus.\n"
    "6. JANGAN menggunakan seed phrase untuk transaksi selain kebutuhan darurat keluarga. "
    "Catat setiap aksi di audit log."
)

CAPSULE_CONTENT = (
    "Untuk anak-anak dan cucu kami — ketika kalian membaca ini, 20 tahun sudah berlalu. "
    "Keluarga ini dibangun dengan disiplin: simpan sebelum belanja, asuransi sebelum investasi, "
    "dan jangan pernah berutang untuk gaya hidup. Aset boleh berubah bentuk, tapi prinsipnya tidak: "
    "transparansi, amanah, dan berkah yang dibagikan."
)


# ------------------------------------------------------------------ seeder

def seed_if_empty(conn) -> bool:
    row = query_one(conn, "SELECT COUNT(*) AS c FROM users")
    if row and row["c"] > 0:
        return False
    _seed(conn)
    return True


def _seed(conn) -> None:
    # ---- users --------------------------------------------------------
    uid = {}
    for name, email, pw, role in USERS:
        uid[role] = execute(
            conn,
            "INSERT INTO users(name, email, password_hash, role, created_at) VALUES(?,?,?,?,?)",
            (name, email, hash_password(pw), role, _ago(400)),
        )
    uname_by_role = {u[3]: u[0] for u in USERS}

    # ---- entities -----------------------------------------------------
    eid = {}
    for etype, name, desc in ENTITIES:
        eid[etype] = execute(
            conn,
            "INSERT INTO entities(name, type, description, created_at) VALUES(?,?,?,?)",
            (name, etype, desc, _ago(395)),
        )

    # ---- assets -------------------------------------------------------
    aid = {}
    for key, name, cls, sym, ent, qty, price, cur, stype, slabel, notes in ASSETS:
        aid[key] = execute(
            conn,
            "INSERT INTO assets(name, asset_class, symbol, entity_id, quantity, unit_price, currency, "
            "source_type, source_label, notes, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (name, cls, sym, eid[ent], qty, price, cur, stype, slabel, notes, _ago(300), _ago(1, hours=RNG.randint(1, 10))),
        )

    # ---- transactions (±28, 8 bulan terakhir) -------------------------
    amap = {a[0]: a for a in ASSETS}
    for key, t, q, p, fee, note, d in _build_transactions():
        cur = amap[key][7]
        price_usd = p if cur == "USD" else p / USDIDR
        fee_usd = fee if cur == "USD" else fee / USDIDR
        ts = _ago(d, hours=RNG.randint(1, 7))
        execute(
            conn,
            "INSERT INTO transactions(asset_id, type, quantity, price, currency, price_usd, total_usd, "
            "fee_usd, note, at, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (aid[key], t, q, p, cur, round(price_usd, 6), round(q * price_usd, 2), round(fee_usd, 4), note, ts, ts),
        )

    # ---- strategies + trades ------------------------------------------
    for i, (name, platform, status, desc, sig_hours) in enumerate(STRATEGIES):
        closed = [t for t in TRADES[i] if t[5] is not None]
        pnl = sum(t[5] for t in closed)
        wins = sum(1 for t in closed if t[5] > 0)
        wr = round(wins / len(closed) * 100, 1) if closed else 0.0
        sid = execute(
            conn,
            "INSERT INTO strategies(name, platform, status, description, win_rate_pct, pnl_usd, "
            "last_signal_at, created_at) VALUES(?,?,?,?,?,?,?,?)",
            (name, platform, status, desc, wr, pnl, _ago(0, hours=sig_hours), _ago(300)),
        )
        for sym, side, qty, entry, exitp, pnl_t, od, cd in TRADES[i]:
            execute(
                conn,
                "INSERT INTO trades(strategy_id, symbol, side, quantity, entry_price, exit_price, pnl_usd, "
                "opened_at, closed_at) VALUES(?,?,?,?,?,?,?,?,?)",
                (sid, sym, side, qty, entry, exitp, pnl_t, _ago(od), _ago(cd) if cd is not None else None),
            )

    # ---- alerts (±8) ----------------------------------------------------
    alerts = [
        ("trading", "Zaytrix", "info", "Sinyal BUY BTC terdeteksi — confidence 82%, target $104,000", 2),
        ("trading", "AI Signal Generator", "warning", "ETH mendekati resistance $3,550 — pertimbangkan take profit parsial", 6),
        ("trading", "EA Scalping XAUUSD", "warning", "Drawdown 3.2% dari equity puncak — EA dipause otomatis", 26),
        ("system", "Security", "critical", "Login dari perangkat tidak dikenal — Chrome/Windows, IP Jakarta, pukul 03:14 (anomali)", 50),
        ("system", "Tax & Compliance", "warning", "Reminder: pelaporan pajak dividen & rekap RKU — tenggat akhir bulan depan", 74),
        ("trading", "AI Signal Generator", "info", "SUI volatilitas 24 jam di atas rata-rata — pantau posisi 8,500 SUI", 98),
        ("system", "Vault", "info", "Firmware Ledger Nano X baru tersedia (v2.4.3) — jadwalkan update", 122),
        ("system", "System", "info", "Snapshot portofolio otomatis berhasil dibuat", 146),
    ]
    for kind, source, level, msg, h in alerts:
        execute(conn, "INSERT INTO alerts(kind, source, level, message, created_at) VALUES(?,?,?,?,?)",
                (kind, source, level, msg, _ago(0, hours=h)))

    # ---- approvals (2 pending + histori) ------------------------------
    approvals = [
        ("DCA BTC 0.15 — Rp 370 juta",
         "Eksekusi DCA BTC bulanan 0,15 BTC via Binance. Anggaran alokasi kripto kuartal berjalan: Rp 370 juta. Eksekusi bila harga < $98,000.",
         14550.0, "pending", "owner", None, 2, None),
        ("Top-up Emas Antam 100g",
         "Pembelian 100 gram Emas Antam bersertifikat sebagai hedging inflasi. Penyimpanan: brankas rumah + safe deposit box bank.",
         8520.0, "pending", "owner", None, 4, None),
        ("Pembelian NVDA 30 lembar",
         "Tambah posisi NVDA 30 lembar @ $118 via Interactive Brokers (batch 2).",
         3540.0, "approved", "owner", "beneficiary", 42, 40),
        ("Upgrade kendaraan — Toyota Vellfire",
         "Penggantian Alphard dengan Vellfire 2024. Ditolak: depresiasi terlalu cepat, Alphard masih prima.",
         82000.0, "rejected", "owner", "owner", 35, 30),
    ]
    for title, desc, amount, status, req_role, dec_role, cdays, ddays in approvals:
        execute(
            conn,
            "INSERT INTO approvals(title, description, amount_usd, status, requested_by, decided_by, "
            "created_at, decided_at) VALUES(?,?,?,?,?,?,?,?)",
            (title, desc, amount, status, uid.get(req_role),
             uid.get(dec_role) if dec_role else None, _ago(cdays), _ago(ddays) if ddays else None),
        )

    # ---- audit history (±10) -------------------------------------------
    audits = [
        ("owner", "auth.login", "auth", "Login berhasil — Chrome di macOS", 30, 0),
        ("owner", "asset.create", "asset", "Tambah aset: Sui (OKX) — 8,500 SUI", 90, 4),
        ("owner", "transaction.create", "transaction", "buy 300,000 TLKM @ Rp 3,350", 160, 3),
        ("owner", "approval.create", "approval", "Pengajuan: Pembelian NVDA 30 lembar", 42, 1),
        ("beneficiary", "approval.approve", "approval", "Menyetujui: Pembelian NVDA 30 lembar", 40, 2),
        ("owner", "system.panic", "system", "Panic mode ON — simulasi drill keamanan", 12, 4),
        ("owner", "system.panic", "system", "Panic mode OFF — drill selesai", 12, 2),
        ("advisor", "research.create", "research_note", "Catatan riset baru: Emas sebagai Hedge Portofolio", 25, 5),
        ("owner", "snapshot.create", "snapshot", "Snapshot portofolio manual", 7, 6),
        ("owner", "settings.update", "settings", "Update allocationTargets — crypto 35%", 6, 8),
    ]
    for role, action, etype, detail, d, h in audits:
        execute(
            conn,
            "INSERT INTO audit_logs(user_id, user_name, role, action, entity_type, detail, created_at) "
            "VALUES(?,?,?,?,?,?,?)",
            (uid.get(role), uname_by_role[role], role, action, etype, detail, _ago(d, hours=h)),
        )

    # ---- research notes (4) --------------------------------------------
    notes = [
        ("Tesis BTC: Digital Store of Value", "BTCX",
         "BTC sebagai lapisan simpanan nilai jangka panjang: suplai tetap 21 juta, adopsi institusi & spot ETF "
         "meningkat. Akumulasi via DCA, alokasi maksimal 35% dari portofolio kripto.",
         150000.0, "Jual bertahap 25% per kenaikan $25k di atas $120k; review tiap halving.",
         "active", ["long-term", "store-of-value"], 200, 30),
        ("Tesis BBCA: Bank Blue Chip IDX", "BBCA",
         "BBCA pemimpin digital banking Indonesia: NIM stabil ~5,5%, ROE > 20%, CASA kuat. Akumulasi bertahap "
         "saat valuasi menarik.",
         0.82, "Review saat perubahan suku bunga BI > 50 bps atau NIM turun 2 kuartal berturut.",
         "active", ["blue-chip", "dividend"], 150, 21),
        ("Emas sebagai Hedge Portofolio", "ANTAM",
         "Emas hedge inflasi & geopolitik. Target alokasi 20% gabungan XAUUSD CFD + fisik Antam. Rebalancing "
         "berkala menjaga porsi.",
         3000.0, "Kurangi bertahap bila alokasi emas > 25% total portofolio.",
         "active", ["hedge", "inflation"], 25, 12),
        ("ETH Staking Yield", "ETH",
         "Staking ETH memberi yield 3,2–4% APY tanpa mengurangi eksposur harga. Risiko: slashing, likuiditas, "
         "perubahan protokol.",
         None, "", "draft", ["yield", "staking"], 10, 10),
    ]
    for title, akey, thesis, target, exitp, status, tags, cd, ud in notes:
        execute(
            conn,
            "INSERT INTO research_notes(title, asset_id, thesis, target_price_usd, exit_plan, status, tags, "
            "created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
            (title, aid.get(akey), thesis, target, exitp, status, json.dumps(tags, ensure_ascii=False), _ago(cd), _ago(ud)),
        )

    # ---- succession rules (3) -------------------------------------------
    rules = [
        ("Aisyah Zaydan", "Istri", None, "Semua aset — akses penuh",
         "Konfirmasi meninggal oleh 2 saksi + akta kematian resmi",
         "Konfirmasi meninggal 2 saksi + akta", "active"),
        ("Raka Pratama", "Executor — orang kepercayaan", "Z Capital Holding",
         "Akses operasional: bursa, bank, dokumen legal",
         "Akses sementara maksimal 90 hari sejak aktivasi",
         "Aktivasi darurat oleh owner atau konfirmasi meninggal", "active"),
        ("Bapak & Ibu Zaydan", "Orang tua — beneficiary cadangan", None,
         "50% portofolio",
         "Aktif bila beneficiary utama tidak dapat bertindak",
         "Tidak ada aktivitas akun 180 hari", "draft"),
    ]
    for bn, rel, ent, scope, cond, trig, st in rules:
        execute(
            conn,
            'INSERT INTO succession_rules(beneficiary_name, relation, entity_name, asset_scope, conditions, '
            '"trigger", status, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
            (bn, rel, ent, scope, cond, trig, st, _ago(100), _ago(100)),
        )

    # ---- emergency instructions (1) --------------------------------------
    execute(
        conn,
        "INSERT INTO emergency_instructions(title, content, sealed, created_at, updated_at) VALUES(?,?,0,?,?)",
        ("Instruksi Darurat — Akses Aset Keluarga", EMERGENCY_CONTENT, _ago(100), _ago(100)),
    )

    # ---- goals (3) --------------------------------------------------------
    goals = [
        ("Dana Pendidikan Anak", 500000.0, 185000.0, "2032-06-30"),
        ("Dana Pensiun", 2000000.0, 640000.0, "2045-12-31"),
        ("Haji Keluarga", 80000.0, 42000.0, "2027-05-31"),
    ]
    for name, tgt, cur, dl in goals:
        execute(conn, "INSERT INTO goals(name, target_usd, current_usd, deadline, created_at) VALUES(?,?,?,?,?)",
                (name, tgt, cur, dl, _ago(120)))

    # ---- time capsule (1, terkunci 20 tahun) ------------------------------
    capsule_unlock = _iso(datetime.now(timezone.utc) + timedelta(days=365 * 20))
    execute(
        conn,
        "INSERT INTO time_capsules(title, content, unlock_condition, unlock_date, created_at) VALUES(?,?,?,?,?)",
        ("Surat untuk Generasi Kedua", CAPSULE_CONTENT,
         "Waktu — terbuka 20 tahun setelah dibuat", capsule_unlock, _ago(60)),
    )

    # ---- settings default ---------------------------------------------------
    set_setting(conn, "displayCurrency", "USD")
    set_setting(conn, "allocationTargets", {"crypto": 35, "stocks": 25, "forexGold": 20, "property": 15, "cash": 5})
    set_setting(conn, "panicMode", False)

    # ---- portfolio snapshots: 78 titik mingguan (18 bulan) ------------------
    # Tren naik wajar + noise (seed tetap); titik terakhir = net worth sekarang.
    _, net_now, _ = prices.compute_portfolio(conn)
    weeks = 78
    vals = [net_now * 0.66]
    for _i in range(1, weeks):
        step = 0.0034 + RNG.uniform(-0.005, 0.0055)
        if RNG.random() < 0.10:
            step -= 0.018
        vals.append(max(vals[-1] * (1 + step), net_now * 0.3))
    k = net_now / vals[-1]
    for i, v in enumerate(vals):
        d = (datetime.now(timezone.utc) - timedelta(days=7 * (weeks - i))).strftime("%Y-%m-%d")
        execute(conn, "INSERT INTO portfolio_snapshots(date, value_usd, created_at) VALUES(?,?,?)",
                (d, round(v * k, 2), _ago(7 * (weeks - i))))

    write_audit(conn, None, "system.seed", "system",
                "Seed data awal dibuat (demo keluarga Mr.Z): 4 user, 3 entitas, 15 aset, transaksi, strategi, approval, riset, suksesi")


# ------------------------------------------------- watchlist + tax (modul baru)

# symbol, note
WATCHLIST = [
    ("BTC", "Core holding — DCA bulanan"),
    ("ETH", "Staking yield"),
    ("XAU", "Hedge inflasi"),
    ("BBCA", "Blue chip IDX"),
    ("NVDA", "Growth watch"),
    ("SUI", "Spekulatif kecil"),
]

# name, type, period, offset_hari_due (relatif now), amountUsd, paid, paid_days_ago, note
TAX_OBLIGATIONS = [
    ("PPh Orang Pribadi Tahunan 2025", "pajak penghasilan", "2025", 120, 18500.0, False, None,
     "SPT tahunan — hitung PPh terutang setelah rekap dividen & capital gain"),
    ("PBB P2 — Rumah Pondok Indah", "pajak properti", "2026", 20, 2200.0, False, None,
     "Tagihan tahunan NJOP rumah — bayar via e-billing"),
    ("PKB Toyota Alphard", "pajak kendaraan", "2026", 3, 850.0, False, None,
     "Pajak kendaraan bermotor + PNBP samsat"),
    ("PPh Final 0.1% Penjualan Saham", "pajak penghasilan", "Q1 2026", 15, 410.0, False, None,
     "PPh final 0.1% dari bruto penjualan saham IDX kuartal berjalan"),
    ("Pajak Bumi & Bangunan — rapih tahun lalu", "pajak properti", "2025", -300, 2050.0, True, 243,
     "Bukti bayar PBB 2025 tersimpan di folder dokumen properti"),
    ("Sumbangan Pendidikan", "lainnya", "2025", -180, 500.0, True, 152,
     "Donasi tahunan yayasan pendidikan — deductibility dicek advisor"),
]


def seed_market_tax_if_empty(conn) -> bool:
    """Seed modul Market (watchlist) & Tax — hanya jika tabel terkait masih kosong.

    Aman dipanggil berulang: tabel lama tidak disentuh, tabel baru diisi sekali.
    """
    changed = False
    if not query_one(conn, "SELECT id FROM watchlist LIMIT 1"):
        for i, (sym, note) in enumerate(WATCHLIST):
            execute(conn, "INSERT INTO watchlist(symbol, note, addedAt) VALUES(?,?,?)",
                    (sym, note, _ago(45 - i * 7)))
        write_audit(conn, None, "system.seed", "watchlist",
                    f"Seed watchlist awal: {len(WATCHLIST)} simbol")
        changed = True

    if not query_one(conn, "SELECT id FROM tax_obligations LIMIT 1"):
        for i, (name, t, period, due_off, amount, paid, paid_days, note) in enumerate(TAX_OBLIGATIONS):
            due = datetime.now(timezone.utc) + timedelta(days=due_off)
            paid_at = _ago(paid_days) if paid else None
            execute(
                conn,
                "INSERT INTO tax_obligations(name, type, period, dueDate, amountUsd, paid, paidAt, notes, createdAt) "
                "VALUES(?,?,?,?,?,?,?,?,?)",
                (name, t, period, due.strftime("%Y-%m-%d"), amount, 1 if paid else 0, paid_at,
                 note, _ago(60 - i * 3)),
            )
        write_audit(conn, None, "system.seed", "tax_obligation",
                    f"Seed kewajiban pajak awal: {len(TAX_OBLIGATIONS)} item (mix status)")
        changed = True
    return changed


# ------------------------------------------------- price alerts (modul baru)

# symbol, direction, threshold, note, status, triggered_hours_ago (None = tetap active)
PRICE_ALERTS = [
    ("BTC", "above", 120000.0, "Target breakout ATH — evaluasi tesis", "active", None),
    ("ETH", "below", 3000.0, "Zona akumulasi DCA tambahan", "active", None),
    ("BBCA", "above", 10500.0, "Take profit bertahap", "triggered", 48),
    ("XAU", "below", 2500.0, "Hedge alert", "active", None),
]


def seed_price_alerts_if_empty(conn) -> bool:
    """Seed price alerts awal — hanya jika tabel price_alerts masih kosong (idempotent).

    BBCA above 10500 di-seed berstatus TRIGGERED (2 hari lalu) + 1 row notifikasi
    di tabel alerts (source price-watch, prefix "[alert#<id>]") agar dashboard
    langsung menampilkan contoh alert terpicu.
    """
    if query_one(conn, "SELECT id FROM price_alerts LIMIT 1"):
        return False
    triggered_id = triggered_at = None
    for i, (sym, direction, thr, note, status, trig_h) in enumerate(PRICE_ALERTS):
        trig_at = _ago(0, hours=trig_h) if trig_h else None
        new_id = execute(
            conn,
            "INSERT INTO price_alerts(symbol, direction, threshold, status, note, createdAt, triggeredAt) "
            "VALUES(?,?,?,?,?,?,?)",
            (sym, direction, thr, status, note, _ago(14 - i * 2), trig_at),
        )
        if status == "triggered":
            triggered_id, triggered_at = new_id, trig_at
    if triggered_id:
        execute(
            conn,
            "INSERT INTO alerts(kind, source, level, message, created_at) "
            "VALUES('trading','price-watch','warning',?,?)",
            (f"[alert#{triggered_id}] 🔔 BBCA menembus ke atas Rp 10,500 — take profit bertahap",
             triggered_at),
        )
    write_audit(conn, None, "system.seed", "price_alert",
                f"Seed price alerts awal: {len(PRICE_ALERTS)} alert (1 terpicu: BBCA above 10500)")
    return True
