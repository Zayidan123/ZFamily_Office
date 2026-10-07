"use client";

// ============================================================
// Print Report Overlay (ronde 6 — Task V-a)
// Pratinjau "Laporan Kinerja Portofolio" bergaya kertas A4 +
// ekspor PDF via window.print() (pola visibility .print-area).
//
// Sumber data: props dari ReportsPerformancePanel (query yang
// sama — tidak ada refetch). Dokumen selalu putih agar hasil
// cetak konsisten di tema terang & gelap.
// CSS pendukung: blok @media print di src/app/globals.css.
// ============================================================
import * as React from "react";
import { createPortal } from "react-dom";
import { Printer, X, FileText } from "lucide-react";
import { formatPct, formatMonthLabel, formatDateTime } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import {
  useFormatCurrency,
  ASSET_CLASS_STYLE,
} from "@/components/shared/kit";
import type {
  BenchmarkReport,
  DashboardSummary,
  MonthlyReport,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export interface PrintReportOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  months: number;
  report: MonthlyReport | undefined;
  benchmark: BenchmarkReport | undefined;
  summary: DashboardSummary | undefined;
}

function pnlClass(v: number): string {
  if (!Number.isFinite(v) || v === 0) return "text-zinc-900";
  return v > 0 ? "text-emerald-700" : "text-rose-700";
}

