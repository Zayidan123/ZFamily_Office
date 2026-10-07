"use client";

// ============================================================
// Dashboard — flagship view
// StatCards · Tren Net Worth (Area) · Alokasi (Donut) · Top 5
// Transaksi Terakhir · Alert Pusat · Kesehatan Platform
// ============================================================
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAppStore } from "@/lib/store";
import { api, apiFetch, ApiError } from "@/lib/api";
import {
  formatDate,
  formatMonthLabel,
  formatPct,
  formatUsd,
  timeAgo,
} from "@/lib/format";
import {
  useFormatCurrency,
  useRates,
  StatCard,
  PageHeader,
  SectionCard,
  EmptyState,
  LoadingRows,
  ErrorBox,
  ClassBadge,
  AlertLevelBadge,
} from "@/components/shared/kit";
import type {
  AlertItemWithRead,
  DashboardSummary,
  HistoryPoint,
  TradingAlertRow,
  Transaction,
  UnreadCount,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Wallet,
  Activity,
  Landmark,
  ClipboardCheck,
  Camera,
  Loader2,
  ArrowDownLeft,
  ArrowUpRight,
  Scale,
  Bell,
  Check,
  CheckCheck,
  HeartPulse,
  ShieldCheck,
  Database,
} from "lucide-react";

// ------------------------------------------------------------
// Konstanta kecil
// ------------------------------------------------------------
const TX_META: Record<
  Transaction["type"],
  { label: string; dir: "in" | "out" | "neutral" }
> = {
  buy: { label: "Beli", dir: "in" },
  sell: { label: "Jual", dir: "out" },
  transfer_in: { label: "Transfer Masuk", dir: "in" },
  transfer_out: { label: "Transfer Keluar", dir: "out" },
  income: { label: "Pemasukan", dir: "in" },
  expense: { label: "Pengeluaran", dir: "out" },
  valuation_update: { label: "Update Nilai", dir: "neutral" },
};

const CLASS_STYLE: Record<string, { label: string; hex: string }> = {
  crypto: { label: "Kripto", hex: "#f59e0b" },
  stocks: { label: "Saham", hex: "#10b981" },
  forex_gold: { label: "Forex/Emas", hex: "#ca8a04" },
  property: { label: "Properti", hex: "#0d9488" },
  vehicle: { label: "Kendaraan", hex: "#f97316" },
  cash: { label: "Kas", hex: "#65a30d" },
  business: { label: "Bisnis", hex: "#e11d48" },
};

const CLASS_HEX = CLASS_STYLE;
const CLASS_LABEL = Object.fromEntries(
  Object.entries(CLASS_STYLE).map(([k, v]) => [k, v.label]),
);

