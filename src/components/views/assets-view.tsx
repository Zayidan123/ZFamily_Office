"use client";

// ============================================================
// View: Aset — Task 2-a
// StatCard per kelas · toolbar filter (search/class/entity)
// Tabel aset + dialog detail + dialog tambah/edit (RHF + zod)
// RBAC: hanya owner bisa tambah/edit/hapus
// ============================================================
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useAppStore } from "@/lib/store";
import { apiFetch, ApiError } from "@/lib/api";
import { formatUsd, formatIdr, formatPct, formatNumber, formatDate, formatDateTime } from "@/lib/format";
import {
  useFormatCurrency,
  PageHeader,
  SectionCard,
  EmptyState,
  LoadingRows,
  ErrorBox,
  ClassBadge,
  ASSET_CLASS_STYLE,
  ConfirmButton,
} from "@/components/shared/kit";
import type { Asset, AssetClass, AssetClassRow, AssetPnl, Entity } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
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
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Wallet,
  ArrowLeftRight,
  Briefcase,
  Landmark,
  Package,
  Boxes,
  Snowflake,
  ClipboardList,
  TrendingUp,
  TrendingDown,
  type LucideIcon,
} from "lucide-react";

// ------------------------------------------------------------
// Tipe & konstanta lokal
// ------------------------------------------------------------
type AssetRow = Asset & { change24hPct?: number | null };

const CLASS_OPTIONS = (
  Object.entries(ASSET_CLASS_STYLE) as [AssetClass, { label: string }][]
).map(([value, s]) => ({ value, label: s.label }));

const SOURCE_META: Record<string, { label: string; icon: LucideIcon }> = {
  wallet: { label: "Wallet", icon: Wallet },
  exchange: { label: "Exchange", icon: ArrowLeftRight },
  broker: { label: "Broker", icon: Briefcase },
  bank: { label: "Bank", icon: Landmark },
  physical: { label: "Fisik", icon: Package },
  cold_storage: { label: "Cold Storage", icon: Snowflake },
  manual: { label: "Manual", icon: ClipboardList },
  other: { label: "Lainnya", icon: Boxes },
};

function sourceMeta(t: string) {
  return SOURCE_META[t] ?? { label: t || "Lainnya", icon: Boxes };
}

/** Jumlah desimal sesuai kelas aset */
function qtyDigits(c: AssetClass): number {
  if (c === "property" || c === "vehicle" || c === "business") return 0;
  if (c === "cash") return 2;
  return 6;
}

function formatAssetPrice(unitPrice: number, currency: string): string {
  return currency === "IDR" ? formatIdr(unitPrice) : formatUsd(unitPrice);
}

function errMsg(err: unknown): string {
  return err instanceof ApiError ? err.message : "Backend belum terjangkau — mencoba lagi";
}

/** Nilai total mengikuti display currency store */
function CurrencyCell({ usd }: { usd: number }) {
  const format = useFormatCurrency();
  return <span className="tabular-nums">{format(usd)}</span>;
}

// ------------------------------------------------------------
// Elemen kecil
// ------------------------------------------------------------

function SourceBadge({ type, label }: { type: string; label?: string | null }) {
  const meta = sourceMeta(type);
  const Icon = meta.icon;
  return (
    <Badge
      variant="outline"
      className="max-w-full gap-1 border-zinc-500/40 bg-zinc-500/5 px-1.5 font-normal text-zinc-600 dark:text-zinc-300"
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{label?.trim() ? label : meta.label}</span>
    </Badge>
  );
}

function DeltaPct({ value, className }: { value: number | null | undefined; className?: string }) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className={cn("text-xs text-muted-foreground", className)}>—</span>;
  }
  const up = value >= 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums",
        up
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "bg-rose-500/10 text-rose-600 dark:text-rose-400",
        className,
      )}
    >
      {up ? <TrendingUp className="h-3 w-3" aria-hidden="true" /> : <TrendingDown className="h-3 w-3" aria-hidden="true" />}
      {formatPct(value)}
    </span>
  );
}

