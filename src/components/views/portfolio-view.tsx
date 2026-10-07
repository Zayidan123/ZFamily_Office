"use client";

// ============================================================
// Portofolio & Risiko — Task 2-b
// StatCards (VaR/Posisi/Konsentrasi/Total) · Alokasi vs Target
// Konsentrasi Risiko · Stress Test interaktif (slider + preset
// + POST /risk/stress-test + BarChart recharts)
// ============================================================
import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { useAppStore } from "@/lib/store";
import { apiFetch, apiGetBlob, ApiError } from "@/lib/api";
import { formatPct, formatMonthLabel } from "@/lib/format";
import {
  StatCard,
  PageHeader,
  SectionCard,
  EmptyState,
  LoadingRows,
  ErrorBox,
  ClassBadge,
  useFormatCurrency,
  ASSET_CLASS_STYLE,
} from "@/components/shared/kit";
import type {
  AssetClass,
  MonthlyReport,
  RiskOverview,
  Settings,
  StressScenario,
  StressTestResult,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ShieldAlert,
  Crosshair,
  AlertTriangle,
  Wallet,
  Loader2,
  FlaskConical,
  RotateCcw,
  Play,
  Coins,
  Building2,
  Landmark,
  Layers,
  ArrowRight,
  Download,
  FileBarChart2,
  TrendingUp,
  TrendingDown,
} from "lucide-react";

// ------------------------------------------------------------
// Konstanta
// ------------------------------------------------------------
const CLASS_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(ASSET_CLASS_STYLE).map(([k, v]) => [k, v.label]),
);

/** Kelas yang jadi target slider stress test */
type StressKey = "crypto" | "stocks" | "forex_gold" | "stable";

const STRESS_GROUPS: {
  key: StressKey;
  label: string;
  hint?: string;
  classes: AssetClass[];
}[] = [
  { key: "crypto", label: "Kripto", hint: "BTC, ETH, dll.", classes: ["crypto"] },
  { key: "stocks", label: "Saham", hint: "IDX & AS", classes: ["stocks"] },
  { key: "forex_gold", label: "Forex / Emas", classes: ["forex_gold"] },
  {
    key: "stable",
    label: "Aset Stabil",
    hint: "Properti + Kas digabung",
    classes: ["property", "cash"],
  },
];

const DEFAULT_STRESS: Record<StressKey, number> = {
  crypto: -30,
  stocks: 0,
  forex_gold: 0,
  stable: 0,
};

const STRESS_PRESETS: { label: string; values: Record<StressKey, number> }[] = [
  { label: "BTC −30%", values: { crypto: -30, stocks: 0, forex_gold: 0, stable: 0 } },
  { label: "Bear Market", values: { crypto: -40, stocks: -20, forex_gold: 0, stable: 0 } },
  { label: "Black Swan", values: { crypto: -60, stocks: -35, forex_gold: 10, stable: 0 } },
];

/** Pemetaan kelas aset → key settings.allocationTargets */
const TARGET_KEY: Partial<Record<AssetClass, keyof Settings["allocationTargets"]>> = {
  crypto: "crypto",
  stocks: "stocks",
  forex_gold: "forexGold",
  property: "property",
  cash: "cash",
};

function concentrationIcon(type: string) {
  if (type === "asset") return Coins;
  if (type === "exchange") return Landmark;
  if (type === "platform") return Building2;
  if (type === "class") return Layers;
  return ShieldAlert;
}

function driftBadgeClass(absDrift: number): string {
  if (absDrift <= 5)
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  if (absDrift <= 10)
    return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400";
  return "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400";
}

// ------------------------------------------------------------
// Laporan Kinerja (tab) — Task U-b · GET /reports/monthly[.csv]
// RBAC: executor 403 → EmptyState
// ------------------------------------------------------------

const REPORT_PERIODS = [6, 12, 18, 24] as const;
type ReportMonths = (typeof REPORT_PERIODS)[number];

function pnlTextClass(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v) || v === 0) return "";
  return v > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400";
}

