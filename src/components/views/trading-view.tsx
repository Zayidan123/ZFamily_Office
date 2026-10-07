"use client";

// ============================================================
// Trading — Task 2-b
// StatCards (PnL/WinRate/Aktif/Trade30d) · Kartu Strategi
// (owner: pause/resume) · Performance Attribution (BarChart)
// Log Eksekusi (tabel + filter) · Alert Sinyal Terpusat
// ============================================================
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
        subtitle="Strategi otomatis, trade log, performa, dan alert eksekusi."
      />

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
              <Skeleton key={i} className="h-44 rounded-xl" />
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
            <Skeleton className="h-[280px] w-full rounded-lg" aria-label="Memuat grafik atribusi" />
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
          <div className="max-h-96 overflow-y-auto rounded-lg border">
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
    </div>
  );
}