/** Kartu ringkas per kelas aset (StatCard-style dengan ClassBadge) */
function ClassStatCard({
  row,
  loading,
  formatCurrency,
}: {
  row?: AssetClassRow;
  loading?: boolean;
  formatCurrency: (usd: number, compact?: boolean) => string;
}) {
  if (loading || !row) {
    return (
      <Card className="rounded-xl p-5">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="mt-3 h-8 w-28" />
        <Skeleton className="mt-3 h-4 w-24" />
      </Card>
    );
  }
  return (
    <Card className="flex min-h-[118px] flex-col gap-2.5 rounded-xl p-5">
      <div className="flex items-center justify-between gap-2">
        <ClassBadge assetClass={row.class} />
        <DeltaPct value={row.change24hPct} />
      </div>
      <div className="text-2xl font-semibold leading-none tabular-nums">
        <span className="block truncate" title={formatCurrency(row.valueUsd)}>{formatCurrency(row.valueUsd)}</span>
      </div>
      <div className="text-xs text-muted-foreground">
        {row.count} aset · {formatPct(row.pct, false)} portofolio
      </div>
    </Card>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs font-medium text-rose-600 dark:text-rose-400">{message}</p>;
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 border-b py-2 last:border-b-0">
      <span className="shrink-0 text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-right text-sm font-medium">{children}</span>
    </div>
  );
}

// ------------------------------------------------------------
// Skema form aset (string-based; konversi number saat submit)
// ------------------------------------------------------------
const assetFormSchema = z.object({
  name: z.string().min(1, "Nama aset wajib diisi").max(120, "Nama maksimal 120 karakter"),
  assetClass: z.string().min(1, "Pilih kelas aset"),
  symbol: z.string().max(24, "Simbol maksimal 24 karakter"),
  entityId: z.string().min(1, "Pilih entitas pemilik aset"),
  quantity: z
    .string()
    .min(1, "Jumlah wajib diisi")
    .refine((v) => !Number.isNaN(Number(v)), "Jumlah harus berupa angka")
    .refine((v) => Number(v) >= 0, "Jumlah tidak boleh negatif"),
  unitPrice: z
    .string()
    .min(1, "Harga satuan wajib diisi")
    .refine((v) => !Number.isNaN(Number(v)), "Harga harus berupa angka")
    .refine((v) => Number(v) >= 0, "Harga tidak boleh negatif"),
  currency: z.enum(["USD", "IDR"]),
  sourceType: z.string().min(1, "Pilih sumber pencatatan"),
  sourceLabel: z.string().max(80, "Label sumber maksimal 80 karakter"),
  notes: z.string().max(1000, "Catatan maksimal 1000 karakter"),
});
type AssetFormValues = z.infer<typeof assetFormSchema>;

const EMPTY_ASSET_FORM: AssetFormValues = {
  name: "",
  assetClass: "",
  symbol: "",
  entityId: "",
  quantity: "",
  unitPrice: "",
  currency: "USD",
  sourceType: "other",
  sourceLabel: "",
  notes: "",
};

