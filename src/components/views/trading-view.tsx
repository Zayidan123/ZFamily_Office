"use client";

// ============================================================
// Trading — Task 2-b + S-b
// Tabs: "Strategi & Eksekusi" (StatCards, Kartu Strategi,
// Performance Attribution, Log Eksekusi, Alert) |
// "Paper Trading" (sandbox $100k, order pasar live, posisi,
// riwayat, reset — RBAC: owner CRUD, advisor/beneficiary read)
// ============================================================
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { apiFetch, ApiError } from "@/lib/api";
import { formatDateTime, formatNumber, formatPct, timeAgo } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import {
  StatCard,
  PageHeader,
  SectionCard,
  EmptyState,
  LoadingRows,
  ErrorBox,
  AlertLevelBadge,
  ConfirmButton,
  useFormatCurrency,
} from "@/components/shared/kit";
import type {
  AlertItem,
  Strategy,
  StrategyPerformance,
  StrategyStatus,
  Trade,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  TrendingUp,
  Target,
  Activity,
  Clock,
  Bell,
  Bot,
  Pause,
  Play,
  Loader2,
  FlaskConical,
  Wallet,
  Landmark,
  ArrowDownLeft,
  ArrowUpRight,
  RotateCcw,
  Zap,
} from "lucide-react";

// ------------------------------------------------------------
// Helper kecil
// ------------------------------------------------------------
const STATUS_META: Record<
  StrategyStatus,
  { label: string; dot: string; badge: string; pulse: boolean }
> = {
  active: {
    label: "Aktif",
    dot: "bg-emerald-500",
    badge: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    pulse: true,
  },
  paused: {
    label: "Dijeda",
    dot: "bg-amber-500",
    badge: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    pulse: false,
  },
  archived: {
    label: "Arsip",
    dot: "bg-zinc-400",
    badge: "border-zinc-500/40 bg-zinc-500/10 text-zinc-600 dark:text-zinc-300",
    pulse: false,
  },
};

function StrategyStatusBadge({ status }: { status: StrategyStatus }) {
  const meta = STATUS_META[status] ?? STATUS_META.archived;
  return (
    <Badge variant="outline" className={cn("gap-1.5", meta.badge)}>
      <span className="relative flex h-2 w-2" aria-hidden="true">
        {meta.pulse && (
          <span
            className={cn(
              "absolute inline-flex h-full w-full animate-ping rounded-full opacity-60",
              meta.dot,
            )}
          />
        )}
        <span className={cn("relative inline-flex h-2 w-2 rounded-full", meta.dot)} />
      </span>
      {meta.label}
    </Badge>
  );
}

function SideBadge({ side }: { side: Trade["side"] }) {
  const isLong = side === "long" || side === "buy";
  return (
    <Badge
      variant="outline"
      className={cn(
        isLong
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400",
      )}
    >
      {isLong ? "Long" : "Short"}
    </Badge>
  );
}

/** Jumlah hari sejak tanggal ISO */
function daysAgo(iso: string | null | undefined): number {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Infinity;
  return Math.floor((Date.now() - t) / 86_400_000);
}

// ------------------------------------------------------------
// Paper Trading (Task S-b) — sandbox virtual $100,000
// ------------------------------------------------------------

interface PaperPosition {
  symbol: string;
  qty: number;
  avgPriceUsd: number;
  currentPriceUsd: number;
  valueUsd: number;
  unrealizedPnlUsd: number;
}

interface PaperAccount {
  cashUsd: number;
  realizedPnlUsd: number;
  equityUsd: number;
  positions: PaperPosition[];
}

interface PaperTrade {
  id: string | number;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  priceUsd: number;
  realizedPnlUsd: number | null;
  at: string;
}

interface PaperSymbolInfo {
  symbol: string;
  usd: number;
  change24hPct: number;
}

/** Pola focus-visible konsisten (polish S-b) — terapkan ke kontrol utama */
export const focusRing =
  "focus-visible:ring-2 focus-visible:ring-emerald-500/60 focus-visible:ring-offset-2";

function errMsg(err: unknown): string {
  return err instanceof ApiError ? err.message : "Backend belum terjangkau — mencoba lagi";
}

function PaperSideBadge({ side }: { side: "buy" | "sell" }) {
  const isBuy = side === "buy";
  return (
    <Badge
      variant="outline"
      className={cn(
        isBuy
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400",
      )}
    >
      {isBuy ? "Beli" : "Jual"}
    </Badge>
  );
}

