"use client";

// ============================================================
// Pajak & Kepatuhan — kewajiban pajak + reminder + ringkasan
// GET /tax/obligations · /tax/summary · /tax/annual-report?year=
// POST/PUT/DELETE /tax/obligations (owner) · PUT {paid} toggle lunas
// Grup: overdue & due_soon di atas · banner kepatuhan emerald
// Laporan Tahunan (PDF): overlay print (ronde 10 — Task X-a)
// ============================================================
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch, ApiError } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { formatDate, formatPct } from "@/lib/format";
import type { TaxAnnualReport } from "@/lib/types";
import PrintTaxReport from "@/components/shared/print-tax-report";
import {
  StatCard,
  PageHeader,
  SectionCard,
  EmptyState,
  LoadingRows,
  ErrorBox,
  CurrencyText,
  useFormatCurrency,
  ConfirmButton,
} from "@/components/shared/kit";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  ReceiptText,
  Plus,
  Loader2,
  Check,
  RotateCcw,
  Trash2,
  Wallet,
  Landmark,
  AlertTriangle,
  CalendarClock,
  ShieldCheck,
  Printer,
} from "lucide-react";

// ------------------------------------------------------------
// Types (inline sesuai kontrak R-b — types.ts tidak diubah)
// ------------------------------------------------------------
type TaxStatus = "paid" | "overdue" | "due_soon" | "upcoming";

interface TaxObligation {
  id: number;
  name: string;
  type: string;
  period: string | null;
  dueDate: string;
  amountUsd: number | null;
  paid: boolean; // backend kirim JSON bool (kontrak 0|1 dinormalisasi)
  paidAt: string | null;
  notes: string | null;
  status: TaxStatus;
}

interface TaxSummary {
  estimatedAnnualIncomeUsd: number;
  estimatedTaxUsd: number;
  paidCount: number;
  upcomingCount: number;
  dueSoonCount: number;
  overdueCount: number;
  nextDue: { name: string; dueDate: string; amountUsd: number | null } | null;
}

// ------------------------------------------------------------
// Enum type kewajiban — sesuai implementasi backend
// (type berupa string label Indonesia lowercase)
// ------------------------------------------------------------
const TAX_TYPES: { key: string; label: string }[] = [
  { key: "pajak penghasilan", label: "Pajak Penghasilan" },
  { key: "pajak properti", label: "Pajak Properti" },
  { key: "pajak kendaraan", label: "Pajak Kendaraan" },
  { key: "lainnya", label: "Lainnya" },
];

function taxTypeLabel(type: string): string {
  return TAX_TYPES.find((t) => t.key === type)?.label ?? type;
}

const FILTERS: { key: "all" | TaxStatus; label: string }[] = [
  { key: "all", label: "Semua" },
  { key: "upcoming", label: "Upcoming" },
  { key: "due_soon", label: "Due Soon" },
  { key: "overdue", label: "Overdue" },
  { key: "paid", label: "Paid" },
];

const STATUS_RANK: Record<TaxStatus, number> = {
  overdue: 0,
  due_soon: 1,
  upcoming: 2,
  paid: 3,
};

/** Selisih hari (dueDate YYYY-MM-DD vs hari ini, tanpa jam) */
function daysUntil(dueDate: string): number {
  const due = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(due.getTime())) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

function DueBadge({ status, dueDate }: { status: TaxStatus; dueDate: string }) {
  const d = daysUntil(dueDate);
  let text: string;
  let cls: string;
  if (status === "paid") {
    text = "Lunas";
    cls = "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  } else if (status === "overdue") {
    text = `Terlambat ${Math.max(1, -d)} hari`;
    cls = "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400";
  } else if (status === "due_soon") {
    text = d === 0 ? "Hari ini!" : `${Math.max(0, d)} hari lagi`;
    cls = "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400";
  } else {
    text = d === 0 ? "Hari ini" : d === 1 ? "Besok" : `${d} hari lagi`;
    cls = "border-zinc-500/40 bg-zinc-500/10 text-zinc-600 dark:text-zinc-300";
  }
  return (
    <Badge variant="outline" className={cn("tabular-nums", cls)}>
      {text}
    </Badge>
  );
}