// ------------------------------------------------------------
// Dialog Tambah/Edit Aset
// ------------------------------------------------------------
function AssetFormDialog({
  open,
  onOpenChange,
  asset,
  entities,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  asset: AssetRow | null;
  entities: Entity[];
}) {
  const queryClient = useQueryClient();
  const form = useForm<AssetFormValues>({
    resolver: zodResolver(assetFormSchema),
    defaultValues: EMPTY_ASSET_FORM,
  });
  const currency = useWatch({ control: form.control, name: "currency", defaultValue: "USD" });

  React.useEffect(() => {
    if (!open) return;
    form.reset(
      asset
        ? {
            name: asset.name,
            assetClass: asset.assetClass,
            symbol: asset.symbol ?? "",
            entityId: String(asset.entityId),
            quantity: String(asset.quantity),
            unitPrice: String(asset.unitPrice),
            currency: asset.currency === "IDR" ? "IDR" : "USD",
            sourceType: SOURCE_META[asset.sourceType] ? asset.sourceType : "other",
            sourceLabel: asset.sourceLabel ?? "",
            notes: asset.notes ?? "",
          }
        : EMPTY_ASSET_FORM,
    );
  }, [open, asset, form]);

  const saveMutation = useMutation({
    mutationFn: (values: AssetFormValues) => {
      const body = {
        name: values.name.trim(),
        assetClass: values.assetClass,
        symbol: values.symbol.trim() ? values.symbol.trim() : null,
        entityId: Number(values.entityId),
        quantity: Number(values.quantity),
        unitPrice: Number(values.unitPrice),
        currency: values.currency,
        sourceType: values.sourceType,
        sourceLabel: values.sourceLabel.trim(),
        notes: values.notes.trim(),
      };
      if (asset) {
        return apiFetch<AssetRow>(`/assets/${asset.id}`, { method: "PUT", body });
      }
      return apiFetch<AssetRow>("/assets", { method: "POST", body });
    },
    onSuccess: () => {
      toast.success(asset ? "Aset berhasil diperbarui" : "Aset berhasil ditambahkan", {
        description: asset ? asset.name : "Data aset baru tersimpan ke portofolio.",
      });
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
      void queryClient.invalidateQueries({ queryKey: ["assets", "classes"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(asset ? "Gagal memperbarui aset" : "Gagal menambahkan aset", {
        description: errMsg(err),
      });
    },
  });

  const onSubmit = form.handleSubmit((values) => saveMutation.mutate(values));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto scrollbar-thin sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{asset ? "Edit Aset" : "Tambah Aset"}</DialogTitle>
          <DialogDescription>
            {asset
              ? "Perbarui detail aset. Harga pasar live tetap dihitung otomatis oleh engine."
              : "Catat aset baru ke portofolio keluarga — kripto, saham, properti, dll."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="grid gap-1.5">
            <Label htmlFor="asset-name">Nama Aset *</Label>
            <Input
              id="asset-name"
              placeholder="cth. Bitcoin, Rumah Bandung, BBCA"
              {...form.register("name")}
            />
            <FieldError message={form.formState.errors.name?.message} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Kelas Aset *</Label>
              <Controller
                control={form.control}
                name="assetClass"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Pilih kelas" />
                    </SelectTrigger>
                    <SelectContent>
                      {CLASS_OPTIONS.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError message={form.formState.errors.assetClass?.message} />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="asset-symbol">Simbol / Ticker</Label>
              <Input id="asset-symbol" placeholder="cth. BTC, BBCA (opsional)" {...form.register("symbol")} />
              <FieldError message={form.formState.errors.symbol?.message} />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Entitas Pemilik *</Label>
            <Controller
              control={form.control}
              name="entityId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Pilih entitas" />
                  </SelectTrigger>
                  <SelectContent>
                    {entities.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        Tidak ada entitas tersedia
                      </div>
                    ) : (
                      entities.map((e) => (
                        <SelectItem key={String(e.id)} value={String(e.id)}>
                          {e.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError message={form.formState.errors.entityId?.message} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="asset-quantity">Jumlah *</Label>
              <Input
                id="asset-quantity"
                type="number"
                step="any"
                min="0"
                inputMode="decimal"
                placeholder="cth. 0.5"
                {...form.register("quantity")}
              />
              <FieldError message={form.formState.errors.quantity?.message} />
            </div>

            <div className="grid gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="asset-price">Harga Satuan *</Label>
                {/* Toggle USD/IDR */}
                <div className="flex overflow-hidden rounded-lg border" role="group" aria-label="Mata uang harga satuan">
                  {(["USD", "IDR"] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => form.setValue("currency", c, { shouldValidate: true })}
                      className={cn(
                        "px-2.5 py-1 text-xs font-semibold transition-colors",
                        currency === c
                          ? "bg-emerald-600 text-primary-foreground"
                          : "bg-transparent text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <Input
                id="asset-price"
                type="number"
                step="any"
                min="0"
                inputMode="decimal"
                placeholder={currency === "IDR" ? "cth. 1500000" : "cth. 65000"}
                {...form.register("unitPrice")}
              />
              <FieldError message={form.formState.errors.unitPrice?.message} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Sumber Pencatatan</Label>
              <Controller
                control={form.control}
                name="sourceType"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Pilih sumber" />
                    </SelectTrigger>
                    <SelectContent>
                      {["exchange", "wallet", "broker", "bank", "physical", "other"].map((t) => (
                        <SelectItem key={t} value={t}>
                          {sourceMeta(t).label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError message={form.formState.errors.sourceType?.message} />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="asset-sourcelabel">Label Sumber</Label>
              <Input
                id="asset-sourcelabel"
                placeholder="cth. Binance, Ledger Nano X (opsional)"
                {...form.register("sourceLabel")}
              />
              <FieldError message={form.formState.errors.sourceLabel?.message} />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="asset-notes">Catatan</Label>
            <Textarea
              id="asset-notes"
              rows={3}
              placeholder="Catatan tambahan tentang aset ini (opsional)"
              {...form.register("notes")}
            />
            <FieldError message={form.formState.errors.notes?.message} />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saveMutation.isPending}
            >
              Batal
            </Button>
            <Button
              type="submit"
              className="bg-emerald-600 text-primary-foreground hover:bg-emerald-700"
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {asset ? "Simpan Perubahan" : "Tambah Aset"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------
// Section PnL FIFO (dialog detail aset) — Task U-b
// GET /assets/{id}/pnl · RBAC: executor 403 → section disembunyikan
// ------------------------------------------------------------

function pnlValueClass(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v) || v === 0) return "";
  return v > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400";
}

function PnlMiniStat({
  label,
  value,
  sub,
  valueClass,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border bg-muted/30 p-2.5">
      <p className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground" title={label}>
        {label}
      </p>
      <p
        className={cn("mt-0.5 truncate text-sm font-semibold tabular-nums", valueClass)}
        title={value}
      >
        {value}
      </p>
      {sub !== undefined && (
        <p className="mt-0.5 truncate text-[10px] tabular-nums text-muted-foreground" title={sub}>
          {sub}
        </p>
      )}
    </div>
  );
}

function LotTypeBadge({ type }: { type: string }) {
  const t = (type || "").toLowerCase();
  const isBuy = t === "buy" || t === "transfer_in" || t === "income";
  const isSell = t === "sell" || t === "transfer_out" || t === "expense";
  const label = t === "buy" ? "Beli" : t === "sell" ? "Jual" : type || "—";
  return (
    <Badge
      variant="outline"
      className={cn(
        "px-1.5 text-[10px]",
        isBuy && "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        isSell && "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400",
        !isBuy && !isSell && "border-zinc-500/40 bg-zinc-500/10 text-zinc-600 dark:text-zinc-300",
      )}
    >
      {label}
    </Badge>
  );
}

function AssetPnlSection({ assetId }: { assetId: string }) {
  const formatCurrency = useFormatCurrency();

  const pnlQuery = useQuery<AssetPnl, ApiError>({
    queryKey: ["assets", "pnl", String(assetId)],
    queryFn: () => apiFetch<AssetPnl>(`/assets/${assetId}/pnl`),
    staleTime: 30_000,
    retry: false,
  });

  // Error: executor 403 → section disembunyikan; lainnya → error inline ringan
  if (pnlQuery.isError) {
    if (pnlQuery.error instanceof ApiError && pnlQuery.error.status === 403) return null;
    return (
      <div className="border-t pt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Basis Biaya &amp; PnL (FIFO)
        </p>
        <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2">
          <p className="min-w-0 truncate text-xs text-rose-600 dark:text-rose-400">
            Gagal memuat PnL — {errMsg(pnlQuery.error)}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={() => void pnlQuery.refetch()}
          >
            Coba lagi
          </Button>
        </div>
      </div>
    );
  }

  const pnl = pnlQuery.data;

  // Loading — skeleton mini
  if (pnlQuery.isPending || !pnl) {
    return (
      <div className="border-t pt-4" aria-busy="true" aria-label="Memuat basis biaya & PnL">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Basis Biaya &amp; PnL (FIFO)
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[58px] w-full rounded-lg" />
          ))}
        </div>
        <Skeleton className="mt-2 h-16 w-full rounded-lg" />
      </div>
    );
  }

  const hasLots = pnl.lots.length > 0;

  return (
    <div className="border-t pt-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Basis Biaya &amp; PnL (FIFO)
        </p>
        {pnl.symbol && (
          <span className="text-[10px] font-medium text-muted-foreground">{pnl.symbol}</span>
        )}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <PnlMiniStat
          label="Realized PnL"
          value={formatCurrency(pnl.realizedPnlUsd)}
          valueClass={pnlValueClass(pnl.realizedPnlUsd)}
        />
        <PnlMiniStat
          label="Avg Cost"
          value={pnl.avgCostUsd === null ? "—" : formatCurrency(pnl.avgCostUsd)}
          valueClass={pnl.avgCostUsd === null ? "text-muted-foreground" : undefined}
        />
        <PnlMiniStat
          label="Cost Basis Tersisa"
          value={formatCurrency(pnl.costBasisUsd)}
          sub={`sisa ${formatNumber(pnl.remainingQty, 6)} unit`}
        />
        <PnlMiniStat
          label="Unrealized PnL"
          value={
            pnl.unrealizedPnlUsd === null ? "—" : formatCurrency(pnl.unrealizedPnlUsd)
          }
          valueClass={pnlValueClass(pnl.unrealizedPnlUsd)}
          sub={pnl.unrealizedPnlPct === null ? undefined : formatPct(pnl.unrealizedPnlPct)}
        />
      </div>

      {!hasLots ? (
        <EmptyState
          title="Belum ada riwayat buy"
          description="Basis biaya belum terbentuk — catat transaksi buy untuk aset ini."
          className="mt-3 py-6"
        />
      ) : (
        <div className="mt-3">
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Lot Tersisa
          </p>
          <div className="max-h-40 overflow-auto rounded-lg border scrollbar-thin">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_var(--border)]">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[92px]">Tanggal</TableHead>
                  <TableHead className="w-[72px]">Tipe</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Harga</TableHead>
                  <TableHead className="text-right">Sisa Qty</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pnl.lots.map((lot, i) => (
                  <TableRow key={`${lot.at}-${i}`}>
                    <TableCell className="text-xs">{formatDate(lot.at)}</TableCell>
                    <TableCell>
                      <LotTypeBadge type={lot.type} />
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {formatNumber(lot.qty, 6)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {formatCurrency(lot.priceUsd)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {formatNumber(lot.remainingQty, 6)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// Dialog Detail Aset
// ------------------------------------------------------------
function AssetDetailDialog({
  asset,
  onOpenChange,
}: {
  asset: AssetRow | null;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={!!asset} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto scrollbar-thin sm:max-w-lg">
        {asset && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span>{asset.name}</span>
                {asset.symbol && (
                  <span className="text-sm font-normal text-muted-foreground">{asset.symbol}</span>
                )}
              </DialogTitle>
              <DialogDescription className="flex items-center gap-2">
                <ClassBadge assetClass={asset.assetClass} />
                <SourceBadge type={asset.sourceType} label={asset.sourceLabel} />
              </DialogDescription>
            </DialogHeader>

            {/* Nilai konversi USD / IDR berdampingan */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border bg-emerald-500/5 p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Nilai (USD)</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">{formatUsd(asset.valueUsd)}</p>
              </div>
              <div className="rounded-xl border bg-amber-500/5 p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Nilai (IDR)</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">{formatIdr(asset.valueIdr)}</p>
              </div>
            </div>

            <div>
              <DetailRow label="Entitas">{asset.entityName ?? `#${asset.entityId}`}</DetailRow>
              <DetailRow label="Jumlah">
                {formatNumber(asset.quantity, qtyDigits(asset.assetClass))}
                {asset.symbol ? ` ${asset.symbol}` : ""}
              </DetailRow>
              <DetailRow label="Harga Satuan">
                {formatAssetPrice(asset.unitPrice, asset.currency)}{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  ({formatUsd(asset.unitPriceUsd)})
                </span>
              </DetailRow>
              <DetailRow label="Δ 24 Jam">
                <DeltaPct value={asset.change24hPct} className="ml-auto" />
              </DetailRow>
              <DetailRow label="Sumber">
                <SourceBadge type={asset.sourceType} label={asset.sourceLabel} />
              </DetailRow>
              <DetailRow label="Catatan">
                {asset.notes?.trim() ? asset.notes : <span className="text-muted-foreground">—</span>}
              </DetailRow>
              <DetailRow label="Diperbarui">{formatDateTime(asset.updatedAt)}</DetailRow>
            </div>

            {/* Basis Biaya & PnL (FIFO) — Task U-b */}
            <AssetPnlSection assetId={asset.id} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------
// AssetsView
// ------------------------------------------------------------
export default function AssetsView() {
  const user = useAppStore((s) => s.user);
  const isOwner = user?.role === "owner";
  const formatCurrency = useFormatCurrency();
  const queryClient = useQueryClient();

  // ---------- filter state ----------
  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [classFilter, setClassFilter] = React.useState("all");
  const [entityFilter, setEntityFilter] = React.useState("all");

  React.useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // ---------- dialog state ----------
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<AssetRow | null>(null);
  const [detail, setDetail] = React.useState<AssetRow | null>(null);

  // ---------- queries ----------
  const classesQuery = useQuery<AssetClassRow[], ApiError>({
    queryKey: ["assets", "classes"],
    queryFn: () => apiFetch<AssetClassRow[]>("/assets/classes"),
    staleTime: 30_000,
  });

  const entitiesQuery = useQuery<Entity[], ApiError>({
    queryKey: ["entities"],
    queryFn: () => apiFetch<Entity[]>("/entities"),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const listParams = {
    search: search || undefined,
    class: classFilter !== "all" ? classFilter : undefined,
    entityId: entityFilter !== "all" ? Number(entityFilter) : undefined,
  };
  const assetsQuery = useQuery<AssetRow[], ApiError>({
    queryKey: ["assets", listParams],
    queryFn: () => apiFetch<AssetRow[]>("/assets", { params: listParams }),
    staleTime: 30_000,
  });

  const assets = assetsQuery.data ?? [];
  const classes = classesQuery.data ?? [];
  const entities = entitiesQuery.data ?? [];

  // ---------- delete mutation ----------
  const deleteMutation = useMutation({
    mutationFn: (id: string | number) =>
      apiFetch<{ id: number; deleted: boolean }>(`/assets/${id}`, { method: "DELETE" }),
    onSuccess: (_data, id) => {
      const target = assets.find((a) => String(a.id) === String(id));
      toast.success("Aset berhasil dihapus", {
        description: target ? `${target.name} dihapus dari portofolio.` : undefined,
      });
      setDetail((d) => (d && String(d.id) === String(id) ? null : d));
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
      void queryClient.invalidateQueries({ queryKey: ["assets", "classes"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err) => {
      toast.error("Gagal menghapus aset", { description: errMsg(err) });
    },
  });

  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (a: AssetRow) => {
    setEditing(a);
    setFormOpen(true);
  };

  const totalValue = classes.reduce((acc, c) => acc + c.valueUsd, 0);
  const totalAssets = classes.reduce((acc, c) => acc + c.count, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Aset"
        subtitle="Inventaris multi-aset: kripto, saham, forex/emas, properti, kendaraan, kas, bisnis."
      />

      {/* ================= StatCard per kelas ================= */}
      {classesQuery.isPending ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <ClassStatCard key={i} loading formatCurrency={formatCurrency} />
          ))}
        </div>
      ) : classesQuery.isError && classes.length === 0 ? (
        <ErrorBox
          message={errMsg(classesQuery.error)}
          onRetry={() => void classesQuery.refetch()}
        />
      ) : classes.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {classes.slice(0, 5).map((row) => (
              <ClassStatCard key={row.class} row={row} formatCurrency={formatCurrency} />
            ))}
          </div>
          {classes.length > 5 && (
            <p className="text-xs text-muted-foreground">
              Menampilkan 5 kelas teratas dari {classes.length} kelas · total{" "}
              <span className="font-medium tabular-nums">{formatCurrency(totalValue)}</span> di {totalAssets} aset
            </p>
          )}
        </>
      ) : null}

      {/* ================= Toolbar ================= */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Cari nama, simbol, atau sumber…"
            className="pl-9"
            aria-label="Cari aset"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Select value={classFilter} onValueChange={setClassFilter}>
            <SelectTrigger className="w-full sm:w-[170px]" aria-label="Filter kelas aset">
              <SelectValue placeholder="Semua Kelas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Kelas</SelectItem>
              {CLASS_OPTIONS.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={entityFilter} onValueChange={setEntityFilter}>
            <SelectTrigger className="w-full sm:w-[180px]" aria-label="Filter entitas">
              <SelectValue placeholder="Semua Entitas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Entitas</SelectItem>
              {entities.map((e) => (
                <SelectItem key={String(e.id)} value={String(e.id)}>
                  {e.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {isOwner && (
            <Button
              type="button"
              onClick={openAdd}
              className="bg-emerald-600 text-primary-foreground hover:bg-emerald-700"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Tambah Aset
            </Button>
          )}
        </div>
      </div>

      {/* ================= Tabel Aset ================= */}
      <SectionCard
        title="Daftar Aset"
        description={
          assetsQuery.isPending
            ? "Memuat data…"
            : `${assets.length} aset ditampilkan${search || classFilter !== "all" || entityFilter !== "all" ? " (terfilter)" : ""}`
        }
        contentClassName="px-0 pb-0"
      >
        {assetsQuery.isError && assets.length === 0 ? (
          <div className="px-6 pb-6">
            <ErrorBox message={errMsg(assetsQuery.error)} onRetry={() => void assetsQuery.refetch()} />
          </div>
        ) : assetsQuery.isPending && assets.length === 0 ? (
          <div className="px-6 pb-6">
            <LoadingRows rows={6} />
          </div>
        ) : !assetsQuery.isPending && assets.length === 0 ? (
          <div className="px-6 pb-6">
            <EmptyState
              icon={<Wallet className="h-6 w-6" />}
              title="Belum ada aset"
              description={
                search || classFilter !== "all" || entityFilter !== "all"
                  ? "Tidak ada aset yang cocok dengan filter. Coba ubah kriteria pencarian."
                  : isOwner
                    ? "Mulai catat aset pertama keluarga — kripto, saham, properti, dan lainnya."
                    : "Owner belum mencatat aset. Data akan tampil di sini."
              }
              action={
                isOwner && !search && classFilter === "all" && entityFilter === "all" ? (
                  <Button
                    type="button"
                    onClick={openAdd}
                    className="bg-emerald-600 text-primary-foreground hover:bg-emerald-700"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Tambah Aset
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <div className="max-h-[560px] overflow-auto scrollbar-thin">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_var(--border)]">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="min-w-[220px]">Aset</TableHead>
                  <TableHead className="w-[110px]">Kelas</TableHead>
                  <TableHead className="min-w-[130px]">Entitas</TableHead>
                  <TableHead className="w-[130px] text-right">Jumlah</TableHead>
                  <TableHead className="w-[130px] text-right">Harga Satuan</TableHead>
                  <TableHead className="w-[150px] text-right">Nilai Total</TableHead>
                  <TableHead className="w-[100px] text-right">Δ 24 Jam</TableHead>
                  <TableHead className="w-[90px] text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assets.map((a) => (
                  <TableRow
                    key={String(a.id)}
                    className="cursor-pointer"
                    title="Lihat detail aset"
                    onClick={() => setDetail(a)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setDetail(a);
                      }
                    }}
                    tabIndex={0}
                  >
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span className="font-medium leading-tight">
                          {a.name}
                          {a.symbol && (
                            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                              {a.symbol}
                            </span>
                          )}
                        </span>
                        <SourceBadge type={a.sourceType} label={a.sourceLabel} />
                      </div>
                    </TableCell>
                    <TableCell>
                      <ClassBadge assetClass={a.assetClass} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {a.entityName ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(a.quantity, qtyDigits(a.assetClass))}
                      {a.symbol ? <span className="text-muted-foreground"> {a.symbol}</span> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatAssetPrice(a.unitPrice, a.currency)}
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      <CurrencyCell usd={a.valueUsd} />
                    </TableCell>
                    <TableCell className="text-right">
                      <DeltaPct value={a.change24hPct} className="ml-auto" />
                    </TableCell>
                    <TableCell
                      className="text-right"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      {isOwner ? (
                        <div className="flex items-center justify-end gap-0.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Edit aset"
                            aria-label={`Edit ${a.name}`}
                            onClick={() => openEdit(a)}
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <ConfirmButton
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-rose-600 hover:bg-rose-500/10 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300"
                            title="Hapus aset (klik 2x untuk konfirmasi)"
                            confirmLabel="Yakin?"
                            onConfirm={() => deleteMutation.mutate(a.id)}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </ConfirmButton>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      {isOwner && !assetsQuery.isPending && assets.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Klik baris untuk melihat detail lengkap aset. Perubahan harga pasar live dihitung otomatis dari engine harga.
        </p>
      )}

      {/* ================= Dialogs ================= */}
      <AssetFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        asset={editing}
        entities={entities}
      />
      <AssetDetailDialog
        asset={detail}
        onOpenChange={(v) => {
          if (!v) setDetail(null);
        }}
      />
    </div>
  );
}