function PnlText({ usd, className }: { usd: number | null | undefined; className?: string }) {
  const formatCurrency = useFormatCurrency();
  if (usd === null || usd === undefined || !Number.isFinite(usd)) {
    return <span className={cn("text-muted-foreground", className)}>—</span>;
  }
  return (
    <span
      className={cn(
        "tabular-nums",
        usd > 0 && "text-emerald-600 dark:text-emerald-400",
        usd < 0 && "text-rose-600 dark:text-rose-400",
        className,
      )}
    >
      {usd > 0 ? "+" : ""}
      {formatCurrency(usd)}
    </span>
  );
}

// ----------------------------------------------------------
// Panel Paper Trading — Tab kedua
// ----------------------------------------------------------
function PaperTradingPanel() {
  const queryClient = useQueryClient();
  const user = useAppStore((s) => s.user);
  const isOwner = user?.role === "owner";
  const formatCurrency = useFormatCurrency();

  // ---------- Queries ----------
  const accountQ = useQuery<PaperAccount, ApiError>({
    queryKey: ["paper", "account"],
    queryFn: () => apiFetch<PaperAccount>("/trading/paper/account"),
    refetchInterval: 30_000, // harga live — posisi bergerak
    staleTime: 25_000,
  });

  const tradesQ = useQuery<PaperTrade[], ApiError>({
    queryKey: ["paper", "trades"],
    queryFn: () =>
      apiFetch<PaperTrade[]>("/trading/paper/trades", { params: { limit: 100 } }),
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  // Simbol + harga live untuk form order (endpoint existing /market/symbols)
  const symbolsQ = useQuery<PaperSymbolInfo[], ApiError>({
    queryKey: ["market", "symbols"],
    queryFn: () => apiFetch<PaperSymbolInfo[]>("/market/symbols"),
    staleTime: 30_000,
    enabled: isOwner,
  });

  // ---------- Form order (owner) ----------
  const [symbol, setSymbol] = React.useState("");
  const [side, setSide] = React.useState<"buy" | "sell">("buy");
  const [qty, setQty] = React.useState("");

  const qtyNum = Number(qty.replace(",", "."));
  const qtyValid = qty.trim() !== "" && Number.isFinite(qtyNum) && qtyNum > 0;
  const priceOf = (sym: string) =>
    symbolsQ.data?.find((s) => s.symbol === sym)?.usd ?? null;
  const estUsd = symbol && qtyValid ? (priceOf(symbol) ?? 0) * qtyNum : null;
  const heldQty =
    accountQ.data?.positions.find((p) => p.symbol === symbol)?.qty ?? null;

  const invalidatePaper = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["paper", "account"] });
    void queryClient.invalidateQueries({ queryKey: ["paper", "trades"] });
  }, [queryClient]);

  const orderM = useMutation({
    mutationFn: (body: { symbol: string; side: "buy" | "sell"; qty: number }) =>
      apiFetch<PaperAccount>("/trading/paper/orders", { method: "POST", body }),
    onSuccess: (_acc, vars) => {
      toast.success(
        `Order ${vars.side === "buy" ? "beli" : "jual"} ${vars.qty} ${vars.symbol} tereksekusi`,
        { description: "Fill harga pasar live di akun sandbox." },
      );
      setQty("");
      invalidatePaper();
    },
    onError: (err) => {
      toast.error("Order ditolak", { description: errMsg(err) });
    },
  });

  const resetM = useMutation({
    mutationFn: () => apiFetch<PaperAccount>("/trading/paper/reset", { method: "POST" }),
    onSuccess: () => {
      toast.success("Akun virtual direset", {
        description: "Saldo kembali ke $100,000 — posisi & riwayat dibersihkan.",
      });
      setQty("");
      invalidatePaper();
    },
    onError: (err) => {
      toast.error("Gagal mereset akun virtual", { description: errMsg(err) });
    },
  });

  const submitOrder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!symbol) {
      toast.error("Pilih simbol terlebih dahulu");
      return;
    }
    if (!qtyValid) {
      toast.error("Jumlah (qty) harus lebih dari 0");
      return;
    }
    orderM.mutate({ symbol, side, qty: qtyNum });
  };

  // ---------- Derived ----------
  const account = accountQ.data ?? null;
  const positions = account?.positions ?? [];
  const unrealizedTotal = positions.reduce(
    (acc, p) => acc + (p.unrealizedPnlUsd ?? 0),
    0,
  );
  const paperTrades = React.useMemo(() => {
    const rows = tradesQ.data ?? [];
    return [...rows].sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  }, [tradesQ.data]);

  const isForbidden =
    accountQ.error instanceof ApiError && accountQ.error.status === 403;

  const errBox = (q: { error: unknown; refetch: () => void }) => (
    <ErrorBox message={errMsg(q.error)} onRetry={() => q.refetch()} />
  );

  // Executor & gagal total → tampilkan error / akses terbatas
  if (accountQ.isError && !accountQ.data) {
    return (
      <div className="space-y-6">
        {isForbidden ? (
          <EmptyState
            icon={<FlaskConical className="h-6 w-6" />}
            title="Akses terbatas"
            description="Paper trading hanya tersedia untuk owner, advisor, dan beneficiary."
          />
        ) : (
          errBox(accountQ)
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ---------- Banner sandbox + reset ---------- */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
          <Badge
            variant="outline"
            className="shrink-0 border-amber-500/50 bg-amber-500/10 font-semibold tracking-wide text-amber-700 dark:text-amber-400"
          >
            <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
            SANDBOX — uang virtual $100,000
          </Badge>
          <span className="hidden text-xs text-amber-700/80 dark:text-amber-400/80 md:inline">
            Order terisi dengan harga pasar live — tanpa risiko nyata.
          </span>
        </div>
        {isOwner && (
          <ConfirmButton
            variant="outline"
            confirmLabel="Yakin? Klik lagi"
            className="min-h-[36px] shrink-0 border-rose-500/40 text-rose-600 dark:text-rose-400"
            onConfirm={() => resetM.mutate()}
            disabled={resetM.isPending}
            title="Kembalikan akun sandbox ke $100,000"
          >
            {resetM.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
            )}
            Reset Akun Virtual
          </ConfirmButton>
        )}
      </div>

      {/* ---------- StatCards akun sandbox ---------- */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          loading={accountQ.isPending && !account}
          label="Virtual Cash"
          value={account ? formatCurrency(account.cashUsd) : "—"}
          sub="kas bebas sandbox"
          icon={<Wallet className="h-5 w-5" />}
        />
        <StatCard
          loading={accountQ.isPending && !account}
          label="Total Equity"
          value={account ? formatCurrency(account.equityUsd) : "—"}
          sub="kas + nilai seluruh posisi"
          icon={<Landmark className="h-5 w-5" />}
        />
        <StatCard
          loading={accountQ.isPending && !account}
          label="Realized PnL"
          value={
            account ? (
              <PnlText usd={account.realizedPnlUsd} />
            ) : (
              "—"
            )
          }
          sub="dari posisi yang sudah ditutup"
          icon={<ArrowDownLeft className="h-5 w-5" />}
        />
        <StatCard
          loading={accountQ.isPending && !account}
          label="Unrealized PnL"
          value={
            account ? (
              <PnlText usd={unrealizedTotal} />
            ) : (
              "—"
            )
          }
          sub={`${positions.length} posisi terbuka`}
          accent={unrealizedTotal < 0 ? "rose" : "default"}
          icon={<ArrowUpRight className="h-5 w-5" />}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        {/* ---------- Form order (owner) ---------- */}
        {isOwner && (
          <SectionCard
            title="Order Pasar"
            description="Eksekusi instan di harga live — akun sandbox"
          >
            <form onSubmit={submitOrder} className="space-y-4" noValidate>
              <div className="grid gap-1.5">
                <Label htmlFor="paper-symbol">Simbol</Label>
                <Select value={symbol} onValueChange={setSymbol}>
                  <SelectTrigger
                    id="paper-symbol"
                    className={cn("w-full", focusRing)}
                    aria-label="Pilih simbol"
                  >
                    <SelectValue placeholder="Pilih simbol" />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    {(symbolsQ.data ?? []).map((s) => (
                      <SelectItem key={s.symbol} value={s.symbol}>
                        <span className="font-mono text-xs font-semibold">{s.symbol}</span>
                        <span className="text-xs text-muted-foreground">
                          {" "}· {formatCurrency(s.usd)}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1.5">
                <Label>Side</Label>
                <div className="grid grid-cols-2 gap-2" role="group" aria-label="Arah order">
                  <Button
                    type="button"
                    onClick={() => setSide("buy")}
                    aria-pressed={side === "buy"}
                    className={cn(
                      focusRing,
                      "h-10 border",
                      side === "buy"
                        ? "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700"
                        : "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-400",
                    )}
                  >
                    <ArrowDownLeft className="h-4 w-4" aria-hidden="true" />
                    Beli
                  </Button>
                  <Button
                    type="button"
                    onClick={() => setSide("sell")}
                    aria-pressed={side === "sell"}
                    className={cn(
                      focusRing,
                      "h-10 border",
                      side === "sell"
                        ? "border-rose-600 bg-rose-600 text-white hover:bg-rose-700"
                        : "border-rose-500/40 bg-rose-500/5 text-rose-700 hover:bg-rose-500/15 dark:text-rose-400",
                    )}
                  >
                    <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                    Jual
                  </Button>
                </div>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="paper-qty">Jumlah (qty)</Label>
                <Input
                  id="paper-qty"
                  type="number"
                  step="any"
                  min="0"
                  inputMode="decimal"
                  placeholder="cth. 0.05"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  className={cn("h-10", focusRing)}
                  disabled={orderM.isPending}
                />
                <div className="flex flex-wrap items-center justify-between gap-1 text-xs text-muted-foreground">
                  <span>
                    {side === "sell" && heldQty !== null
                      ? `Tersedia: ${heldQty} ${symbol}`
                      : symbol
                        ? `Harga: ${priceOf(symbol) !== null ? formatCurrency(priceOf(symbol) ?? 0) : "—"}`
                        : "Pilih simbol untuk melihat harga live"}
                  </span>
                  {estUsd !== null && (
                    <span className="font-medium tabular-nums">
                      ≈ {formatCurrency(estUsd)}
                    </span>
                  )}
                </div>
                {qty.trim() !== "" && !qtyValid && (
                  <p className="text-xs font-medium text-rose-600 dark:text-rose-400">
                    Jumlah harus angka lebih dari 0.
                  </p>
                )}
              </div>

              <Button
                type="submit"
                className={cn(
                  focusRing,
                  "h-11 w-full bg-emerald-600 text-white hover:bg-emerald-700",
                )}
                disabled={orderM.isPending || !symbol || !qtyValid}
              >
                {orderM.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Zap className="h-4 w-4" aria-hidden="true" />
                )}
                Eksekusi Order Pasar
              </Button>
            </form>
          </SectionCard>
        )}

        {/* ---------- Posisi Terbuka ---------- */}
        <SectionCard
          title="Posisi Terbuka"
          description="Harga diperbarui otomatis tiap 30 detik"
          className={isOwner ? "xl:col-span-2" : "xl:col-span-3"}
        >
          {accountQ.isError ? (
            errBox(accountQ)
          ) : accountQ.isPending && !account ? (
            <LoadingRows rows={3} />
          ) : positions.length === 0 ? (
            <EmptyState
              icon={<Bot className="h-6 w-6" />}
              title="Belum ada posisi"
              description={
                isOwner
                  ? "Eksekusi order beli pertama Anda untuk membuka posisi sandbox."
                  : "Owner belum membuka posisi paper trading."
              }
            />
          ) : (
            <div className="max-h-80 overflow-auto rounded-lg border">
              <Table>
                <TableHeader className="sticky top-0 bg-background/95 backdrop-blur">
                  <TableRow>
                    <TableHead>Simbol</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Harga Rata²</TableHead>
                    <TableHead className="text-right">Harga Kini</TableHead>
                    <TableHead className="text-right">Nilai</TableHead>
                    <TableHead className="text-right">Unrealized PnL</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {positions.map((p) => (
                    <TableRow key={p.symbol}>
                      <TableCell className="font-mono text-xs font-bold">{p.symbol}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p.qty}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(p.avgPriceUsd)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(p.currentPriceUsd)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatCurrency(p.valueUsd)}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        <PnlText usd={p.unrealizedPnlUsd} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {!isOwner && !accountQ.isError && (
            <p className="mt-3 text-xs text-muted-foreground">
              Mode lihat-saja — eksekusi order &amp; reset hanya untuk owner.
            </p>
          )}
        </SectionCard>
      </div>

      {/* ---------- Riwayat Trade ---------- */}
      <SectionCard
        title="Riwayat Trade"
        description="100 eksekusi terakhir di akun sandbox"
      >
        {tradesQ.isError ? (
          errBox(tradesQ)
        ) : tradesQ.isPending && paperTrades.length === 0 ? (
          <LoadingRows rows={4} />
        ) : paperTrades.length === 0 ? (
          <EmptyState
            icon={<Activity className="h-6 w-6" />}
            title="Belum ada trade"
            description="Riwayat eksekusi order sandbox akan tampil di sini."
          />
        ) : (
          <div className="max-h-96 overflow-auto rounded-lg border">
            <Table>
              <TableHeader className="sticky top-0 bg-background/95 backdrop-blur">
                <TableRow>
                  <TableHead className="w-[150px]">Waktu</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead>Simbol</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Harga</TableHead>
                  <TableHead className="text-right">Realized PnL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paperTrades.map((t) => (
                  <TableRow key={String(t.id)}>
                    <TableCell className="tabular-nums">
                      <div className="font-medium">{formatDateTime(t.at)}</div>
                      <div className="text-xs text-muted-foreground">{timeAgo(t.at)}</div>
                    </TableCell>
                    <TableCell>
                      <PaperSideBadge side={t.side} />
                    </TableCell>
                    <TableCell className="font-mono text-xs font-semibold">{t.symbol}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.qty}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(t.priceUsd)}
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      <PnlText usd={t.realizedPnlUsd} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ------------------------------------------------------------
// TradingView
// ------------------------------------------------------------
export default function TradingView() {
  const queryClient = useQueryClient();
  const user = useAppStore((s) => s.user);
  const isOwner = user?.role === "owner";
  const formatCurrency = useFormatCurrency();

  // ---------- Queries ----------
  const strategiesQuery = useQuery<Strategy[], ApiError>({
    queryKey: ["trading", "strategies"],
    queryFn: () => apiFetch<Strategy[]>("/trading/strategies"),
    refetchInterval: 60_000,
    staleTime: 50_000,
  });

  const perfQuery = useQuery<StrategyPerformance[], ApiError>({
    queryKey: ["trading", "performance"],
    queryFn: () => apiFetch<StrategyPerformance[]>("/trading/performance"),
    refetchInterval: 60_000,
    staleTime: 50_000,
  });

  const tradesAllQuery = useQuery<Trade[], ApiError>({
    queryKey: ["trading", "trades", "all"],
    queryFn: () => apiFetch<Trade[]>("/trading/trades", { params: { limit: 100 } }),
    refetchInterval: 60_000,
    staleTime: 50_000,
  });

  const [strategyFilter, setStrategyFilter] = React.useState<string>("all");

  const tradesQuery = useQuery<Trade[], ApiError>({
    queryKey: ["trading", "trades", strategyFilter],
    queryFn: () =>
      apiFetch<Trade[]>("/trading/trades", {
        params: {
          strategyId: strategyFilter === "all" ? undefined : strategyFilter,
          limit: 100,
        },
      }),
    staleTime: 50_000,
  });

  const alertsQuery = useQuery<AlertItem[], ApiError>({
    queryKey: ["trading", "alerts"],
    queryFn: () => apiFetch<AlertItem[]>("/trading/alerts", { params: { limit: 30 } }),
    refetchInterval: 60_000,
    staleTime: 50_000,
  });

  // ---------- Mutasi status strategi (owner) ----------
  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: StrategyStatus }) =>
      apiFetch<Strategy>(`/trading/strategies/${id}`, {
        method: "PUT",
        body: { status },
      }),
    onSuccess: (updated) => {
      toast.success(
        `Strategi "${updated.name}" ${updated.status === "paused" ? "dijeda" : "diaktifkan"}`,
        { description: "Status strategi berhasil diperbarui." },
      );
      void queryClient.invalidateQueries({ queryKey: ["trading", "strategies"] });
      void queryClient.invalidateQueries({ queryKey: ["trading", "performance"] });
    },
    onError: (err) => {
      toast.error("Gagal mengubah status strategi", {
        description: err instanceof ApiError ? err.message : "Backend belum terjangkau — mencoba lagi",
      });
    },
  });

  // ---------- Derived ----------
  const strategies = strategiesQuery.data ?? [];
  const tradesAll = tradesAllQuery.data ?? [];
  const perf = perfQuery.data ?? [];

  const totalPnl = strategies.reduce((acc, s) => acc + (s.pnlUsd ?? 0), 0);
  const activeCount = strategies.filter((s) => s.status === "active").length;
  const totalTradesWeight = strategies.reduce((acc, s) => acc + (s.tradeCount ?? 0), 0);
  const weightedWinRate =
    totalTradesWeight > 0
      ? strategies.reduce((acc, s) => acc + s.winRatePct * (s.tradeCount ?? 0), 0) /
        totalTradesWeight
      : null;

  const cutoff30d = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const trades30d = tradesAll.filter((t) => {
    const ts = new Date(t.closedAt ?? t.openedAt).getTime();
    return Number.isFinite(ts) && ts >= cutoff30d;
  }).length;

  const tableTrades = React.useMemo(() => {
    const rows =
      strategyFilter === "all" ? tradesAll : (tradesQuery.data ?? tradesAll);
    return [...rows].sort((a, b) => {
      const ta = new Date(a.closedAt ?? a.openedAt).getTime();
      const tb = new Date(b.closedAt ?? b.openedAt).getTime();
      return tb - ta;
    });
  }, [strategyFilter, tradesAll, tradesQuery.data]);

  const perfChart = React.useMemo(
    () =>
      [...perf]
        .sort((a, b) => b.pnlUsd - a.pnlUsd)
        .map((p) => ({ name: p.name, pnlUsd: p.pnlUsd })),
    [perf],
  );

  const errBox = (q: { error: unknown; refetch: () => void }) => (
    <ErrorBox
      message={
        q.error instanceof ApiError ? q.error.message : "Backend belum terjangkau — mencoba lagi"
      }
      onRetry={() => q.refetch()}
    />
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trading"
        subtitle="Strategi otomatis, paper trading sandbox, dan alert eksekusi."
      />

      <Tabs defaultValue="strategi" className="gap-6">
        <TabsList className="h-10 p-1">
          <TabsTrigger value="strategi" className={cn("px-4", focusRing)}>
            <Bot className="h-4 w-4" aria-hidden="true" />
            Strategi &amp; Eksekusi
          </TabsTrigger>
          <TabsTrigger value="paper" className={cn("px-4", focusRing)}>
            <FlaskConical className="h-4 w-4" aria-hidden="true" />
            Paper Trading
          </TabsTrigger>
        </TabsList>

        {/* ================= Tab 1: Strategi & Eksekusi ================= */}
        <TabsContent value="strategi" className="mt-2 outline-none">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="space-y-6"
          >

      {/* ---------- Error banner ---------- */}
      {strategiesQuery.isError && !strategiesQuery.data && errBox(strategiesQuery)}

      {/* ================= 1. StatCards ================= */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          loading={strategiesQuery.isPending}
          label="Total PnL"
          value={
            <span
              className={cn(
                totalPnl > 0 && "text-emerald-600 dark:text-emerald-400",
                totalPnl < 0 && "text-rose-600 dark:text-rose-400",
              )}
            >
              {strategiesQuery.isPending ? "—" : formatCurrency(totalPnl)}
            </span>
          }
          sub={`${strategies.length} strategi terdaftar`}
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <StatCard
          loading={strategiesQuery.isPending}
          label="Win Rate"
          value={weightedWinRate !== null ? formatPct(weightedWinRate, false) : "—"}
          sub="rata-rata berbobot jumlah trade"
          icon={<Target className="h-5 w-5" />}
        />
        <StatCard
          loading={strategiesQuery.isPending}
          label="Strategi Aktif"
          value={`${activeCount}`}
          sub={`${strategies.length} total strategi`}
          icon={<Activity className="h-5 w-5" />}
        />
        <StatCard
          loading={tradesAllQuery.isPending}
          label="Trade 30 Hari"
          value={`${trades30d}`}
          sub="30 hari terakhir"
          icon={<Clock className="h-5 w-5" />}
        />
      </div>

      {/* ================= 2. Strategi ================= */}
      <SectionCard
        title="Strategi"
        description="Bot & strategi trading lintas platform"
      >
        {strategiesQuery.isPending ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="zfo-shimmer h-44 rounded-xl" />
            ))}
          </div>
        ) : strategiesQuery.isError ? (
          errBox(strategiesQuery)
        ) : strategies.length === 0 ? (
          <EmptyState
            icon={<Bot className="h-6 w-6" />}
            title="Belum ada strategi"
            description="Strategi trading yang terdaftar akan tampil di sini."
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {strategies.map((s) => {
              const meta = STATUS_META[s.status] ?? STATUS_META.archived;
              const nextStatus: StrategyStatus | null =
                s.status === "active" ? "paused" : s.status === "paused" ? "active" : null;
              return (
                <Card key={s.id} className="rounded-xl p-5 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <p className="truncate font-semibold leading-tight">{s.name}</p>
                      <Badge
                        variant="outline"
                        className="border-zinc-500/40 bg-zinc-500/10 text-[10px] uppercase tracking-wide text-zinc-600 dark:text-zinc-300"
                      >
                        {s.platform}
                      </Badge>
                    </div>
                    <StrategyStatusBadge status={s.status} />
                  </div>

                  {s.description && (
                    <p className="line-clamp-2 text-sm text-muted-foreground">{s.description}</p>
                  )}

                  <div className="grid grid-cols-3 gap-2 border-t pt-3 text-sm">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Win Rate
                      </p>
                      <p className="font-medium tabular-nums">
                        {formatPct(s.winRatePct, false)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        PnL
                      </p>
                      <p
                        className={cn(
                          "font-medium tabular-nums",
                          s.pnlUsd > 0 && "text-emerald-600 dark:text-emerald-400",
                          s.pnlUsd < 0 && "text-rose-600 dark:text-rose-400",
                        )}
                      >
                        {formatCurrency(s.pnlUsd, true)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Trades
                      </p>
                      <p className="font-medium tabular-nums">{s.tradeCount}</p>
                    </div>
                  </div>

                  <div className="mt-auto flex items-center justify-between gap-2 border-t pt-3">
                    <p className="text-xs text-muted-foreground">
                      Sinyal terakhir:{" "}
                      <span className="font-medium text-foreground">
                        {timeAgo(s.lastSignalAt)}
                      </span>
                    </p>
                    {isOwner && nextStatus && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-h-[32px] shrink-0"
                        disabled={statusMutation.isPending}
                        onClick={() =>
                          statusMutation.mutate({ id: s.id, status: nextStatus })
                        }
                      >
                        {statusMutation.isPending &&
                        statusMutation.variables?.id === s.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        ) : nextStatus === "paused" ? (
                          <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <Play className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        {nextStatus === "paused" ? "Jeda" : "Lanjutkan"}
                      </Button>
                    )}
                    {!isOwner && (
                      <span className={cn("text-xs", meta.pulse ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                        {meta.label}
                      </span>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* ================= 3. Performance Attribution ================= */}
      <div className="grid gap-6 xl:grid-cols-3">
        <SectionCard
          title="Performance Attribution"
          description="PnL per strategi — kontribusi ke hasil total"
          className="xl:col-span-2"
        >
          {perfQuery.isPending ? (
            <Skeleton className="zfo-shimmer h-[280px] w-full rounded-lg" aria-label="Memuat grafik atribusi" />
          ) : perfQuery.isError ? (
            errBox(perfQuery)
          ) : perfChart.length === 0 ? (
            <EmptyState
              icon={<TrendingUp className="h-6 w-6" />}
              title="Belum ada data performa"
              description="Atribusi PnL per strategi akan tampil setelah ada trade."
            />
          ) : (
            <div className="h-[280px] w-full" role="img" aria-label="Grafik PnL per strategi">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={perfChart}
                  layout="vertical"
                  margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(113,113,122,0.18)"
                    horizontal={false}
                  />
                  <XAxis
                    type="number"
                    tickFormatter={(v: number) => formatCurrency(v, true)}
                    tick={{ fill: "#71717a", fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={120}
                    tick={{ fill: "#71717a", fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: string) =>
                      typeof v === "string" && v.length > 15 ? `${v.slice(0, 14)}…` : v
                    }
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(113,113,122,0.08)" }}
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      fontSize: 12,
                      color: "var(--popover-foreground)",
                    }}
                    labelStyle={{ color: "var(--muted-foreground)", marginBottom: 4 }}
                    itemStyle={{ color: "var(--popover-foreground)" }}
                    formatter={(value) => [formatCurrency(Number(value)), "PnL"]}
                  />
                  <Bar dataKey="pnlUsd" radius={[0, 4, 4, 0]} maxBarSize={22}>
                    {perfChart.map((row) => (
                      <Cell
                        key={row.name}
                        fill={row.pnlUsd >= 0 ? "#10b981" : "#f43f5e"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        {/* Kontribusi */}
        <SectionCard title="Kontribusi" description="Porsi PnL per strategi">
          {perfQuery.isPending ? (
            <LoadingRows rows={4} />
          ) : perfQuery.isError ? (
            errBox(perfQuery)
          ) : perf.length === 0 ? (
            <EmptyState title="Belum ada kontribusi" />
          ) : (
            <ul className="space-y-3.5">
              {perf
                .slice()
                .sort((a, b) => Math.abs(b.contributionPct) - Math.abs(a.contributionPct))
                .map((p) => (
                  <li key={p.strategyId} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate font-medium">{p.name}</span>
                      <span
                        className={cn(
                          "shrink-0 font-semibold tabular-nums",
                          p.contributionPct >= 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-rose-600 dark:text-rose-400",
                        )}
                      >
                        {formatPct(p.contributionPct)}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          p.contributionPct >= 0 ? "bg-emerald-500" : "bg-rose-500",
                        )}
                        style={{
                          width: `${Math.min(100, Math.max(2, Math.abs(p.contributionPct)))}%`,
                        }}
                      />
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* ================= 4. Log Eksekusi ================= */}
      <SectionCard
        title="Log Eksekusi"
        description="Riwayat trade yang dieksekusi strategi"
        actions={
          <Select value={strategyFilter} onValueChange={setStrategyFilter}>
            <SelectTrigger size="sm" className="w-[190px]" aria-label="Filter strategi">
              <SelectValue placeholder="Semua Strategi" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Strategi</SelectItem>
              {strategies.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      >
        {tradesQuery.isPending && strategyFilter !== "all" ? (
          <LoadingRows rows={5} />
        ) : (strategyFilter === "all" ? tradesAllQuery.isError : tradesQuery.isError) ? (
          errBox(strategyFilter === "all" ? tradesAllQuery : tradesQuery)
        ) : tableTrades.length === 0 ? (
          <EmptyState
            icon={<Activity className="h-6 w-6" />}
            title="Belum ada trade"
            description="Trade yang dieksekusi strategi akan tercatat di sini."
          />
        ) : (
          <div className="max-h-96 overflow-auto rounded-lg border">
            <Table>
              <TableHeader className="sticky top-0 bg-background/95 backdrop-blur">
                <TableRow>
                  <TableHead className="w-[150px]">Waktu Close</TableHead>
                  <TableHead>Strategi</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Entry → Exit</TableHead>
                  <TableHead className="text-right">PnL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tableTrades.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="tabular-nums">
                      <div className="font-medium">
                        {t.closedAt ? formatDateTime(t.closedAt) : "Terbuka"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t.closedAt
                          ? daysAgo(t.closedAt) < 30
                            ? timeAgo(t.closedAt)
                            : ""
                          : `dibuka ${timeAgo(t.openedAt)}`}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[160px] truncate font-medium">
                      {t.strategyName}
                    </TableCell>
                    <TableCell className="font-mono text-xs font-semibold">{t.symbol}</TableCell>
                    <TableCell>
                      <SideBadge side={t.side} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(t.quantity, 4)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs">
                      {formatCurrency(t.entryPrice)}
                      <span className="mx-1 text-muted-foreground">→</span>
                      {t.exitPrice != null ? formatCurrency(t.exitPrice) : "—"}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-semibold tabular-nums",
                        t.pnlUsd > 0 && "text-emerald-600 dark:text-emerald-400",
                        t.pnlUsd < 0 && "text-rose-600 dark:text-rose-400",
                      )}
                    >
                      {t.pnlUsd > 0 ? "+" : ""}
                      {formatCurrency(t.pnlUsd)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      {/* ================= 5. Alert Sinyal Terpusat ================= */}
      <SectionCard
        title="Alert Sinyal Terpusat"
        description="Notifikasi sinyal & eksekusi dari seluruh strategi"
        actions={
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Bell className="h-4 w-4" aria-hidden="true" />
            diperbarui tiap 60 detik
          </span>
        }
      >
        {alertsQuery.isPending ? (
          <LoadingRows rows={4} />
        ) : alertsQuery.isError ? (
          errBox(alertsQuery)
        ) : !alertsQuery.data || alertsQuery.data.length === 0 ? (
          <EmptyState
            icon={<Bell className="h-6 w-6" />}
            title="Tidak ada alert"
            description="Sinyal dan peringatan trading akan tampil di sini."
          />
        ) : (
          <ul className="max-h-80 space-y-3 overflow-y-auto pr-1">
            {alertsQuery.data.map((a) => (
              <li key={a.id} className="flex items-start gap-3">
                <AlertLevelBadge level={a.level} className="mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm leading-snug">{a.message}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {a.source ? `${a.source} · ` : ""}
                    {timeAgo(a.createdAt)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
          </motion.div>
        </TabsContent>

        {/* ================= Tab 2: Paper Trading (sandbox) ================= */}
        <TabsContent value="paper" className="mt-2 outline-none">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
            <PaperTradingPanel />
          </motion.div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
