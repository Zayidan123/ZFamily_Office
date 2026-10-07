"use client";

// ============================================================
// Suksesi & Perencanaan — Tabs: Aturan Suksesi | Instruksi
// Darurat | Goals | Proyeksi | Time Capsule.
// RBAC: rules/goals/projection/capsules = owner & beneficiary;
// write = owner; emergency content penuh = owner.
// ============================================================
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAppStore } from "@/lib/store";
import { apiFetch, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/format";
import {
  EmptyState,
  ErrorBox,
  LoadingRows,
  PageHeader,
  SectionCard,
  useFormatCurrency,
} from "@/components/shared/kit";
import type { Capsule, EmergencyInstruction, Goal, SuccessionRule } from "@/lib/types";
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
import { Slider } from "@/components/ui/slider";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CalendarClock,
  Clock,
  Eye,
  FlaskConical,
  Heart,
  KeyRound,
  Loader2,
  Lock,
  LockOpen,
  Pencil,
  Plus,
  RotateCcw,
  ScrollText,
  ShieldAlert,
  Siren,
  Sparkles,
  Target,
} from "lucide-react";

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

function LockedPlannerNote() {
  return (
    <EmptyState
      icon={<Lock className="h-6 w-6" />}
      title="Akses terbatas"
      description="Modul ini hanya dapat dilihat oleh owner & beneficiary keluarga."
    />
  );
}

function deadlineInfo(deadline?: string | null): { label: string; cls: string } | null {
  if (!deadline) return null;
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return null;
  const days = Math.ceil((d.getTime() - Date.now()) / 86_400_000);
  if (days > 1) return { label: `${days} hari lagi`, cls: "text-emerald-600 dark:text-emerald-400" };
  if (days === 1) return { label: "Besok", cls: "text-amber-600 dark:text-amber-400" };
  if (days === 0) return { label: "Hari ini", cls: "text-amber-600 dark:text-amber-400" };
  return {
    label: `Terlewat ${Math.abs(days)} hari`,
    cls: "text-rose-600 dark:text-rose-400",
  };
}

