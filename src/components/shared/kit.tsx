"use client";

// ============================================================
// Family Office — Mr.Z · Shared UI kit
// StatCard, PageHeader, SectionCard, EmptyState, LoadingRows,
// ErrorBox, CurrencyText, RoleBadge, ClassBadge, ConfirmButton,
// Monogram + hooks (useRates / useFormatCurrency)
// ============================================================
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useAppStore } from "@/lib/store";
import { api, ApiError } from "@/lib/api";
import { formatUsd, formatIdr, formatPct } from "@/lib/format";
import type { AssetClass, AlertLevel, Role, RateInfo } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Inbox,
  RotateCcw,
} from "lucide-react";

// ------------------------------------------------------------
// Hooks bersama
// ------------------------------------------------------------

export function useRates() {
  return useQuery<RateInfo, ApiError>({
    queryKey: ["rates"],
    queryFn: () => api.rates(),
    staleTime: 55_000,
    refetchInterval: 60_000,
  });
}

/** (usd, compact?) => string — menghormati displayCurrency dari store */
export function useFormatCurrency() {
  const currency = useAppStore((s) => s.displayCurrency);
  const { data: rates } = useRates();
  return React.useCallback(
    (usd: number, compact = false): string => {
      if (currency === "IDR") {
        const rate = rates?.USDIDR;
        if (rate && Number.isFinite(rate)) return formatIdr(usd * rate, compact);
        return "—";
      }
      return formatUsd(usd, compact);
    },
    [currency, rates?.USDIDR],
  );
}

// ------------------------------------------------------------
// Polish helpers — cardHover (utilitas hover lift kartu)
// ------------------------------------------------------------

/** Utilitas hover-lift — terapkan pada Card/StatCard/SectionCard (aman untuk semua view) */
export const cardHover =
  "transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md";

// ------------------------------------------------------------
// Count-up animation (StatCard) — requestAnimationFrame, 700ms easeOut
// Backward-compatible: value non-numerik (ReactNode/string non-angka)
// dirender langsung tanpa animasi.
// ------------------------------------------------------------

const COUNTUP_DURATION = 700;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** Animasi angka dari nilai sebelumnya (awal 0) → target, easeOutCubic. */
function useCountUp(target: number, duration = COUNTUP_DURATION): number {
  const reduced = usePrefersReducedMotion();
  const [display, setDisplay] = React.useState(0);
  const currentRef = React.useRef(0);

  React.useEffect(() => {
    if (reduced) {
      currentRef.current = target;
      setDisplay(target);
      return;
    }
    const from = currentRef.current;
    if (from === target) {
      setDisplay(target);
      return;
    }
    const start =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(
        1,
        ((typeof performance !== "undefined" ? performance.now() : Date.now()) -
          start) /
          duration,
      );
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const v = from + (target - from) * eased;
      currentRef.current = t < 1 ? v : target;
      setDisplay(currentRef.current);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, reduced]);

  return display;
}

/** Metadata replay format string terformat agar count-up mempertahankan gaya aslinya. */
interface NumericFormatInfo {
  prefix: string;
  suffix: string;
  explicitPlus: boolean;
  negative: boolean;
  groupingSep: "," | "." | null;
  decimalSep: "," | "." | null;
  fracDigits: number;
  value: number;
}

/**
 * Parse string terformat — "$2,535,379.30", "Rp 40.003.721.671", "+12,3%",
 * "15", "1,15" — menjadi angka + info format. Return null jika bukan angka
 * murni (mis. "—", "12 Feb 2025") supaya StatCard merender langsung.
 */
