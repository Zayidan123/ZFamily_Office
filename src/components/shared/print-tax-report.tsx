"use client";

// ============================================================
// Print Tax Report Overlay (ronde 10 — Task X-a)
// Pratinjau "Laporan Pajak Tahunan {year}" bergaya kertas A4 +
// ekspor PDF via window.print() (pola visibility .print-area,
// CSS pendukung di src/app/globals.css — sama dgn print-report).
//
// Sumber data: GET /tax/annual-report?year= (query di tax-view,
// enabled saat overlay terbuka). Kertas selalu putih agar hasil
// cetak konsisten di tema terang & gelap.
// ============================================================
import * as React from "react";
import { createPortal } from "react-dom";
import { Printer, X, FileText, Loader2 } from "lucide-react";
import { formatDate, formatDateTime } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import { useFormatCurrency } from "@/components/shared/kit";
import type { TaxAnnualReport } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const TYPE_LABELS: Record<string, string> = {
  "pajak penghasilan": "Pajak Penghasilan",
  "pajak properti": "Pajak Properti",
  "pajak kendaraan": "Pajak Kendaraan",
  lainnya: "Lainnya",
};

function typeLabel(t: string): string {
  return TYPE_LABELS[t] ?? t;
}

function StatusChip({ status }: { status: TaxAnnualReport["obligations"][number]["status"] }) {
  const map: Record<string, { text: string; cls: string }> = {
    paid: { text: "Lunas", cls: "text-emerald-700" },
    overdue: { text: "Terlambat", cls: "text-rose-700" },
    due_soon: { text: "Segera Jatuh Tempo", cls: "text-amber-700" },
    upcoming: { text: "Akan Datang", cls: "text-zinc-600" },
  };
  const s = map[status] ?? { text: status, cls: "text-zinc-600" };
  return (
    <span className={cn("font-semibold tabular-nums", s.cls)}>{s.text}</span>
  );
}

export interface PrintTaxReportProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  year: number;
  report: TaxAnnualReport | undefined;
  loading?: boolean;
}

