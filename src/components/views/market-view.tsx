"use client";

// ============================================================
// Pasar — watchlist simbol & harga live + alert harga + konverter
// GET /market/watchlist (30s) · GET /market/symbols · GET /market/history
// GET /market/alerts (30s, lazy-eval) + POST /market/alerts + dismiss/delete
// Konverter mata uang via pivot USD (useRates: USDIDR + prices[].usd)
// Sparkline mini (SVG) + dialog detail (AreaChart 7/30/90 hari)
// Quick Trade (V-b): tombol "Perdagangkan" per kartu → dialog order paper
//   POST /trading/paper/orders (owner) · GET /trading/paper/account (konteks)
// RBAC: owner CRUD (watchlist & alert), lainnya read-only, executor tanpa alert
// ============================================================
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch, ApiError } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { formatDate, formatIdr, formatNumber, formatPct, formatUsd, timeAgo } from "@/lib/format";
import type { PaperAccount } from "@/lib/types";
import {
  StatCard,
  PageHeader,
  SectionCard,
  EmptyState,
  ErrorBox,
  LoadingRows,
  CurrencyText,
  useFormatCurrency,
  useRates,
  ConfirmButton,
} from "@/components/shared/kit";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  LineChart as LineChartIcon,
  Eye,
  Plus,
  Trash2,
  Loader2,
  TrendingUp,
  TrendingDown,
  Coins,
  StickyNote,
  Bell,
  ArrowLeftRight,
  Zap,
} from "lucide-react";

// ------------------------------------------------------------
// Types (inline sesuai kontrak R-b — types.ts tidak diubah)
// ------------------------------------------------------------
interface WatchPrice {
  usd: number;
  change24hPct: number;
}

interface WatchlistItem {
  id: number;
  symbol: string;
  note: string | null;
  addedAt: string;
  price: WatchPrice;
}

interface SymbolInfo {
  symbol: string;
  usd: number;
  change24hPct: number;
}

interface MarketHistoryPoint {
  date: string;
  price: number;
}

interface MarketHistory {
  symbol: string;
  days: number;
  points: MarketHistoryPoint[];
}

// Kontrak T-a — /market/alerts (server lazy-evaluasi saat GET)
interface PriceAlert {
  id: number;
  symbol: string;
  direction: "above" | "below";
  threshold: number;
  status: "active" | "triggered" | "dismissed";
  note: string | null;
  createdAt: string;
  triggeredAt: string | null;
  currentPrice: number;
  /** Ekstra dari backend T-a: satuan threshold/currentPrice (BBCA seed = IDR) */
  quote?: "USD" | "IDR";
}

interface MarketAlertsResponse {
  alerts: PriceAlert[];
  triggeredCount: number;
}