function parseNumericFormat(raw: string): NumericFormatInfo | null {
  if (!raw || !/\d/.test(raw)) return null;
  const m = /^([^\d.,+\-]*)([+\-])?([\d.,]+)(.*)$/.exec(raw.trim());
  if (!m) return null;
  const prefix = m[1];
  const sign = m[2];
  const num = m[3];
  const suffix = m[4];
  // Ada digit di prefix/suffix → bukan angka murni (mis. tanggal) → jangan animasi
  if (/\d/.test(prefix) || /\d/.test(suffix)) return null;
  if (!num) return null;

  const lastDot = num.lastIndexOf(".");
  const lastComma = num.lastIndexOf(",");
  let groupingSep: "," | "." | null = null;
  let decimalSep: "," | "." | null = null;

  if (lastDot >= 0 && lastComma >= 0) {
    if (lastDot > lastComma) {
      decimalSep = ".";
      groupingSep = ",";
    } else {
      decimalSep = ",";
      groupingSep = ".";
    }
  } else {
    const sep = lastDot >= 0 ? "." : lastComma >= 0 ? "," : null;
    if (sep) {
      const parts = num.split(sep);
      const after = parts[1] ?? "";
      if (parts.length > 2) {
        groupingSep = sep; // 40.003.721 / 2,535,379
      } else if (after.length === 3 && parts[0] !== "") {
        groupingSep = sep; // ambigu "96,378" → perlakukan sebagai ribuan
      } else if (after.length > 0) {
        decimalSep = sep; // "12,3" / "1.15"
      }
    }
  }

  const fracDigits = decimalSep ? (num.split(decimalSep)[1]?.length ?? 0) : 0;
  const canonical =
    (groupingSep ? num.split(groupingSep).join("") : num).replace(
      decimalSep ?? "",
      ".",
    );
  const value = Number(canonical);
  if (!Number.isFinite(value)) return null;

  return {
    prefix,
    suffix,
    explicitPlus: sign === "+",
    negative: value < 0 || sign === "-",
    groupingSep,
    decimalSep,
    fracDigits,
    value,
  };
}

/** Replay string terformat dari angka teranimasi — bentuk identik dengan sampel. */
function formatLike(info: NumericFormatInfo, n: number): string {
  const locale = info.decimalSep === "," ? "id-ID" : "en-US";
  const body = new Intl.NumberFormat(locale, {
    minimumFractionDigits: info.decimalSep ? info.fracDigits : 0,
    maximumFractionDigits: info.decimalSep ? info.fracDigits : 0,
    useGrouping: Boolean(info.groupingSep),
  }).format(n);
  const plus = info.explicitPlus && n > 0 ? "+" : "";
  return `${plus}${info.prefix}${body}${info.suffix}`;
}

/**
 * Hook internal StatCard: menghasilkan node teranimasi bila value numerik,
 * atau value apa adanya bila tidak bisa dianimasikan (backward compatible).
 */
function useAnimatedValue(value: React.ReactNode): React.ReactNode {
  const reduced = usePrefersReducedMotion();
  const parsed = React.useMemo(() => {
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return null;
      return {
        info: null,
        target: value,
        raw: null as string | null,
      };
    }
    if (typeof value === "string") {
      const info = parseNumericFormat(value);
      if (!info) return null;
      return { info, target: info.value, raw: value };
    }
    return null;
  }, [value]);

  const animated = useCountUp(parsed ? parsed.target : 0);

  if (!parsed || reduced) return value;
  // Frame terakhir → string asli (menjamin bentuk persis sama)
  if (parsed.raw !== null && animated === parsed.target) return parsed.raw;
  if (parsed.info) return formatLike(parsed.info, animated);
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(
    animated,
  );
}

// ------------------------------------------------------------
// Monogram "Z" — brand mark
// ------------------------------------------------------------

export function Monogram({ size = 40, className }: { size?: number; className?: string }) {
  const id = React.useId().replace(/[:]/g, "");
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`zg-${id}`} x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f59e0b" />
          <stop offset="1" stopColor="#10b981" />
        </linearGradient>
      </defs>
      <rect
        x="1.75"
        y="1.75"
        width="44.5"
        height="44.5"
        rx="11"
        stroke={`url(#zg-${id})`}
        strokeWidth="2.4"
        fill="none"
        opacity="0.95"
      />
      <path
        d="M15 15.5 H33 L17.5 32.5 H33"
        stroke={`url(#zg-${id})`}
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

