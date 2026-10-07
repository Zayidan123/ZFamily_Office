"use client";

// ============================================================
// Governance — Tabs: Entitas | Pengguna | Persetujuan | Audit Log
// RBAC: owner tulis (entitas/pengajuan), owner+beneficiary
// memutuskan approval, audit append-only.
// ============================================================
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAppStore } from "@/lib/store";
import { apiFetch, ApiError } from "@/lib/api";
import { formatDateTime, timeAgo } from "@/lib/format";
import {
  ConfirmButton,
  CurrencyText,
  EmptyState,
  ErrorBox,
  LoadingRows,
  PageHeader,
  RoleBadge,
  useFormatCurrency,
} from "@/components/shared/kit";
import type { Approval, Asset, AuditLog, Entity, EntityType, Role, User } from "@/lib/types";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Building2,
  Check,
  ClipboardCheck,
  Landmark,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  ScrollText,
  Search,
  ShieldAlert,
  UserRound,
  Users,
  UsersRound,
  X,
} from "lucide-react";

type EntityRow = Entity & { assetCount?: number; valueUsd?: number };
type UserRow = User & { created_at?: string };

function errMsg(err: unknown): string {
  return err instanceof ApiError ? err.message : "Backend belum terjangkau — mencoba lagi";
}

function useDebounced<T>(value: T, delay = 350): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

const TYPE_META: Record<
  EntityType,
  { label: string; icon: React.ElementType; badge: string; box: string }