export default function PrintReportOverlay({
  open,
  onOpenChange,
  months,
  report,
  benchmark,
  summary,
}: PrintReportOverlayProps) {
  const formatCurrency = useFormatCurrency();
  const displayCurrency = useAppStore((s) => s.displayCurrency);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const restoreRef = React.useRef<HTMLElement | null>(null);

  // Body scroll lock + Escape + fokus awal
  React.useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = window.setTimeout(() => closeRef.current?.focus(), 60);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      restoreRef.current?.focus?.();
    };
  }, [open, onOpenChange]);

  if (!open || typeof document === "undefined") return null;

  const rows = report?.months ?? [];
  const s = report?.summary;
  const bs = benchmark?.summary;
  const generatedAt = formatDateTime(new Date().toISOString());

  // Nilai akhir tiap seri benchmark (terindeks 100 = awal periode)
  const benchFinal =
    benchmark?.series?.map((ser) => {
      const pts = ser.points ?? [];
      const last = pts.length > 0 ? pts[pts.length - 1]!.value : 100;
      return { label: ser.label, final: last, ret: last - 100 };
    }) ?? [];

  // Alokasi kelas aset saat ini (maks 6 baris terbesar)
  const alloc = [...(summary?.byClass ?? [])]
    .sort((a, b) => b.valueUsd - a.valueUsd)
    .slice(0, 6);
  const allocMax = Math.max(1, ...alloc.map((a) => a.pct));

  return createPortal(
    <div
      className="print-overlay fixed inset-0 z-[90] overflow-auto bg-zinc-950/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Pratinjau laporan kinerja untuk dicetak"
    >
      {/* Toolbar (hanya layar) */}
      <div className="print-toolbar sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-white/10 bg-zinc-950/90 px-4 py-3 backdrop-blur lg:px-8">
        <div className="flex min-w-0 items-center gap-2 text-zinc-200">
          <FileText className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
          <p className="truncate text-sm font-medium">
            Pratinjau Laporan Kinerja — {months} bulan
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            size="sm"
            className="min-h-[36px] gap-2 bg-emerald-600 text-white hover:bg-emerald-500"
            onClick={() => window.print()}
          >
            <Printer className="h-4 w-4" aria-hidden="true" />
            Cetak / Simpan PDF
          </Button>
          <Button
            ref={closeRef}
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
            aria-label="Tutup pratinjau laporan"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {/* Kertas laporan */}
      <div className="mx-auto w-full max-w-[820px] px-3 py-6 lg:px-0">
        <div className="print-area rounded-xl bg-white p-8 text-zinc-900 shadow-2xl sm:p-10">
          {/* ---------- Kop dokumen ---------- */}
          <header className="print-avoid-break flex items-start justify-between gap-6 border-b-2 border-emerald-600 pb-5">
            <div className="flex items-center gap-3">
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-lg font-black text-white"
                aria-hidden="true"
              >
                Z
              </div>
              <div>
                <h1 className="text-lg font-bold leading-tight tracking-tight">
                  Laporan Kinerja Portofolio
                </h1>
                <p className="text-xs text-zinc-500">
                  Z Family Office — Internal Wealth Platform
                </p>
              </div>
            </div>
            <div className="text-right text-[11px] leading-relaxed text-zinc-500">
              <p>
                <span className="font-semibold text-zinc-700">Periode:</span>{" "}
                {months} bulan terakhir
              </p>
              <p>
                <span className="font-semibold text-zinc-700">Dibuat:</span> {generatedAt}
              </p>
              <p>
                <span className="font-semibold text-zinc-700">Mata uang:</span>{" "}
                {displayCurrency === "IDR" ? "IDR (Rupiah)" : "USD (Dolar)"}
              </p>
            </div>
          </header>

          {/* ---------- Ringkasan KPI ---------- */}
          <section className="print-avoid-break mt-6" aria-label="Ringkasan kinerja">
            <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-700">
              Ringkasan Kinerja
            </h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                {
                  label: "Total Perubahan",
                  value: s ? formatCurrency(s.totalChangeUsd) : "—",
                  sub: s ? formatPct(s.totalChangePct) : undefined,
                  cls: s ? pnlClass(s.totalChangeUsd) : "",
                },
                {
                  label: "Bulan Terbaik",
                  value: s?.bestMonth ? formatCurrency(s.bestMonth.changeUsd) : "—",
                  sub: s?.bestMonth ? formatMonthLabel(s.bestMonth.month) : undefined,
                  cls: "text-emerald-700",
                },
                {
                  label: "Bulan Terburuk",
                  value: s?.worstMonth ? formatCurrency(s.worstMonth.changeUsd) : "—",
                  sub: s?.worstMonth ? formatMonthLabel(s.worstMonth.month) : undefined,
                  cls: "text-rose-700",
                },
                {
                  label: "Rata-rata Bulanan",
                  value: s ? formatCurrency(s.avgMonthlyChangeUsd) : "—",
                  sub: "per bulan",
                  cls: s ? pnlClass(s.avgMonthlyChangeUsd) : "",
                },
              ].map((kpi) => (
                <div
                  key={kpi.label}
                  className="rounded-lg border border-zinc-200 bg-zinc-50 p-3"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                    {kpi.label}
                  </p>
                  <p
                    className={cn(
                      "mt-1 text-base font-bold tabular-nums leading-tight",
                      kpi.cls,
                    )}
                  >
                    {kpi.value}
                  </p>
                  {kpi.sub && (
                    <p className="mt-0.5 text-[11px] tabular-nums text-zinc-500">{kpi.sub}</p>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* ---------- Posisi portofolio saat ini ---------- */}
          {summary && (
            <section className="print-avoid-break mt-6" aria-label="Posisi portofolio saat ini">
              <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-700">
                Posisi Portofolio Saat Ini
              </h2>
              <div className="mb-3 flex flex-wrap items-baseline gap-x-6 gap-y-1">
                <p className="text-sm text-zinc-600">
                  Total Net Worth{" "}
                  <span className="text-lg font-bold tabular-nums text-zinc-900">
                    {formatCurrency(summary.netWorthUsd)}
                  </span>
                </p>
                <p className="text-xs tabular-nums text-zinc-500">
                  {summary.counts.assets} aset · {summary.counts.entities} entitas ·{" "}
                  {summary.counts.strategies} strategi
                </p>
              </div>
              {alloc.length > 0 && (
                <div className="space-y-2">
                  {alloc.map((a) => (
                    <div key={a.class} className="flex items-center gap-3">
                      <span className="w-28 shrink-0 truncate text-xs font-medium text-zinc-700">
                        {ASSET_CLASS_STYLE[a.class]?.label ?? a.class}
                      </span>
                      <div className="h-3 min-w-0 flex-1 overflow-hidden rounded bg-zinc-100">
                        <div
                          className="h-full rounded bg-emerald-600"
                          style={{ width: `${Math.max(4, (a.pct / allocMax) * 100)}%` }}
                        />
                      </div>
                      <span className="w-24 shrink-0 text-right text-xs tabular-nums text-zinc-600">
                        {formatCurrency(a.valueUsd, true)}
                      </span>
                      <span className="w-12 shrink-0 text-right text-xs font-semibold tabular-nums text-zinc-900">
                        {a.pct.toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* ---------- Benchmark ---------- */}
          {benchFinal.length > 0 && bs && (
            <section className="print-avoid-break mt-6" aria-label="Perbandingan benchmark">
              <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-700">
                Perbandingan Benchmark (Indeks 100 = Awal Periode)
              </h2>
              <table className="print-table w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-zinc-300 text-left">
                    <th className="py-1.5 pr-3 font-semibold text-zinc-600">Strategi</th>
                    <th className="py-1.5 pr-3 text-right font-semibold text-zinc-600">
                      Nilai Akhir
                    </th>
                    <th className="py-1.5 text-right font-semibold text-zinc-600">Return</th>
                  </tr>
                </thead>
                <tbody>
                  {benchFinal.map((b) => (
                    <tr key={b.label} className="border-b border-zinc-100">
                      <td className="py-1.5 pr-3 text-zinc-800">{b.label}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-800">
                        {b.final.toFixed(2)}
                      </td>
                      <td
                        className={cn(
                          "py-1.5 text-right font-semibold tabular-nums",
                          pnlClass(b.ret),
                        )}
                      >
                        {formatPct(b.ret)}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={3} className="pt-2 text-[11px] text-zinc-500">
                      Portofolio keluarga menang head-to-head vs Seimbang pada{" "}
                      <span className="font-semibold text-zinc-700 tabular-nums">
                        {bs.winningMonths}/{bs.totalMonths}
                      </span>{" "}
                      bulan · Terbaik periode: {bs.best?.label ?? "—"} (
                      {formatPct(bs.best?.pct ?? 0)}).
                    </td>
                  </tr>
                </tbody>
              </table>
            </section>
          )}

          {/* ---------- Rincian bulanan ---------- */}
          <section className="mt-6" aria-label="Rincian bulanan">
            <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-700">
              Rincian Bulanan
            </h2>
            {rows.length === 0 ? (
              <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-xs text-zinc-500">
                Belum ada data snapshot bulanan untuk periode ini.
              </p>
            ) : (
              <table className="print-table w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-zinc-300 text-left">
                    <th className="py-1.5 pr-2 font-semibold text-zinc-600">Bulan</th>
                    <th className="py-1.5 pr-2 text-right font-semibold text-zinc-600">Awal</th>
                    <th className="py-1.5 pr-2 text-right font-semibold text-zinc-600">Akhir</th>
                    <th className="py-1.5 pr-2 text-right font-semibold text-zinc-600">Δ ±</th>
                    <th className="py-1.5 pr-2 text-right font-semibold text-zinc-600">
                      Inflow
                    </th>
                    <th className="py-1.5 pr-2 text-right font-semibold text-zinc-600">
                      Outflow
                    </th>
                    <th className="py-1.5 pr-2 text-right font-semibold text-zinc-600">
                      Net Flow
                    </th>
                    <th className="py-1.5 text-right font-semibold text-zinc-600">Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => (
                    <tr key={m.month} className="border-b border-zinc-100">
                      <td className="py-1.5 pr-2 font-medium text-zinc-800">
                        {formatMonthLabel(m.month)}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums text-zinc-600">
                        {formatCurrency(m.startUsd, true)}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums text-zinc-800">
                        {formatCurrency(m.endUsd, true)}
                      </td>
                      <td
                        className={cn(
                          "py-1.5 pr-2 text-right font-medium tabular-nums",
                          pnlClass(m.changeUsd),
                        )}
                      >
                        {formatCurrency(m.changeUsd, true)}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums text-emerald-700">
                        {formatCurrency(m.inflowUsd, true)}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums text-rose-700">
                        {formatCurrency(m.outflowUsd, true)}
                      </td>
                      <td
                        className={cn(
                          "py-1.5 pr-2 text-right tabular-nums",
                          pnlClass(m.netFlowUsd),
                        )}
                      >
                        {formatCurrency(m.netFlowUsd, true)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-zinc-600">
                        {m.txCount}
                      </td>
                    </tr>
                  ))}
                  {/* Baris total */}
                  {s && (
                    <tr className="border-t-2 border-zinc-300 font-semibold">
                      <td className="py-2 pr-2 text-zinc-900">Total</td>
                      <td className="py-2 pr-2" />
                      <td className="py-2 pr-2" />
                      <td
                        className={cn(
                          "py-2 pr-2 text-right tabular-nums",
                          pnlClass(s.totalChangeUsd),
                        )}
                      >
                        {formatCurrency(s.totalChangeUsd, true)}
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums text-emerald-700">
                        {formatCurrency(s.totalInflowUsd, true)}
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums text-rose-700">
                        {formatCurrency(s.totalOutflowUsd, true)}
                      </td>
                      <td className="py-2 pr-2" />
                      <td className="py-2 text-right tabular-nums text-zinc-900">
                        {rows.reduce((acc, r) => acc + (r.txCount ?? 0), 0)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </section>

          {/* ---------- Catatan kaki ---------- */}
          <footer className="print-avoid-break mt-8 border-t border-zinc-200 pt-3 text-[10px] leading-relaxed text-zinc-500">
            <p>
              Laporan dihasilkan otomatis oleh Z Family Office pada {generatedAt}. Nilai
              portofolio bersumber dari snapshot bulanan & harga pasar engine internal
              (lingkungan sandbox) — bukan nasihat investasi.
            </p>
            <p className="mt-1 font-semibold uppercase tracking-wide text-zinc-600">
              Z Family Office — Internal Use Only
            </p>
          </footer>
        </div>
      </div>
    </div>,
    document.body,
  );
}