// ------------------------------------------------------------
// StatCard
// ------------------------------------------------------------

/**
 * Ekstrak teks polos dari ReactNode (rekursif) — dipakai StatCard untuk
 * atribut title agar nilai panjang yang ter-truncate tetap terbaca penuh
 * saat hover. Node non-teks (icon dsb.) diabaikan.
 */
function nodeToText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map((n) => nodeToText(n)).join("");
  if (React.isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode };
    return nodeToText(props.children);
  }
  return "";
}

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  delta?: number | null;
  icon?: React.ReactNode;
  loading?: boolean;
  accent?: "default" | "amber" | "rose";
  className?: string;
}

export function StatCard({ label, value, sub, delta, icon, loading, accent = "default", className }: StatCardProps) {
  const up = (delta ?? 0) >= 0;
  const animatedValue = useAnimatedValue(loading ? null : value);
  // Teks penuh utk atribut title (hover) — jaga bila nilai ter-truncate di kolom sempit.
  const valueText = nodeToText(animatedValue).trim();
  return (
    <Card className={cn(cardHover, "min-w-0 rounded-xl p-5 flex flex-col gap-3 min-h-[118px]", className)}>
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {icon && (
          <span
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
              accent === "amber" && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
              accent === "rose" && "bg-rose-500/10 text-rose-600 dark:text-rose-400",
              accent === "default" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
            )}
            aria-hidden="true"
          >
            {icon}
          </span>
        )}
      </div>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-4 w-24" />
        </div>
      ) : (
        <>
          {/* min-w-0 + truncate: nilai panjang (mis. "Rp 40.003.721.671") tidak
              meluber di grid 2-kolom mobile — full text tampil via title hover. */}
          <div className="min-w-0 text-2xl font-semibold tabular-nums leading-none">
            <span className="block truncate" title={valueText || undefined}>
              {animatedValue}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {typeof delta === "number" && Number.isFinite(delta) && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium tabular-nums",
                  up
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "bg-rose-500/10 text-rose-600 dark:text-rose-400",
                )}
              >
                {up ? <TrendingUp className="h-3 w-3" aria-hidden="true" /> : <TrendingDown className="h-3 w-3" aria-hidden="true" />}
                {formatPct(delta)}
              </span>
            )}
            {sub && <span className="text-muted-foreground truncate">{sub}</span>}
          </div>
        </>
      )}
    </Card>
  );
}

// ------------------------------------------------------------
// PageHeader
// ------------------------------------------------------------