> = {
  personal: {
    label: "Personal",
    icon: UserRound,
    badge: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    box: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  holding: {
    label: "Holding",
    icon: Building2,
    badge: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    box: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  family: {
    label: "Family",
    icon: UsersRound,
    badge: "border-zinc-500/40 bg-zinc-500/10 text-zinc-600 dark:text-zinc-300",
    box: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300",
  },
};

const ROLE_INFO: Record<Role, { desc: string; can: string }> = {
  owner: {
    desc: "Pemilik keluarga",
    can: "Akses penuh — tulis data, buat pengajuan, pengaturan & panic mode.",
  },
  beneficiary: {
    desc: "Ahli waris",
    can: "Lihat seluruh data + menyetujui/menolak pengajuan (approval).",
  },
  advisor: {
    desc: "Penasihat profesional",
    can: "Baca portofolio & kelola catatan riset — tanpa akses tulis finansial.",
  },
  executor: {
    desc: "Eksekutor",
    can: "Akses ringkas dashboard, aset & instruksi darurat — tanpa akses tulis.",
  },
};

function ExecutorNote({ what }: { what: string }) {
  return (
    <EmptyState
      icon={<ShieldAlert className="h-6 w-6" />}
      title="Akses terbatas"
      description={`Peran Executor tidak memiliki akses ke ${what}. Hubungi owner bila memerlukan akses.`}
    />
  );
}

// ============================================================
// Tab 1 — Entitas
// ============================================================
function EntitiesTab() {
  const qc = useQueryClient();
  const user = useAppStore((s) => s.user);
  const isOwner = user?.role === "owner";
  const isExecutor = user?.role === "executor";

  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({ name: "", type: "personal", description: "" });

  const entitiesQ = useQuery<EntityRow[], ApiError>({
    queryKey: ["entities"],
    queryFn: () => apiFetch("/entities"),
    enabled: !isExecutor,
  });
  const assetsQ = useQuery<Asset[], ApiError>({
    queryKey: ["assets"],
    queryFn: () => apiFetch("/assets"),
    enabled: !isExecutor,
  });

  // Fallback client-side: jumlah & nilai aset per entitas (bila API tidak menyertakan)
  const byEntity = React.useMemo(() => {
    const m = new Map<string, { count: number; value: number }>();
    for (const a of assetsQ.data ?? []) {
      const cur = m.get(a.entityId) ?? { count: 0, value: 0 };
      cur.count += 1;
      cur.value += a.valueUsd;
      m.set(a.entityId, cur);
    }
    return m;
  }, [assetsQ.data]);

  const createM = useMutation({
    mutationFn: () =>
      apiFetch("/entities", {
        method: "POST",
        body: {
          name: form.name.trim(),
          type: form.type,
          description: form.description.trim(),
        },
      }),
    onSuccess: () => {
      toast.success("Entitas berhasil dibuat");
      setOpen(false);
      setForm({ name: "", type: "personal", description: "" });
      void qc.invalidateQueries({ queryKey: ["entities"] });
      void qc.invalidateQueries({ queryKey: ["audit"] });
    },
    onError: (e) => toast.error("Gagal membuat entitas", { description: errMsg(e) }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {isExecutor
            ? "Struktur kepemilikan aset keluarga."
            : `Struktur kepemilikan aset keluarga — ${entitiesQ.data?.length ?? 0} entitas.`}
        </p>
        {isOwner && (
          <Button
            size="sm"
            className="min-h-[36px] bg-emerald-600 text-primary-foreground hover:bg-emerald-700"
            onClick={() => setOpen(true)}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Entitas Baru
          </Button>
        )}
      </div>

      {entitiesQ.isError ? (
        isExecutor ? (
          <ExecutorNote what="data entitas" />
        ) : (
          <ErrorBox message={errMsg(entitiesQ.error)} onRetry={() => void entitiesQ.refetch()} />
        )
      ) : entitiesQ.isPending || !entitiesQ.data ? (
        isExecutor ? (
          <ExecutorNote what="data entitas" />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Card key={i} className="rounded-xl p-5">
                <LoadingRows rows={3} />
              </Card>
            ))}
          </div>
        )
      ) : entitiesQ.data.length === 0 ? (
        <EmptyState
          icon={<Landmark className="h-6 w-6" />}
          title="Belum ada entitas"
          description={
            isOwner
              ? "Buat entitas personal, holding, atau family untuk mengelompokkan aset."
              : "Owner belum membuat entitas."
          }
          action={
            isOwner ? (
              <Button
                size="sm"
                className="bg-emerald-600 text-primary-foreground hover:bg-emerald-700"
                onClick={() => setOpen(true)}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Entitas Baru
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {entitiesQ.data.map((e) => {
            const meta = TYPE_META[e.type] ?? TYPE_META.personal;
            const Icon = meta.icon;
            const agg = byEntity.get(e.id);
            const count = e.assetCount ?? agg?.count ?? 0;
            const value = e.valueUsd ?? agg?.value ?? 0;
            return (
              <Card key={e.id} className="rounded-xl flex flex-col gap-3 p-5">
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                      meta.box,
                    )}
                    aria-hidden="true"
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{e.name}</p>
                    <Badge variant="outline" className={cn("mt-1", meta.badge)}>
                      {meta.label}
                    </Badge>
                  </div>
                </div>
                {e.description ? (
                  <p className="line-clamp-2 text-sm text-muted-foreground">{e.description}</p>
                ) : (
                  <p className="text-sm italic text-muted-foreground/70">Tanpa deskripsi</p>
                )}
                <div className="mt-auto flex items-center justify-between border-t pt-3 text-sm">
                  <span className="text-muted-foreground">{count} aset</span>
                  <span className="font-medium tabular-nums">
                    <CurrencyText usd={value} />
                  </span>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Dialog entitas baru (owner) */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Entitas Baru</DialogTitle>
            <DialogDescription>
              Kelompokkan aset ke dalam entitas personal, holding, atau family.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="entity-name">
                Nama Entitas <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="entity-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="mis. Z Family Holding"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Tipe</Label>
              <Select
                value={form.type}
                onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pilih tipe" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="personal">Personal</SelectItem>
                  <SelectItem value="holding">Holding</SelectItem>
                  <SelectItem value="family">Family</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="entity-desc">Deskripsi</Label>
              <Textarea
                id="entity-desc"
                rows={3}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Tujuan & cakupan entitas…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={createM.isPending}>
              Batal
            </Button>
            <Button
              className="bg-emerald-600 text-primary-foreground hover:bg-emerald-700"
              disabled={!form.name.trim() || createM.isPending}
              onClick={() => createM.mutate()}
            >
              {createM.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================
// Tab 2 — Pengguna
// ============================================================
function UsersTab() {
  const user = useAppStore((s) => s.user);
  const isExecutor = user?.role === "executor";
  const usersQ = useQuery<UserRow[], ApiError>({
    queryKey: ["users"],
    queryFn: () => apiFetch("/users"),
    enabled: !isExecutor,
  });

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="space-y-4 lg:col-span-3">
        {usersQ.isError ? (
          isExecutor ? (
            <ExecutorNote what="daftar pengguna" />
          ) : (
            <ErrorBox message={errMsg(usersQ.error)} onRetry={() => void usersQ.refetch()} />
          )
        ) : usersQ.isPending || !usersQ.data ? (
          isExecutor ? (
            <ExecutorNote what="daftar pengguna" />
          ) : (
            <LoadingRows rows={4} />
          )
        ) : (
          <>
          {/* Desktop: tabel penuh */}
          <div className="hidden overflow-hidden rounded-xl border md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Nama</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Peran</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {usersQ.data.map((u) => (
                  <tr key={u.id} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{u.name}</span>
                        {user?.id === u.id && (
                          <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                            Anda
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                    <td className="px-4 py-3">
                      <RoleBadge role={u.role} />
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                        Aktif
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: kartu (ronde 9 — hapus scroll horizontal tabel 4 kolom) */}
          <ul className="scrollbar-thin max-h-[26rem] space-y-2 overflow-y-auto pr-1 md:hidden">
            {usersQ.data.map((u) => (
              <li key={u.id} className="rounded-xl border bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600/15 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                      {u.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}
                    </span>
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                        {u.name}
                        {user?.id === u.id && (
                          <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                            Anda
                          </Badge>
                        )}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                    </div>
                  </div>
                  <RoleBadge role={u.role} />
                </div>
                <p className="mt-2 flex items-center gap-1.5 border-t pt-2 text-xs text-emerald-600 dark:text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                  Aktif
                </p>
              </li>
            ))}
          </ul>
          </>
        )}
      </div>

      {/* Kartu penjelasan RBAC */}
      <Card className="rounded-xl gap-4 p-5 lg:col-span-2">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Hak Akses per Peran (RBAC)
          </h3>
        </div>
        <ul className="space-y-4">
          {(Object.keys(ROLE_INFO) as Role[]).map((r) => (
            <li key={r} className="space-y-1">
              <div className="flex items-center gap-2">
                <RoleBadge role={r} />
                <span className="text-xs text-muted-foreground">{ROLE_INFO[r].desc}</span>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground/90">{ROLE_INFO[r].can}</p>
            </li>
          ))}
        </ul>
        <p className="border-t pt-3 text-xs text-muted-foreground/70">
          Role di-enforce di backend (HTTP 401/403) — UI hanya menyesuaikan tombol & aksi yang tersedia.
        </p>
      </Card>
    </div>
  );
}

// ============================================================
// Tab 3 — Persetujuan
// ============================================================
function ApprovalsTab() {
  const qc = useQueryClient();
  const user = useAppStore((s) => s.user);
  const isOwner = user?.role === "owner";
  const canDecide = user?.role === "owner" || user?.role === "beneficiary";
  const isExecutor = user?.role === "executor";

  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({ title: "", amountUsd: "", description: "" });

  const approvalsQ = useQuery<Approval[], ApiError>({
    queryKey: ["approvals"],
    queryFn: () => apiFetch("/approvals"),
    enabled: !isExecutor,
  });

  const decideM = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approve" | "reject" }) =>
      apiFetch(`/approvals/${id}/${decision}`, { method: "POST" }),
    onSuccess: (_d, v) => {
      toast.success(v.decision === "approve" ? "Pengajuan disetujui" : "Pengajuan ditolak");
      void qc.invalidateQueries({ queryKey: ["approvals"] });
      void qc.invalidateQueries({ queryKey: ["audit"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => toast.error("Gagal memutuskan pengajuan", { description: errMsg(e) }),
  });

  const createM = useMutation({
    mutationFn: () =>
      apiFetch("/approvals", {
        method: "POST",
        body: {
          title: form.title.trim(),
          description: form.description.trim(),
          amountUsd: Number(form.amountUsd) || 0,
        },
      }),
    onSuccess: () => {
      toast.success("Pengajuan approval dibuat");
      setOpen(false);
      setForm({ title: "", amountUsd: "", description: "" });
      void qc.invalidateQueries({ queryKey: ["approvals"] });
      void qc.invalidateQueries({ queryKey: ["audit"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => toast.error("Gagal membuat pengajuan", { description: errMsg(e) }),
  });

  const all = approvalsQ.data ?? [];
  const pending = all.filter((a) => a.status === "pending");
  const decided = all.filter((a) => a.status !== "pending");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {pending.length > 0
            ? `${pending.length} pengajuan menunggu keputusan.`
            : "Tidak ada pengajuan pending."}
        </p>
        {isOwner && (
          <Button
            size="sm"
            variant="outline"
            className="min-h-[36px]"
            onClick={() => setOpen(true)}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Pengajuan Baru
          </Button>
        )}
      </div>

      {approvalsQ.isError ? (
        isExecutor ? (
          <ExecutorNote what="approval" />
        ) : (
          <ErrorBox
            message={errMsg(approvalsQ.error)}
            onRetry={() => void approvalsQ.refetch()}
          />
        )
      ) : approvalsQ.isPending || !approvalsQ.data ? (
        isExecutor ? (
          <ExecutorNote what="approval" />
        ) : (
          <LoadingRows rows={4} />
        )
      ) : (
        <>
          {/* Pending */}
          {pending.length === 0 ? (
            <EmptyState
              icon={<ClipboardCheck className="h-6 w-6" />}
              title="Tidak ada approval pending"
              description="Semua pengajuan sudah diputuskan. Pengajuan baru dari owner akan tampil di sini."
            />
          ) : (
            <div className="space-y-3">
              {pending.map((a) => (
                <Card key={a.id} className="rounded-xl p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <p className="font-semibold">{a.title}</p>
                      {a.description && (
                        <p className="text-sm text-muted-foreground">{a.description}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Diminta oleh <span className="font-medium text-foreground">{a.requestedByName ?? "—"}</span>{" "}
                        · {timeAgo(a.createdAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                      <span className="text-lg font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                        <CurrencyText usd={a.amountUsd} />
                      </span>
                      {canDecide ? (
                        <div className="flex items-center gap-2">
                          <ConfirmButton
                            onConfirm={() => decideM.mutate({ id: a.id, decision: "approve" })}
                            confirmLabel="Klik lagi untuk setujui"
                            variant="outline"
                            className="border-emerald-500/50 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400"
                          >
                            <Check className="h-4 w-4" aria-hidden="true" />
                            Setujui
                          </ConfirmButton>
                          <ConfirmButton
                            onConfirm={() => decideM.mutate({ id: a.id, decision: "reject" })}
                            confirmLabel="Klik lagi untuk tolak"
                            variant="outline"
                            className="border-rose-500/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
                          >
                            <X className="h-4 w-4" aria-hidden="true" />
                            Tolak
                          </ConfirmButton>
                        </div>
                      ) : (
                        <span className="text-xs italic text-muted-foreground">
                          Hanya owner & beneficiary yang dapat memutuskan.
                        </span>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* Histori */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Histori Keputusan
            </h3>
            {decided.length === 0 ? (
              <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                Belum ada keputusan.
              </p>
            ) : (
              <ul className="divide-y rounded-xl border">
                {decided.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
                    <Badge
                      variant="outline"
                      className={cn(
                        a.status === "approved"
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                          : "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400",
                      )}
                    >
                      {a.status === "approved" ? "Disetujui" : "Ditolak"}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate font-medium">{a.title}</span>
                    <span className="tabular-nums text-muted-foreground">
                      <CurrencyText usd={a.amountUsd} />
                    </span>
                    <span className="text-xs text-muted-foreground">
                      oleh {a.decidedByName ?? "—"} · {formatDateTime(a.decidedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {/* Dialog pengajuan baru (owner) */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pengajuan Approval Baru</DialogTitle>
            <DialogDescription>
              Owner membuat pengajuan; owner & beneficiary kemudian memutuskan.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="appr-title">
                Judul <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="appr-title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="mis. Pembelian emas batangan 1 kg"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="appr-amount">
                Jumlah (USD) <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="appr-amount"
                type="number"
                min="0"
                step="any"
                className="tabular-nums"
                value={form.amountUsd}
                onChange={(e) => setForm((f) => ({ ...f, amountUsd: e.target.value }))}
                placeholder="0"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="appr-desc">Deskripsi</Label>
              <Textarea
                id="appr-desc"
                rows={3}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Konteks & justifikasi pengajuan…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={createM.isPending}>
              Batal
            </Button>
            <Button
              className="bg-emerald-600 text-primary-foreground hover:bg-emerald-700"
              disabled={!form.title.trim() || form.amountUsd === "" || createM.isPending}
              onClick={() => createM.mutate()}
            >
              {createM.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Buat Pengajuan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================
// Tab 4 — Audit Log
// ============================================================
function AuditTab() {
  const [actionInput, setActionInput] = React.useState("");
  const action = useDebounced(actionInput);
  const [userId, setUserId] = React.useState("all");

  const auditQ = useQuery<AuditLog[], ApiError>({
    queryKey: ["audit", { userId }],
    queryFn: () =>
      apiFetch("/audit", {
        params: {
          limit: 200,
          userId: userId === "all" ? undefined : Number(userId),
        },
      }),
  });
  const usersQ = useQuery<UserRow[], ApiError>({
    queryKey: ["users"],
    queryFn: () => apiFetch("/users"),
  });

  const rows = React.useMemo(() => {
    const q = action.trim().toLowerCase();
    const list = auditQ.data ?? [];
    if (!q) return list;
    return list.filter((r) => r.action.toLowerCase().includes(q));
  }, [auditQ.data, action]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={actionInput}
            onChange={(e) => setActionInput(e.target.value)}
            placeholder="Filter action — mis. approval, entity, auth…"
            className="pl-9"
          />
        </div>
        <Select value={userId} onValueChange={setUserId}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Semua pengguna" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua pengguna</SelectItem>
            {(usersQ.data ?? []).map((u) => (
              <SelectItem key={u.id} value={String(u.id)}>
                {u.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          className="min-h-[36px]"
          onClick={() => void auditQ.refetch()}
          disabled={auditQ.isFetching}
        >
          {auditQ.isFetching ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          )}
          Refresh
        </Button>
      </div>

      {auditQ.isError ? (
        <ErrorBox message={errMsg(auditQ.error)} onRetry={() => void auditQ.refetch()} />
      ) : auditQ.isPending ? (
        <LoadingRows rows={6} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<ScrollText className="h-6 w-6" />}
          title="Tidak ada entri audit"
          description="Coba ubah filter action atau pilih pengguna lain."
        />
      ) : (
        <>
          {/* ---------- Kartu mobile (<md) — tabel 5 kolom terpotong di 390px ---------- */}
          <div className="scrollbar-thin max-h-96 space-y-2 overflow-y-auto md:hidden">
            {rows.map((r) => (
              <div key={r.id} className="rounded-xl border bg-card p-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {r.action}
                  </Badge>
                  <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    {formatDateTime(r.createdAt)}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span className="text-xs font-medium">{r.userName}</span>
                  <RoleBadge role={r.role} className="px-1.5 text-[10px]" />
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                  {r.detail ?? "—"}
                </p>
              </div>
            ))}
          </div>

          {/* ---------- Tabel (≥md) ---------- */}
          <div className="scrollbar-thin hidden max-h-96 overflow-y-auto rounded-xl border md:block">
            <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Waktu</th>
                <th className="px-4 py-2.5 font-medium">Pengguna</th>
                <th className="px-4 py-2.5 font-medium">Aksi</th>
                <th className="px-4 py-2.5 font-medium">Entity</th>
                <th className="px-4 py-2.5 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0 align-top">
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs tabular-nums text-muted-foreground">
                    {formatDateTime(r.createdAt)}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{r.userName}</span>
                      <RoleBadge role={r.role} className="text-[10px] px-1.5" />
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge variant="outline" className="font-mono text-[11px]">
                      {r.action}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{r.entityType}</td>
                  <td className="max-w-[280px] px-4 py-2.5 text-muted-foreground">
                    <span className="line-clamp-2">{r.detail ?? "—"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
        <Lock className="h-3 w-3" aria-hidden="true" />
        Audit log bersifat append-only — entri tidak dapat diubah atau dihapus oleh siapa pun.
      </p>
    </div>
  );
}

// ============================================================
// GovernanceView
// ============================================================
export default function GovernanceView() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Governance"
        subtitle="Entitas, pengguna, approval workflow, dan audit log append-only."
      />
      <Tabs defaultValue="entities">
        <TabsList className="h-auto w-full flex-wrap justify-start sm:w-auto">
          <TabsTrigger value="entities">
            <Landmark className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
            <span className="hidden sm:inline">Entitas</span>
          </TabsTrigger>
          <TabsTrigger value="users">
            <Users className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
            <span className="hidden sm:inline">Pengguna</span>
          </TabsTrigger>
          <TabsTrigger value="approvals">
            <ClipboardCheck className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
            <span className="hidden sm:inline">Persetujuan</span>
          </TabsTrigger>
          <TabsTrigger value="audit">
            <ScrollText className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
            <span className="hidden sm:inline">Audit Log</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="entities" className="mt-4">
          <EntitiesTab />
        </TabsContent>
        <TabsContent value="users" className="mt-4">
          <UsersTab />
        </TabsContent>
        <TabsContent value="approvals" className="mt-4">
          <ApprovalsTab />
        </TabsContent>
        <TabsContent value="audit" className="mt-4">
          <AuditTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