function monthStamp(d = new Date()): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function ReportsPerformancePanel() {
  const formatCurrency = useFormatCurrency();
  const user = useAppStore((s) => s.user);
  const isExecutor = user?.role === "executor";

  const [months, setMonths] = React.useState<ReportMonths>(12);

  const reportQuery = useQuery<MonthlyReport, ApiError>({
    queryKey: ["reports", "monthly", months],
    queryFn: () => apiFetch<MonthlyReport>("/reports/monthly", { params: { months } }),
    enabled: !isExecutor,
    staleTime: 60_000,
    retry: false,
  });

  // Ekspor CSV laporan — blob + Bearer (pola apiGetBlob, S-b)
  const exportCsvM = useMutation({
    mutationFn: async () => {
      const blob = await apiGetBlob("/reports/monthly.csv", { months });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `laporan-kinerja-${monthStamp()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return blob.size;
    },
    onSuccess: (size) =>
      toast.success("Laporan CSV berhasil diunduh", {
        description: `laporan-kinerja-${monthStamp()}.csv · ${(size / 1024).toFixed(1)} KB`,
      }),
    onError: (e) =>
      toast.error("Gagal mengekspor laporan", {
        description: e instanceof ApiError ? e.message : "Backend belum terjangkau — mencoba lagi",
      }),
  });

  const report = reportQuery.data;
  const summary = report?.summary;
  const rows = report?.months ?? [];

  const chartData = React.useMemo(
    () =>
      rows.map((m) => ({
        month: m.month,
        label: formatMonthLabel(m.month),
        Perubahan: m.changeUsd,
      })),
    [rows],
  );

  // ---------- RBAC: executor → EmptyState ----------
  if (isExecutor) {
    return (
      <EmptyState
        icon={<ShieldAlert className="h-6 w-6" />}
        title="Akses terbatas"
        description="Laporan kinerja tidak tersedia untuk peran executor."
      />
    );
  }

  if (reportQuery.isError) {
    if (reportQuery.error instanceof ApiError && reportQuery.error.status === 403) {
      return (
        <EmptyState
          icon={<ShieldAlert className="h-6 w-6" />}
          title="Akses terbatas"
          description="Laporan kinerja tidak tersedia untuk peran Anda."
        />
      );
    }
    return (
      <ErrorBox
        message={
          reportQuery.error instanceof ApiError
            ? reportQuery.error.message
            : "Backend belum terjangkau — mencoba lagi"
        }
        onRetry={() => void reportQuery.refetch()}
      />
    );
  }

  const pending = reportQuery.isPending;

  return (
    <div className="space-y-6">
      {/* ================= StatCards ringkasan ================= */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          loading={pending}
          label={`Perubahan ${months} Bulan`}
          value={
            summary ? (
              <span className={cn(pnlTextClass(summary.totalChangeUsd))}>
                {formatCurrency(summary.totalChangeUsd)}
              </span>
            ) : (
              "—"
            )
          }
          sub={summary ? `${formatPct(summary.totalChangePct)} dalam ${months} bulan` : undefined}
          accent={summary && summary.totalChangeUsd < 0 ? "rose" : "default"}
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <StatCard
          loading={pending}
          label="Bulan Terbaik"
          value={
            summary?.bestMonth ? (
              <span className="text-emerald-600 dark:text-emerald-400">
                {formatCurrency(summary.bestMonth.changeUsd)}
              </span>
            ) : (
              "—"
            )
          }
          sub={summary?.bestMonth ? formatMonthLabel(summary.bestMonth.month) : undefined}
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <StatCard
          loading={pending}
          label="Bulan Terburuk"
          value={
            summary?.worstMonth ? (
              <span className="text-rose-600 dark:text-rose-400">
                {formatCurrency(summary.worstMonth.changeUsd)}
              </span>
            ) : (
              "—"
            )
          }
          sub={summary?.worstMonth ? formatMonthLabel(summary.worstMonth.month) : undefined}
          accent="rose"
          icon={<TrendingDown className="h-5 w-5" />}
        />
        <StatCard
          loading={pending}
          label="Rata-rata Bulanan"
          value={
            summary ? (
              <span className={cn(pnlTextClass(summary.avgMonthlyChangeUsd))}>
                {formatCurrency(summary.avgMonthlyChangeUsd)}
              </span>
            ) : (
              "—"
            )
          }
          sub="rata-rata perubahan per bulan"
          icon={<TrendingUp className="h-5 w-5" />}
        />
      </div>

      {/* ================= Grafik perubahan bulanan ================= */}
      <SectionCard
        title="Perubahan Bulanan"
        description="Gain/loss portofolio per bulan (arus masuk/keluar tidak dihitung sebagai gain)"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={String(months)}
              onValueChange={(v) => setMonths(Number(v) as ReportMonths)}
            >
              <SelectTrigger className="w-[124px]" aria-label="Periode laporan">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REPORT_PERIODS.map((p) => (
                  <SelectItem key={p} value={String(p)}>
                    {p} Bulan
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-[36px]"
              onClick={() => exportCsvM.mutate()}
              disabled={exportCsvM.isPending || pending}
            >
              {exportCsvM.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Download className="h-4 w-4" aria-hidden="true" />
              )}
              Ekspor CSV Laporan
            </Button>
          </div>
        }
      >
        {pending ? (
          <Skeleton className="h-[260px] w-full rounded-lg" aria-label="Memuat grafik laporan" />
        ) : chartData.length === 0 ? (
          <EmptyState
            icon={<FileBarChart2 className="h-6 w-6" />}
            title="Belum ada data bulanan"
            description="Laporan terbentuk dari snapshot & transaksi bulanan — data belum cukup."
          />
        ) : (
          <div
            className="h-[260px] w-full"
            role="img"
            aria-label="Grafik perubahan portofolio per bulan"
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(113,113,122,0.18)"
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "#71717a", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={16}
                />
                <YAxis
                  tickFormatter={(v: number) => formatCurrency(v, true)}
                  tick={{ fill: "#71717a", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={70}
                  domain={["auto", "auto"]}
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
                  formatter={(value) => [formatCurrency(Number(value)), "Perubahan"]}
                />
                <Bar dataKey="Perubahan" radius={[4, 4, 0, 0]} maxBarSize={30}>
                  {chartData.map((d) => (
                    <Cell key={d.month} fill={d.Perubahan >= 0 ? "#10b981" : "#f43f5e"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </SectionCard>

      {/* ================= Tabel rincian bulanan ================= */}
      <SectionCard
        title="Rincian Bulanan"
        description={
          pending
            ? "Memuat data…"
            : `${rows.length} bulan · inflow ${formatCurrency(summary?.totalInflowUsd ?? 0, true)} · outflow ${formatCurrency(summary?.totalOutflowUsd ?? 0, true)}`
        }
        contentClassName="px-0 pb-0"
      >
        {pending ? (
          <div className="px-6 pb-6">
            <LoadingRows rows={6} />
          </div>
        ) : rows.length === 0 ? (
          <div className="px-6 pb-6">
            <EmptyState
              icon={<FileBarChart2 className="h-6 w-6" />}
              title="Tidak ada baris bulanan"
              description="Belum ada snapshot portofolio untuk periode ini."
            />
          </div>
        ) : (
          <div className="max-h-80 overflow-auto scrollbar-thin">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_var(--border)]">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="min-w-[84px]">Bulan</TableHead>
                  <TableHead className="text-right">Awal</TableHead>
                  <TableHead className="text-right">Akhir</TableHead>
                  <TableHead className="text-right">Δ ±</TableHead>
                  <TableHead className="text-right">Inflow</TableHead>
                  <TableHead className="text-right">Outflow</TableHead>
                  <TableHead className="text-right">Net Flow</TableHead>
                  <TableHead className="w-[56px] text-right">Tx</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((m) => (
                  <TableRow key={m.month}>
                    <TableCell className="font-medium">{formatMonthLabel(m.month)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatCurrency(m.startUsd, true)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(m.endUsd, true)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-medium tabular-nums",
                        pnlTextClass(m.changeUsd),
                      )}
                    >
                      {formatCurrency(m.changeUsd, true)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-600/90 dark:text-emerald-400/90">
                      {formatCurrency(m.inflowUsd, true)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-rose-600/90 dark:text-rose-400/90">
                      {formatCurrency(m.outflowUsd, true)}
                    </TableCell>
                    <TableCell
                      className={cn("text-right tabular-nums", pnlTextClass(m.netFlowUsd))}
                    >
                      {formatCurrency(m.netFlowUsd, true)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {m.txCount}
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
// PortfolioView
// ------------------------------------------------------------
export default function PortfolioView() {
  const formatCurrency = useFormatCurrency();

  // ---------- Queries ----------
  const riskQuery = useQuery<RiskOverview, ApiError>({
    queryKey: ["risk"],
    queryFn: () => apiFetch<RiskOverview>("/risk/overview"),
    refetchInterval: 60_000,
    staleTime: 50_000,
  });

  const settingsQuery = useQuery<Settings, ApiError>({
    queryKey: ["settings"],
    queryFn: () => apiFetch<Settings>("/settings"),
    staleTime: 5 * 60_000,
  });

  const risk = riskQuery.data;
  const settings = settingsQuery.data;
  const loadingAll = riskQuery.isPending;

  // ---------- Stress test state (lokal — tidak dipersist) ----------
  const [stress, setStress] = React.useState<Record<StressKey, number>>(DEFAULT_STRESS);
  const [stressResult, setStressResult] = React.useState<StressTestResult | null>(null);

  const stressMutation = useMutation({
    mutationFn: (scenarios: StressScenario[]) =>
      apiFetch<StressTestResult>("/risk/stress-test", {
        method: "POST",
        body: { scenarios },
      }),
    onSuccess: (data) => {
      setStressResult(data);
      toast.success("Simulasi stress test selesai", {
        description: `Dampak portofolio ${formatPct(data.impactPct)} (${formatCurrency(data.impactUsd, true)}).`,
      });
    },
    onError: (err) => {
      toast.error("Gagal menjalankan simulasi", {
        description: err instanceof ApiError ? err.message : "Backend belum terjangkau — mencoba lagi",
      });
    },
  });

  const runStressTest = () => {
    const scenarios: StressScenario[] = [];
    for (const group of STRESS_GROUPS) {
      for (const assetClass of group.classes) {
        scenarios.push({ assetClass, changePct: stress[group.key] });
      }
    }
    stressMutation.mutate(scenarios);
  };

  // ---------- Derived ----------
  const allocation = React.useMemo(
    () => [...(risk?.allocation ?? [])].sort((a, b) => b.pct - a.pct),
    [risk?.allocation],
  );
  const totalPortfolio = allocation.reduce((acc, r) => acc + (r.valueUsd ?? 0), 0);
  const concentrationRiskCount =
    risk?.concentration?.filter((c) => c.level !== "normal").length ?? 0;

  const largestPct = risk?.largestPositionPct ?? 0;
  const largestLevel =
    largestPct >= 20 ? "critical" : largestPct >= 10 ? "warning" : "normal";

  const stressChartData =
    stressResult?.byClass.map((row) => ({
      name: CLASS_LABEL[row.class] ?? row.class,
      Sebelum: row.beforeUsd,
      Sesudah: row.afterUsd,
    })) ?? [];

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
        title="Portofolio & Risiko"
        subtitle="Alokasi vs target, konsentrasi posisi, VaR, stress test, dan laporan kinerja bulanan."
      />

      <Tabs defaultValue="risiko" className="gap-6">
        <TabsList className="h-10 p-1">
          <TabsTrigger value="risiko" className="px-4">
            <ShieldAlert className="h-4 w-4" aria-hidden="true" />
            Risiko
          </TabsTrigger>
          <TabsTrigger value="laporan" className="px-4">
            <FileBarChart2 className="h-4 w-4" aria-hidden="true" />
            Laporan Kinerja
          </TabsTrigger>
        </TabsList>

        {/* ================= Tab 1: Risiko ================= */}
        <TabsContent value="risiko" className="mt-2 outline-none">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="space-y-6"
          >

      {/* ---------- Error banner ---------- */}
      {riskQuery.isError && !risk && errBox(riskQuery)}

      {/* ================= 1. StatCards ================= */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          loading={loadingAll}
          label="VaR 95%"
          value={risk ? formatCurrency(risk.var95Usd) : "—"}
          sub={
            risk && Number.isFinite(risk.var95Pct)
              ? `estimasi kerugian maksimum · ${formatPct(risk.var95Pct)} portofolio`
              : "estimasi kerugian maksimum"
          }
          icon={<ShieldAlert className="h-5 w-5" />}
        />
        <StatCard
          loading={loadingAll}
          label="Posisi Terbesar"
          value={
            <span
              className={cn(
                largestLevel === "critical" && "text-rose-600 dark:text-rose-400",
                largestLevel === "warning" && "text-amber-600 dark:text-amber-400",
                largestLevel === "normal" && "text-emerald-600 dark:text-emerald-400",
              )}
            >
              {risk ? formatPct(largestPct, false) : "—"}
            </span>
          }
          accent={largestLevel === "critical" ? "rose" : largestLevel === "warning" ? "amber" : "default"}
          sub="posisi tunggal vs total portofolio"
          icon={<Crosshair className="h-5 w-5" />}
        />
        <StatCard
          loading={loadingAll}
          label="Konsentrasi Waspada"
          value={risk ? `${concentrationRiskCount}` : "—"}
          accent={concentrationRiskCount > 0 ? "amber" : "default"}
          sub={
            risk
              ? concentrationRiskCount > 0
                ? "level warning + critical"
                : "semua dalam ambang aman"
              : undefined
          }
          icon={<AlertTriangle className="h-5 w-5" />}
        />
        <StatCard
          loading={loadingAll}
          label="Total Portofolio"
          value={risk ? formatCurrency(totalPortfolio) : "—"}
          sub={allocation.length > 0 ? `${allocation.length} kelas aset` : undefined}
          icon={<Wallet className="h-5 w-5" />}
        />
      </div>

      {/* ================= 2. Alokasi vs Target ================= */}
      <SectionCard
        title="Alokasi vs Target"
        description="Komposisi aktual dibanding target alokasi dari pengaturan"
        actions={
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" aria-hidden="true" />
              Aktual
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-zinc-400" aria-hidden="true" />
              Target
            </span>
          </div>
        }
      >
        {riskQuery.isPending ? (
          <LoadingRows rows={4} />
        ) : riskQuery.isError ? (
          errBox(riskQuery)
        ) : allocation.length === 0 ? (
          <EmptyState
            icon={<Wallet className="h-6 w-6" />}
            title="Belum ada alokasi"
            description="Tambahkan aset untuk melihat perbandingan alokasi vs target."
          />
        ) : (
          <ul className="space-y-5">
            {allocation.map((row) => {
              const label = CLASS_LABEL[row.class] ?? row.class;
              const targetKey = TARGET_KEY[row.class];
              const targetPct =
                (targetKey && settings?.allocationTargets
                  ? settings.allocationTargets[targetKey]
                  : undefined) ?? row.targetPct;
              const drift = row.pct - targetPct;
              const absDrift = Math.abs(drift);
              const recommendation =
                drift > 5
                  ? `Kurangi ${label} ${formatPct(absDrift, false)}`
                  : drift < -5
                    ? `Tambah ${label} ${formatPct(absDrift, false)}`
                    : "Sesuai target — tidak perlu rebalancing";

              return (
                <li key={row.class} className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <ClassBadge assetClass={row.class} />
                    <span className="text-sm font-medium tabular-nums">
                      {formatPct(row.pct, false)}
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      target {formatPct(targetPct, false)}
                    </span>
                    <Badge variant="outline" className={cn("ml-auto tabular-nums", driftBadgeClass(absDrift))}>
                      Δ {formatPct(drift)}
                    </Badge>
                  </div>
                  <div className="space-y-1.5">
                    {/* bar aktual */}
                    <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all"
                        style={{ width: `${Math.min(100, Math.max(0, row.pct))}%` }}
                      />
                    </div>
                    {/* bar target */}
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60">
                      <div
                        className="h-full rounded-full bg-zinc-400 transition-all"
                        style={{ width: `${Math.min(100, Math.max(0, targetPct))}%` }}
                      />
                    </div>
                  </div>
                  <p className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{recommendation}</span>
                    <span className="tabular-nums">{formatCurrency(row.valueUsd, true)}</span>
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      {/* ================= 3. Konsentrasi Risiko ================= */}
      <SectionCard
        title="Konsentrasi Risiko"
        description="Posisi, bursa, atau kelas aset yang mendominasi portofolio"
      >
        {riskQuery.isPending ? (
          <LoadingRows rows={3} />
        ) : riskQuery.isError ? (
          errBox(riskQuery)
        ) : !risk || risk.concentration.length === 0 ? (
          <EmptyState
            icon={<Layers className="h-6 w-6" />}
            title="Tidak ada konsentrasi berlebih"
            description="Risiko terdistribusi dengan baik di seluruh portofolio."
          />
        ) : (
          <ul className="grid gap-x-8 gap-y-4 md:grid-cols-2">
            {risk.concentration.map((c, i) => {
              const Icon = concentrationIcon(c.type);
              return (
                <li key={`${c.type}-${c.label}-${i}`} className="space-y-1.5">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                        c.level === "critical" && "bg-rose-500/10 text-rose-600 dark:text-rose-400",
                        c.level === "warning" && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                        c.level === "normal" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                      )}
                      aria-hidden="true"
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.label}</span>
                    <span className="text-sm font-semibold tabular-nums">
                      {formatPct(c.pct, false)}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        c.level === "critical" && "bg-rose-500",
                        c.level === "warning" && "bg-amber-500",
                        c.level === "normal" && "bg-emerald-500",
                      )}
                      style={{ width: `${Math.min(100, Math.max(2, c.pct))}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      {/* ================= 4. Stress Test ================= */}
      <SectionCard
        title="Stress Test"
        description="Simulasikan pergerakan pasar ekstrem dan lihat dampaknya ke net worth"
      >
        <div className="grid gap-8 lg:grid-cols-2">
          {/* ---- Kontrol skenario ---- */}
          <div className="space-y-6">
            <div className="space-y-5">
              {STRESS_GROUPS.map((group) => (
                <div key={group.key} className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{group.label}</p>
                      {group.hint && (
                        <p className="text-xs text-muted-foreground">{group.hint}</p>
                      )}
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        "tabular-nums",
                        stress[group.key] < 0 &&
                          "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400",
                        stress[group.key] > 0 &&
                          "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                      )}
                    >
                      {formatPct(stress[group.key])}
                    </Badge>
                  </div>
                  <Slider
                    min={-50}
                    max={20}
                    step={1}
                    value={[stress[group.key]]}
                    onValueChange={([v]) =>
                      setStress((prev) => ({ ...prev, [group.key]: v }))
                    }
                    aria-label={`Skenario perubahan ${group.label}`}
                  />
                </div>
              ))}
            </div>

            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Preset Skenario
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {STRESS_PRESETS.map((preset) => (
                  <Button
                    key={preset.label}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-[36px] tabular-nums"
                    onClick={() => setStress(preset.values)}
                  >
                    {preset.label}
                  </Button>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-h-[36px] text-muted-foreground"
                  onClick={() => {
                    setStress(DEFAULT_STRESS);
                    setStressResult(null);
                  }}
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  Reset
                </Button>
              </div>

              <Button
                type="button"
                size="sm"
                className="min-h-[40px] w-full bg-emerald-600 text-white hover:bg-emerald-700 sm:w-auto"
                onClick={runStressTest}
                disabled={stressMutation.isPending}
              >
                {stressMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Play className="h-4 w-4" aria-hidden="true" />
                )}
                Jalankan Simulasi
              </Button>
            </div>
          </div>

          {/* ---- Hasil simulasi ---- */}
          <div className="rounded-xl border bg-muted/30 p-4">
            {stressMutation.isPending && !stressResult ? (
              <div className="space-y-4" aria-busy="true" aria-label="Memuat hasil simulasi">
                <Skeleton className="h-8 w-3/4" />
                <Skeleton className="h-8 w-1/2" />
                <Skeleton className="h-[220px] w-full rounded-lg" />
              </div>
            ) : !stressResult ? (
              <EmptyState
                icon={<FlaskConical className="h-6 w-6" />}
                title="Belum ada simulasi"
                description="Atur skenario per kelas aset (atau pakai preset), lalu klik Jalankan Simulasi untuk melihat dampak ke net worth."
                className="border-0 py-10"
              />
            ) : (
              <div className="space-y-4">
                {/* Net worth sebelum → sesudah */}
                <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Net Worth Sebelum
                    </p>
                    <p className="text-2xl font-semibold tabular-nums">
                      {formatCurrency(stressResult.baselineUsd)}
                    </p>
                  </div>
                  <ArrowRight
                    className="mb-1.5 h-5 w-5 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Sesudah
                    </p>
                    <p
                      className={cn(
                        "text-2xl font-semibold tabular-nums",
                        stressResult.impactUsd < 0
                          ? "text-rose-600 dark:text-rose-400"
                          : "text-emerald-600 dark:text-emerald-400",
                      )}
                    >
                      {formatCurrency(stressResult.stressedUsd)}
                    </p>
                  </div>
                  <div className="ml-auto text-right">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Dampak
                    </p>
                    <p
                      className={cn(
                        "text-lg font-semibold tabular-nums",
                        stressResult.impactUsd < 0
                          ? "text-rose-600 dark:text-rose-400"
                          : stressResult.impactUsd > 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-muted-foreground",
                      )}
                    >
                      {formatPct(stressResult.impactPct)}
                    </p>
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {formatCurrency(stressResult.impactUsd, true)}
                    </p>
                  </div>
                </div>

                {/* Bar chart sebelum vs sesudah per kelas */}
                {stressChartData.length === 0 ? (
                  <EmptyState
                    title="Tidak ada data kelas aset"
                    description="Hasil simulasi tidak memuat rincian per kelas."
                  />
                ) : (
                  <div className="h-[230px] w-full" role="img" aria-label="Grafik dampak stress test per kelas aset">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={stressChartData}
                        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                        barGap={4}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="rgba(113,113,122,0.18)"
                          vertical={false}
                        />
                        <XAxis
                          dataKey="name"
                          tick={{ fill: "#71717a", fontSize: 11 }}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          tickFormatter={(v: number) => formatCurrency(v, true)}
                          tick={{ fill: "#71717a", fontSize: 11 }}
                          tickLine={false}
                          axisLine={false}
                          width={68}
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
                          formatter={(value, name) => [
                            formatCurrency(Number(value)),
                            String(name),
                          ]}
                        />
                        <Legend
                          iconType="circle"
                          wrapperStyle={{ fontSize: 12, paddingTop: 4 }}
                        />
                        <Bar dataKey="Sebelum" fill="#a1a1aa" radius={[4, 4, 0, 0]} maxBarSize={38} />
                        <Bar dataKey="Sesudah" radius={[4, 4, 0, 0]} maxBarSize={38}>
                          {stressResult.byClass.map((row) => (
                            <Cell
                              key={row.class}
                              fill={row.afterUsd < row.beforeUsd ? "#f59e0b" : "#10b981"}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </SectionCard>
          </motion.div>
        </TabsContent>

        {/* ================= Tab 2: Laporan Kinerja ================= */}
        <TabsContent value="laporan" className="mt-2 outline-none">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
            <ReportsPerformancePanel />
          </motion.div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
