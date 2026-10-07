// ============================================================
// Family Office — Mr.Z · Formatter utilitas (id-ID / en-US)
// ============================================================

const usdFull = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});

const idrFull = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const idrCompact = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatUsd(value: number | null | undefined, compact = false): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return compact ? usdCompact.format(value) : usdFull.format(value);
}

export function formatIdr(value: number | null | undefined, compact = false): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return compact ? idrCompact.format(value) : idrFull.format(value);
}

export function formatCompact(value: number | null | undefined, currency: "USD" | "IDR" = "USD"): string {
  return currency === "USD" ? formatUsd(value, true) : formatIdr(value, true);
}

/** formatPct(12.34) → "+12,3%" · formatPct(12.34, false) → "12,3%" */
export function formatPct(value: number | null | undefined, signed = true, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const fixed = value.toFixed(digits).replace(".", ",");
  if (!signed) return `${fixed}%`;
  return `${value > 0 ? "+" : ""}${fixed}%`;
}

export function formatNumber(value: number | null | undefined, digits = 4): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: digits }).format(value);
}

const MONTHS_ID = [
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
];

/** formatDate("2025-02-12T10:30:00") → "12 Feb 2025" */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getDate()} ${MONTHS_ID[d.getMonth()]} ${d.getFullYear()}`;
}

/** formatDateTime → "12 Feb 2025, 10.30" */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${formatDate(iso)}, ${hh}.${mm}`;
}

/** Label bulan untuk chart: "2025-02" → "Feb 25" ; fallback format ISO penuh */
export function formatMonthLabel(date: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(date ?? "");
  if (m) return `${MONTHS_ID[Number(m[2]) - 1]} ${m[1].slice(2)}`;
  return formatDate(date);
}

/** Waktu relatif bahasa Indonesia: "baru saja", "5 mnt lalu", "2 jam lalu", "3 hr lalu" */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = Date.now() - t;
  const s = Math.floor(diff / 1000);
  if (s < 60) return "baru saja";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} mnt lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam lalu`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} hr lalu`;
  return formatDate(iso);
}

/** Konversi antar mata uang display */
export function convertCurrency(
  amount: number,
  from: "USD" | "IDR",
  to: "USD" | "IDR",
  usdIdrRate: number,
): number {
  if (!Number.isFinite(amount)) return 0;
  if (from === to || !usdIdrRate) return amount;
  return from === "USD" ? amount * usdIdrRate : amount / usdIdrRate;
}
