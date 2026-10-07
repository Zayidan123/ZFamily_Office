"use client";

// ============================================================
// View: Transaksi — Task 2-a
// Filter type/asset · StatCard arus masuk/keluar · tabel riwayat
// Dialog catat transaksi (RHF + zod, validasi qty client-side)
// RBAC: hanya owner bisa mencatat transaksi
// ============================================================
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useAppStore } from "@/lib/store";
import { apiFetch, apiGetBlob, ApiError } from "@/lib/api";
import { formatNumber, formatDate, timeAgo } from "@/lib/format";
import {
  useFormatCurrency,
  PageHeader,
  SectionCard,
  EmptyState,
  LoadingRows,
  ErrorBox,
  ClassBadge,
  StatCard,
} from "@/components/shared/kit";
import type { Asset, Transaction, TransactionType } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Plus,
  Loader2,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  Scale,
  Info,
  Download,
  type LucideIcon,
} from "lucide-react";

// ------------------------------------------------------------
// Konstanta
// ------------------------------------------------------------
const TX_TYPE_META: Record<
  TransactionType,
  { label: string; badge: string; dir: "in" | "out" | "neutral"; icon: LucideIcon }
> = {
  buy: {
    label: "Beli",
    badge: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    dir: "in",
    icon: ArrowDownLeft,
  },
  sell: {
    label: "Jual",
    badge: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400",
    dir: "out",
    icon: ArrowUpRight,
  },
  transfer_in: {
    label: "Transfer Masuk",
    badge: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    dir: "in",
    icon: ArrowDownLeft,
  },
  transfer_out: {
    label: "Transfer Keluar",
    badge: "border-zinc-500/40 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
    dir: "out",
    icon: ArrowUpRight,
  },
  income: {
    label: "Pemasukan",
    badge: "border-emerald-500/40 bg-transparent text-emerald-700 dark:text-emerald-400",
    dir: "in",
    icon: ArrowDownLeft,
  },
  expense: {
    label: "Pengeluaran",
    badge: "border-rose-500/40 bg-transparent text-rose-700 dark:text-rose-400",
    dir: "out",
    icon: ArrowUpRight,
  },
  valuation_update: {
    label: "Update Nilai",
    badge: "border-zinc-500/40 bg-zinc-500/10 text-zinc-600 dark:text-zinc-300",
    dir: "neutral",
    icon: Scale,
  },
};

const TX_TYPE_OPTIONS = Object.entries(TX_TYPE_META).map(([value, m]) => ({
  value: value as TransactionType,
  label: m.label,
}));

const INFLOW_TYPES: TransactionType[] = ["buy", "transfer_in", "income"];
const OUTFLOW_TYPES: TransactionType[] = ["sell", "transfer_out", "expense"];

function txMeta(t: string) {
  return TX_TYPE_META[t as TransactionType] ?? {
    label: t,
    badge: "border-zinc-500/40 bg-zinc-500/10 text-zinc-600 dark:text-zinc-300",
    dir: "neutral" as const,
    icon: Scale,
  };
}

function errMsg(err: unknown): string {
  return err instanceof ApiError ? err.message : "Backend belum terjangkau — mencoba lagi";
}