// ------------------------------------------------------------
// DashboardView
// ------------------------------------------------------------
export default function DashboardView() {
  const queryClient = useQueryClient();
  const user = useAppStore((s) => s.user);
  const displayCurrency = useAppStore((s) => s.displayCurrency);
  const formatCurrency = useFormatCurrency();
  const ratesQuery = useRates();

  const [range, setRange] = React.useState<6 | 12 | 18>(18);

  // ---------- Queries ----------
  const summaryQuery = useQuery<DashboardSummary, ApiError>({
    queryKey: ["dashboard", "summary"],
    queryFn: () => api.dashboardSummary(),
    refetchInterval: 60_000,
    staleTime: 50_000,
  });

  const historyQuery = useQuery<HistoryPoint[], ApiError>({
    queryKey: ["dashboard", "history"],
    queryFn: () => api.dashboardHistory(18),
    refetchInterval: 60_000,
    staleTime: 50_000,
  });

  // Status sistem (untuk panic mode) — polling 30s
  const statusQuery = useQuery({
    queryKey: ["system-status"],
    queryFn: () => api.systemStatus(),
    refetchInterval: 30_000,
    staleTime: 25_000,
    retry: false,
  });
  const panicOn = statusQuery.data?.panicMode === true;

  // ---------- Notifikasi: status dibaca (Task U-b) ----------
  const isExecutor = user?.role === "executor";
  const canManageRead = !!user && !isExecutor; // owner/advisor/beneficiary

  const unreadQuery = useQuery<UnreadCount, ApiError>({
    queryKey: ["trading", "alerts", "unread-count"],
    queryFn: () => apiFetch<UnreadCount>("/trading/alerts/unread-count"),
    enabled: canManageRead,
    refetchInterval: 30_000,
    staleTime: 25_000,
    retry: false, // executor 403 → badge disembunyikan
  });
  const unread = unreadQuery.data?.unread ?? 0;

  // Peta isRead per id (dari /trading/alerts) — merge ke summary.alerts yang
  // mungkin belum membawa isRead (backward-compatible).
  const tradingAlertsQuery = useQuery<TradingAlertRow[], ApiError>({
    queryKey: ["trading", "alerts"],
    queryFn: () => apiFetch<TradingAlertRow[]>("/trading/alerts", { params: { limit: 50 } }),
    enabled: canManageRead,
    refetchInterval: 30_000,
    staleTime: 25_000,
    retry: false,
  });
  const readMap = React.useMemo(() => {
    const m = new Map<string, boolean>();
    for (const r of tradingAlertsQuery.data ?? []) {
      if (r?.id !== undefined && r.isRead !== undefined) m.set(String(r.id), r.isRead);
    }
    return m;
  }, [tradingAlertsQuery.data]);

  const markReadM = useMutation({
    mutationFn: (id: string) =>
      apiFetch<unknown>(`/trading/alerts/${id}/read`, { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["trading", "alerts"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err) => {
      toast.error("Gagal menandai dibaca", {
        description: err instanceof ApiError ? err.message : "Backend belum terjangkau — mencoba lagi",
      });
    },
  });

  const markAllReadM = useMutation({
    mutationFn: () => apiFetch<unknown>("/trading/alerts/read-all", { method: "POST" }),
    onSuccess: () => {
      toast.success("Semua notifikasi ditandai dibaca");
      void queryClient.invalidateQueries({ queryKey: ["trading", "alerts"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err) => {
      toast.error("Gagal menandai semua dibaca", {
        description: err instanceof ApiError ? err.message : "Backend belum terjangkau — mencoba lagi",
      });
    },
  });

  const summary = summaryQuery.data;
  const summaryAlerts = (summary?.alerts ?? []) as AlertItemWithRead[];
  const history = historyQuery.data ?? [];
  const usdIdr = ratesQuery.data?.USDIDR;
  const isIdr = displayCurrency === "IDR";
  const rateReady = !isIdr || (typeof usdIdr === "number" && usdIdr > 0);

  const slicedHistory = React.useMemo(
    () => (range >= 18 ? history : history.slice(-range)),
    [history, range],
  );

  // ---------- Snapshot (owner only) ----------
  const snapshotMutation = useMutation({
    mutationFn: () => api.snapshot(),
    onSuccess: () => {
      toast.success("Snapshot berhasil dibuat", {
        description: "Net worth hari ini tersimpan ke histori.",
      });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err) => {
      toast.error("Gagal membuat snapshot", {
        description: err instanceof ApiError ? err.message : "Backend belum terjangkau — mencoba lagi",
      });
    },
  });

  const loadingAll = summaryQuery.isPending && !summary;

  // Ekuivalen mata uang satunya (sub-text StatCard Net Worth)
  const equivalent = React.useMemo(() => {
    if (!summary) return null;
    if (isIdr) {
      return { label: "USD", text: formatUsd(summary.netWorthUsd) };
    }
    if (!usdIdr) return null;
    return { label: "IDR", text: `≈ Rp ${new Intl.NumberFormat("id-ID").format(Math.round(summary.netWorthUsd * usdIdr))}` };
  }, [summary, isIdr, usdIdr]);

  const lastSnapshot = history.length > 0 ? history[history.length - 1] : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle={
          user
            ? `Ringkasan kekayaan keluarga — selamat datang, ${user.name}.`
            : "Ringkasan kekayaan keluarga."
        }
        actions={
          <span className="text-xs text-muted-foreground">
            {summaryQuery.isFetching ? "Memperbarui…" : "Diperbarui tiap 60 detik"}
          </span>
        }
      />

      {/* ---------- Error banner (backend down dsb) ---------- */}
      {summaryQuery.isError && !summary && (
        <ErrorBox
          message={
            summaryQuery.error instanceof ApiError
              ? summaryQuery.error.message
              : "Backend belum terjangkau — mencoba lagi"
          }
          onRetry={() => void summaryQuery.refetch()}
        />
      )}

      {/* ================= 1. StatCards ================= */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy={loadingAll}>
        <StatCard
          loading={loadingAll || !rateReady}
          label="Total Net Worth"
          value={
            summary
              ? formatCurrency(summary.netWorthUsd)
              : "—"
          }
          sub={
            summary && equivalent && !loadingAll
              ? `≈ ${equivalent.text} ${equivalent.label}`
              : undefined
          }
          icon={<Wallet className="h-5 w-5" />}
        />
        <StatCard
          loading={loadingAll}
          label="Perubahan 24 Jam"
          value={summary ? formatPct(summary.change24hPct) : "—"}
          accent={summary && summary.change24hPct < 0 ? "rose" : "default"}
          delta={summary?.change24hPct}
          sub="vs kemarin"
          icon={<Activity className="h-5 w-5" />}
        />
        <StatCard
          loading={loadingAll}
          label="Total Aset"
          value={summary ? `${summary.counts.assets}` : "—"}
          sub={
            summary
              ? `aset di ${summary.counts.entities} entitas · ${summary.counts.strategies} strategi`
              : undefined
          }
          icon={<Landmark className="h-5 w-5" />}
        />
        <StatCard
          loading={loadingAll}
          label="Approval Pending"
          value={summary ? `${summary.counts.pendingApprovals}` : "—"}
          accent="amber"
          sub={summary && summary.counts.pendingApprovals > 0 ? "perlu keputusan" : "tidak ada antrean"}
          icon={<ClipboardCheck className="h-5 w-5" />}
        />
      </div>

      {/* ================= 2. Charts ================= */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* ---- Tren Net Worth ---- */}
        <SectionCard
          title="Tren Net Worth"
          description="Nilai bersih portofolio per bulan"
          className="lg:col-span-2"
          actions={
            <Tabs value={String(range)} onValueChange={(v) => setRange(Number(v) as 6 | 12 | 18)}>
              <TabsList>
                <TabsTrigger value="6" className="text-xs">6B</TabsTrigger>
                <TabsTrigger value="12" className="text-xs">12B</TabsTrigger>
                <TabsTrigger value="18" className="text-xs">18B</TabsTrigger>
              </TabsList>
            </Tabs>
          }
        >
          {historyQuery.isError ? (
            <ErrorBox
              message={
                historyQuery.error instanceof ApiError
                  ? historyQuery.error.message
                  : "Backend belum terjangkau — mencoba lagi"
              }
              onRetry={() => void historyQuery.refetch()}
            />
          ) : historyQuery.isPending ? (
            <Skeleton className="h-[300px] w-full rounded-lg" aria-label="Memuat grafik" />
          ) : slicedHistory.length === 0 ? (
            <EmptyState
              icon={<Activity className="h-6 w-6" />}
              title="Belum ada histori"
              description="Ambil snapshot berkala untuk membangun tren net worth."
            />
          ) : (
            <div className="h-[300px] w-full" role="img" aria-label="Grafik tren net worth">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={slicedHistory} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
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
                    tickFormatter={formatMonthLabel}
                    tick={{ fill: "#71717a", fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={28}
                  />
                  <YAxis
                    tickFormatter={(v: number) => formatCurrency(v, true)}
                    tick={{ fill: "#71717a", fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={72}
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
                      boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                    }}
                    labelStyle={{ color: "var(--muted-foreground)", marginBottom: 4 }}
                    itemStyle={{ color: "var(--popover-foreground)" }}
                    formatter={(value) => [formatCurrency(Number(value)), "Net Worth"]}
                    labelFormatter={(label) => formatMonthLabel(String(label))}
                  />
                  <Area
                    type="monotone"
                    dataKey="valueUsd"
                    stroke="#10b981"
                    strokeWidth={2.5}
                    fill="url(#nwFill)"
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        {/* ---- Alokasi Kelas Aset + Top 5 ---- */}
        <SectionCard
          title="Alokasi Kelas Aset"
          description="Komposisi nilai portofolio"
        >
          {summaryQuery.isError && !summary ? (
            <ErrorBox
              className="border-0 bg-transparent p-0"
              message="Data alokasi tidak tersedia"
            />
          ) : summaryQuery.isPending || !summary || !rateReady ? (
            <div className="space-y-4">
              <Skeleton className="mx-auto h-[200px] w-[200px] rounded-full" />
              <Skeleton className="h-20 w-full rounded-lg" />
            </div>
          ) : summary.byClass.length === 0 ? (
            <EmptyState
              title="Belum ada aset"
              description="Tambahkan aset untuk melihat alokasi kelas."
            />
          ) : (
            <div className="space-y-4">
              <div className="relative mx-auto h-[190px] w-full max-w-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={summary.byClass}
                      dataKey="valueUsd"
                      nameKey="class"
                      innerRadius="62%"
                      outerRadius="88%"
                      paddingAngle={2}
                      strokeWidth={0}
                    >
                      {summary.byClass.map((row) => (
                        <Cell
                          key={row.class}
                          fill={CLASS_HEX[row.class]?.hex ?? "#71717a"}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: "var(--popover)",
                        border: "1px solid var(--border)",
                        borderRadius: 12,
                        fontSize: 12,
                        color: "var(--popover-foreground)",
                      }}
                      labelStyle={{ color: "var(--muted-foreground)", marginBottom: 4 }}
                      itemStyle={{ color: "var(--popover-foreground)" }}
                      formatter={(value, name) => [
                        formatCurrency(Number(value)),
                        CLASS_LABEL[String(name)] ?? String(name),
                      ]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                {/* Label tengah donut */}
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Total
                  </span>
                  <span className="text-lg font-semibold tabular-nums">
                    {formatCurrency(summary.netWorthUsd, true)}
                  </span>
                </div>
              </div>

              {/* Legend */}
              <ul className="space-y-2" aria-label="Legenda alokasi kelas aset">
                {summary.byClass.map((row) => {
                  const style = CLASS_STYLE[row.class];
                  const down = row.change24hPct < 0;
                  return (
                    <li key={row.class} className="flex items-center gap-2 text-sm">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: style?.hex ?? "#71717a" }}
                        aria-hidden="true"
                      />
                      <span className="truncate">{style?.label ?? row.class}</span>
                      <span
                        className={cn(
                          "text-xs tabular-nums",
                          down ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400",
                        )}
                      >
                        {formatPct(row.change24hPct)}
                      </span>
                      <span className="ml-auto font-medium tabular-nums">
                        {formatCurrency(row.valueUsd, true)}
                      </span>
                      <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">
                        {row.pct.toFixed(1).replace(".", ",")}%
                      </span>
                    </li>
                  );
                })}
              </ul>

              {/* Top 5 Holdings */}
              <div className="border-t pt-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Top 5 Holdings
                </p>
                {summary.topHoldings.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Belum ada posisi.</p>
                ) : (
                  <ul className="space-y-3">
                    {summary.topHoldings.map((h, i) => (
                      <li key={h.id ?? `${h.name}-${i}`} className="space-y-1.5">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="truncate font-medium">{h.name}</span>
                          <ClassBadge assetClass={h.assetClass} className="text-[10px] px-1.5" />
                          <span className="ml-auto font-medium tabular-nums">
                            {formatCurrency(h.valueUsd, true)}
                          </span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-emerald-500"
                            style={{ width: `${Math.min(100, Math.max(2, h.pct))}%` }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </SectionCard>
      </div>

      {/* ================= 3. Transaksi + Alert ================= */}
      <div className="grid gap-6 lg:grid-cols-3">
        <SectionCard
          title="Transaksi Terakhir"
          description="6 aktivitas terbaru"
          className="lg:col-span-2"
        >
          {summaryQuery.isPending && !summary ? (
            <LoadingRows rows={5} />
          ) : !summary || summary.recentTransactions.length === 0 ? (
            <EmptyState
              icon={<ArrowUpRight className="h-6 w-6" />}
              title="Belum ada transaksi"
              description="Transaksi buy/sell dan transfer akan tampil di sini."
            />
          ) : (
            <ul className="divide-y">
              {summary.recentTransactions.map((tx) => {
                const meta = TX_META[tx.type] ?? { label: tx.type, dir: "neutral" as const };
                const inflow = meta.dir === "in";
                const neutral = meta.dir === "neutral";
                const Icon = neutral ? Scale : inflow ? ArrowDownLeft : ArrowUpRight;
                return (
                  <li key={tx.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <span
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                        neutral && "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300",
                        !neutral && inflow && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                        !neutral && !inflow && "bg-rose-500/10 text-rose-600 dark:text-rose-400",
                      )}
                      aria-hidden="true"
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{tx.assetName}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(tx.at)} · {timeAgo(tx.at)}
                      </p>
                    </div>
                    <Badge variant="outline" className="hidden shrink-0 sm:inline-flex">
                      {meta.label}
                    </Badge>
                    <span
                      className={cn(
                        "w-28 shrink-0 text-right text-sm font-medium tabular-nums",
                        neutral && "text-muted-foreground",
                        !neutral && inflow && "text-emerald-600 dark:text-emerald-400",
                        !neutral && !inflow && "text-rose-600 dark:text-rose-400",
                      )}
                    >
                      {neutral ? "" : inflow ? "+" : "−"}
                      {formatCurrency(Math.abs(tx.totalUsd), true)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Pusat Notifikasi"
          description="Alert sistem & trading"
          actions={
            <div className="flex items-center gap-2">
              {canManageRead && unread > 0 && (
                <Badge
                  variant="outline"
                  className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                  title={`${unread} notifikasi belum dibaca`}
                >
                  {unread} baru
                </Badge>
              )}
              <Bell className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </div>
          }
        >
          {summaryQuery.isPending && !summary ? (
            <LoadingRows rows={5} />
          ) : summaryAlerts.length === 0 ? (
            <EmptyState
              icon={<Bell className="h-6 w-6" />}
              title="Tidak ada notifikasi"
              description="Semua sistem berjalan normal."
            />
          ) : (
            <div className="space-y-3">
              <ul className="space-y-3">
                {summaryAlerts.map((a) => {
                  const knownRead =
                    canManageRead &&
                    (a.isRead === true || readMap.get(String(a.id)) === true);
                  const unreadItem =
                    canManageRead &&
                    (a.isRead === false || readMap.get(String(a.id)) === false);
                  // Hanya alert trading (ada di /trading/alerts) yang bisa POST read
                  const markable = canManageRead && readMap.has(String(a.id));
                  return (
                    <li
                      key={a.id}
                      className={cn("flex items-start gap-3", knownRead && "opacity-70")}
                    >
                      {canManageRead && (
                        <span
                          className={cn(
                            "mt-2.5 h-2 w-2 shrink-0 rounded-full",
                            unreadItem ? "bg-emerald-500" : "bg-transparent",
                          )}
                          aria-hidden="true"
                        />
                      )}
                      <AlertLevelBadge level={a.level} className="mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-snug">{a.message}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {a.source ? `${a.source} · ` : ""}
                          {timeAgo(a.createdAt)}
                        </p>
                      </div>
                      {unreadItem && markable && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0"
                          title="Tandai sudah dibaca"
                          aria-label="Tandai sudah dibaca"
                          disabled={markReadM.isPending}
                          onClick={() => markReadM.mutate(String(a.id))}
                        >
                          <Check className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>

              {canManageRead && unread > 0 && (
                <div className="border-t pt-3">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => markAllReadM.mutate()}
                    disabled={markAllReadM.isPending}
                  >
                    <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    Tandai semua dibaca
                  </Button>
                </div>
              )}
            </div>
          )}
        </SectionCard>
      </div>

      {/* ================= 4. Kesehatan Platform ================= */}
      <SectionCard
        title="Kesehatan Platform"
        description="Status sistem & snapshot data"
        contentClassName="px-6 pb-6"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="grid gap-4 sm:grid-cols-3 sm:gap-8">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" aria-hidden="true">
                <HeartPulse className="h-4 w-4" />
              </span>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Panic Mode</p>
                {panicOn ? (
                  <Badge className="mt-1 border-transparent bg-rose-500/15 text-rose-600 dark:text-rose-400">
                    <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                    Aktif — mutasi dibekukan
                  </Badge>
                ) : (
                  <Badge className="mt-1 border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                    Normal
                  </Badge>
                )}
              </div>
            </div>

            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400" aria-hidden="true">
                <Database className="h-4 w-4" />
              </span>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Snapshot Terakhir
                </p>
                <p className="mt-1 text-sm font-medium tabular-nums">
                  {lastSnapshot
                    ? `${formatMonthLabel(lastSnapshot.date)} — ${formatCurrency(lastSnapshot.valueUsd, true)}`
                    : "Belum ada snapshot"}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-500/10 text-zinc-600 dark:text-zinc-300" aria-hidden="true">
                <Activity className="h-4 w-4" />
              </span>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Kurs</p>
                <p className="mt-1 text-sm font-medium tabular-nums">
                  {usdIdr ? `USD 1 = Rp ${usdIdr.toLocaleString("id-ID")}` : "—"}
                </p>
              </div>
            </div>
          </div>

          {user?.role === "owner" && (
            <Button
              type="button"
              size="sm"
              className="min-h-[40px] shrink-0 bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={() => snapshotMutation.mutate()}
              disabled={snapshotMutation.isPending}
              aria-label="Ambil snapshot net worth hari ini"
            >
              {snapshotMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Camera className="h-4 w-4" aria-hidden="true" />
              )}
              Ambil Snapshot
            </Button>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