// ------------------------------------------------------------
// Sparkline mini — SVG polyline + area gradient
// ------------------------------------------------------------
function Sparkline({
  values,
  up,
  className,
}: {
  values: number[];
  up: boolean;
  className?: string;
}) {
  const id = React.useId().replace(/[:]/g, "");
  if (values.length < 2) return null;
  const w = 120;
  const h = 36;
  const pad = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = (w - pad * 2) / (values.length - 1);
  const coords = values.map((p, i) => {
    const x = pad + i * step;
    const y = h - pad - ((p - min) / span) * (h - pad * 2);
    return [x, y] as const;
  });
  const linePath = coords
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const last = coords[coords.length - 1];
  const first = coords[0];
  const areaPath = `${linePath} L${last[0].toFixed(1)},${h - pad} L${first[0].toFixed(1)},${h - pad} Z`;
  const pointsAttr = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const color = up ? "#10b981" : "#f43f5e";

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={cn("h-9 w-full", className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.32} />
          <stop offset="100%" stopColor={color} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#spark-${id})`} stroke="none" />
      <polyline
        points={pointsAttr}
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ------------------------------------------------------------
// Hook history per simbol
// ------------------------------------------------------------
function useMarketHistory(symbol: string, days: number, enabled = true) {
  return useQuery<MarketHistory, ApiError>({
    queryKey: ["market", "history", symbol, days],
    queryFn: () =>
      apiFetch<MarketHistory>("/market/history", { params: { symbol, days } }),
    enabled: enabled && Boolean(symbol),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

// ------------------------------------------------------------
// Kartu watchlist (sparkline mini + harga live)
// ------------------------------------------------------------
function WatchCard({
  item,
  isOwner,
  canTrade,
  onTrade,
  onOpen,
  onDelete,
  deleting,
}: {
  item: WatchlistItem;
  isOwner: boolean;
  /** V-b: tombol "Perdagangkan" — hanya owner (POST paper/orders 403 utk role lain) */
  canTrade: boolean;
  onTrade: () => void;
  onOpen: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const historyQuery = useMarketHistory(item.symbol, 30);
  const points = historyQuery.data?.points ?? [];
  const values = React.useMemo(() => points.map((p) => p.price), [points]);
  const up = item.price.change24hPct >= 0;

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={`Detail ${item.symbol}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group cursor-pointer rounded-xl p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-lg font-bold tracking-tight">{item.symbol}</p>
          {item.note ? (
            <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
              <StickyNote className="h-3 w-3 shrink-0" aria-hidden="true" />
              {item.note}
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground/60">
              Ditambahkan {formatDate(item.addedAt)}
            </p>
          )}
        </div>
        {isOwner && (
          <span onClick={(e) => e.stopPropagation()}>
            <ConfirmButton
              size="icon"
              variant="ghost"
              confirmLabel="?"
              title={`Hapus ${item.symbol} dari watchlist`}
              className="h-8 w-8 text-muted-foreground opacity-0 transition-opacity hover:text-rose-600 focus-visible:opacity-100 group-hover:opacity-100"
              onConfirm={onDelete}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              )}
            </ConfirmButton>
          </span>
        )}
      </div>

      <div className="mt-3 flex items-end justify-between gap-2">
        <CurrencyText
          usd={item.price.usd}
          className="text-xl font-semibold tabular-nums"
        />
        <Badge
          variant="outline"
          className={cn(
            "tabular-nums",
            up
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400",
          )}
        >
          {formatPct(item.price.change24hPct)}
        </Badge>
      </div>

      <div className="mt-2">
        {historyQuery.isPending ? (
          <Skeleton className="h-9 w-full rounded-md" />
        ) : historyQuery.isError ? (
          <p className="flex h-9 items-center text-xs text-muted-foreground">
            Sparkline tidak tersedia
          </p>
        ) : (
          <Sparkline values={values} up={up} />
        )}
      </div>

      {/* V-b — aksi cepat paper trading (tidak memicu dialog detail) */}
      {canTrade && (
        <div className="mt-3 flex items-center justify-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-h-[36px] gap-1.5 border-emerald-500/40 bg-emerald-500/5 px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-500/15 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300"
            title="Perdagangan cepat — beli/jual di akun paper sandbox"
            aria-label={`Perdagangkan ${item.symbol} di akun paper`}
            onClick={(e) => {
              e.stopPropagation();
              onTrade();
            }}
          >
            <Zap className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
            Perdagangkan
          </Button>
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------
// Dialog detail simbol (chart besar + toggle 7/30/90 hari)
// ------------------------------------------------------------
function WatchDetailDialog({
  item,
  open,
  onOpenChange,
}: {
  item: WatchlistItem | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [days, setDays] = React.useState<7 | 30 | 90>(30);
  const formatCurrency = useFormatCurrency();
  const symbol = item?.symbol ?? "";

  React.useEffect(() => {
    if (open) setDays(30);
  }, [open, symbol]);

  const historyQuery = useMarketHistory(symbol, days, open && Boolean(item));

  const points = historyQuery.data?.points ?? [];
  const first = points.length > 0 ? points[0].price : null;
  const lastPrice = points.length > 0 ? points[points.length - 1].price : null;
  const periodChange =
    first && lastPrice ? ((lastPrice - first) / first) * 100 : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {item && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-xl">
                {item.symbol}
                <Badge
                  variant="outline"
                  className={cn(
                    "tabular-nums",
                    item.price.change24hPct >= 0
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400",
                  )}
                >
                  {formatPct(item.price.change24hPct)} 24j
                </Badge>
              </DialogTitle>
              <DialogDescription>
                Harga sekarang{" "}
                <CurrencyText
                  usd={item.price.usd}
                  className="font-semibold text-foreground"
                />{" "}
                · ditambahkan {formatDate(item.addedAt)}
              </DialogDescription>
            </DialogHeader>

            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Riwayat Harga
              </p>
              <div className="flex gap-1" role="group" aria-label="Rentang hari">
                {([7, 30, 90] as const).map((d) => (
                  <Button
                    key={d}
                    type="button"
                    size="sm"
                    variant={days === d ? "default" : "outline"}
                    className="h-7 px-2.5 text-xs"
                    onClick={() => setDays(d)}
                    aria-pressed={days === d}
                  >
                    {d} hari
                  </Button>
                ))}
              </div>
            </div>

            <div className="h-[220px] w-full" role="img" aria-label={`Grafik harga ${symbol}`}>
              {historyQuery.isPending ? (
                <Skeleton className="h-full w-full rounded-lg" />
              ) : historyQuery.isError ? (
                <ErrorBox
                  className="h-full"
                  message={
                    historyQuery.error instanceof ApiError
                      ? historyQuery.error.message
                      : undefined
                  }
                  onRetry={() => void historyQuery.refetch()}
                />
              ) : points.length === 0 ? (
                <EmptyState title="Belum ada data riwayat" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id={`detailFill-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.32} />
                        <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="rgba(113,113,122,0.18)"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: "#71717a", fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={32}
                      tickFormatter={(v: string) => v.slice(5)}
                    />
                    <YAxis
                      tickFormatter={(v: number) => formatCurrency(v, true)}
                      tick={{ fill: "#71717a", fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      width={70}
                      domain={["auto", "auto"]}
                    />
                    <Tooltip
                      cursor={{ stroke: "rgba(113,113,122,0.35)", strokeDasharray: "4 4" }}
                      contentStyle={{
                        background: "var(--popover)",
                        border: "1px solid var(--border)",
                        borderRadius: 12,
                        fontSize: 12,
                        color: "var(--popover-foreground)",
                      }}
                      labelStyle={{ color: "var(--muted-foreground)", marginBottom: 4 }}
                      itemStyle={{ color: "var(--popover-foreground)" }}
                      formatter={(value) => [formatCurrency(Number(value)), "Harga"]}
                    />
                    <Area
                      type="monotone"
                      dataKey="price"
                      stroke="#10b981"
                      strokeWidth={2.2}
                      fill={`url(#detailFill-${symbol})`}
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 0 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Perubahan {days} hari:</span>
              {periodChange === null ? (
                <span className="tabular-nums">—</span>
              ) : (
                <span
                  className={cn(
                    "font-semibold tabular-nums",
                    periodChange >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400",
                  )}
                >
                  {formatPct(periodChange)}
                </span>
              )}
            </div>

            {item.note && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm">
                <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
                    Catatan
                  </p>
                  <p className="whitespace-pre-wrap">{item.note}</p>
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground/70">
              Untuk mengubah catatan, hapus simbol lalu tambahkan ulang dengan catatan baru.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------
// Quick Trade (V-b) — dialog order paper trading cepat per simbol
// POST /trading/paper/orders (owner-only) · konteks GET /trading/paper/account
// Validasi inline sebelum submit: qty > 0, sell ≤ posisi, buy ≤ kas + ε
// ------------------------------------------------------------
function QuickTradeDialog({
  item,
  open,
  onOpenChange,
}: {
  item: WatchlistItem | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const formatCurrency = useFormatCurrency();
  const symbol = item?.symbol ?? "";
  const price = typeof item?.price.usd === "number" ? item.price.usd : null;

  const [side, setSide] = React.useState<"buy" | "sell">("buy");
  const [qtyRaw, setQtyRaw] = React.useState("");

  // Reset setiap kali dialog dibuka / simbol berganti
  React.useEffect(() => {
    if (open) {
      setSide("buy");
      setQtyRaw("");
    }
  }, [open, symbol]);

  // Konteks akun paper — fetch HANYA saat dialog terbuka
  const accountQ = useQuery<PaperAccount, ApiError>({
    queryKey: ["paper", "account"],
    queryFn: () => apiFetch<PaperAccount>("/trading/paper/account"),
    enabled: open,
    staleTime: 15_000,
  });
  const cash = accountQ.data?.cashUsd ?? null;
  const heldQty =
    accountQ.data && symbol
      ? (accountQ.data.positions.find((p) => p.symbol === symbol)?.qty ?? 0)
      : null;

  // Chip nominal USD → qty = nominal / harga live (skala per magnitude simbol)
  const chipUsd: number[] =
    price == null
      ? []
      : price >= 5000
        ? [100, 500, 1000, 5000]
        : price >= 500
          ? [50, 100, 500, 1000]
          : price >= 10
            ? [10, 50, 100, 500]
            : [5, 10, 50, 100];
  const chipDecimals = price != null && price >= 1000 ? 6 : 4;
  const chipLabel = (usd: number) => (usd >= 1000 ? `$${usd / 1000}k` : `$${usd}`);

  const applyChip = (usd: number) => {
    if (price == null || price <= 0) return;
    setQtyRaw(String(Number((usd / price).toFixed(chipDecimals))));
  };

  const qtyNum = Number(qtyRaw.replace(",", "."));
  const qtyTyped = qtyRaw.trim() !== "";
  const qtyValid = qtyTyped && Number.isFinite(qtyNum) && qtyNum > 0;
  const estUsd = qtyValid && price != null ? qtyNum * price : null;

  // Validasi inline — tampil sebelum submit (merah)
  let inlineError: string | null = null;
  if (qtyTyped && !(Number.isFinite(qtyNum) && qtyNum > 0)) {
    inlineError = "Jumlah (qty) harus angka lebih besar dari 0.";
  } else if (
    qtyValid &&
    side === "sell" &&
    heldQty !== null &&
    qtyNum > heldQty + 1e-9
  ) {
    inlineError = `Posisi tidak cukup — Anda memegang ${formatNumber(heldQty, 8)} ${symbol} di akun paper.`;
  } else if (
    qtyValid &&
    side === "buy" &&
    cash !== null &&
    estUsd !== null &&
    estUsd > cash + 0.01
  ) {
    inlineError = `Kas tidak cukup — tersedia ${formatCurrency(cash)} di akun paper.`;
  }
  const canSubmit = qtyValid && inlineError === null && price != null && symbol !== "";

  const orderM = useMutation({
    mutationFn: (b: { symbol: string; side: "buy" | "sell"; qty: number }) =>
      apiFetch<PaperAccount>("/trading/paper/orders", { method: "POST", body: b }),
    onSuccess: (_acc, vars) => {
      toast.success(
        `Order ${vars.side === "buy" ? "Beli" : "Jual"} ${formatNumber(vars.qty, 8)} ${vars.symbol} terisi @ ${formatUsd(price ?? 0)}`,
        { description: "Fill harga live di akun paper trading sandbox." },
      );
      void queryClient.invalidateQueries({ queryKey: ["paper"] });
      void queryClient.invalidateQueries({ queryKey: ["market"] });
      onOpenChange(false);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 423) {
        toast.error("Panic mode aktif — trading dinonaktifkan");
      } else {
        toast.error("Order ditolak", {
          description:
            err instanceof ApiError
              ? err.message
              : "Backend belum terjangkau — mencoba lagi",
        });
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        {item && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2 text-xl">
                Perdagangan Cepat — {item.symbol}
              </DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-2">
                <span>
                  Harga live{" "}
                  <CurrencyText
                    usd={item.price.usd}
                    className="font-semibold text-foreground"
                  />
                </span>
                <Badge
                  variant="outline"
                  className={cn(
                    "tabular-nums",
                    item.price.change24hPct >= 0
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400",
                  )}
                >
                  {formatPct(item.price.change24hPct)} 24j
                </Badge>
                <Badge
                  variant="outline"
                  className="border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                >
                  <Zap className="h-3 w-3" aria-hidden="true" />
                  Paper sandbox
                </Badge>
              </DialogDescription>
            </DialogHeader>

            {/* ---------- Konteks akun paper ---------- */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Kas tersedia
                </p>
                {accountQ.isPending && !accountQ.data ? (
                  <Skeleton className="mt-1.5 h-6 w-24 rounded-md" />
                ) : (
                  <p className="mt-0.5 text-lg font-semibold tabular-nums leading-tight">
                    {cash === null ? "—" : formatCurrency(cash)}
                  </p>
                )}
              </div>
              <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Posisi {item.symbol}
                </p>
                {accountQ.isPending && !accountQ.data ? (
                  <Skeleton className="mt-1.5 h-6 w-16 rounded-md" />
                ) : (
                  <p className="mt-0.5 text-lg font-semibold tabular-nums leading-tight">
                    {heldQty === null ? "—" : formatNumber(heldQty, 8)}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      {item.symbol}
                    </span>
                  </p>
                )}
              </div>
            </div>
            {accountQ.isError && (
              <p className="text-xs text-rose-600 dark:text-rose-400">
                Gagal memuat konteks akun paper —{" "}
                {accountQ.error instanceof ApiError
                  ? accountQ.error.message
                  : "coba lagi"}
              </p>
            )}

            {/* ---------- Toggle Beli / Jual ---------- */}
            <div
              className="grid grid-cols-2 gap-2"
              role="group"
              aria-label="Arah order"
            >
              <Button
                type="button"
                variant="outline"
                aria-pressed={side === "buy"}
                onClick={() => setSide("buy")}
                className={cn(
                  "min-h-[44px] font-semibold",
                  side === "buy"
                    ? "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 hover:text-white"
                    : "text-emerald-700 hover:border-emerald-500/60 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300",
                )}
              >
                <TrendingUp className="h-4 w-4" aria-hidden="true" />
                Beli
              </Button>
              <Button
                type="button"
                variant="outline"
                aria-pressed={side === "sell"}
                onClick={() => setSide("sell")}
                className={cn(
                  "min-h-[44px] font-semibold",
                  side === "sell"
                    ? "border-rose-600 bg-rose-600 text-white hover:bg-rose-700 hover:text-white"
                    : "text-rose-700 hover:border-rose-500/60 hover:bg-rose-500/10 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300",
                )}
              >
                <TrendingDown className="h-4 w-4" aria-hidden="true" />
                Jual
              </Button>
            </div>

            {/* ---------- Qty + chip nominal cepat ---------- */}
            <div className="space-y-2">
              <Label htmlFor="qt-qty">
                Jumlah (qty {item.symbol})
              </Label>
              <Input
                id="qt-qty"
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={qtyRaw}
                onChange={(e) => setQtyRaw(e.target.value)}
                placeholder="mis. 0,01"
                aria-invalid={inlineError ? true : undefined}
                aria-describedby={inlineError ? "qt-qty-error" : undefined}
              />
              {chipUsd.length > 0 && (
                <div
                  className="flex flex-wrap gap-1.5"
                  role="group"
                  aria-label="Nominal cepat"
                >
                  {chipUsd.map((usd) => (
                    <Button
                      key={usd}
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="min-h-[32px] rounded-full px-3 text-xs tabular-nums"
                      onClick={() => applyChip(usd)}
                    >
                      {chipLabel(usd)}
                    </Button>
                  ))}
                </div>
              )}
              {inlineError && (
                <p
                  id="qt-qty-error"
                  role="alert"
                  className="text-xs font-medium text-rose-600 dark:text-rose-400"
                >
                  {inlineError}
                </p>
              )}
            </div>

            {/* ---------- Estimasi nilai live ---------- */}
            <div
              className="rounded-lg border bg-muted/30 px-4 py-3"
              role="status"
              aria-label="Estimasi nilai order"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Estimasi Nilai
                </p>
                <p className="text-xl font-bold tabular-nums leading-tight">
                  {estUsd !== null ? formatCurrency(estUsd) : "—"}
                </p>
              </div>
              <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                {estUsd !== null && price != null
                  ? `${formatNumber(qtyNum, 8)} × ${formatCurrency(price)}`
                  : "Masukkan jumlah untuk melihat estimasi."}
              </p>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Batal
              </Button>
              <Button
                type="button"
                disabled={!canSubmit || orderM.isPending}
                className={cn(
                  "min-h-[40px]",
                  side === "buy"
                    ? "bg-emerald-600 text-white hover:bg-emerald-700"
                    : "bg-rose-600 text-white hover:bg-rose-700",
                )}
                onClick={() =>
                  orderM.mutate({ symbol: item.symbol, side, qty: qtyNum })
                }
              >
                {orderM.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Zap className="h-4 w-4" aria-hidden="true" />
                )}
                {side === "buy" ? "Beli" : "Jual"} {item.symbol}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------
// Dialog "+ Pantau Simbol" (owner)
// ------------------------------------------------------------
function AddWatchDialog({
  open,
  onOpenChange,
  symbols,
  watchedSymbols,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  symbols: SymbolInfo[];
  watchedSymbols: string[];
  pending: boolean;
  onSubmit: (symbol: string, note: string) => void;
}) {
  const [symbol, setSymbol] = React.useState("");
  const [note, setNote] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setSymbol("");
      setNote("");
    }
  }, [open]);

  const available = symbols.filter((s) => !watchedSymbols.includes(s.symbol));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pantau Simbol Baru</DialogTitle>
          <DialogDescription>
            Pilih simbol dari daftar harga yang tersedia, tambahkan catatan opsional.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="watch-symbol">Simbol</Label>
            <Select value={symbol} onValueChange={setSymbol}>
              <SelectTrigger id="watch-symbol" className="w-full" aria-label="Pilih simbol">
                <SelectValue placeholder="Pilih simbol…" />
              </SelectTrigger>
              <SelectContent>
                {available.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-muted-foreground">
                    Semua simbol sudah dipantau
                  </div>
                ) : (
                  available.map((s) => (
                    <SelectItem key={s.symbol} value={s.symbol}>
                      <span className="flex items-center gap-2">
                        <span className="font-semibold">{s.symbol}</span>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          ${s.usd >= 1000 ? s.usd.toLocaleString("en-US", { maximumFractionDigits: 0 }) : s.usd.toFixed(2)}
                        </span>
                      </span>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="watch-note">Catatan (opsional)</Label>
            <Input
              id="watch-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="mis. DCA bulanan, entry zone akumulasi…"
              maxLength={120}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button
            type="button"
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            disabled={!symbol || pending}
            onClick={() => onSubmit(symbol, note.trim())}
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="h-4 w-4" aria-hidden="true" />
            )}
            Pantau
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------
// Progress mini alert — % jarak harga kini menuju threshold (clamp 0-100)
// above: current/threshold · below: threshold/current · triggered = 100
// ------------------------------------------------------------
function alertProgressPct(alert: PriceAlert): number {
  if (alert.status === "triggered") return 100;
  const cur = alert.currentPrice;
  const th = alert.threshold;
  if (!Number.isFinite(cur) || !Number.isFinite(th) || cur <= 0 || th <= 0) return 0;
  const raw = alert.direction === "above" ? (cur / th) * 100 : (th / cur) * 100;
  return Math.min(100, Math.max(0, raw));
}

const ALERT_STATUS_META: Record<
  PriceAlert["status"],
  { label: string; className: string }
> = {
  active: {
    label: "Aktif",
    className: "border-zinc-500/40 bg-zinc-500/10 text-zinc-600 dark:text-zinc-300",
  },
  triggered: {
    label: "Terpicu",
    className: "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400 animate-pulse",
  },
  dismissed: {
    label: "Diabaikan",
    className: "border-zinc-500/30 bg-zinc-500/5 text-zinc-400 dark:text-zinc-500",
  },
};

function AlertStatusBadge({ status }: { status: PriceAlert["status"] }) {
  const meta = ALERT_STATUS_META[status] ?? ALERT_STATUS_META.active;
  return (
    <Badge variant="outline" className={cn("shrink-0 text-[10px]", meta.className)}>
      {meta.label}
    </Badge>
  );
}

/** Harga alert aware-quote: quote "IDR" dirender langsung Rp, selain itu via CurrencyText (USD display). */
function AlertPrice({
  value,
  quote,
  className,
}: {
  value: number;
  quote?: string;
  className?: string;
}) {
  if (quote === "IDR") {
    return <span className={cn("tabular-nums", className)}>{formatIdr(value)}</span>;
  }
  return <CurrencyText usd={value} className={className} />;
}

// ------------------------------------------------------------
// Kartu kecil 1 alert harga
// ------------------------------------------------------------
function AlertCard({
  alert,
  isOwner,
  onDismiss,
  dismissing,
  onDelete,
  deleting,
}: {
  alert: PriceAlert;
  isOwner: boolean;
  onDismiss: () => void;
  dismissing: boolean;
  onDelete: () => void;
  deleting: boolean;
}) {
  const pct = alertProgressPct(alert);
  const above = alert.direction === "above";
  const barColor =
    alert.status === "triggered"
      ? "bg-rose-500"
      : pct >= 85
        ? "bg-amber-500"
        : "bg-emerald-500";

  return (
    <Card className="rounded-xl p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            above
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "bg-rose-500/10 text-rose-600 dark:text-rose-400",
          )}
          aria-hidden="true"
        >
          {above ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
        </span>

        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            <span className="tracking-tight">{alert.symbol}</span>
            <span className="text-xs font-normal text-muted-foreground">
              {above ? "di atas" : "di bawah"}
            </span>
            <AlertStatusBadge status={alert.status} />
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Target <AlertPrice value={alert.threshold} quote={alert.quote} className="font-medium text-foreground" />
            {" · "}
            Sekarang <AlertPrice value={alert.currentPrice} quote={alert.quote} />
          </p>
        </div>

        {isOwner && (
          <div className="flex shrink-0 items-center gap-2">
            {alert.status !== "dismissed" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="min-h-[32px] text-xs"
                disabled={dismissing}
                onClick={onDismiss}
              >
                {dismissing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : null}
                Dismiss
              </Button>
            )}
            <ConfirmButton
              size="sm"
              variant="outline"
              confirmLabel="Yakin?"
              title={`Hapus alert ${alert.symbol}`}
              className="min-h-[32px] text-xs text-muted-foreground hover:text-rose-600"
              onConfirm={onDelete}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              Hapus
            </ConfirmButton>
          </div>
        )}
      </div>

      {alert.note && (
        <p className="mt-2 flex items-center gap-1 truncate text-xs text-muted-foreground">
          <StickyNote className="h-3 w-3 shrink-0" aria-hidden="true" />
          {alert.note}
        </p>
      )}

      {/* Progress mini menuju threshold */}
      <div
        className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={`Progres ${alert.symbol} menuju threshold`}
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn("h-full rounded-full transition-all duration-500", barColor)}
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] tabular-nums text-muted-foreground/80">
        <span>
          Dibuat {timeAgo(alert.createdAt)}
          {alert.status === "triggered" && alert.triggeredAt
            ? ` · terpicu ${timeAgo(alert.triggeredAt)}`
            : ""}
        </span>
        <span>{Math.round(pct)}%</span>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------
// Dialog "+ Alert Baru" (owner)
// ------------------------------------------------------------
function AddAlertDialog({
  open,
  onOpenChange,
  symbols,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  symbols: SymbolInfo[];
  pending: boolean;
  onSubmit: (body: { symbol: string; direction: "above" | "below"; threshold: number; note?: string }) => void;
}) {
  const [symbol, setSymbol] = React.useState("");
  const [direction, setDirection] = React.useState<"above" | "below">("above");
  const [threshold, setThreshold] = React.useState("");
  const [note, setNote] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setSymbol("");
      setDirection("above");
      setThreshold("");
      setNote("");
    }
  }, [open]);

  const th = Number(threshold);
  const valid = Boolean(symbol) && Number.isFinite(th) && th > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Alert Harga Baru</DialogTitle>
          <DialogDescription>
            Notifikasi otomatis saat harga menembus threshold — masuk ke Pusat Notifikasi Dashboard.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="alert-symbol">Simbol</Label>
            <Select value={symbol} onValueChange={setSymbol}>
              <SelectTrigger id="alert-symbol" className="w-full" aria-label="Pilih simbol alert">
                <SelectValue placeholder="Pilih simbol…" />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                {symbols.map((s) => (
                  <SelectItem key={s.symbol} value={s.symbol}>
                    <span className="flex items-center gap-2">
                      <span className="font-semibold">{s.symbol}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        ${s.usd >= 1000 ? s.usd.toLocaleString("en-US", { maximumFractionDigits: 0 }) : s.usd.toFixed(2)}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="alert-direction">Arah</Label>
            <Select value={direction} onValueChange={(v) => setDirection(v as "above" | "below")}>
              <SelectTrigger id="alert-direction" className="w-full" aria-label="Arah alert">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="above">
                  <span className="flex items-center gap-2">
                    <TrendingUp className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                    Di atas threshold
                  </span>
                </SelectItem>
                <SelectItem value="below">
                  <span className="flex items-center gap-2">
                    <TrendingDown className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                    Di bawah threshold
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="alert-threshold">Threshold (USD)</Label>
            <Input
              id="alert-threshold"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder="mis. 100000"
              aria-invalid={threshold !== "" && !(Number.isFinite(th) && th > 0)}
            />
            {threshold !== "" && !(Number.isFinite(th) && th > 0) && (
              <p className="text-xs font-medium text-rose-600 dark:text-rose-400">
                Threshold harus angka lebih besar dari 0.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="alert-note">Catatan (opsional)</Label>
            <Input
              id="alert-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="mis. entry zone DCA, take profit…"
              maxLength={120}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button
            type="button"
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            disabled={!valid || pending}
            onClick={() => onSubmit({ symbol, direction, threshold: th, note: note.trim() || undefined })}
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Bell className="h-4 w-4" aria-hidden="true" />
            )}
            Buat Alert
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------
// Panel "Alert Harga" — query 30s (GET lazy-eval) + toast saat terpicu
// RBAC: read owner/advisor/beneficiary · CRUD owner · executor tanpa akses
// ------------------------------------------------------------
function AlertsPanel({ symbols }: { symbols: SymbolInfo[] }) {
  const queryClient = useQueryClient();
  const user = useAppStore((s) => s.user);
  const isOwner = user?.role === "owner";
  const [addOpen, setAddOpen] = React.useState(false);

  const alertsQuery = useQuery<MarketAlertsResponse, ApiError>({
    queryKey: ["market", "alerts"],
    queryFn: () => apiFetch<MarketAlertsResponse>("/market/alerts"),
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  const alerts = alertsQuery.data?.alerts ?? [];
  const triggeredCount = alertsQuery.data?.triggeredCount ?? 0;

  // GET memicu evaluasi server → jika jumlah terpicu naik vs sebelumnya → toast
  const prevTriggered = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (!alertsQuery.data) return;
    const count = alertsQuery.data.triggeredCount ?? 0;
    if (prevTriggered.current !== null && count > prevTriggered.current) {
      toast("🔔 Alert harga terpicu!", {
        description: "Harga menembus threshold — cek panel Alert Harga & Pusat Notifikasi.",
      });
    }
    prevTriggered.current = count;
  }, [alertsQuery.data]);

  const invalidateAlerts = () =>
    void queryClient.invalidateQueries({ queryKey: ["market", "alerts"] });

  const createMutation = useMutation({
    mutationFn: (body: { symbol: string; direction: "above" | "below"; threshold: number; note?: string }) =>
      apiFetch<PriceAlert>("/market/alerts", { method: "POST", body }),
    onSuccess: (_d, vars) => {
      toast.success(`Alert ${vars.symbol} dibuat`, {
        description: `${vars.direction === "above" ? "Di atas" : "Di bawah"} ${vars.threshold} USD.`,
      });
      setAddOpen(false);
      invalidateAlerts();
    },
    onError: (err) => {
      toast.error("Gagal membuat alert", {
        description: err instanceof ApiError ? err.message : "Coba lagi sebentar",
      });
    },
  });

  const dismissMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch<PriceAlert>(`/market/alerts/${id}/dismiss`, { method: "POST" }),
    onSuccess: (_d, id) => {
      const target = alerts.find((a) => a.id === id);
      toast.success(`Alert ${target?.symbol ?? ""} di-dismiss`);
      invalidateAlerts();
    },
    onError: (err) => {
      toast.error("Gagal dismiss alert", {
        description: err instanceof ApiError ? err.message : "Coba lagi sebentar",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch<void>(`/market/alerts/${id}`, { method: "DELETE" }),
    onSuccess: (_d, id) => {
      const target = alerts.find((a) => a.id === id);
      toast.success(`Alert ${target?.symbol ?? ""} dihapus`);
      invalidateAlerts();
    },
    onError: (err) => {
      toast.error("Gagal menghapus alert", {
        description: err instanceof ApiError ? err.message : "Coba lagi sebentar",
      });
    },
  });

  return (
    <SectionCard
      title="Alert Harga"
      description="Notifikasi otomatis saat harga menembus threshold — dicek server tiap GET/30 detik."
      contentClassName="px-6 pb-6"
      actions={
        <>
          {triggeredCount > 0 && (
            <Badge
              variant="outline"
              className="border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400"
            >
              <Bell className="h-3 w-3 animate-pulse" aria-hidden="true" />
              {triggeredCount} terpicu
            </Badge>
          )}
          {isOwner && (
            <Button
              type="button"
              size="sm"
              className="min-h-[36px] bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={() => setAddOpen(true)}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Alert Baru
            </Button>
          )}
        </>
      }
    >
      {alertsQuery.isPending && !alertsQuery.data ? (
        <LoadingRows rows={3} />
      ) : alertsQuery.isError ? (
        <ErrorBox
          message={
            alertsQuery.error instanceof ApiError ? alertsQuery.error.message : undefined
          }
          onRetry={() => void alertsQuery.refetch()}
        />
      ) : alerts.length === 0 ? (
        <EmptyState
          icon={<Bell className="h-6 w-6" />}
          title="Belum ada alert harga"
          description={
            isOwner
              ? "Buat alert untuk diperingatkan saat BTC, saham, atau emas menyentuh level target Anda."
              : "Owner dapat membuat alert harga — notifikasi muncul di sini & Pusat Notifikasi Dashboard."
          }
          action={
            isOwner && (
              <Button
                type="button"
                size="sm"
                className="bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={() => setAddOpen(true)}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Alert Baru
              </Button>
            )
          }
        />
      ) : (
        <div className="space-y-3">
          {alerts.map((a) => (
            <AlertCard
              key={a.id}
              alert={a}
              isOwner={isOwner}
              onDismiss={() => dismissMutation.mutate(a.id)}
              dismissing={dismissMutation.isPending && dismissMutation.variables === a.id}
              onDelete={() => deleteMutation.mutate(a.id)}
              deleting={deleteMutation.isPending && deleteMutation.variables === a.id}
            />
          ))}
        </div>
      )}

      <AddAlertDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        symbols={symbols}
        pending={createMutation.isPending}
        onSubmit={(body) => createMutation.mutate(body)}
      />
    </SectionCard>
  );
}

// ------------------------------------------------------------
// Konverter Mata Uang (PRD #10) — pivot USD, rate live dari /rates
// Daftar: USD, IDR, BTC, ETH, BNB, SUI, XAU (per troy oz)
// ------------------------------------------------------------
const CONVERTER_CCYS = ["USD", "IDR", "BTC", "ETH", "BNB", "SUI", "XAU"] as const;
type ConverterCcy = (typeof CONVERTER_CCYS)[number];

function fmtConverterValue(v: number | null, ccy: ConverterCcy): string {
  if (v === null || !Number.isFinite(v)) return "—";
  if (ccy === "IDR") return formatIdr(v);
  if (ccy === "USD") return formatUsd(v);
  const abs = Math.abs(v);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 6 : 8;
  return `${new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: digits,
  }).format(v)} ${ccy}`;
}

function ConverterCard() {
  const ratesQuery = useRates();
  const rates = ratesQuery.data;

  const [amountRaw, setAmountRaw] = React.useState("1");
  const [from, setFrom] = React.useState<ConverterCcy>("BTC");
  const [to, setTo] = React.useState<ConverterCcy>("IDR");

  const amount = Number(amountRaw.replace(",", "."));
  const amountValid = amountRaw.trim() !== "" && Number.isFinite(amount) && amount >= 0;

  const usdIdr = typeof rates?.USDIDR === "number" && rates.USDIDR > 0 ? rates.USDIDR : null;

  const toUsd = React.useCallback(
    (ccy: ConverterCcy, value: number): number | null => {
      if (ccy === "USD") return value;
      if (ccy === "IDR") return usdIdr ? value / usdIdr : null;
      const p = rates?.prices?.[ccy]?.usd;
      return typeof p === "number" && p > 0 ? value * p : null;
    },
    [rates, usdIdr],
  );

  const fromUsd = React.useCallback(
    (ccy: ConverterCcy, usd: number): number | null => {
      if (ccy === "USD") return usd;
      if (ccy === "IDR") return usdIdr ? usd * usdIdr : null;
      const p = rates?.prices?.[ccy]?.usd;
      return typeof p === "number" && p > 0 ? usd / p : null;
    },
    [rates, usdIdr],
  );

  const usdAmount = amountValid ? toUsd(from, amount) : null;
  const result = usdAmount !== null ? fromUsd(to, usdAmount) : null;
  const rateOne = fromUsd(to, toUsd(from, 1) ?? 0);

  const swap = () => {
    setFrom(to);
    setTo(from);
  };

  const rateMissing =
    amountValid &&
    (result === null || rateOne === null) &&
    (from !== to);

  return (
    <SectionCard
      title="Konverter Mata Uang"
      description="Konversi via kurs USD live — kripto & emas (per troy oz) · diperbarui otomatis."
      contentClassName="px-6 pb-6"
      actions={
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="min-h-[32px] text-xs"
          onClick={swap}
          aria-label="Tukar mata uang asal & tujuan"
        >
          <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
          Tukar
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="conv-amount">Jumlah</Label>
            <Input
              id="conv-amount"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={amountRaw}
              onChange={(e) => setAmountRaw(e.target.value)}
              placeholder="mis. 1"
              aria-invalid={amountRaw.trim() !== "" && !amountValid}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="conv-from">Dari</Label>
            <Select value={from} onValueChange={(v) => setFrom(v as ConverterCcy)}>
              <SelectTrigger id="conv-from" className="w-full" aria-label="Mata uang asal">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONVERTER_CCYS.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="conv-to">Ke</Label>
            <Select value={to} onValueChange={(v) => setTo(v as ConverterCcy)}>
              <SelectTrigger id="conv-to" className="w-full" aria-label="Mata uang tujuan">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONVERTER_CCYS.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div
          className="rounded-lg border bg-muted/30 px-4 py-3"
          role="status"
          aria-label="Hasil konversi"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Hasil
          </p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums leading-tight sm:text-3xl">
            {amountValid ? fmtConverterValue(result, to) : "—"}
          </p>
          <p className="mt-1 text-xs tabular-nums text-muted-foreground">
            {rateMissing ? (
              "Kurs belum tersedia — menunggu data harga."
            ) : amountValid ? (
              <>1 {from} = {fmtConverterValue(rateOne, to)}</>
            ) : (
              "Masukkan jumlah yang valid."
            )}
          </p>
        </div>
      </div>
    </SectionCard>
  );
}

// ------------------------------------------------------------
// MarketView
// ------------------------------------------------------------
export default function MarketView() {
  const queryClient = useQueryClient();
  const user = useAppStore((s) => s.user);
  const isOwner = user?.role === "owner";
  // Executor 403 pada /market/alerts (RBAC) → panel tidak dirender utk role ini
  const canViewAlerts = user?.role !== "executor";

  const [addOpen, setAddOpen] = React.useState(false);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<WatchlistItem | null>(null);
  // V-b — quick trade
  const [tradeOpen, setTradeOpen] = React.useState(false);
  const [tradeItem, setTradeItem] = React.useState<WatchlistItem | null>(null);

  // POST /trading/paper/orders = owner-only (RBAC backend) — executor/advisor/
  // beneficiary dapat 403 → tombol Perdagangkan disembunyikan untuk role lain.
  const canTradeOrders = user?.role === "owner";
  /** USD/IDR adalah kurs FX (bukan simbol tradable) — tanpa tombol trade. */
  const isTradableSymbol = (item: WatchlistItem) =>
    item.symbol.toUpperCase() !== "USDIDR" && typeof item.price?.usd === "number";

  // ---------- Queries ----------
  const watchlistQuery = useQuery<WatchlistItem[], ApiError>({
    queryKey: ["market", "watchlist"],
    queryFn: () => apiFetch<WatchlistItem[]>("/market/watchlist"),
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  const symbolsQuery = useQuery<SymbolInfo[], ApiError>({
    queryKey: ["market", "symbols"],
    queryFn: () => apiFetch<SymbolInfo[]>("/market/symbols"),
    staleTime: 60_000,
  });

  const ratesQuery = useRates();

  const watchlist = watchlistQuery.data ?? [];
  const symbols = symbolsQuery.data ?? [];

  // ---------- Mutations ----------
  const invalidateWatchlist = () =>
    void queryClient.invalidateQueries({ queryKey: ["market", "watchlist"] });

  const addMutation = useMutation({
    mutationFn: (body: { symbol: string; note?: string }) =>
      apiFetch<WatchlistItem>("/market/watchlist", { method: "POST", body }),
    onSuccess: (_data, vars) => {
      toast.success(`${vars.symbol} ditambahkan ke watchlist`);
      setAddOpen(false);
      invalidateWatchlist();
    },
    onError: (err) => {
      toast.error("Gagal menambah simbol", {
        description: err instanceof ApiError ? err.message : "Coba lagi sebentar",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch<void>(`/market/watchlist/${id}`, { method: "DELETE" }),
    onSuccess: (_d, id) => {
      const target = watchlist.find((w) => w.id === id);
      toast.success(`${target?.symbol ?? "Simbol"} dihapus dari watchlist`);
      if (selected?.id === id) {
        setDetailOpen(false);
        setSelected(null);
      }
      invalidateWatchlist();
    },
    onError: (err) => {
      toast.error("Gagal menghapus simbol", {
        description: err instanceof ApiError ? err.message : "Coba lagi sebentar",
      });
    },
  });

  // ---------- Derived stats ----------
  const gainers = watchlist.filter((w) => w.price?.change24hPct !== undefined);
  const topGainer =
    gainers.length > 0
      ? gainers.reduce((a, b) =>
          b.price.change24hPct > a.price.change24hPct ? b : a,
        )
      : null;
  const topLoser =
    gainers.length > 0
      ? gainers.reduce((a, b) =>
          b.price.change24hPct < a.price.change24hPct ? b : a,
        )
      : null;
  const xau =
    ratesQuery.data?.prices?.XAU ??
    (symbols.find((s) => s.symbol === "XAU")
      ? {
          usd: symbols.find((s) => s.symbol === "XAU")!.usd,
          change24hPct: symbols.find((s) => s.symbol === "XAU")!.change24hPct,
        }
      : null);

  const loadingAll = watchlistQuery.isPending && !watchlistQuery.data;
  const errMsg =
    watchlistQuery.error instanceof ApiError
      ? watchlistQuery.error.message
      : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pasar"
        subtitle="Watchlist simbol & harga live — diperbarui otomatis tiap 30 detik."
        actions={
          isOwner && (
            <Button
              type="button"
              size="sm"
              className="min-h-[40px] bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={() => setAddOpen(true)}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Pantau Simbol
            </Button>
          )
        }
      />

      {watchlistQuery.isError && !watchlistQuery.data && (
        <ErrorBox message={errMsg} onRetry={() => void watchlistQuery.refetch()} />
      )}

      {/* ---------- StatCards ---------- */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          loading={loadingAll}
          label="Simbol Dipantau"
          value={watchlistQuery.data ? `${watchlist.length}` : "—"}
          sub={`${symbols.length || "—"} simbol tersedia`}
          icon={<Eye className="h-5 w-5" />}
        />
        <StatCard
          loading={loadingAll}
          label="Gainer Teratas"
          value={topGainer ? topGainer.symbol : "—"}
          delta={topGainer?.price.change24hPct ?? null}
          sub={topGainer ? <CurrencyText usd={topGainer.price.usd} compact /> : undefined}
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <StatCard
          loading={loadingAll}
          label="Loser Teratas"
          value={topLoser ? topLoser.symbol : "—"}
          delta={topLoser?.price.change24hPct ?? null}
          sub={topLoser ? <CurrencyText usd={topLoser.price.usd} compact /> : undefined}
          accent="rose"
          icon={<TrendingDown className="h-5 w-5" />}
        />
        <StatCard
          label="XAU / USD"
          value={xau ? formatXauValue(xau.usd) : "—"}
          delta={xau?.change24hPct ?? null}
          sub="Emas spot per troy ounce"
          accent="amber"
          icon={<Coins className="h-5 w-5" />}
        />
      </div>

      {/* ---------- Panel Alert Harga (owner CRUD · advisor/beneficiary read · executor hidden) ---------- */}
      {canViewAlerts && <AlertsPanel symbols={symbols} />}

      {/* ---------- Grid watchlist ---------- */}
      {loadingAll ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="rounded-xl p-5">
              <Skeleton className="h-6 w-24" />
              <Skeleton className="mt-3 h-4 w-32" />
              <Skeleton className="mt-4 h-7 w-28" />
              <Skeleton className="mt-4 h-9 w-full rounded-md" />
            </Card>
          ))}
        </div>
      ) : watchlist.length === 0 ? (
        <EmptyState
          icon={<LineChartIcon className="h-6 w-6" />}
          title="Watchlist masih kosong"
          description={
            isOwner
              ? "Pantau simbol favorit — BTC, ETH, XAU, saham, dan lainnya — lengkap dengan harga live dan sparkline 30 hari."
              : "Belum ada simbol yang dipantau. Owner dapat menambahkan simbol untuk dipantau."
          }
          action={
            isOwner && (
              <Button
                type="button"
                size="sm"
                className="bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={() => setAddOpen(true)}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Pantau Simbol
              </Button>
            )
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {watchlist.map((item) => (
            <WatchCard
              key={item.id}
              item={item}
              isOwner={isOwner}
              canTrade={canTradeOrders && isTradableSymbol(item)}
              onTrade={() => {
                setTradeItem(item);
                setTradeOpen(true);
              }}
              onOpen={() => {
                setSelected(item);
                setDetailOpen(true);
              }}
              onDelete={() => deleteMutation.mutate(item.id)}
              deleting={deleteMutation.isPending && deleteMutation.variables === item.id}
            />
          ))}
        </div>
      )}

      {/* ---------- Konverter mata uang (PRD #10) ---------- */}
      <ConverterCard />

      {/* ---------- Dialogs ---------- */}
      <WatchDetailDialog
        item={selected}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />

      {/* V-b — Quick Trade paper trading (owner) */}
      <QuickTradeDialog
        item={tradeItem}
        open={tradeOpen}
        onOpenChange={setTradeOpen}
      />

      <AddWatchDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        symbols={symbols}
        watchedSymbols={watchlist.map((w) => w.symbol)}
        pending={addMutation.isPending}
        onSubmit={(symbol, note) =>
          addMutation.mutate({ symbol, note: note || undefined })
        }
      />
    </div>
  );
}

function formatXauValue(usd: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(usd);
}