export default function PrintTaxReport({
  open,
  onOpenChange,
  year,
  report,
  loading,
}: PrintTaxReportProps) {
  const formatCurrency = useFormatCurrency();
  const displayCurrency = useAppStore((s) => s.displayCurrency);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const restoreRef = React.useRef<HTMLElement | null>(null);

  // Body scroll lock + Escape + fokus awal (pola print-report)
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

  const totals = report?.totals;
  const byType = report?.byType ?? [];
  const rows = report?.obligations ?? [];
  const income = report?.income;
  const generatedAt = formatDateTime(new Date().toISOString());
  const typeMax = Math.max(1, ...byType.map((t) => t.totalUsd));

  return createPortal(
    <div
      className="print-overlay fixed inset-0 z-[90] overflow-auto bg-zinc-950/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Pratinjau laporan pajak tahunan ${year} untuk dicetak`}
    >
      {/* Toolbar (hanya layar) */}
      <div className="print-toolbar sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-white/10 bg-zinc-950/90 px-4 py-3 backdrop-blur lg:px-8">
        <div className="flex min-w-0 items-center gap-2 text-zinc-200">
          <FileText className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
          <p className="truncate text-sm font-medium">
            Pratinjau Laporan Pajak Tahunan — {year}
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
            aria-label="Tutup pratinjau laporan pajak"
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
                  Laporan Pajak Tahunan {year}
                </h1>
                <p className="text-xs text-zinc-500">
                  Z Family Office — Tax &amp; Kepatuhan Keluarga
                </p>
              </div>
            </div>
            <div className="text-right text-[11px] leading-relaxed text-zinc-500">
              <p>
                <span className="font-semibold text-zinc-700">Tahun:</span> {year}
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

          {loading || !report ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Memuat data laporan…
            </div>
          ) : (
            <>
              {/* ---------- Ringkasan KPI ---------- */}
              <section className="print-avoid-break mt-6" aria-label="Ringkasan pajak tahunan">
                <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-700">
                  Ringkasan {year}
                </h2>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {[
                    {
                      label: "Total Kewajiban",
                      value: formatCurrency(totals?.totalUsd ?? 0),
                      sub: `${totals?.count ?? 0} item tercatat`,
                      cls: "text-zinc-900",
                    },
                    {
                      label: "Terbayar",
                      value: formatCurrency(totals?.paidUsd ?? 0),
                      sub:
                        totals && totals.count > 0
                          ? `${rows.filter((r) => r.paid).length} dari ${totals.count} lunas`
                          : undefined,
                      cls: "text-emerald-700",
                    },
                    {
                      label: "Terutang",
                      value: formatCurrency(totals?.outstandingUsd ?? 0),
                      sub:
                        totals && totals.overdueCount > 0
                          ? `${totals.overdueCount} item terlambat!`
                          : "belum dibayar",
                      cls: totals && totals.overdueCount > 0 ? "text-rose-700" : "text-amber-700",
                    },
                    {
                      label: "Estimasi PPh Income",
                      value: formatCurrency(income?.estimatedTaxUsd ?? 0),
                      sub: `rate demo ${((income?.taxRate ?? 0) * 100).toFixed(0)}% × income`,
                      cls: "text-zinc-900",
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

              {/* ---------- Rekap per jenis ---------- */}
              {byType.length > 0 && (
                <section className="print-avoid-break mt-6" aria-label="Rekapitulasi per jenis pajak">
                  <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-700">
                    Rekapitulasi per Jenis
                  </h2>
                  <div className="space-y-2.5">
                    {byType.map((t) => (
                      <div key={t.type} className="flex items-center gap-3">
                        <span className="w-36 shrink-0 truncate text-xs font-medium text-zinc-700">
                          {typeLabel(t.type)}
                        </span>
                        <div className="relative h-3 min-w-0 flex-1 overflow-hidden rounded bg-zinc-100">
                          <div
                            className="h-full rounded bg-emerald-600"
                            style={{ width: `${Math.max(3, (t.totalUsd / typeMax) * 100)}%` }}
                          />
                          {t.paidUsd > 0 && (
                            <div
                              className="absolute inset-y-0 left-0 rounded bg-emerald-600/90"
                              style={{
                                width: `${Math.max(3, (t.paidUsd / typeMax) * 100)}%`,
                              }}
                              aria-hidden="true"
                            />
                          )}
                        </div>
                        <span className="w-24 shrink-0 text-right text-xs tabular-nums text-zinc-600">
                          {formatCurrency(t.totalUsd, true)}
                        </span>
                        <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-zinc-500">
                          {t.count} item
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[10px] text-zinc-500">
                    Bar terang = porsi sudah dibayar · nilai kanan = total tagihan tahun {year}.
                  </p>
                </section>
              )}

              {/* ---------- Rincian kewajiban ---------- */}
              <section className="mt-6" aria-label="Rincian kewajiban pajak">
                <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-700">
                  Rincian Kewajiban
                </h2>
                {rows.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-xs text-zinc-500">
                    Tidak ada kewajiban pajak yang tercatat untuk tahun {year}.
                  </p>
                ) : (
                  <table className="print-table w-full border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-zinc-300 text-left">
                        <th className="py-1.5 pr-2 font-semibold text-zinc-600">Kewajiban</th>
                        <th className="py-1.5 pr-2 font-semibold text-zinc-600">Jenis</th>
                        <th className="py-1.5 pr-2 font-semibold text-zinc-600">Periode</th>
                        <th className="py-1.5 pr-2 font-semibold text-zinc-600">Jatuh Tempo</th>
                        <th className="py-1.5 pr-2 text-right font-semibold text-zinc-600">
                          Jumlah
                        </th>
                        <th className="py-1.5 pr-2 font-semibold text-zinc-600">Status</th>
                        <th className="py-1.5 text-right font-semibold text-zinc-600">Dilunasi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((o) => (
                        <tr key={o.id} className="border-b border-zinc-100 align-top">
                          <td className="py-1.5 pr-2 font-medium text-zinc-800">{o.name}</td>
                          <td className="py-1.5 pr-2 text-zinc-600">{typeLabel(o.type)}</td>
                          <td className="py-1.5 pr-2 tabular-nums text-zinc-600">
                            {o.period || "—"}
                          </td>
                          <td className="py-1.5 pr-2 tabular-nums text-zinc-600">
                            {formatDate(o.dueDate)}
                          </td>
                          <td className="py-1.5 pr-2 text-right font-medium tabular-nums text-zinc-900">
                            {o.amountUsd !== null ? formatCurrency(o.amountUsd, true) : "—"}
                          </td>
                          <td className="py-1.5 pr-2">
                            <StatusChip status={o.status} />
                          </td>
                          <td className="py-1.5 text-right tabular-nums text-zinc-600">
                            {o.paidAt ? formatDate(o.paidAt) : "—"}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-zinc-300 font-semibold">
                        <td className="py-2 pr-2 text-zinc-900" colSpan={4}>
                          Total {year}
                        </td>
                        <td className="py-2 pr-2 text-right tabular-nums text-zinc-900">
                          {formatCurrency(totals?.totalUsd ?? 0, true)}
                        </td>
                        <td className="py-2 pr-2 text-zinc-600" colSpan={2} />
                      </tr>
                    </tbody>
                  </table>
                )}
              </section>

              {/* ---------- Catatan income ---------- */}
              <section
                className="print-avoid-break mt-6 rounded-lg border border-zinc-200 bg-zinc-50 p-4"
                aria-label="Estimasi penghasilan"
              >
                <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-700">
                  Estimasi Penghasilan {year}
                </h2>
                <div className="mt-2 flex flex-wrap gap-x-8 gap-y-1 text-xs text-zinc-600">
                  <p>
                    Income tercatat{" "}
                    <span className="font-semibold tabular-nums text-zinc-900">
                      {formatCurrency(income?.incomeUsd ?? 0)}
                    </span>
                  </p>
                  <p>
                    Rate demo{" "}
                    <span className="font-semibold tabular-nums text-zinc-900">
                      {(((income?.taxRate ?? 0) * 100) || 0).toFixed(0)}%
                    </span>
                  </p>
                  <p>
                    Estimasi PPh{" "}
                    <span className="font-semibold tabular-nums text-zinc-900">
                      {formatCurrency(income?.estimatedTaxUsd ?? 0)}
                    </span>
                  </p>
                </div>
                <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
                  Anggota tahun mengikuti token tahun pada kolom Periode, atau (bila Periode
                  kosong) tahun jatuh tempo. Income dihitung dari transaksi berjenis income
                  pada tahun {year}.
                </p>
              </section>
            </>
          )}

          {/* ---------- Catatan kaki ---------- */}
          <footer className="print-avoid-break mt-8 border-t border-zinc-200 pt-3 text-[10px] leading-relaxed text-zinc-500">
            <p>
              Laporan dihasilkan otomatis oleh Z Family Office pada {generatedAt}. Estimasi
              pajak memakai rate demo flat — bukan konsultasi pajak resmi; verifikasi ke
              konsultan pajak keluarga sebelum pelaporan.
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
