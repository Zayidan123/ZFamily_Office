# ZFamily Office — Platform Manajemen Kekayaan Multi-Aset

Platform **family office** berbasis web untuk mengelola kekayaan lintas kelas aset: **kripto, saham/ETF, komoditas (emas & FX), aset fisik (properti, kendaraan, seni), hingga rekening kas** — dengan tata kelola (governance) berbasis peran, pencatatan transaksi append-only, pemantauan harga real-time, paper trading, kepatuhan pajak, perencanaan suksesi, dan audit lengkap.

> Seluruh antarmuka berbahasa **Indonesia**, tema terang/gelap, responsif penuh (mobile → desktop), siap cetak/PDF.

---

## ✨ Fitur Utama

| Modul | Kemampuan |
|---|---|
| **Dashboard** | Ringkasan portofolio, alokasi kelas aset, trend nilai (90 hari), widget notifikasi + indikator kanal aktif |
| **Aset** | CRUD aset multi-kelas, dialog detail dgn **basis biaya FIFO / LIFO / Rata-rata** + PnL realized/unrealized, lot history |
| **Transaksi** | Riwayat append-only, filter/sort, kartu mobile, fee & catatan |
| **Portofolio & Laporan** | Kinerja vs benchmark, **Laporan Kinerja** & cetak/PDF (print CSS A4) |
| **Trading** | Paper trading (buy/sell/limit), price alerts + trigger otomatis, RBAC ketat (executor-only write) |
| **Pasar** | Harga live kripto (CoinGecko), watchlist multi-aset, sparkline 30 hari |
| **Pajak** | Kewajiban pajak per jenis, status lunas/terutama, **Laporan Pajak Tahunan** (pilih tahun + PDF) |
| **Riset** | Knowledge base catatan investasi |
| **Governance** | Manajemen pengguna 4 peran, persetujuan (approval), **audit log append-only** |
| **Suksesi** | Perencanaan warisan & penerima |
| **Pengaturan** | Profil, **panic mode** (423 blokir semua tulis + banner global), **MFA TOTP**, roadmap, **backup database** (snapshot manual + **auto-backup harian** + unduh), **kanal notifikasi Email & Telegram** (mock delivery + riwayat) |
| **UX Global** | Command palette (⌘K), **shortcut keyboard `G`+`D/A/T/P/R/M/G/X/I/S/,` + `?`**, notification bell w/ unread badge, sidebar rail collapse (persist), dark mode, kartu mobile utk semua tabel lebar |

## 🔐 Peran & RBAC

| Peran | Akses |
|---|---|
| `owner` | Penuh — termasuk backup, kanal notifikasi, panic mode, manajemen pengguna |
| `beneficiary` | Baca portofolio/laporan/pajak, kanal notifikasi baca-saja |
| `advisor` | Baca + laporan & pajak; tanpa tulis transaksi |
| `executor` | Trading (paper + alerts) — **tanpa** akses laporan/pajak/notifikasi |

Setiap endpoint diamankan server-side (403) + **audit append-only** + **panic mode** (HTTP 423) + **MFA TOTP** opsional.

## 🏗️ Arsitektur

```
Browser ──> Caddy Gateway (:81)
              ├── /            ──> Next.js 16 (SPA single-route, :3000)
              └── /api/v1/*?XTransformPort=8001 ──> FastAPI (:8001, SQLite WAL)
```

- **Frontend**: Next.js 16 App Router (single route `/`), TypeScript, Tailwind CSS 4, shadcn/ui, TanStack Query, zustand (persist), framer-motion, recharts.
- **Backend**: FastAPI (Python 3.12) — SQLite (WAL, foreign keys), seed otomatis saat pertama kali dijalankan, JWT auth, audit append-only, scheduler auto-backup (daemon thread).
- **API**: semua request frontend relatif via gateway: `/api/v1/...?XTransformPort=8001`.

## 🚀 Menjalankan Proyek

### Backend (FastAPI — port 8001)

```bash
cd mini-services/family-office-api
pip install -r requirements.txt   # fastapi, uvicorn
bun run dev                       # uvicorn main:app --port 8001
```

Saat boot: DDL dibuat, **data demo di-seed otomatis** (pengguna, aset, transaksi, alert, pajak, dsb.), `secret.key` di-generate, dan scheduler auto-backup harian aktif. Database tersimpan di `db/family_office.db`.

### Frontend (Next.js — port 3000)

```bash
bun install
bun run dev
```

> Gateway Caddy (`:81`) meneruskan `/` ke Next dan `/api/v1/*` ke FastAPI. Tanpa gateway, frontend tak akan menemukan `/api/v1/*` (fetch relatif).

### Prisma (opsional)

Skema Prisma tersedia di `prisma/` untuk scaffolding; runtime data utama memakai SQLite backend FastAPI.

## 👤 Akun Demo

| Peran | Email | Password |
|---|---|---|
| Owner | `owner@zfamily.id` | `owner123` |
| Beneficiary | `aisyah@zfamily.id` | `family123` |
| Advisor | `budi@partner.id` | `advisor123` |
| Executor | `raka@zfamily.id` | `executor123` |

## 📁 Struktur Proyek

```
src/
  app/            # Next.js App Router (single route)
  components/
    shell/        # app-shell, sidebar, topbar, bell, palette, shortcut-help
    views/        # 11 view modul (dashboard, assets, trading, tax, ...)
    shared/       # print-report, print-tax-report, badges, empty-state
  lib/            # api client, store zustand, types, format
mini-services/
  family-office-api/
    main.py       # FastAPI app + lifespan seed + scheduler
    routers/      # 16 router domain (auth, assets, trading, tax, ...)
    seed.py       # data demo
db/               # SQLite runtime (git-ignored, auto-seed)
```

## 🧪 Verifikasi Kualitas

- `bun run lint` — 0 error · `tsc` src/ — 0 error
- 20+ endpoint regresi 200 · RBAC 403 tervalidasi per peran
- QA browser end-to-end tiap rilis (login, seluruh view, console bersih, mobile 390px, dark mode, print CSS)

## 📄 Lisensi

Proyek demonstrasi — gunakan sebagai referensi implementasi family office platform.