/** datetime-local value untuk "sekarang" (zona lokal) */
function nowLocalInput(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function TypeBadge({ type }: { type: string }) {
  const meta = txMeta(type);
  return (
    <Badge variant="outline" className={cn("max-w-full", meta.badge)}>
      {meta.label}
    </Badge>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs font-medium text-rose-600 dark:text-rose-400">{message}</p>;
}

/** Sel mata uang (hormati display currency store) */
function MoneyCell({
  usd,
  sign,
  className,
}: {
  usd: number;
  sign?: "+" | "−";
  className?: string;
}) {
  const format = useFormatCurrency();
  return (
    <span className={cn("tabular-nums", className)}>
      {sign}
      {format(Math.abs(usd))}
    </span>
  );
}

// ------------------------------------------------------------
// Skema form transaksi (string-based; konversi saat submit)
// ------------------------------------------------------------
const numberString = (label: string) =>
  z
    .string()
    .min(1, `${label} wajib diisi`)
    .refine((v) => !Number.isNaN(Number(v)), `${label} harus berupa angka`)
    .refine((v) => Number(v) >= 0, `${label} tidak boleh negatif`);

const txFormSchema = z.object({
  assetId: z.string().min(1, "Pilih aset"),
  type: z.string().min(1, "Pilih jenis transaksi"),
  quantity: numberString("Jumlah"),
  price: numberString("Harga"),
  fee: z
    .string()
    .refine((v) => v === "" || !Number.isNaN(Number(v)), "Fee harus berupa angka")
    .refine((v) => v === "" || Number(v) >= 0, "Fee tidak boleh negatif"),
  at: z
    .string()
    .refine((v) => v === "" || !Number.isNaN(new Date(v).getTime()), "Tanggal tidak valid"),
  note: z.string().max(1000, "Catatan maksimal 1000 karakter"),
});
type TxFormValues = z.infer<typeof txFormSchema>;

const EMPTY_TX_FORM: TxFormValues = {
  assetId: "",
  type: "",
  quantity: "",
  price: "",
  fee: "",
  at: "",
  note: "",
};

// ------------------------------------------------------------
// Dialog Catat Transaksi
// ------------------------------------------------------------
function TxFormDialog({
  open,
  onOpenChange,
  assets,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  assets: Asset[];
}) {
  const queryClient = useQueryClient();
  const form = useForm<TxFormValues>({
    resolver: zodResolver(txFormSchema),
    defaultValues: { ...EMPTY_TX_FORM, at: nowLocalInput() },
  });

  const typeWatch = useWatch({ control: form.control, name: "type", defaultValue: "" });
  const assetIdWatch = useWatch({ control: form.control, name: "assetId", defaultValue: "" });
  const type = (typeWatch ?? "") as TransactionType | "";
  const selectedAsset = assets.find((a) => String(a.id) === assetIdWatch) ?? null;

  React.useEffect(() => {
    if (!open) return;
    form.reset({ ...EMPTY_TX_FORM, at: nowLocalInput() });
  }, [open, form]);

  const createMutation = useMutation({
    mutationFn: (values: TxFormValues) => {
      const body: Record<string, unknown> = {
        assetId: Number(values.assetId),
        type: values.type,
        quantity: Number(values.quantity),
        price: Number(values.price),
        fee: values.fee === "" ? 0 : Number(values.fee),
        note: values.note.trim(),
      };
      if (values.at) {
        const d = new Date(values.at);
        if (!Number.isNaN(d.getTime())) body.at = d.toISOString();
      }
      return apiFetch<Transaction>("/transactions", { method: "POST", body });
    },
    onSuccess: (tx) => {
      toast.success("Transaksi berhasil dicatat", {
        description: `${txMeta(tx.type).label} · ${tx.assetName ?? "aset"} · ${formatNumber(tx.quantity, 6)}`,
      });
      void queryClient.invalidateQueries({ queryKey: ["transactions"] });
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error("Gagal mencatat transaksi", { description: errMsg(err) });
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    // Validasi client-side terkait tipe & ketersediaan aset
    const t = values.type as TransactionType;
    const qty = Number(values.quantity);
    if (["buy", "sell", "transfer_in", "transfer_out"].includes(t) && qty <= 0) {
      form.setError("quantity", { message: "Jumlah harus lebih dari 0 untuk jenis transaksi ini" });
      return;
    }
    if (t === "sell" || t === "transfer_out") {
      const asset = assets.find((a) => String(a.id) === values.assetId);
      if (asset && qty > asset.quantity + 1e-9) {
        form.setError("quantity", {
          message: `Melebihi jumlah tersedia (${formatNumber(asset.quantity, 6)})`,
        });
        return;
      }
    }
    createMutation.mutate(values);
  });

  const needsPositiveQty =
    type === "buy" || type === "sell" || type === "transfer_in" || type === "transfer_out";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto scrollbar-thin sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Catat Transaksi</DialogTitle>
          <DialogDescription>
            Beli/jual otomatis menyesuaikan jumlah aset. Harga &amp; fee mengikuti mata uang aset.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="grid gap-1.5">
            <Label>Aset *</Label>
            <Controller
              control={form.control}
              name="assetId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Pilih aset" />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    {assets.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        Belum ada aset — tambahkan aset terlebih dahulu
                      </div>
                    ) : (
                      assets.map((a) => (
                        <SelectItem key={String(a.id)} value={String(a.id)}>
                          {a.name}
                          {a.symbol ? ` (${a.symbol})` : ""}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              )}
            />
            {selectedAsset && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <ClassBadge assetClass={selectedAsset.assetClass} className="px-1.5 text-[10px]" />
                <span>
                  Mata uang: <span className="font-medium">{selectedAsset.currency}</span>
                </span>
                <span>
                  Tersedia:{" "}
                  <span className="font-medium tabular-nums">
                    {formatNumber(selectedAsset.quantity, 6)}
                    {selectedAsset.symbol ? ` ${selectedAsset.symbol}` : ""}
                  </span>
                </span>
              </div>
            )}
            <FieldError message={form.formState.errors.assetId?.message} />
          </div>

          <div className="grid gap-1.5">
            <Label>Jenis Transaksi *</Label>
            <Controller
              control={form.control}
              name="type"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Pilih jenis" />
                  </SelectTrigger>
                  <SelectContent>
                    {TX_TYPE_OPTIONS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {type === "valuation_update" && (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                Harga baru akan diterapkan sebagai harga satuan aset.
              </p>
            )}
            <FieldError message={form.formState.errors.type?.message} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="tx-quantity">Jumlah *</Label>
              <Input
                id="tx-quantity"
                type="number"
                step="any"
                min="0"
                inputMode="decimal"
                placeholder={needsPositiveQty ? "cth. 0.25" : "cth. 0"}
                {...form.register("quantity")}
              />
              <FieldError message={form.formState.errors.quantity?.message} />
            </div>

            <div className="grid gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="tx-price">Harga Satuan *</Label>
                {selectedAsset && (
                  <span className="rounded-md border bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                    {selectedAsset.currency}
                  </span>
                )}
              </div>
              <Input
                id="tx-price"
                type="number"
                step="any"
                min="0"
                inputMode="decimal"
                placeholder="cth. 65000"
                {...form.register("price")}
              />
              <FieldError message={form.formState.errors.price?.message} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="tx-fee">Fee</Label>
              <Input
                id="tx-fee"
                type="number"
                step="any"
                min="0"
                inputMode="decimal"
                placeholder="cth. 1.5 (opsional)"
                {...form.register("fee")}
              />
              <FieldError message={form.formState.errors.fee?.message} />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="tx-at">Tanggal &amp; Jam</Label>
              <Input id="tx-at" type="datetime-local" {...form.register("at")} />
              <FieldError message={form.formState.errors.at?.message} />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="tx-note">Catatan</Label>
            <Textarea
              id="tx-note"
              rows={3}
              placeholder="cth. DCA mingguan via Binance (opsional)"
              {...form.register("note")}
            />
            <FieldError message={form.formState.errors.note?.message} />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createMutation.isPending}
            >
              Batal
            </Button>
            <Button
              type="submit"
              className="bg-emerald-600 text-primary-foreground hover:bg-emerald-700"
              disabled={createMutation.isPending || assets.length === 0}
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Simpan Transaksi
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------
// TransactionsView
// ------------------------------------------------------------
export default function TransactionsView() {
  const user = useAppStore((s) => s.user);
  const isOwner = user?.role === "owner";
  // Ekspor CSV: owner & advisor (S-b)
  const canExportCsv = user?.role === "owner" || user?.role === "advisor";
  const formatCurrency = useFormatCurrency();

  // ---------- filter state ----------
  const [typeFilter, setTypeFilter] = React.useState("all");
  const [assetFilter, setAssetFilter] = React.useState("all");
  const [formOpen, setFormOpen] = React.useState(false);

  // ---------- Ekspor CSV (Task S-b) ----------
  const exportCsvM = useMutation({
    mutationFn: async () => {
      const blob = await apiGetBlob("/transactions/export.csv");
      const now = new Date();
      const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
        now.getDate(),
      ).padStart(2, "0")}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `transaksi-${stamp}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return blob.size;
    },
    onSuccess: (size) =>
      toast.success("Ekspor CSV berhasil diunduh", {
        description: `transaksi-*.csv · ${(size / 1024).toFixed(1)} KB`,
      }),
    onError: (e) =>
      toast.error("Gagal mengekspor CSV", {
        description: e instanceof ApiError ? e.message : "Backend belum terjangkau — mencoba lagi",
      }),
  });

  // ---------- queries ----------
  const assetsQuery = useQuery<Asset[], ApiError>({
    queryKey: ["assets", "options"],
    queryFn: () => apiFetch<Asset[]>("/assets"),
    staleTime: 30_000,
  });
  const assets = assetsQuery.data ?? [];

  const txParams = {
    assetId: assetFilter !== "all" ? assetFilter : undefined,
    type: typeFilter !== "all" ? typeFilter : undefined,
    limit: 200,
  };
  const txQuery = useQuery<Transaction[], ApiError>({
    queryKey: ["transactions", { assetId: txParams.assetId ?? null, type: txParams.type ?? null }],
    queryFn: () =>
      apiFetch<Transaction[]>("/transactions", {
        params: { assetId: txParams.assetId, type: txParams.type, limit: 200 },
      }),
    staleTime: 30_000,
  });

  const txs = React.useMemo(() => {
    const rows = txQuery.data ?? [];
    return [...rows].sort((a, b) => {
      const d = (b.at ?? "").localeCompare(a.at ?? "");
      return d !== 0 ? d : String(b.id).localeCompare(String(a.id));
    });
  }, [txQuery.data]);

  const stats = React.useMemo(() => {
    let inflow = 0;
    let outflow = 0;
    for (const tx of txs) {
      if (INFLOW_TYPES.includes(tx.type)) inflow += Math.abs(tx.totalUsd ?? 0);
      else if (OUTFLOW_TYPES.includes(tx.type)) outflow += Math.abs(tx.totalUsd ?? 0);
    }
    return { inflow, outflow, count: txs.length };
  }, [txs]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transaksi"
        subtitle="Riwayat buy/sell, transfer, income/expense, dan valuation update."
      />

      {/* ================= StatCards arus kas ================= */}
      <div className="grid gap-4 sm:grid-cols-3" aria-busy={txQuery.isPending && txs.length === 0}>
        <StatCard
          loading={txQuery.isPending && txs.length === 0}
          label="Total Masuk"
          value={formatCurrency(stats.inflow)}
          sub="beli · transfer masuk · pemasukan"
          icon={<ArrowDownLeft className="h-5 w-5" />}
        />
        <StatCard
          loading={txQuery.isPending && txs.length === 0}
          label="Total Keluar"
          value={formatCurrency(stats.outflow)}
          sub="jual, transfer keluar, pengeluaran"
          accent="rose"
          icon={<ArrowUpRight className="h-5 w-5" />}
        />
        <StatCard
          loading={txQuery.isPending && txs.length === 0}
          label="Jumlah Transaksi"
          value={String(stats.count)}
          sub={`hingga ${txParams.limit} terakhir terfilter`}
          accent="amber"
          icon={<ArrowLeftRight className="h-5 w-5" />}
        />
      </div>

      {/* ================= Toolbar ================= */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-full sm:w-[190px]" aria-label="Filter jenis transaksi">
              <SelectValue placeholder="Semua Jenis" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Jenis</SelectItem>
              {TX_TYPE_OPTIONS.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={assetFilter} onValueChange={setAssetFilter}>
            <SelectTrigger className="w-full sm:w-[230px]" aria-label="Filter aset">
              <SelectValue placeholder="Semua Aset" />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              <SelectItem value="all">Semua Aset</SelectItem>
              {assets.map((a) => (
                <SelectItem key={String(a.id)} value={String(a.id)}>
                  {a.name}
                  {a.symbol ? ` (${a.symbol})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {(isOwner || canExportCsv) && (
          <div className="flex flex-wrap items-center gap-2">
            {canExportCsv && (
              <Button
                type="button"
                variant="outline"
                className="min-h-[40px]"
                onClick={() => exportCsvM.mutate()}
                disabled={exportCsvM.isPending}
                title="Unduh seluruh riwayat transaksi sebagai file CSV"
              >
                {exportCsvM.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Download className="h-4 w-4" aria-hidden="true" />
                )}
                Ekspor CSV
              </Button>
            )}
            {isOwner && (
              <Button
                type="button"
                onClick={() => setFormOpen(true)}
                className="bg-emerald-600 text-primary-foreground hover:bg-emerald-700"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Catat Transaksi
              </Button>
            )}
          </div>
        )}
      </div>

      {/* ================= Tabel Transaksi ================= */}
      <SectionCard
        title="Riwayat Transaksi"
        description={
          txQuery.isPending
            ? "Memuat data…"
            : `${txs.length} transaksi ditampilkan${typeFilter !== "all" || assetFilter !== "all" ? " (terfilter)" : ""}`
        }
        contentClassName="px-0 pb-0"
      >
        {txQuery.isError && txs.length === 0 ? (
          <div className="px-6 pb-6">
            <ErrorBox message={errMsg(txQuery.error)} onRetry={() => void txQuery.refetch()} />
          </div>
        ) : txQuery.isPending && txs.length === 0 ? (
          <div className="px-6 pb-6">
            <LoadingRows rows={6} />
          </div>
        ) : txs.length === 0 ? (
          <div className="px-6 pb-6">
            <EmptyState
              icon={<ArrowLeftRight className="h-6 w-6" />}
              title="Belum ada transaksi"
              description={
                typeFilter !== "all" || assetFilter !== "all"
                  ? "Tidak ada transaksi yang cocok dengan filter. Coba ubah kriteria."
                  : isOwner
                    ? "Catat transaksi pertama — beli, jual, transfer, atau pencatatan nilai."
                    : "Owner belum mencatat transaksi. Riwayat akan tampil di sini."
              }
              action={
                isOwner && typeFilter === "all" && assetFilter === "all" ? (
                  <Button
                    type="button"
                    onClick={() => setFormOpen(true)}
                    className="bg-emerald-600 text-primary-foreground hover:bg-emerald-700"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Catat Transaksi
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <TooltipProvider delayDuration={200}>
            <div className="max-h-96 overflow-auto scrollbar-thin">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_var(--border)]">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="min-w-[150px]">Tanggal</TableHead>
                    <TableHead className="w-[150px]">Tipe</TableHead>
                    <TableHead className="min-w-[160px]">Aset</TableHead>
                    <TableHead className="w-[110px] text-right">Jumlah</TableHead>
                    <TableHead className="w-[110px] text-right">Harga</TableHead>
                    <TableHead className="w-[130px] text-right">Total</TableHead>
                    <TableHead className="w-[100px] text-right">Fee</TableHead>
                    <TableHead className="min-w-[140px]">Catatan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {txs.map((tx) => {
                    const meta = txMeta(tx.type);
                    const inflow = meta.dir === "in";
                    const neutral = meta.dir === "neutral";
                    const DirIcon = meta.icon;
                    return (
                      <TableRow key={String(tx.id)}>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="whitespace-nowrap text-sm tabular-nums">
                              {formatDate(tx.at)}
                            </span>
                            <span className="text-xs text-muted-foreground">{timeAgo(tx.at)}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1.5">
                            <DirIcon
                              className={cn(
                                "h-3.5 w-3.5",
                                neutral && "text-zinc-500",
                                !neutral && inflow && "text-emerald-600 dark:text-emerald-400",
                                !neutral && !inflow && "text-rose-600 dark:text-rose-400",
                              )}
                              aria-hidden="true"
                            />
                            <TypeBadge type={tx.type} />
                          </span>
                        </TableCell>
                        <TableCell className="font-medium">{tx.assetName ?? `#${tx.assetId}`}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(tx.quantity, 6)}
                        </TableCell>
                        <TableCell className="text-right">
                          <MoneyCell usd={tx.priceUsd} />
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-semibold tabular-nums",
                            neutral && "text-muted-foreground",
                            !neutral && inflow && "text-emerald-600 dark:text-emerald-400",
                            !neutral && !inflow && "text-rose-600 dark:text-rose-400",
                          )}
                        >
                          <MoneyCell
                            usd={tx.totalUsd}
                            sign={neutral ? undefined : inflow ? "+" : "−"}
                            className={cn(
                              "font-semibold",
                              neutral && "text-muted-foreground",
                              !neutral && inflow && "text-emerald-600 dark:text-emerald-400",
                              !neutral && !inflow && "text-rose-600 dark:text-rose-400",
                            )}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          {tx.feeUsd > 0 ? (
                            <MoneyCell usd={tx.feeUsd} className="text-muted-foreground" />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {tx.note?.trim() ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="block max-w-[220px] cursor-default truncate text-sm text-muted-foreground">
                                  {tx.note}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs">
                                <p className="text-xs">{tx.note}</p>
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </TooltipProvider>
        )}
      </SectionCard>

      {txs.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Nilai ditampilkan dalam mata uang tampilan pilihan Anda. Total masuk/keluar dihitung dari
          tipe: masuk (beli, transfer masuk, pemasukan) dan keluar (jual, transfer keluar, pengeluaran).
        </p>
      )}

      {/* ================= Dialog ================= */}
      {isOwner && (
        <TxFormDialog open={formOpen} onOpenChange={setFormOpen} assets={assets} />
      )}
    </div>
  );
}