export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {/* Aksen: garis gradient emerald → amber tipis di bawah judul */}
        <div
          aria-hidden="true"
          className="h-0.5 w-14 rounded-full bg-gradient-to-r from-emerald-500 to-amber-400"
        />
        {subtitle && <p className="pt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// ------------------------------------------------------------
// SectionCard
// ------------------------------------------------------------

export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
}: {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card className={cn(cardHover, "rounded-xl flex flex-col", className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-5 pb-3">
          <div className="space-y-0.5 min-w-0">
            {title && (
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {title}
              </h3>
            )}
            {description && <p className="text-xs text-muted-foreground/80">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn("px-6 pb-6", contentClassName)}>{children}</div>
    </Card>
  );
}

// ------------------------------------------------------------
// EmptyState
// ------------------------------------------------------------

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-12 px-6 text-center",
        className,
      )}
    >
      {icon && (
        <span
          className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          aria-hidden="true"
        >
          {icon ?? <Inbox className="h-5 w-5" />}
        </span>
      )}
      <div className="space-y-1">
        <p className="font-semibold">{title}</p>
        {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

// ------------------------------------------------------------
// LoadingRows — skeleton baris tabel/list
// ------------------------------------------------------------

export function LoadingRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-3", className)} aria-busy="true" aria-label="Memuat data">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-3.5 w-20" />
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------
// ErrorBox — inline error dengan retry
// ------------------------------------------------------------

export function ErrorBox({
  message,
  onRetry,
  className,
}: {
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">
            Gagal memuat data
          </p>
          <p className="text-sm text-rose-600/90 dark:text-rose-400/90">
            {message || "Backend belum terjangkau — mencoba lagi"}
          </p>
        </div>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="shrink-0 border-rose-500/40">
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Coba lagi
        </Button>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// CurrencyText — auto konversi sesuai display currency store
// ------------------------------------------------------------

export function CurrencyText({
  usd,
  compact = false,
  className,
}: {
  usd: number;
  compact?: boolean;
  className?: string;
}) {
  const format = useFormatCurrency();
  return (
    <span className={cn("tabular-nums", className)}>
      {format(usd, compact)}
    </span>
  );
}

// ------------------------------------------------------------
// Badges: Role & AssetClass (palet tanpa biru/indigo)
// ------------------------------------------------------------

const ROLE_STYLE: Record<Role, { label: string; className: string }> = {
  owner: {
    label: "Owner",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  beneficiary: {
    label: "Beneficiary",
    className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  advisor: {
    label: "Advisor",
    className: "border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-400",
  },
  executor: {
    label: "Executor",
    className: "border-zinc-500/40 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  },
};

export function RoleBadge({ role, className }: { role: Role; className?: string }) {
  const s = ROLE_STYLE[role] ?? ROLE_STYLE.executor;
  return (
    <Badge variant="outline" className={cn(s.className, className)}>
      {s.label}
    </Badge>
  );
}

export const ASSET_CLASS_STYLE: Record<AssetClass, { label: string; className: string; hex: string }> = {
  crypto: { label: "Kripto", className: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400", hex: "#f59e0b" },
  stocks: { label: "Saham", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", hex: "#10b981" },
  forex_gold: { label: "Forex/Emas", className: "border-yellow-600/40 bg-yellow-600/10 text-yellow-700 dark:text-yellow-500", hex: "#ca8a04" },
  property: { label: "Properti", className: "border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-400", hex: "#0d9488" },
  vehicle: { label: "Kendaraan", className: "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-400", hex: "#f97316" },
  cash: { label: "Kas", className: "border-lime-600/40 bg-lime-600/10 text-lime-700 dark:text-lime-500", hex: "#65a30d" },
  business: { label: "Bisnis", className: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400", hex: "#e11d48" },
};

export function ClassBadge({ assetClass, className }: { assetClass: AssetClass; className?: string }) {
  const s = ASSET_CLASS_STYLE[assetClass] ?? {
    label: assetClass,
    className: "border-zinc-500/40 bg-zinc-500/10 text-zinc-600 dark:text-zinc-300",
    hex: "#71717a",
  };
  return (
    <Badge variant="outline" className={cn(s.className, className)}>
      {s.label}
    </Badge>
  );
}

export function AlertLevelBadge({ level, className }: { level: AlertLevel; className?: string }) {
  const style =
    level === "critical"
      ? "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400"
      : level === "warning"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
        : "border-zinc-500/40 bg-zinc-500/10 text-zinc-600 dark:text-zinc-300";
  const label = level === "critical" ? "Kritis" : level === "warning" ? "Peringatan" : "Info";
  return (
    <Badge variant="outline" className={cn(style, className)}>
      {label}
    </Badge>
  );
}

// ------------------------------------------------------------
// ConfirmButton — konfirmasi dua langkah (anti salah klik)
// ------------------------------------------------------------

export function ConfirmButton({
  onConfirm,
  children,
  confirmLabel = "Yakin? Klik lagi",
  variant = "outline",
  size = "sm",
  disabled,
  className,
  title,
}: {
  onConfirm: () => void;
  children: React.ReactNode;
  confirmLabel?: string;
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  const [armed, setArmed] = React.useState(false);
  React.useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  return (
    <Button
      type="button"
      title={title}
      disabled={disabled}
      size={size}
      variant={armed ? "destructive" : variant}
      className={cn("min-h-[36px]", className)}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
    >
      {armed ? confirmLabel : children}
    </Button>
  );
}