const RULE_STATUS_META: Record<string, { label: string; className: string }> = {
  active: {
    label: "Aktif",
    className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  draft: {
    label: "Draft",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  revoked: {
    label: "Dicabut",
    className: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400",
  },
};

// ============================================================
// Tab 1 — Aturan Suksesi
// ============================================================
interface RuleFormState {
  beneficiaryName: string;
  relation: string;
  entityName: string;
  assetScope: string;
  conditions: string;
  trigger: string;
  status: "active" | "draft" | "revoked";
}

const EMPTY_RULE: RuleFormState = {
  beneficiaryName: "",
  relation: "",
  entityName: "",
  assetScope: "",
  conditions: "",
  trigger: "",
  status: "active",
};

function RuleFormDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: SuccessionRule | null;
}) {
  const qc = useQueryClient();
  const [form, setForm] = React.useState<RuleFormState>(EMPTY_RULE);

  React.useEffect(() => {
    if (!open) return;
    setForm(
      editing
        ? {
            beneficiaryName: editing.beneficiaryName,
            relation: editing.relation ?? "",
            entityName: editing.entityName ?? "",
            assetScope: editing.assetScope ?? "",
            conditions: editing.conditions ?? "",
            trigger: editing.trigger ?? "",
            status: (["active", "draft", "revoked"].includes(editing.status)
              ? editing.status
              : "active") as RuleFormState["status"],
          }
        : EMPTY_RULE,
    );
  }, [open, editing]);

  const saveM = useMutation({
    mutationFn: () => {
      const body = {
        beneficiaryName: form.beneficiaryName.trim(),
        relation: form.relation.trim(),
        entityName: form.entityName.trim() || null,
        assetScope: form.assetScope.trim(),
        conditions: form.conditions.trim(),
        trigger: form.trigger.trim(),
        status: form.status,
      };
      return editing
        ? apiFetch(`/succession/rules/${editing.id}`, { method: "PUT", body })
        : apiFetch("/succession/rules", { method: "POST", body });
    },
    onSuccess: () => {
      toast.success(editing ? "Aturan suksesi diperbarui" : "Aturan suksesi dibuat");
      onOpenChange(false);
      void qc.invalidateQueries({ queryKey: ["succession"] });
      void qc.invalidateQueries({ queryKey: ["audit"] });
    },
    onError: (e) => toast.error("Gagal menyimpan aturan", { description: errMsg(e) }),
  });

  const set = (patch: Partial<RuleFormState>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Aturan Suksesi" : "Aturan Suksesi Baru"}</DialogTitle>
          <DialogDescription>
            Tentukan siapa menerima apa, dengan kondisi & pemicu yang jelas.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rule-benef">
                Nama Beneficiary <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="rule-benef"
                value={form.beneficiaryName}
                onChange={(e) => set({ beneficiaryName: e.target.value })}
                placeholder="mis. Aisyah Zaydan"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rule-rel">Relasi</Label>
              <Input
                id="rule-rel"
                value={form.relation}
                onChange={(e) => set({ relation: e.target.value })}
                placeholder="mis. Anak, Pasangan"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rule-entity">Entitas terkait (opsional)</Label>
            <Input
              id="rule-entity"
              value={form.entityName}
              onChange={(e) => set({ entityName: e.target.value })}
              placeholder="mis. Z Family Holding"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rule-scope">Lingkup aset</Label>
            <Input
              id="rule-scope"
              value={form.assetScope}
              onChange={(e) => set({ assetScope: e.target.value })}
              placeholder="mis. Seluruh kripto & kas di entitas holding"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rule-cond">Kondisi</Label>
            <Textarea
              id="rule-cond"
              rows={2}
              value={form.conditions}
              onChange={(e) => set({ conditions: e.target.value })}
              placeholder="mis. Usia 25 tahun & menyelesaikan program literasi keuangan"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rule-trig">Pemicu (trigger)</Label>
              <Input
                id="rule-trig"
                value={form.trigger}
                onChange={(e) => set({ trigger: e.target.value })}
                placeholder="mis. Wafat / incapacity"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => set({ status: v as RuleFormState["status"] })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Aktif</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="revoked">Dicabut</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saveM.isPending}>
            Batal
          </Button>
          <Button
            className="bg-emerald-600 text-primary-foreground hover:bg-emerald-700"
            disabled={!form.beneficiaryName.trim() || saveM.isPending}
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

function RulesTab({ isOwner }: { isOwner: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<SuccessionRule | null>(null);

  const rulesQ = useQuery<SuccessionRule[], ApiError>({
    queryKey: ["succession"],
    queryFn: () => apiFetch("/succession/rules"),
  });

  return (
    <div className="space-y-4">
      {!isOwner && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Aturan suksesi hanya dapat dibuat/diubah oleh owner — Anda melihat versi read-only.
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Pembagian warisan terstruktur per beneficiary.
        </p>
        {isOwner && (
          <Button
            size="sm"
            className="min-h-[36px] bg-emerald-600 text-primary-foreground hover:bg-emerald-700"
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Aturan Baru
          </Button>
        )}
      </div>

      {rulesQ.isError ? (
        <ErrorBox message={errMsg(rulesQ.error)} onRetry={() => void rulesQ.refetch()} />
      ) : rulesQ.isPending || !rulesQ.data ? (
        <LoadingRows rows={4} />
      ) : rulesQ.data.length === 0 ? (
        <EmptyState
          icon={<ScrollText className="h-6 w-6" />}
          title="Belum ada aturan suksesi"
          description={
            isOwner
              ? "Buat aturan pertama untuk memetakan warisan ke beneficiary."
              : "Owner belum menetapkan aturan suksesi."
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rulesQ.data.map((r) => {
            const meta = RULE_STATUS_META[r.status] ?? RULE_STATUS_META.draft;
            return (
              <Card key={r.id} className="rounded-xl space-y-3 p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400"
                      aria-hidden="true"
                    >
                      <Heart className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{r.beneficiaryName}</p>
                      {r.relation && (
                        <p className="truncate text-xs text-muted-foreground">{r.relation}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Badge variant="outline" className={meta.className}>
                      {meta.label}
                    </Badge>
                    {isOwner && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        aria-label={`Edit aturan ${r.beneficiaryName}`}
                        onClick={() => {
                          setEditing(r);
                          setOpen(true);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                </div>
                <dl className="space-y-2 text-sm">
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
                      Entitas
                    </dt>
                    <dd className="min-w-0 flex-1">{r.entityName || "—"}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
                      Lingkup
                    </dt>
                    <dd className="min-w-0 flex-1">{r.assetScope || "—"}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
                      Kondisi
                    </dt>
                    <dd className="min-w-0 flex-1">{r.conditions || "—"}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
                      Pemicu
                    </dt>
                    <dd className="min-w-0 flex-1">{r.trigger || "—"}</dd>
                  </div>
                </dl>
              </Card>
            );
          })}
        </div>
      )}

      <RuleFormDialog open={open} onOpenChange={setOpen} editing={editing} />
    </div>
  );
}

// ============================================================
// Tab 2 — Instruksi Darurat
// ============================================================
function EmergencyTab({ isOwner }: { isOwner: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({ title: "", content: "" });

  const emergencyQ = useQuery<EmergencyInstruction[], ApiError>({
    queryKey: ["succession", "emergency"],
    queryFn: () => apiFetch("/succession/emergency"),
  });

  const createM = useMutation({
    mutationFn: () =>
      apiFetch("/succession/emergency", {
        method: "POST",
        body: { title: form.title.trim(), content: form.content },
      }),
    onSuccess: () => {
      toast.success("Instruksi darurat ditambahkan");
      setOpen(false);
      setForm({ title: "", content: "" });
      void qc.invalidateQueries({ queryKey: ["succession"] });
      void qc.invalidateQueries({ queryKey: ["audit"] });
    },
    onError: (e) => toast.error("Gagal menambah instruksi", { description: errMsg(e) }),
  });

  return (
    <div className="space-y-4">
      {!isOwner && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Instruksi darurat tersegel — konten penuh hanya dapat dibuka owner saat kondisi darurat
          terverifikasi.
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Panduan eksekusi saat keadaan darurat (krisis, incapacity, wafat).
        </p>
        {isOwner && (
          <Button
            size="sm"
            className="min-h-[36px] bg-emerald-600 text-primary-foreground hover:bg-emerald-700"
            onClick={() => setOpen(true)}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Instruksi
          </Button>
        )}
      </div>

      {emergencyQ.isError ? (
        <ErrorBox
          message={errMsg(emergencyQ.error)}
          onRetry={() => void emergencyQ.refetch()}
        />
      ) : emergencyQ.isPending || !emergencyQ.data ? (
        <LoadingRows rows={3} />
      ) : emergencyQ.data.length === 0 ? (
        <EmptyState
          icon={<Siren className="h-6 w-6" />}
          title="Belum ada instruksi darurat"
          description={
            isOwner
              ? "Tulis instruksi langkah demi langkah untuk keluarga saat darurat."
              : "Owner belum menambahkan instruksi darurat."
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {emergencyQ.data.map((inst) => (
            <Card key={inst.id} className="rounded-xl space-y-2 p-5">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold">{inst.title}</p>
                <Badge
                  variant="outline"
                  className={cn(
                    "shrink-0",
                    inst.sealed
                      ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                      : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                  )}
                >
                  {inst.sealed ? (
                    <>
                      <Lock className="h-3 w-3" aria-hidden="true" /> Tersegel
                    </>
                  ) : (
                    <>
                      <LockOpen className="h-3 w-3" aria-hidden="true" /> Terbuka
                    </>
                  )}
                </Badge>
              </div>
              {inst.sealed && !isOwner ? (
                <div className="relative overflow-hidden rounded-lg border border-amber-500/20 bg-muted/40">
                  <p className="pointer-events-none select-none blur-[3px] line-clamp-3 p-4 text-sm text-muted-foreground">
                    {inst.content ?? "Konten tersegel."}
                  </p>
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-background/55 p-4 text-center">
                    <Lock className="h-5 w-5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                    <p className="text-xs font-medium leading-snug text-amber-700 dark:text-amber-400">
                      Terkunci — konten penuh hanya saat kondisi darurat terverifikasi
                    </p>
                  </div>
                </div>
              ) : (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                  {inst.content ?? "—"}
                </p>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Dialog tambah instruksi (owner) */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Instruksi Darurat Baru</DialogTitle>
            <DialogDescription>
              Konten tersegel untuk non-owner; owner selalu dapat melihat penuh.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="em-title">
                Judul <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="em-title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="mis. Prosedur pembekuan trading darurat"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="em-content">
                Konten <span className="text-rose-500">*</span>
              </Label>
              <Textarea
                id="em-content"
                rows={6}
                value={form.content}
                onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                placeholder="Langkah 1… Langkah 2… kontak penting, akses, dsb."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={createM.isPending}>
              Batal
            </Button>
            <Button
              className="bg-emerald-600 text-primary-foreground hover:bg-emerald-700"
              disabled={!form.title.trim() || !form.content.trim() || createM.isPending}
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
// Tab 3 — Goals
// ============================================================
function GoalFormDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [form, setForm] = React.useState({
    name: "",
    targetUsd: "",
    currentUsd: "",
    deadline: "",
  });

  React.useEffect(() => {
    if (open) setForm({ name: "", targetUsd: "", currentUsd: "", deadline: "" });
  }, [open]);

  const createM = useMutation({
    mutationFn: () =>
      apiFetch("/planning/goals", {
        method: "POST",
        body: {
          name: form.name.trim(),
          targetUsd: Number(form.targetUsd) || 0,
          currentUsd: Number(form.currentUsd) || 0,
          deadline: form.deadline || null,
        },
      }),
    onSuccess: () => {
      toast.success("Goal dibuat");
      onOpenChange(false);
      void qc.invalidateQueries({ queryKey: ["planning"] });
      void qc.invalidateQueries({ queryKey: ["audit"] });
    },
    onError: (e) => toast.error("Gagal membuat goal", { description: errMsg(e) }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Goal Keuangan Baru</DialogTitle>
          <DialogDescription>Target terukur dengan progres & tenggat waktu.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="goal-name">
              Nama Goal <span className="text-rose-500">*</span>
            </Label>
            <Input
              id="goal-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="mis. Dana pendidikan anak"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="goal-target">
                Target (USD) <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="goal-target"
                type="number"
                min="1"
                step="any"
                className="tabular-nums"
                value={form.targetUsd}
                onChange={(e) => setForm((f) => ({ ...f, targetUsd: e.target.value }))}
                placeholder="mis. 250000"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="goal-current">Tercapai (USD)</Label>
              <Input
                id="goal-current"
                type="number"
                min="0"
                step="any"
                className="tabular-nums"
                value={form.currentUsd}
                onChange={(e) => setForm((f) => ({ ...f, currentUsd: e.target.value }))}
                placeholder="0"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="goal-deadline">Tenggat (opsional)</Label>
            <Input
              id="goal-deadline"
              type="date"
              value={form.deadline}
              onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={createM.isPending}>
            Batal
          </Button>
          <Button
            className="bg-emerald-600 text-primary-foreground hover:bg-emerald-700"
            disabled={!form.name.trim() || !(Number(form.targetUsd) > 0) || createM.isPending}
            onClick={() => createM.mutate()}
          >
            {createM.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GoalsTab({ isOwner }: { isOwner: boolean }) {
  const format = useFormatCurrency();
  const [open, setOpen] = React.useState(false);
  // simulasi dana per goal — client-side visual only
  const [sim, setSim] = React.useState<Record<string, string>>({});

  const goalsQ = useQuery<Goal[], ApiError>({
    queryKey: ["planning", "goals"],
    queryFn: () => apiFetch("/planning/goals"),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Target keuangan keluarga — {goalsQ.data?.length ?? 0} goal.
        </p>
        {isOwner && (
          <Button
            size="sm"
            className="min-h-[36px] bg-emerald-600 text-primary-foreground hover:bg-emerald-700"
            onClick={() => setOpen(true)}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Goal Baru
          </Button>
        )}
      </div>

      {goalsQ.isError ? (
        <ErrorBox message={errMsg(goalsQ.error)} onRetry={() => void goalsQ.refetch()} />
      ) : goalsQ.isPending || !goalsQ.data ? (
        <LoadingRows rows={3} />
      ) : goalsQ.data.length === 0 ? (
        <EmptyState
          icon={<Target className="h-6 w-6" />}
          title="Belum ada goal"
          description={
            isOwner
              ? "Tetapkan goal keuangan pertama — dana pendidikan, pensiun, dsb."
              : "Owner belum menetapkan goal keuangan."
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {goalsQ.data.map((g) => {
            const dl = deadlineInfo(g.deadline);
            const pct = Math.min(100, Math.max(0, g.progressPct));
            const good = pct >= 70;
            const simVal = Number(sim[g.id]);
            const hasSim = Number.isFinite(simVal) && simVal > 0;
            const simPct = g.targetUsd > 0 ? Math.min(100, ((g.currentUsd + simVal) / g.targetUsd) * 100) : 0;
            return (
              <Card key={g.id} className="rounded-xl space-y-3 p-5">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold">{g.name}</p>
                  {dl && (
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1 text-xs tabular-nums",
                        dl.cls,
                      )}
                    >
                      <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                      {dl.label}
                    </span>
                  )}
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="tabular-nums text-muted-foreground">
                      {format(g.currentUsd)} / {format(g.targetUsd)}
                    </span>
                    <span
                      className={cn(
                        "font-semibold tabular-nums",
                        good
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-amber-600 dark:text-amber-400",
                      )}
                    >
                      {pct.toFixed(1).replace(".", ",")}%
                    </span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        good ? "bg-emerald-500" : "bg-amber-500",
                      )}
                      style={{ width: `${Math.max(2, pct)}%` }}
                    />
                  </div>
                </div>

                {/* Simulasi dana (visual client-side) */}
                <div className="rounded-lg border border-dashed p-3">
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      className="h-8 tabular-nums text-xs"
                      placeholder="Simulasi tambah dana (USD)…"
                      value={sim[g.id] ?? ""}
                      onChange={(e) => setSim((s) => ({ ...s, [g.id]: e.target.value }))}
                    />
                    {hasSim && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 shrink-0 px-2 text-xs"
                        onClick={() => setSim((s) => ({ ...s, [g.id]: "" }))}
                      >
                        Reset
                      </Button>
                    )}
                  </div>
                  {hasSim && (
                    <p className="mt-2 text-xs tabular-nums text-amber-600 dark:text-amber-400">
                      +{format(simVal)} → {format(g.currentUsd + simVal)} ({simPct.toFixed(1).replace(".", ",")}
                      %) — simulasi visual, tidak disimpan
                    </p>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <GoalFormDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

// ============================================================
// Tab 4 — Proyeksi
// ============================================================
const PROJ_DEFAULT = { years: 30, growthPct: 10, annualContributionUsd: 50000 };

function ProjectionTab() {
  const format = useFormatCurrency();
  const [years, setYears] = React.useState(PROJ_DEFAULT.years);
  const [growthPct, setGrowthPct] = React.useState(PROJ_DEFAULT.growthPct);
  const [contribution, setContribution] = React.useState(PROJ_DEFAULT.annualContributionUsd);

  const dYears = useDebounced(years);
  const dGrowth = useDebounced(growthPct);
  const dContribution = useDebounced(contribution);

  const projQ = useQuery<{ year: number; valueUsd: number }[], ApiError>({
    queryKey: ["planning", "projection", { dYears, dGrowth, dContribution }],
    queryFn: () =>
      apiFetch("/planning/projection", {
        params: {
          years: dYears,
          growthPct: dGrowth,
          annualContributionUsd: dContribution,
        },
      }),
  });

  const data = projQ.data ?? [];
  const first = data[0]?.valueUsd ?? 0;
  const last = data.length > 0 ? data[data.length - 1].valueUsd : 0;
  const multiple = first > 0 ? last / first : null;

  const reset = () => {
    setYears(PROJ_DEFAULT.years);
    setGrowthPct(PROJ_DEFAULT.growthPct);
    setContribution(PROJ_DEFAULT.annualContributionUsd);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Form */}
      <SectionCard title="Parameter" description="Geser untuk memperbarui proyeksi" className="lg:col-span-1">
        <div className="space-y-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="proj-years">Durasi</Label>
              <span className="text-sm font-semibold tabular-nums">{years} tahun</span>
            </div>
            <Slider
              id="proj-years"
              min={5}
              max={50}
              step={1}
              value={[years]}
              onValueChange={(v) => setYears(v[0])}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>5 thn</span>
              <span>50 thn</span>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="proj-growth">Pertumbuhan / tahun</Label>
              <span className="text-sm font-semibold tabular-nums">
                {growthPct.toString().replace(".", ",")}%
              </span>
            </div>
            <Slider
              id="proj-growth"
              min={0}
              max={20}
              step={0.5}
              value={[growthPct]}
              onValueChange={(v) => setGrowthPct(v[0])}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>0%</span>
              <span>20%</span>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="proj-contrib">Kontribusi tahunan</Label>
              <span className="text-sm font-semibold tabular-nums">
                {format(contribution, true)}
              </span>
            </div>
            <Slider
              id="proj-contrib"
              min={0}
              max={500000}
              step={5000}
              value={[contribution]}
              onValueChange={(v) => setContribution(v[0])}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>0</span>
              <span>500 rb</span>
            </div>
          </div>

          <Button variant="outline" className="w-full" onClick={reset}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Reset (30 thn · 10% · 50 rb)
          </Button>

          <div className="grid grid-cols-2 gap-3 border-t pt-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Nilai akhir</p>
              {projQ.isPending || data.length === 0 ? (
                <p className="mt-1 text-lg font-semibold tabular-nums text-muted-foreground">—</p>
              ) : (
                <p className="mt-1 text-lg font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {format(last, true)}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Multiple</p>
              {projQ.isPending || data.length === 0 ? (
                <p className="mt-1 text-lg font-semibold tabular-nums text-muted-foreground">—</p>
              ) : (
                <p className="mt-1 text-lg font-semibold tabular-nums">
                  ×{multiple != null ? multiple.toFixed(1).replace(".", ",") : "—"}
                </p>
              )}
            </div>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground/70">
            Proyeksi = net worth saat ini × pertumbuhan majemuk + kontribusi tahunan. Bukan jaminan
            hasil masa depan.
          </p>
        </div>
      </SectionCard>

      {/* Chart */}
      <SectionCard
        title="Proyeksi Net Worth"
        description={`Simulasi ${dYears} tahun ke depan`}
        className="lg:col-span-2"
      >
        {projQ.isError ? (
          <ErrorBox message={errMsg(projQ.error)} onRetry={() => void projQ.refetch()} />
        ) : projQ.isPending || data.length === 0 ? (
          <div className="h-[340px] w-full animate-pulse rounded-lg bg-muted/60" aria-label="Memuat grafik" />
        ) : (
          <div className="h-[340px] w-full" role="img" aria-label="Grafik proyeksi net worth">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="projFill" x1="0" y1="0" x2="0" y2="1">
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
                  dataKey="year"
                  tickFormatter={(v: number) => `T${v}`}
                  tick={{ fill: "#71717a", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={24}
                />
                <YAxis
                  tickFormatter={(v: number) => format(v, true)}
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
                  }}
                  labelStyle={{ color: "var(--muted-foreground)", marginBottom: 4 }}
                  itemStyle={{ color: "var(--popover-foreground)" }}
                  formatter={(value) => [format(Number(value)), "Proyeksi"]}
                  labelFormatter={(label) => `Tahun ke-${label}`}
                />
                <Area
                  type="monotone"
                  dataKey="valueUsd"
                  stroke="#10b981"
                  strokeWidth={2.5}
                  fill="url(#projFill)"
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ============================================================
// Tab 5 — Time Capsule
// ============================================================
function CapsuleFormDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [form, setForm] = React.useState({
    title: "",
    content: "",
    unlockCondition: "",
    unlockDate: "",
  });

  React.useEffect(() => {
    if (open) setForm({ title: "", content: "", unlockCondition: "", unlockDate: "" });
  }, [open]);

  const createM = useMutation({
    mutationFn: () =>
      apiFetch("/planning/capsules", {
        method: "POST",
        body: {
          title: form.title.trim(),
          content: form.content,
          unlockCondition: form.unlockCondition.trim(),
          unlockDate: form.unlockDate || null,
        },
      }),
    onSuccess: () => {
      toast.success("Time capsule dibuat");
      onOpenChange(false);
      void qc.invalidateQueries({ queryKey: ["planning"] });
      void qc.invalidateQueries({ queryKey: ["audit"] });
    },
    onError: (e) => toast.error("Gagal membuat capsule", { description: errMsg(e) }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Time Capsule Baru</DialogTitle>
          <DialogDescription>
            Pesan yang terbuka otomatis ketika kondisi/tanggal terpenuhi.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="cap-title">
              Judul <span className="text-rose-500">*</span>
            </Label>
            <Input
              id="cap-title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="mis. Pesan untuk ulang tahun ke-21 Aisyah"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cap-content">
              Konten <span className="text-rose-500">*</span>
            </Label>
            <Textarea
              id="cap-content"
              rows={5}
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              placeholder="Tulis pesan, pelajaran hidup, atau panduan…"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cap-cond">Kondisi buka</Label>
              <Input
                id="cap-cond"
                value={form.unlockCondition}
                onChange={(e) => setForm((f) => ({ ...f, unlockCondition: e.target.value }))}
                placeholder="mis. Menikah / lulus S1"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cap-date">Tanggal buka (opsional)</Label>
              <Input
                id="cap-date"
                type="date"
                value={form.unlockDate}
                onChange={(e) => setForm((f) => ({ ...f, unlockDate: e.target.value }))}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={createM.isPending}>
            Batal
          </Button>
          <Button
            className="bg-emerald-600 text-primary-foreground hover:bg-emerald-700"
            disabled={!form.title.trim() || !form.content.trim() || createM.isPending}
            onClick={() => createM.mutate()}
          >
            {createM.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CapsulesTab({ isOwner }: { isOwner: boolean }) {
  const [open, setOpen] = React.useState(false);

  const capsulesQ = useQuery<Capsule[], ApiError>({
    queryKey: ["planning", "capsules"],
    queryFn: () => apiFetch("/planning/capsules"),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Pesan untuk generasi berikutnya — terbuka saat kondisi terpenuhi.
        </p>
        {isOwner && (
          <Button
            size="sm"
            className="min-h-[36px] bg-emerald-600 text-primary-foreground hover:bg-emerald-700"
            onClick={() => setOpen(true)}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Capsule
          </Button>
        )}
      </div>

      {capsulesQ.isError ? (
        <ErrorBox
          message={errMsg(capsulesQ.error)}
          onRetry={() => void capsulesQ.refetch()}
        />
      ) : capsulesQ.isPending || !capsulesQ.data ? (
        <LoadingRows rows={3} />
      ) : capsulesQ.data.length === 0 ? (
        <EmptyState
          icon={<Clock className="h-6 w-6" />}
          title="Belum ada time capsule"
          description={
            isOwner
              ? "Buat capsule pertama — pesan yang terbuka di masa depan."
              : "Owner belum membuat time capsule."
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {capsulesQ.data.map((c) => (
            <Card key={c.id} className="rounded-xl space-y-3 p-5">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold">{c.title}</p>
                <Badge
                  variant="outline"
                  className={cn(
                    "shrink-0",
                    c.unlocked
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
                  )}
                >
                  {c.unlocked ? (
                    <>
                      <LockOpen className="h-3 w-3" aria-hidden="true" /> Terbuka
                    </>
                  ) : (
                    <>
                      <Lock className="h-3 w-3" aria-hidden="true" /> Terkunci
                    </>
                  )}
                </Badge>
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">
                <p className="flex items-center gap-1.5">
                  <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                  {c.unlockCondition || "Tanpa kondisi khusus"}
                </p>
                {c.unlockDate && (
                  <p className="flex items-center gap-1.5 tabular-nums">
                    <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                    {formatDate(c.unlockDate)}
                  </p>
                )}
              </div>
              {c.unlocked ? (
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-3">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{c.content ?? "—"}</p>
                </div>
              ) : (
                <p className="flex items-center gap-1.5 text-xs italic text-muted-foreground/70">
                  <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                  Konten terbuka otomatis saat kondisi/tanggal terpenuhi.
                </p>
              )}
            </Card>
          ))}
        </div>
      )}

      <CapsuleFormDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

// ============================================================
// SuccessionView
// ============================================================
export default function SuccessionView() {
  const user = useAppStore((s) => s.user);
  const isOwner = user?.role === "owner";
  const isPlanner = user?.role === "owner" || user?.role === "beneficiary";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Suksesi & Perencanaan"
        subtitle="Aturan suksesi, instruksi darurat, goals, proyeksi, dan time capsule."
      />
      {!user ? null : !isPlanner ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-400">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Peran Anda ({user.role}) hanya dapat mengakses Instruksi Darurat. Modul perencanaan lain
          tersedia untuk owner & beneficiary.
        </div>
      ) : null}
      <Tabs defaultValue="rules">
        <TabsList className="h-auto w-full flex-wrap justify-start sm:w-auto">
          <TabsTrigger value="rules">
            <ScrollText className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
            <span className="hidden sm:inline">Aturan Suksesi</span>
          </TabsTrigger>
          <TabsTrigger value="emergency">
            <Siren className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
            <span className="hidden sm:inline">Instruksi Darurat</span>
          </TabsTrigger>
          <TabsTrigger value="goals">
            <Target className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
            <span className="hidden sm:inline">Goals</span>
          </TabsTrigger>
          <TabsTrigger value="projection">
            <FlaskConical className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
            <span className="hidden sm:inline">Proyeksi</span>
          </TabsTrigger>
          <TabsTrigger value="capsules">
            <Sparkles className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
            <span className="hidden sm:inline">Time Capsule</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="rules" className="mt-4">
          {isPlanner ? <RulesTab isOwner={!!isOwner} /> : <LockedPlannerNote />}
        </TabsContent>
        <TabsContent value="emergency" className="mt-4">
          <EmergencyTab isOwner={!!isOwner} />
        </TabsContent>
        <TabsContent value="goals" className="mt-4">
          {isPlanner ? <GoalsTab isOwner={!!isOwner} /> : <LockedPlannerNote />}
        </TabsContent>
        <TabsContent value="projection" className="mt-4">
          {isPlanner ? <ProjectionTab /> : <LockedPlannerNote />}
        </TabsContent>
        <TabsContent value="capsules" className="mt-4">
          {isPlanner ? <CapsulesTab isOwner={!!isOwner} /> : <LockedPlannerNote />}
        </TabsContent>
      </Tabs>
    </div>
  );
}
