"use client";

// ============================================================
// Riset — Research vault: thesis, target harga, exit plan, tags.
// RBAC: owner & advisor CRUD; beneficiary read-only; executor —.
// ============================================================
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAppStore } from "@/lib/store";
import { apiFetch, ApiError } from "@/lib/api";
import { formatDate, timeAgo } from "@/lib/format";
import {
  ConfirmButton,
  CurrencyText,
  EmptyState,
  ErrorBox,
  LoadingRows,
  PageHeader,
  SectionCard,
} from "@/components/shared/kit";
import type { Asset, ResearchNote, ResearchStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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
  FlaskConical,
  Loader2,
  Pencil,
  Plus,
  Search,
  ShieldAlert,
  Tag,
  Target,
  Trash2,
} from "lucide-react";

const STATUS_META: Record<ResearchStatus, { label: string; className: string }> = {
  draft: {
    label: "Draft",
    className: "border-zinc-500/40 bg-zinc-500/10 text-zinc-600 dark:text-zinc-300",
  },
  active: {
    label: "Aktif",
    className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  closed: {
    label: "Ditutup",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
};

function errMsg(err: unknown): string {
  return err instanceof ApiError ? err.message : "Backend belum terjangkau — mencoba lagi";
}

interface NoteFormState {
  title: string;
  assetId: string; // "none" | asset id
  thesis: string;
  targetPriceUsd: string;
  exitPlan: string;
  status: ResearchStatus;
  tags: string;
}

const EMPTY_FORM: NoteFormState = {
  title: "",
  assetId: "none",
  thesis: "",
  targetPriceUsd: "",
  exitPlan: "",
  status: "draft",
  tags: "",
};

// ============================================================
// Dialog form catatan (create + edit)
// ============================================================
function NoteFormDialog({
  open,
  onOpenChange,
  editing,
  assets,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: ResearchNote | null;
  assets: Asset[];
}) {
  const qc = useQueryClient();
  const [form, setForm] = React.useState<NoteFormState>(EMPTY_FORM);

  React.useEffect(() => {
    if (!open) return;
    setForm(
      editing
        ? {
            title: editing.title,
            assetId: editing.assetId != null ? String(editing.assetId) : "none",
            thesis: editing.thesis ?? "",
            targetPriceUsd:
              editing.targetPriceUsd != null ? String(editing.targetPriceUsd) : "",
            exitPlan: editing.exitPlan ?? "",
            status: editing.status,
            tags: (editing.tags ?? []).join(", "),
          }
        : EMPTY_FORM,
    );
  }, [open, editing]);

  const saveM = useMutation({
    mutationFn: () => {
      const body = {
        title: form.title.trim(),
        thesis: form.thesis,
        assetId: form.assetId === "none" ? null : Number(form.assetId),
        targetPriceUsd:
          form.targetPriceUsd.trim() === "" ? null : Number(form.targetPriceUsd),
        exitPlan: form.exitPlan,
        status: form.status,
        tags: form.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      };
      return editing
        ? apiFetch(`/research/notes/${editing.id}`, { method: "PUT", body })
        : apiFetch("/research/notes", { method: "POST", body });
    },
    onSuccess: () => {
      toast.success(editing ? "Catatan riset diperbarui" : "Catatan riset dibuat");
      onOpenChange(false);
      void qc.invalidateQueries({ queryKey: ["research"] });
      void qc.invalidateQueries({ queryKey: ["audit"] });
    },
    onError: (e) => toast.error("Gagal menyimpan catatan", { description: errMsg(e) }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Catatan Riset" : "Catatan Riset Baru"}</DialogTitle>
          <DialogDescription>
            Thesis investasi, target harga, rencana exit, dan tag untuk memudahkan pencarian.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="note-title">
              Judul <span className="text-rose-500">*</span>
            </Label>
            <Input
              id="note-title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="mis. Akumulasi BTC menjelang halving berikutnya"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Aset terkait (opsional)</Label>
              <Select
                value={form.assetId}
                onValueChange={(v) => setForm((f) => ({ ...f, assetId: v }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Tanpa aset" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Tanpa aset</SelectItem>
                  {assets.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm((f) => ({ ...f, status: v as ResearchStatus }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="active">Aktif</SelectItem>
                  <SelectItem value="closed">Ditutup</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="note-thesis">Thesis</Label>
            <Textarea
              id="note-thesis"
              rows={5}
              value={form.thesis}
              onChange={(e) => setForm((f) => ({ ...f, thesis: e.target.value }))}
              placeholder="Argumen investasi, katalis, risiko utama…"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="note-target">Target harga (USD, opsional)</Label>
              <Input
                id="note-target"
                type="number"
                min="0"
                step="any"
                className="tabular-nums"
                value={form.targetPriceUsd}
                onChange={(e) => setForm((f) => ({ ...f, targetPriceUsd: e.target.value }))}
                placeholder="mis. 150000"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="note-tags">Tag (pisahkan koma)</Label>
              <Input
                id="note-tags"
                value={form.tags}
                onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                placeholder="mis. kripto, long-term, DCA"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="note-exit">Exit plan</Label>
            <Textarea
              id="note-exit"
              rows={2}
              value={form.exitPlan}
              onChange={(e) => setForm((f) => ({ ...f, exitPlan: e.target.value }))}
              placeholder="Rencana keluar — mis. jual bertahap 25% per $20k…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saveM.isPending}>
            Batal
          </Button>
          <Button
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            disabled={!form.title.trim() || saveM.isPending}
            onClick={() => saveM.mutate()}
          >
            {saveM.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// ResearchView
// ============================================================
export default function ResearchView() {
  const qc = useQueryClient();
  const user = useAppStore((s) => s.user);
  const role = user?.role;
  const canRead = role === "owner" || role === "beneficiary" || role === "advisor";
  const canEdit = role === "owner" || role === "advisor";

  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<"all" | ResearchStatus>("all");
  const [detail, setDetail] = React.useState<ResearchNote | null>(null);
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<ResearchNote | null>(null);

  const notesQ = useQuery<ResearchNote[], ApiError>({
    queryKey: ["research"],
    queryFn: () => apiFetch("/research/notes"),
    enabled: canRead,
  });
  const assetsQ = useQuery<Asset[], ApiError>({
    queryKey: ["assets"],
    queryFn: () => apiFetch("/assets"),
    enabled: canEdit,
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => apiFetch(`/research/notes/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Catatan riset dihapus");
      setDetail(null);
      void qc.invalidateQueries({ queryKey: ["research"] });
      void qc.invalidateQueries({ queryKey: ["audit"] });
    },
    onError: (e) => toast.error("Gagal menghapus catatan", { description: errMsg(e) }),
  });

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return (notesQ.data ?? []).filter((n) => {
      if (statusFilter !== "all" && n.status !== statusFilter) return false;
      if (!q) return true;
      return (
        n.title.toLowerCase().includes(q) ||
        (n.thesis ?? "").toLowerCase().includes(q) ||
        (n.assetName ?? "").toLowerCase().includes(q) ||
        (n.tags ?? []).some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [notesQ.data, search, statusFilter]);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (n: ResearchNote) => {
    setDetail(null);
    setEditing(n);
    setFormOpen(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Riset"
        subtitle="Vault catatan riset: thesis, target harga, exit plan, dan tag."
      />

      {!user ? null : !canRead ? (
        <EmptyState
          icon={<ShieldAlert className="h-6 w-6" />}
          title="Akses terbatas"
          description="Modul riset tersedia untuk owner, beneficiary, dan advisor."
        />
      ) : (
        <>
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari judul, thesis, aset, atau tag…"
                className="pl-9"
              />
            </div>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua status</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="active">Aktif</SelectItem>
                <SelectItem value="closed">Ditutup</SelectItem>
              </SelectContent>
            </Select>
            {canEdit && (
              <Button
                size="sm"
                className="min-h-[36px] bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={openCreate}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Catatan Riset
              </Button>
            )}
          </div>

          {/* Konten */}
          {notesQ.isError ? (
            <ErrorBox message={errMsg(notesQ.error)} onRetry={() => void notesQ.refetch()} />
          ) : notesQ.isPending || !notesQ.data ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Card key={i} className="rounded-xl p-5">
                  <LoadingRows rows={3} />
                </Card>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<FlaskConical className="h-6 w-6" />}
              title={
                (notesQ.data ?? []).length === 0
                  ? "Belum ada catatan riset"
                  : "Tidak ada hasil yang cocok"
              }
              description={
                (notesQ.data ?? []).length === 0
                  ? canEdit
                    ? "Mulai dokumentasikan thesis investasi pertama Anda."
                    : "Owner atau advisor belum membuat catatan riset."
                  : "Ubah kata kunci pencarian atau filter status."
              }
              action={
                canEdit && (notesQ.data ?? []).length === 0 ? (
                  <Button
                    size="sm"
                    className="bg-emerald-600 text-white hover:bg-emerald-700"
                    onClick={openCreate}
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Catatan Riset
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((n) => {
                const meta = STATUS_META[n.status] ?? STATUS_META.draft;
                return (
                  <Card
                    key={n.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setDetail(n)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setDetail(n);
                      }
                    }}
                    className="rounded-xl cursor-pointer p-5 transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                  >
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {n.assetName && (
                          <Badge variant="outline" className="max-w-[140px]">
                            <span className="truncate">{n.assetName}</span>
                          </Badge>
                        )}
                        <Badge variant="outline" className={meta.className}>
                          {meta.label}
                        </Badge>
                        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                          {timeAgo(n.updatedAt)}
                        </span>
                      </div>
                      <p className="line-clamp-1 font-semibold">{n.title}</p>
                      <p className="line-clamp-3 min-h-[3.6rem] text-sm leading-relaxed text-muted-foreground">
                        {n.thesis || "Tanpa thesis."}
                      </p>
                      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs">
                        {n.targetPriceUsd != null ? (
                          <span className="inline-flex items-center gap-1 font-medium tabular-nums text-emerald-700 dark:text-emerald-400">
                            <Target className="h-3.5 w-3.5" aria-hidden="true" />
                            <CurrencyText usd={n.targetPriceUsd} compact />
                          </span>
                        ) : (
                          <span className="text-muted-foreground/60">Tanpa target</span>
                        )}
                        {(n.tags ?? []).length > 0 && (
                          <span className="flex max-w-[60%] flex-wrap gap-1">
                            {n.tags.slice(0, 2).map((t) => (
                              <Badge
                                key={t}
                                variant="outline"
                                className="px-1.5 py-0 text-[10px] text-muted-foreground"
                              >
                                {t}
                              </Badge>
                            ))}
                            {n.tags.length > 2 && (
                              <span className="text-[10px] text-muted-foreground">
                                +{n.tags.length - 2}
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Dialog detail */}
      <Dialog open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="text-left">{detail.title}</DialogTitle>
                <DialogDescription className="text-left">
                  Dibuat {formatDate(detail.createdAt)} · diperbarui{" "}
                  {formatDate(detail.updatedAt)}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge
                    variant="outline"
                    className={(STATUS_META[detail.status] ?? STATUS_META.draft).className}
                  >
                    {(STATUS_META[detail.status] ?? STATUS_META.draft).label}
                  </Badge>
                  {detail.assetName && <Badge variant="outline">{detail.assetName}</Badge>}
                  {detail.targetPriceUsd != null && (
                    <Badge
                      variant="outline"
                      className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 tabular-nums dark:text-emerald-400"
                    >
                      Target <CurrencyText usd={detail.targetPriceUsd} />
                    </Badge>
                  )}
                </div>
                <SectionCard title="Thesis">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                    {detail.thesis || "Tanpa thesis."}
                  </p>
                </SectionCard>
                <SectionCard title="Exit Plan">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                    {detail.exitPlan || "Belum ditentukan."}
                  </p>
                </SectionCard>
                {(detail.tags ?? []).length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Tag className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                    {detail.tags.map((t) => (
                      <Badge key={t} variant="outline" className="text-muted-foreground">
                        {t}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              {canEdit && (
                <DialogFooter className="gap-2 sm:justify-between">
                  <ConfirmButton
                    onConfirm={() => deleteM.mutate(detail.id)}
                    confirmLabel="Klik lagi untuk hapus"
                    variant="outline"
                    className="border-rose-500/40 text-rose-600 dark:text-rose-400"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    Hapus
                  </ConfirmButton>
                  <Button
                    className="bg-emerald-600 text-white hover:bg-emerald-700"
                    onClick={() => openEdit(detail)}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                    Edit
                  </Button>
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog form create/edit */}
      <NoteFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        assets={assetsQ.data ?? []}
      />
    </div>
  );
}