// ------------------------------------------------------------
// Dialog "+ Kewajiban" (owner)
// ------------------------------------------------------------
function AddObligationDialog({
  open,
  onOpenChange,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pending: boolean;
  onSubmit: (body: {
    name: string;
    type: string;
    period?: string;
    dueDate: string;
    amountUsd?: number;
    notes?: string;
  }) => void;
}) {
  const [name, setName] = React.useState("");
  const [type, setType] = React.useState("pajak penghasilan");
  const [period, setPeriod] = React.useState("");
  const [dueDate, setDueDate] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [errors, setErrors] = React.useState<{ name?: string; dueDate?: string }>({});

  React.useEffect(() => {
    if (open) {
      setName("");
      setType("pajak penghasilan");
      setPeriod("");
      setDueDate("");
      setAmount("");
      setNotes("");
      setErrors({});
    }
  }, [open]);

  const submit = () => {
    const nextErrors: { name?: string; dueDate?: string } = {};
    if (!name.trim()) nextErrors.name = "Nama kewajiban wajib diisi";
    if (!dueDate) nextErrors.dueDate = "Tanggal jatuh tempo wajib diisi";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    const amountNum = Number(amount);
    onSubmit({
      name: name.trim(),
      type,
      period: period.trim() || undefined,
      dueDate,
      amountUsd: amount !== "" && Number.isFinite(amountNum) ? amountNum : undefined,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Tambah Kewajiban Pajak</DialogTitle>
          <DialogDescription>
            Catat kewajiban pajak beserta jatuh tempo untuk reminder kepatuhan.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tax-name">Nama kewajiban *</Label>
            <Input
              id="tax-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="mis. PPh Final Properti"
              aria-invalid={Boolean(errors.name)}
            />
            {errors.name && <p className="text-xs text-rose-600 dark:text-rose-400">{errors.name}</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Jenis</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="w-full" aria-label="Jenis pajak">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TAX_TYPES.map((t) => (
                    <SelectItem key={t.key} value={t.key}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tax-period">Periode</Label>
              <Input
                id="tax-period"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                placeholder="mis. Q1 2026 / 2026"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="tax-due">Jatuh tempo *</Label>
              <Input
                id="tax-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                aria-invalid={Boolean(errors.dueDate)}
              />
              {errors.dueDate && <p className="text-xs text-rose-600 dark:text-rose-400">{errors.dueDate}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="tax-amount">Estimasi jumlah (USD)</Label>
              <Input
                id="tax-amount"
                type="number"
                min="0"
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="mis. 2500"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tax-notes">Catatan</Label>
            <Textarea
              id="tax-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="opsional — mis. rekening tujuan, NPWP, dll."
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button
            type="button"
            className="bg-emerald-600 text-primary-foreground hover:bg-emerald-700"
            disabled={pending}
            onClick={submit}
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="h-4 w-4" aria-hidden="true" />
            )}
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------
// TaxView
// ------------------------------------------------------------
export default function TaxView() {
  const queryClient = useQueryClient();
  const user = useAppStore((s) => s.user);
  const isOwner = user?.role === "owner";
  // Executor tanpa akses baca pajak (403) — kontrol laporan disembunyikan
  const isExecutor = user?.role === "executor";
  const formatCurrency = useFormatCurrency();

  const [filter, setFilter] = React.useState<"all" | TaxStatus>("all");
  const [addOpen, setAddOpen] = React.useState(false);
  const currentYear = React.useMemo(() => new Date().getFullYear(), []);
  const [reportYear, setReportYear] = React.useState<number>(currentYear);
  const [printOpen, setPrintOpen] = React.useState(false);

  // ---------- Queries ----------
  const obligationsQuery = useQuery<TaxObligation[], ApiError>({
    queryKey: ["tax", "obligations"],
    queryFn: () => apiFetch<TaxObligation[]>("/tax/obligations"),
    refetchInterval: 60_000,
    staleTime: 50_000,
  });

  const summaryQuery = useQuery<TaxSummary, ApiError>({
    queryKey: ["tax", "summary"],
    queryFn: () => apiFetch<TaxSummary>("/tax/summary"),
    refetchInterval: 60_000,
    staleTime: 50_000,
  });

  // Laporan pajak tahunan (murah — muat sejak awal agar Select tahun siap)
  const annualQuery = useQuery<TaxAnnualReport, ApiError>({
    queryKey: ["tax", "annual", reportYear],
    queryFn: () =>
      apiFetch<TaxAnnualReport>("/tax/annual-report", { params: { year: reportYear } }),
    enabled: !isExecutor,
    staleTime: 50_000,
    retry: false,
  });

  const obligations = obligationsQuery.data ?? [];
  const summary = summaryQuery.data;
  const annual = annualQuery.data;
  const yearOptions = React.useMemo(() => {
    const set = new Set<number>(annual?.availableYears ?? []);
    set.add(currentYear);
    return [...set].sort((a, b) => b - a);
  }, [annual?.availableYears, currentYear]);

  // ---------- Mutations ----------
  const invalidateTax = () => {
    void queryClient.invalidateQueries({ queryKey: ["tax", "obligations"] });
    void queryClient.invalidateQueries({ queryKey: ["tax", "summary"] });
    void queryClient.invalidateQueries({ queryKey: ["tax", "annual"] });
  };

  const addMutation = useMutation({
    mutationFn: (body: {
      name: string;
      type: string;
      period?: string;
      dueDate: string;
      amountUsd?: number;
      notes?: string;
    }) => apiFetch<TaxObligation>("/tax/obligations", { method: "POST", body }),
    onSuccess: () => {
      toast.success("Kewajiban pajak ditambahkan");
      setAddOpen(false);
      invalidateTax();
    },
    onError: (err) => {
      toast.error("Gagal menambah kewajiban", {
        description: err instanceof ApiError ? err.message : "Coba lagi sebentar",
      });
    },
  });

  const togglePaidMutation = useMutation({
    mutationFn: ({ id, paid }: { id: number; paid: boolean }) =>
      apiFetch<TaxObligation>(`/tax/obligations/${id}`, {
        method: "PUT",
        body: { paid },
      }),
    onSuccess: (_d, vars) => {
      toast.success(
        vars.paid ? "Kewajiban ditandai lunas" : "Kewajiban dibuka kembali",
      );
      invalidateTax();
    },
    onError: (err) => {
      toast.error("Gagal memperbarui status", {
        description: err instanceof ApiError ? err.message : "Coba lagi sebentar",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch<void>(`/tax/obligations/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Kewajiban dihapus");
      invalidateTax();
    },
    onError: (err) => {
      toast.error("Gagal menghapus kewajiban", {
        description: err instanceof ApiError ? err.message : "Coba lagi sebentar",
      });
    },
  });

  // ---------- Derived ----------
  const sorted = React.useMemo(() => {
    const filtered =
      filter === "all" ? obligations : obligations.filter((o) => o.status === filter);
    const active = filtered
      .filter((o) => o.status !== "paid")
      .sort(
        (a, b) =>
          STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
          a.dueDate.localeCompare(b.dueDate),
      );
    const paid = filtered
      .filter((o) => o.status === "paid")
      .sort((a, b) => (b.paidAt ?? "").localeCompare(a.paidAt ?? ""));
    return [...active, ...paid];
  }, [obligations, filter]);

  const hasUrgent = obligations.some(
    (o) => o.status === "overdue" || o.status === "due_soon",
  );

  const loadingAll = obligationsQuery.isPending && !obligationsQuery.data;
  const loadingSummary = summaryQuery.isPending && !summaryQuery.data;
  const errMsg =
    obligationsQuery.error instanceof ApiError
      ? obligationsQuery.error.message
      : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pajak & Kepatuhan"
        subtitle="Kewajiban pajak, jatuh tempo, dan reminder kepatuhan keluarga."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {!isExecutor && (
              <>
                <Select
                  value={String(reportYear)}
                  onValueChange={(v) => setReportYear(Number(v))}
                >
                  <SelectTrigger
                    className="h-9 w-[112px]"
                    aria-label="Tahun laporan pajak"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {yearOptions.map((y) => (
                      <SelectItem key={y} value={String(y)}>
                        Tahun {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="min-h-[40px] gap-2 border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400"
                  aria-label={`Buka pratinjau laporan pajak tahunan ${reportYear}`}
                  onClick={() => setPrintOpen(true)}
                >
                  <Printer className="h-4 w-4" aria-hidden="true" />
                  Laporan PDF
                </Button>
              </>
            )}
            {isOwner && (
              <Button
                type="button"
                size="sm"
                className="min-h-[40px] bg-emerald-600 text-primary-foreground hover:bg-emerald-700"
                onClick={() => setAddOpen(true)}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Kewajiban
              </Button>
            )}
          </div>
        }
      />

      {obligationsQuery.isError && !obligationsQuery.data && (
        <ErrorBox message={errMsg} onRetry={() => void obligationsQuery.refetch()} />
      )}

      {/* ---------- StatCards ---------- */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          loading={loadingSummary}
          label="Estimasi Income Tahun Ini"
          value={summary ? formatCurrency(summary.estimatedAnnualIncomeUsd) : "—"}
          sub="dari aset & aktivitas tercatat"
          icon={<Wallet className="h-5 w-5" />}
        />
        <StatCard
          loading={loadingSummary}
          label="Estimasi Pajak"
          value={summary ? formatCurrency(summary.estimatedTaxUsd) : "—"}
          sub="asumsi rate demo 5% dari income"
          accent="amber"
          icon={<Landmark className="h-5 w-5" />}
        />
        <StatCard
          loading={loadingSummary}
          label="Overdue"
          value={summary ? `${summary.overdueCount}` : "—"}
          accent={summary && summary.overdueCount > 0 ? "rose" : "default"}
          sub={
            summary && summary.overdueCount > 0
              ? "segera lunasi!"
              : "tidak ada kewajiban terlambat"
          }
          icon={<AlertTriangle className="h-5 w-5" />}
        />
        <StatCard
          loading={loadingSummary}
          label="Next Due"
          value={summary?.nextDue ? summary.nextDue.name : "—"}
          sub={
            summary?.nextDue
              ? `${formatDate(summary.nextDue.dueDate)}${
                  summary.nextDue.amountUsd !== null
                    ? ` · ${formatCurrency(summary.nextDue.amountUsd, true)}`
                    : ""
                }`
              : "tidak ada antrean jatuh tempo"
          }
          icon={<CalendarClock className="h-5 w-5" />}
        />
      </div>

      {/* ---------- Banner kepatuhan ---------- */}
      {!loadingAll && obligations.length > 0 && !hasUrgent && (
        <div
          role="status"
          className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3"
        >
          <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
            Semua kewajiban lancar ✓ — tidak ada yang terlambat atau jatuh tempo dekat.
          </p>
        </div>
      )}

      {/* ---------- Toolbar ---------- */}
      <SectionCard
        title="Daftar Kewajiban"
        description={
          filter === "all"
            ? "Overdue & due soon tampil di atas"
            : `Filter: ${FILTERS.find((f) => f.key === filter)?.label}`
        }
        actions={
          <Select value={filter} onValueChange={(v) => setFilter(v as "all" | TaxStatus)}>
            <SelectTrigger className="h-9 w-[150px]" aria-label="Filter status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FILTERS.map((f) => (
                <SelectItem key={f.key} value={f.key}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      >
        {loadingAll ? (
          <LoadingRows rows={5} />
        ) : sorted.length === 0 ? (
          <EmptyState
            icon={<ReceiptText className="h-6 w-6" />}
            title={
              obligations.length === 0
                ? "Belum ada kewajiban pajak"
                : "Tidak ada kewajiban pada filter ini"
            }
            description={
              obligations.length === 0
                ? isOwner
                  ? "Tambahkan kewajiban pajak untuk mulai memantau jatuh tempo & kepatuhan."
                  : "Owner dapat menambahkan kewajiban pajak di sini."
                : "Coba pilih filter status lain."
            }
            action={
              isOwner &&
              obligations.length === 0 && (
                <Button
                  type="button"
                  size="sm"
                  className="bg-emerald-600 text-primary-foreground hover:bg-emerald-700"
                  onClick={() => setAddOpen(true)}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Kewajiban
                </Button>
              )
            }
          />
        ) : (
          <ul className="divide-y" aria-label="Daftar kewajiban pajak">
            {sorted.map((o) => (
              <li
                key={o.id}
                className={cn(
                  "flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center",
                  o.status === "overdue" && "-mx-2 rounded-lg bg-rose-500/5 px-2",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium">{o.name}</p>
                    <Badge variant="outline" className="text-[10px]">
                      {taxTypeLabel(o.type)}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {o.period ? `${o.period} · ` : ""}Jatuh tempo {formatDate(o.dueDate)}
                    {o.status === "paid" && o.paidAt
                      ? ` · dilunasi ${formatDate(o.paidAt)}`
                      : ""}
                  </p>
                  {o.notes && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground/70">
                      {o.notes}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <DueBadge status={o.status} dueDate={o.dueDate} />
                </div>

                <div className="w-32 shrink-0 text-right text-sm font-medium tabular-nums">
                  {o.amountUsd !== null ? (
                    <CurrencyText usd={o.amountUsd} />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </div>

                {isOwner && (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-[36px]"
                      disabled={togglePaidMutation.isPending}
                      onClick={() =>
                        togglePaidMutation.mutate({ id: o.id, paid: !o.paid })
                      }
                    >
                      {togglePaidMutation.isPending &&
                      togglePaidMutation.variables?.id === o.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : o.paid ? (
                        <RotateCcw className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Check className="h-4 w-4" aria-hidden="true" />
                      )}
                      {o.paid ? "Buka Lunas" : "Tandai Lunas"}
                    </Button>
                    <ConfirmButton
                      size="icon"
                      variant="ghost"
                      confirmLabel="?"
                      title={`Hapus ${o.name}`}
                      className="h-9 w-9 text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400"
                      onConfirm={() => deleteMutation.mutate(o.id)}
                      disabled={deleteMutation.isPending}
                    >
                      {deleteMutation.isPending && deleteMutation.variables === o.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      )}
                    </ConfirmButton>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* ---------- Ringkasan kecil ---------- */}
      {summary && (
        <p className="text-xs text-muted-foreground">
          Ringkasan: {summary.paidCount} lunas · {summary.upcomingCount} upcoming ·{" "}
          {summary.dueSoonCount} due soon · {summary.overdueCount} overdue · estimasi
          pajak {formatCurrency(summary.estimatedTaxUsd, true)} (
          {formatPct(
            summary.estimatedAnnualIncomeUsd > 0
              ? (summary.estimatedTaxUsd / summary.estimatedAnnualIncomeUsd) * 100
              : 0,
            false,
            1)}
          )
        </p>
      )}

      <AddObligationDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        pending={addMutation.isPending}
        onSubmit={(body) => addMutation.mutate(body)}
      />

      <PrintTaxReport
        open={printOpen}
        onOpenChange={setPrintOpen}
        year={reportYear}
        report={annual}
        loading={annualQuery.isPending && !annual}
      />
    </div>
  );
}
