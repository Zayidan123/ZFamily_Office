"use client";

// ============================================================
// Pengaturan — Preferensi · Target Alokasi · Keamanan & Darurat
// (Panic Mode) · Data & Portabilitas · Roadmap Platform (PRD).
// RBAC: PUT settings / panic / export = owner.
// ============================================================
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { useAppStore } from "@/lib/store";
import { apiFetch, apiGetBlob, ApiError } from "@/lib/api";
import {
  PageHeader,
  SectionCard,
  ErrorBox,
  LoadingRows,
  ConfirmButton,
} from "@/components/shared/kit";
import type {
  AllocationTarget,
  NotifyChannelKey,
  NotifyChannelsData,
  Settings,
  SystemBackupCreated,
  SystemBackupList,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  AlertTriangle,
  BellRing,
  Check,
  Copy,
  DatabaseBackup,
  Download,
  Info,
  Loader2,
  Mail,
  Monitor,
  Moon,
  Palette,
  PieChart,
  Plus,
  Send,
  ShieldCheck,
  Siren,
  Smartphone,
  Sun,
} from "lucide-react";
import { formatDateTime, timeAgo } from "@/lib/format";

type SettingsData = Settings & { panicMode?: boolean };

function errMsg(err: unknown): string {
  return err instanceof ApiError ? err.message : "Backend belum terjangkau — mencoba lagi";
}

const ALLOC_KEYS: { key: keyof AllocationTarget; label: string }[] = [
  { key: "crypto", label: "Kripto" },
  { key: "stocks", label: "Saham" },
  { key: "forexGold", label: "Forex / Emas" },
  { key: "property", label: "Properti" },
  { key: "cash", label: "Kas" },
];

const DEFAULT_TARGETS: AllocationTarget = {
  crypto: 10,
  stocks: 40,
  forexGold: 15,
  property: 20,
  cash: 15,
};

function numOr(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Pola focus-visible konsisten (polish S-b) */
const focusRing =
  "focus-visible:ring-2 focus-visible:ring-emerald-500/60 focus-visible:ring-offset-2";

interface MfaStatus {
  enabled: boolean;
  hasSecret: boolean;
}

interface MfaSetup {
  secret: string;
  otpauthUrl: string;
}

// ------------------------------------------------------------
// Roadmap PRD — 8 modul, status Live vs Roadmap (MVP cakupan)
// ------------------------------------------------------------
const ROADMAP: { code: string; name: string; features: { label: string; live: boolean }[] }[] = [
  {
    code: "A",
    name: "Wealth Aggregation",
    features: [
      { label: "Dashboard net worth real-time", live: true },
      { label: "Input aset manual + kelas aset", live: true },
      { label: "Rekaman wallet / exchange / fisik", live: true },
      { label: "Price table pasar + kurs USD/IDR", live: true },
      { label: "Histori nilai portofolio (snapshot)", live: true },
      { label: "Sinkronisasi API exchange otomatis", live: false },
      { label: "Import CSV / broker statement", live: false },
      { label: "Agregasi rekening bank & indexer on-chain", live: false },
    ],
  },
  {
    code: "B",
    name: "Portfolio & Risk",
    features: [
      { label: "Alokasi per kelas aset", live: true },
      { label: "Target alokasi & indikator drift", live: true },
      { label: "Analisis konsentrasi posisi", live: true },
      { label: "VaR 95% portofolio", live: true },
      { label: "Stress test skenario kustom", live: true },
      { label: "Matriks korelasi antar aset", live: false },
      { label: "Rekomendasi rebalancing otomatis", live: false },
      { label: "Atribusi kinerja risk-adjusted", live: false },
    ],
  },
  {
    code: "C",
    name: "Trading Bridge",
    features: [
      { label: "Log strategi multi-platform", live: true },
      { label: "Riwayat trade & PnL", live: true },
      { label: "Kinerja & win rate per strategi", live: true },
      { label: "Alert trading terpusat", live: true },
      { label: "Kanal notifikasi Email & Telegram", live: true },
      { label: "Eksekusi order otomatis via exchange API", live: false },
      { label: "Paper trading sandbox", live: false },
      { label: "Copy-trading antar strategi", live: false },
      { label: "Position sizing & auto risk limit", live: false },
    ],
  },
  {
    code: "D",
    name: "Governance",
    features: [
      { label: "Multi-entitas (personal/holding/family)", live: true },
      { label: "Manajemen pengguna & RBAC 4 peran", live: true },
      { label: "Approval workflow (pending→decided)", live: true },
      { label: "Audit log append-only", live: true },
      { label: "Notulen rapat & keputusan keluarga", live: false },
      { label: "Voting keputusan keluarga", live: false },
      { label: "Policy engine granular per entitas", live: false },
      { label: "Laporan kepatuhan tahunan", live: false },
    ],
  },
  {
    code: "E",
    name: "Security",
    features: [
      { label: "Panic mode kill-switch", live: true },
      { label: "RBAC enforced di backend", live: true },
      { label: "Audit trail login & mutasi", live: true },
      { label: "Simulasi 2FA", live: true },
      { label: "MFA TOTP (authenticator app)", live: true },
      { label: "Enkripsi at-rest penuh + HSM", live: false },
      { label: "Device pairing & SSO", live: false },
      { label: "Audit keamanan eksternal (SOC2-style)", live: false },
    ],
  },
  {
    code: "F",
    name: "Tax & Compliance",
    features: [
      { label: "Rekap transaksi & PnL tercatat", live: true },
      { label: "Ekspor data penuh (portabilitas)", live: true },
      { label: "Kalkulasi pajak kripto multi-yurisdiksi", live: false },
      { label: "Cost-basis engine FIFO/LIFO/Rata-rata", live: true },
      { label: "Tracking regulasi lintas negara", live: false },
      { label: "Laporan FATCA/CRS helper", live: false },
      { label: "Integrasi e-filing DJP", live: false },
    ],
  },
  {
    code: "G",
    name: "Research Vault",
    features: [
      { label: "Catatan riset thesis/target/exit", live: true },
      { label: "Tag, status & pencarian riset", live: true },
      { label: "Tautan riset ↔ aset portofolio", live: true },
      { label: "Arsip berita pasar per aset", live: false },
      { label: "Reminder review thesis berkala", live: false },
      { label: "Backtesting thesis vs histori harga", live: false },
      { label: "Integrasi data fundamental & screener", live: false },
    ],
  },
  {
    code: "H",
    name: "Generational",
    features: [
      { label: "Aturan suksesi per beneficiary", live: true },
      { label: "Instruksi darurat tersegel", live: true },
      { label: "Goals keuangan + progres", live: true },
      { label: "Proyeksi compound growth", live: true },
      { label: "Time capsule (pesan masa depan)", live: true },
      { label: "Modul edukasi ahli waris", live: false },
      { label: "Digital legacy vault kredensial", live: false },
      { label: "Struktur yayasan & philanthropy", live: false },
      { label: "Simulasi pajak warisan", live: false },
    ],
  },
];

function LiveBadge({ live }: { live: boolean }) {
  return live ? (
    <Badge
      variant="outline"
      className="shrink-0 border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0 text-[10px] text-emerald-700 dark:text-emerald-400"
    >
      Live
    </Badge>
  ) : (
    <Badge
      variant="outline"
      className="shrink-0 border-zinc-500/40 bg-zinc-500/10 px-1.5 py-0 text-[10px] text-zinc-600 dark:text-zinc-300"
    >
      Roadmap
    </Badge>
  );
}

// ============================================================
// SettingsView
// ============================================================
export default function SettingsView() {
  const qc = useQueryClient();
  const user = useAppStore((s) => s.user);
  const displayCurrency = useAppStore((s) => s.displayCurrency);
  const setDisplayCurrency = useAppStore((s) => s.setDisplayCurrency);
  const { theme, setTheme } = useTheme();
  const isOwner = user?.role === "owner";

  // ---------- Query settings ----------
  const settingsQ = useQuery<SettingsData, ApiError>({
    queryKey: ["settings"],
    queryFn: () => apiFetch("/settings"),
  });

  const putM = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch("/settings", { method: "PUT", body }),
    onSuccess: () => {
      toast.success("Pengaturan disimpan");
      void qc.invalidateQueries({ queryKey: ["settings"] });
      void qc.invalidateQueries({ queryKey: ["risk"] });
    },
    onError: (e) => toast.error("Gagal menyimpan pengaturan", { description: errMsg(e) }),
  });

  // ---------- Status sistem (panic mode) ----------
  const statusQ = useQuery({
    queryKey: ["system-status"],
    queryFn: () => apiFetch<{ panicMode: boolean; version: string; serverTime: string }>("/system/status"),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
  const panicOn = statusQ.data?.panicMode === true;

  const panicM = useMutation({
    mutationFn: (enabled: boolean) =>
      apiFetch("/system/panic", { method: "POST", body: { enabled } }),
    onSuccess: (_d, enabled) => {
      toast.success(enabled ? "PANIC MODE AKTIF" : "Panic mode dimatikan", {
        description: enabled
          ? "Semua operasi tulis backend diblokir (HTTP 423)."
          : "Sistem kembali normal.",
      });
      setPanicOpen(false);
      setPanicText("");
      void qc.invalidateQueries({ queryKey: ["system-status"] });
    },
    onError: (e) => toast.error("Gagal mengubah panic mode", { description: errMsg(e) }),
  });

  const [panicOpen, setPanicOpen] = React.useState(false);
  const [panicText, setPanicText] = React.useState("");

  // ---------- Target alokasi ----------
  const [targets, setTargets] = React.useState<AllocationTarget>(DEFAULT_TARGETS);
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    const at = settingsQ.data?.allocationTargets;
    if (at && !dirty) {
      setTargets({
        crypto: numOr(at.crypto, DEFAULT_TARGETS.crypto),
        stocks: numOr(at.stocks, DEFAULT_TARGETS.stocks),
        forexGold: numOr(at.forexGold, DEFAULT_TARGETS.forexGold),
        property: numOr(at.property, DEFAULT_TARGETS.property),
        cash: numOr(at.cash, DEFAULT_TARGETS.cash),
      });
    }
  }, [settingsQ.data, dirty]);

  const total =
    targets.crypto + targets.stocks + targets.forexGold + targets.property + targets.cash;
  const totalOk = Math.round(total) === 100;

  const saveTargets = () => {
    putM.mutate({ allocationTargets: targets });
    setDirty(false);
  };

  // ---------- Ekspor data ----------
  const exportM = useMutation({
    mutationFn: async () => {
      const data = await apiFetch<unknown>("/admin/export");
      const now = new Date();
      const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
        now.getDate(),
      ).padStart(2, "0")}`;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `family-office-export-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return blob.size;
    },
    onSuccess: (size) =>
      toast.success("Ekspor berhasil diunduh", {
        description: `family-office-export-*.json · ${(size / 1024).toFixed(1)} KB`,
      }),
    onError: (e) => toast.error("Gagal mengekspor data", { description: errMsg(e) }),
  });

  // ---------- Backup database (ronde 7) ----------
  const backupsQ = useQuery<SystemBackupList, ApiError>({
    queryKey: ["system", "backups"],
    queryFn: () => apiFetch<SystemBackupList>("/system/backups"),
    enabled: isOwner,
    staleTime: 15_000,
    retry: false,
  });

  const backupM = useMutation({
    mutationFn: () => apiFetch<SystemBackupCreated>("/system/backup", { method: "POST" }),
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey: ["system", "backups"] });
      toast.success("Backup database dibuat", {
        description: `${d.name} · ${(d.sizeBytes / 1024).toFixed(0)} KB · ${d.totalBackups} backup tersimpan`,
      });
    },
    onError: (e) =>
      toast.error("Gagal membuat backup", {
        description: e instanceof ApiError ? e.message : "Backend belum terjangkau",
      }),
  });

  const downloadBackupM = useMutation({
    mutationFn: async (name: string) => {
      const blob = await apiGetBlob(`/system/backups/${encodeURIComponent(name)}/download`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return blob.size;
    },
    onSuccess: (size, name) =>
      toast.success("Backup diunduh", { description: `${name} · ${(size / 1024).toFixed(0)} KB` }),
    onError: (e) =>
      toast.error("Gagal mengunduh backup", {
        description: e instanceof ApiError ? e.message : "Backend belum terjangkau",
      }),
  });

  // ---------- Kanal Notifikasi (ronde 9) ----------
  const canReadNotify = user?.role === "owner" || user?.role === "beneficiary" || user?.role === "advisor";

  const notifyQ = useQuery<NotifyChannelsData, ApiError>({
    queryKey: ["notify-channels"],
    queryFn: () => apiFetch<NotifyChannelsData>("/settings/notification-channels"),
    enabled: canReadNotify,
    staleTime: 15_000,
    retry: false,
  });

  // form lokal (draft) — disinkronkan dgn data query saat pertama load
  const [notifyDraft, setNotifyDraft] = React.useState<
    Record<NotifyChannelKey, { enabled: boolean; target: string }>
  >({
    email: { enabled: false, target: "" },
    telegram: { enabled: false, target: "" },
  });
  const [notifyDirty, setNotifyDirty] = React.useState(false);

  const notifyLoadedRef = React.useRef(false);
  React.useEffect(() => {
    if (notifyQ.data && !notifyLoadedRef.current) {
      notifyLoadedRef.current = true;
      setNotifyDraft(notifyQ.data.channels);
    }
  }, [notifyQ.data]);

  const notifyPutM = useMutation({
    mutationFn: () =>
      apiFetch<NotifyChannelsData>("/settings/notification-channels", {
        method: "PUT",
        body: { channels: notifyDraft },
      }),
    onSuccess: (d: NotifyChannelsData) => {
      notifyLoadedRef.current = true;
      setNotifyDraft(d.channels);
      setNotifyDirty(false);
      void qc.invalidateQueries({ queryKey: ["notify-channels"] });
      toast.success("Kanal notifikasi disimpan", {
        description: Object.entries(d.channels)
          .map(([k, v]) => `${k} ${v.enabled ? "aktif" : "nonaktif"}`)
          .join(" · "),
      });
    },
    onError: (e) => toast.error("Gagal menyimpan kanal notifikasi", { description: errMsg(e) }),
  });

  const notifyTestM = useMutation({
    mutationFn: (channel: NotifyChannelKey) =>
      apiFetch<{ channel: NotifyChannelKey; target: string }>(
        "/settings/notification-channels/test",
        {
          method: "POST",
          body: { channel },
        },
      ),
    onSuccess: (d: { channel: NotifyChannelKey; target: string }, channel) => {
      void qc.invalidateQueries({ queryKey: ["notify-channels"] });
      toast.success(`Tes ${channel} terkirim (mock)`, {
        description: `Disimulasikan terkirim ke ${d.target} — tercatat di riwayat & audit log.`,
      });
    },
    onError: (e) => toast.error("Gagal mengirim tes", { description: errMsg(e) }),
  });

  // ---------- MFA — Autentikasi Dua Faktor (Task S-b) ----------
  const mfaStatusQ = useQuery<MfaStatus, ApiError>({
    queryKey: ["auth", "mfa", "status"],
    queryFn: () => apiFetch<MfaStatus>("/auth/mfa/status"),
    staleTime: 30_000,
  });
  const mfaEnabled = mfaStatusQ.data?.enabled === true;

  const [setupOpen, setSetupOpen] = React.useState(false);
  const [setupData, setSetupData] = React.useState<MfaSetup | null>(null);
  const [setupCode, setSetupCode] = React.useState("");
  const [copied, setCopied] = React.useState(false);

  const mfaSetupM = useMutation({
    mutationFn: () => apiFetch<MfaSetup>("/auth/mfa/setup", { method: "POST" }),
    onSuccess: (d) => setSetupData(d),
    onError: (e) => {
      toast.error("Gagal menyiapkan MFA", { description: errMsg(e) });
      setSetupOpen(false);
    },
  });

  const openSetup = () => {
    setSetupData(null);
    setSetupCode("");
    setCopied(false);
    setSetupOpen(true);
    mfaSetupM.mutate();
  };

  const copySecret = async () => {
    if (!setupData?.secret) return;
    try {
      await navigator.clipboard.writeText(setupData.secret);
      setCopied(true);
      toast.success("Secret disalin ke clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Gagal menyalin — salin manual dari teks secret");
    }
  };

  const mfaEnableM = useMutation({
    mutationFn: (code: string) =>
      apiFetch<unknown>("/auth/mfa/enable", { method: "POST", body: { code } }),
    onSuccess: () => {
      toast.success("MFA diaktifkan", {
        description: "Login berikutnya akan meminta kode authenticator.",
      });
      setSetupOpen(false);
      setSetupCode("");
      setSetupData(null);
      void qc.invalidateQueries({ queryKey: ["auth", "mfa"] });
    },
    onError: (e) => toast.error("Kode ditolak", { description: errMsg(e) }),
  });

  const [disableOpen, setDisableOpen] = React.useState(false);
  const [disableCode, setDisableCode] = React.useState("");

  const mfaDisableM = useMutation({
    mutationFn: (code: string) =>
      apiFetch<unknown>("/auth/mfa/disable", { method: "POST", body: { code } }),
    onSuccess: () => {
      toast.success("MFA dinonaktifkan", {
        description: "Login tidak lagi meminta kode authenticator.",
      });
      setDisableOpen(false);
      setDisableCode("");
      void qc.invalidateQueries({ queryKey: ["auth", "mfa"] });
    },
    onError: (e) => toast.error("Kode ditolak", { description: errMsg(e) }),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pengaturan"
        subtitle="Preferensi tampilan, target alokasi, keamanan, dan portabilitas data."
      />

      {settingsQ.isError && (
        <ErrorBox message={errMsg(settingsQ.error)} onRetry={() => void settingsQ.refetch()} />
      )}

      {/* ================= Preferensi ================= */}
      <SectionCard title="Preferensi" description="Tampilan mata uang & tema aplikasi">
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="pref-currency">
              <span className="inline-flex items-center gap-1.5">
                <DatabaseBackup className="h-3.5 w-3.5" aria-hidden="true" />
                Mata Uang Tampilan
              </span>
            </Label>
            <Select
              value={displayCurrency}
              onValueChange={(v) => {
                setDisplayCurrency(v as "USD" | "IDR");
                if (isOwner) putM.mutate({ displayCurrency: v });
              }}
            >
              <SelectTrigger id="pref-currency" className="w-full sm:w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="USD">USD — Dolar AS ($)</SelectItem>
                <SelectItem value="IDR">IDR — Rupiah (Rp)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {isOwner
                ? "Tersimpan ke server & perangkat ini."
                : "Tersimpan di perangkat ini (ubah server hanya owner)."}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pref-theme">
              <span className="inline-flex items-center gap-1.5">
                <Palette className="h-3.5 w-3.5" aria-hidden="true" />
                Tema
              </span>
            </Label>
            <Select value={theme ?? "system"} onValueChange={(v) => setTheme(v)}>
              <SelectTrigger id="pref-theme" className="w-full sm:w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">
                  <span className="inline-flex items-center gap-1.5">
                    <Sun className="h-3.5 w-3.5" aria-hidden="true" /> Terang
                  </span>
                </SelectItem>
                <SelectItem value="dark">
                  <span className="inline-flex items-center gap-1.5">
                    <Moon className="h-3.5 w-3.5" aria-hidden="true" /> Gelap
                  </span>
                </SelectItem>
                <SelectItem value="system">
                  <span className="inline-flex items-center gap-1.5">
                    <Monitor className="h-3.5 w-3.5" aria-hidden="true" /> Sistem
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Mengikuti preferensi perangkat bila Sistem.</p>
          </div>
        </div>
      </SectionCard>

      {/* ================= Target Alokasi ================= */}
      <SectionCard
        title="Target Alokasi"
        description="Komposisi ideal portofolio — pembanding untuk analisis risiko"
        actions={
          <Badge
            variant="outline"
            className={cn(
              "tabular-nums",
              totalOk
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400",
            )}
          >
            Total {total.toString().replace(".", ",")}%
            {totalOk ? " ✓" : " — harus 100%"}
          </Badge>
        }
      >
        {settingsQ.isPending ? (
          <LoadingRows rows={5} />
        ) : (
          <div className="space-y-5">
            {ALLOC_KEYS.map(({ key, label }) => (
              <div key={key} className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor={`alloc-${key}`}>{label}</Label>
                  <span className="text-sm font-semibold tabular-nums">
                    {targets[key].toString().replace(".", ",")}%
                  </span>
                </div>
                <Slider
                  id={`alloc-${key}`}
                  min={0}
                  max={100}
                  step={1}
                  value={[targets[key]]}
                  onValueChange={(v) => {
                    setTargets((t) => ({ ...t, [key]: v[0] }));
                    setDirty(true);
                  }}
                  disabled={!isOwner}
                />
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              {!isOwner && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Info className="h-3.5 w-3.5" aria-hidden="true" />
                  Hanya owner yang dapat mengubah target alokasi.
                </p>
              )}
              {isOwner && !totalOk && (
                <p className="flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-400">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                  Jumlah target harus tepat 100% sebelum dapat disimpan.
                </p>
              )}
              {isOwner && (
                <Button
                  className="ml-auto min-h-[40px] bg-emerald-600 text-primary-foreground hover:bg-emerald-700"
                  disabled={!totalOk || putM.isPending}
                  onClick={saveTargets}
                >
                  {putM.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Check className="h-4 w-4" aria-hidden="true" />
                  )}
                  Simpan Target
                </Button>
              )}
            </div>
          </div>
        )}
      </SectionCard>

      {/* ================= Keamanan & Darurat ================= */}
      <SectionCard title="Keamanan & Darurat" description="Kill-switch untuk membekukan seluruh operasi tulis">
        <Card
          className={cn(
            "rounded-xl border-2 p-5 transition-colors",
            panicOn ? "border-rose-500/50 bg-rose-500/[0.04]" : "border-border",
          )}
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                  panicOn
                    ? "bg-rose-500/15 text-rose-600 dark:text-rose-400"
                    : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                )}
                aria-hidden="true"
              >
                <Siren className="h-5 w-5" />
              </span>
              <div className="space-y-0.5">
                <p className="font-semibold">Panic Mode (Kill Switch)</p>
                <p className="text-sm text-muted-foreground">
                  Saat aktif, semua endpoint mutasi menolak request (HTTP 423) — hanya owner dapat
                  mematikannya.
                </p>
                <div className="pt-1">
                  {statusQ.isPending ? (
                    <Badge variant="outline">Memeriksa status…</Badge>
                  ) : statusQ.isError ? (
                    <Badge
                      variant="outline"
                      className="border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400"
                    >
                      Status tidak tersedia
                    </Badge>
                  ) : panicOn ? (
                    <Badge className="border-transparent bg-rose-500/15 text-rose-700 dark:text-rose-400">
                      <Siren className="h-3 w-3" aria-hidden="true" /> AKTIF — mutasi diblokir
                    </Badge>
                  ) : (
                    <Badge className="border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                      <ShieldCheck className="h-3 w-3" aria-hidden="true" /> Normal
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            {isOwner && (
              <div className="flex shrink-0 items-center gap-3">
                {!panicOn ? (
                  <>
                    <Switch
                      checked={false}
                      onCheckedChange={(v) => {
                        if (v) setPanicOpen(true);
                      }}
                      aria-label="Aktifkan panic mode"
                    />
                    <ConfirmButton
                      variant="destructive"
                      onConfirm={() => setPanicOpen(true)}
                      confirmLabel="Yakin? Klik lagi"
                      className="min-h-[40px]"
                    >
                      AKTIFKAN PANIC MODE
                    </ConfirmButton>
                  </>
                ) : (
                  <ConfirmButton
                    variant="outline"
                    className="min-h-[40px] border-rose-500/40 text-rose-600 dark:text-rose-400"
                    onConfirm={() => panicM.mutate(false)}
                  >
                    {panicM.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : null}
                    Matikan Panic Mode
                  </ConfirmButton>
                )}
              </div>
            )}
          </div>

          {!isOwner && (
            <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
              Status read-only — kontrol panic mode hanya tersedia untuk owner.
            </p>
          )}
        </Card>
      </SectionCard>

      {/* ================= Autentikasi Dua Faktor (MFA) ================= */}
      <SectionCard
        title="Autentikasi Dua Faktor (MFA)"
        description="Lapisan TOTP untuk login — setiap pengguna mengelola MFA miliknya sendiri"
        actions={
          mfaStatusQ.isPending ? (
            <Badge variant="outline" className="text-muted-foreground">
              Memeriksa status…
            </Badge>
          ) : mfaStatusQ.isError ? (
            <Badge
              variant="outline"
              className="border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400"
            >
              Status tidak tersedia
            </Badge>
          ) : mfaEnabled ? (
            <Badge className="border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
              <ShieldCheck className="h-3 w-3" aria-hidden="true" /> Aktif
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="border-zinc-500/40 bg-zinc-500/10 text-zinc-600 dark:text-zinc-300"
            >
              Nonaktif
            </Badge>
          )
        }
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                mfaEnabled
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-zinc-500/10 text-zinc-500 dark:text-zinc-400",
              )}
              aria-hidden="true"
            >
              <Smartphone className="h-5 w-5" />
            </span>
            <div className="space-y-0.5">
              <p className="text-sm font-medium">
                {mfaEnabled
                  ? "Akun Anda dilindungi kode authenticator (TOTP)"
                  : "Tambahkan lapisan keamanan ekstra di login"}
              </p>
              <p className="text-sm text-muted-foreground">
                {mfaEnabled
                  ? "Setiap login meminta kode 6 digit dari aplikasi authenticator setelah email & password benar."
                  : "Setelah aktif, login meminta kode 6 digit dari aplikasi authenticator (Google Authenticator, Authy, dsb.)."}
              </p>
              {mfaStatusQ.isError && (
                <p className="text-xs text-rose-600 dark:text-rose-400">
                  Gagal memuat status MFA — {errMsg(mfaStatusQ.error)}
                </p>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {mfaEnabled ? (
              <Button
                type="button"
                variant="outline"
                className={cn(
                  focusRing,
                  "min-h-[40px] border-rose-500/40 text-rose-600 dark:text-rose-400",
                )}
                onClick={() => {
                  setDisableCode("");
                  setDisableOpen(true);
                }}
              >
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                Nonaktifkan MFA
              </Button>
            ) : (
              <Button
                type="button"
                className={cn(
                  focusRing,
                  "min-h-[40px] bg-emerald-600 text-primary-foreground hover:bg-emerald-700",
                )}
                onClick={openSetup}
                disabled={mfaSetupM.isPending}
              >
                {mfaSetupM.isPending && setupOpen ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                )}
                Aktifkan MFA
              </Button>
            )}
          </div>
        </div>
      </SectionCard>

      {/* ================= Data & Portabilitas ================= */}
      <SectionCard title="Data & Portabilitas" description="Ekspor seluruh data platform dalam format JSON">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              aria-hidden="true"
            >
              <Download className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-medium">Ekspor JSON lengkap</p>
              <p className="text-sm text-muted-foreground">
                Berisi pengguna, entitas, aset, transaksi, riset, suksesi, goals, audit log, dsb.
              </p>
              {!isOwner && (
                <p className="mt-1 text-xs italic text-muted-foreground/70">
                  Fitur ekspor hanya tersedia untuk owner.
                </p>
              )}
            </div>
          </div>
          {isOwner && (
            <Button
              className="min-h-[40px] shrink-0 bg-emerald-600 text-primary-foreground hover:bg-emerald-700"
              onClick={() => exportM.mutate()}
              disabled={exportM.isPending}
            >
              {exportM.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Download className="h-4 w-4" aria-hidden="true" />
              )}
              Ekspor Seluruh Data (JSON)
            </Button>
          )}
        </div>
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-400">
          <DatabaseBackup className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Backup terenkripsi harian dijalankan otomatis di luar jam pasar; lakukan uji restore
            berkala dan simpan salinan ekspor di lokasi terpisah (rekomendasi PRD keamanan data).
          </span>
        </div>

        {/* ---------- Backup database (ronde 7) — owner-only ---------- */}
        {isOwner && (
          <div className="mt-4 rounded-xl border p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <DatabaseBackup className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  Snapshot Backup Database
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Snapshot konsisten SQLite — maksimal {backupsQ.data?.maxKeep ?? 20} backup
                  terakhir disimpan di server (backup lama dipangkas otomatis).
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-700 dark:text-emerald-400">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />
                    Auto-backup harian aktif
                  </span>
                  {backupsQ.data?.lastBackupAt && (
                    <span className="text-muted-foreground">
                      Backup terakhir {formatDateTime(backupsQ.data.lastBackupAt)}
                    </span>
                  )}
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                className="min-h-[40px] shrink-0 bg-emerald-600 text-primary-foreground hover:bg-emerald-700"
                onClick={() => backupM.mutate()}
                disabled={backupM.isPending}
                aria-label="Buat snapshot backup database sekarang"
              >
                {backupM.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Plus className="h-4 w-4" aria-hidden="true" />
                )}
                Buat Backup Sekarang
              </Button>
            </div>

            <div className="mt-3" aria-live="polite">
              {backupsQ.isPending ? (
                <div className="space-y-2">
                  {[0, 1].map((i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
                </div>
              ) : backupsQ.isError ? (
                <p className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-600 dark:text-rose-400">
                  Gagal memuat daftar backup — coba muat ulang halaman.
                </p>
              ) : (backupsQ.data?.backups.length ?? 0) === 0 ? (
                <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                  Belum ada backup — buat snapshot pertama Anda.
                </p>
              ) : (
                <ul className="scrollbar-thin max-h-44 space-y-1.5 overflow-y-auto">
                  {backupsQ.data!.backups.map((b) => (
                    <li
                      key={b.name}
                      className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2"
                    >
                      <DatabaseBackup
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-xs font-medium">{b.name}</p>
                        <p className="text-[10px] tabular-nums text-muted-foreground">
                          {(b.sizeBytes / 1024).toFixed(0)} KB · {formatDateTime(b.createdAt)}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 shrink-0 gap-1.5 px-2 text-xs"
                        onClick={() => downloadBackupM.mutate(b.name)}
                        disabled={downloadBackupM.isPending}
                        aria-label={`Unduh backup ${b.name}`}
                      >
                        {downloadBackupM.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <Download className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        Unduh
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </SectionCard>

      {/* ================= Kanal Notifikasi (ronde 9) ================= */}
      {canReadNotify && (
        <SectionCard
          title="Kanal Notifikasi"
          description="Kirim notifikasi penting (price alert, sistem) ke Email / Telegram — mock delivery"
        >
          {notifyQ.isError ? (
            <ErrorBox
              message="Gagal memuat konfigurasi kanal notifikasi."
              onRetry={() => void notifyQ.refetch()}
            />
          ) : notifyQ.isPending || !notifyQ.data ? (
            <div className="space-y-3">
              {[0, 1].map((i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
            </div>
          ) : (
            <>
              {(["email", "telegram"] as NotifyChannelKey[]).map((ch) => {
                const conf = notifyDraft[ch];
                const isEmail = ch === "email";
                const Icon = isEmail ? Mail : Send;
                const testPending = notifyTestM.isPending && notifyTestM.variables === ch;
                return (
                  <div
                    key={ch}
                    className={cn(
                      "flex flex-col gap-3 rounded-xl border p-4 transition-colors",
                      conf.enabled && "border-emerald-500/40 bg-emerald-500/[0.04]",
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className={cn(
                            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                            isEmail
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                          )}
                          aria-hidden="true"
                        >
                          <Icon className="h-5 w-5" />
                        </span>
                        <div className="min-w-0">
                          <p className="flex items-center gap-2 text-sm font-medium capitalize">
                            {ch === "telegram" ? "Telegram" : "Email"}
                            <span
                              className={cn(
                                "inline-flex items-center rounded-full px-1.5 py-0 text-[10px] font-semibold",
                                conf.enabled
                                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                                  : "bg-muted text-muted-foreground",
                              )}
                            >
                              {conf.enabled ? "aktif" : "nonaktif"}
                            </span>
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {isEmail
                              ? "Ringkasan alert & kejadian penting ke email keluarga."
                              : "Pesan singkat real-time ke chat/bot Telegram keluarga."}
                          </p>
                        </div>
                      </div>
                      <Switch
                        checked={conf.enabled}
                        disabled={!isOwner || notifyPutM.isPending}
                        onCheckedChange={(v) => {
                          setNotifyDraft((f) => ({
                            ...f,
                            [ch]: { ...f[ch], enabled: v },
                          }));
                          setNotifyDirty(true);
                        }}
                        aria-label={`Aktifkan kanal ${ch === "telegram" ? "Telegram" : "Email"}`}
                      />
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <div className="relative min-w-0 flex-1">
                        <Icon
                          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                          aria-hidden="true"
                        />
                        <Input
                          value={conf.target}
                          onChange={(e) => {
                            setNotifyDraft((f) => ({
                              ...f,
                              [ch]: { ...f[ch], target: e.target.value },
                            }));
                            setNotifyDirty(true);
                          }}
                          disabled={!isOwner || notifyPutM.isPending}
                          placeholder={isEmail ? "nama@zfamily.id" : "@handle atau chat_id"}
                          className={cn("h-10 pl-9", focusRing)}
                          aria-label={`Target ${ch === "telegram" ? "Telegram" : "Email"}`}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-h-[40px] shrink-0 gap-1.5"
                        disabled={
                          !isOwner || !conf.enabled || !conf.target.trim() || testPending
                        }
                        onClick={() => notifyTestM.mutate(ch)}
                        aria-label={`Kirim pesan tes via ${ch === "telegram" ? "Telegram" : "Email"}`}
                      >
                        {testPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Send className="h-4 w-4" aria-hidden="true" />
                        )}
                        Kirim tes
                      </Button>
                    </div>
                  </div>
                );
              })}

              {/* bar simpan (owner) / catatan read-only (lain) */}
              {isOwner ? (
                <div className="flex items-center justify-between gap-3 pt-1">
                  <p className="text-xs text-muted-foreground">
                    {notifyDirty
                      ? "Ada perubahan yang belum disimpan."
                      : "Perubahan aktif/aktif-nonaktif & target tersimpan ke server."}
                  </p>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="min-h-[40px]"
                      disabled={!notifyDirty || notifyPutM.isPending}
                      onClick={() => {
                        setNotifyDraft(notifyQ.data!.channels);
                        setNotifyDirty(false);
                      }}
                    >
                      Batalkan
                    </Button>
                    <Button
                      type="button"
                      className="min-h-[40px] bg-emerald-600 text-primary-foreground hover:bg-emerald-700"
                      disabled={!notifyDirty || notifyPutM.isPending}
                      onClick={() => notifyPutM.mutate()}
                    >
                      {notifyPutM.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Check className="h-4 w-4" aria-hidden="true" />
                      )}
                      Simpan Konfigurasi
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="pt-1 text-xs italic text-muted-foreground/70">
                  Hanya owner yang dapat mengubah konfigurasi kanal — Anda melihat mode baca-saja.
                </p>
              )}

              <p className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>
                  Delivery saat ini <strong>disimulasikan</strong> (mock) di server — tanpa email/bot
                  sungguhan. Setiap pengiriman (tes maupun price alert terpicu) tercatat di riwayat
                  di bawah &amp; audit log.
                </span>
              </p>

              {/* ---------- Riwayat pengiriman ---------- */}
              <div className="mt-1">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Riwayat Pengiriman
                  </h3>
                  <Badge
                    variant="outline"
                    className="px-2 py-0 text-[10px] tabular-nums text-muted-foreground"
                  >
                    {notifyQ.data.deliveredCount} total
                  </Badge>
                </div>
                {(notifyQ.data.log.length ?? 0) === 0 ? (
                  <p className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">
                    Belum ada pengiriman — aktifkan kanal, kirim tes, atau tunggu price alert terpicu.
                  </p>
                ) : (
                  <ul className="scrollbar-thin max-h-64 space-y-1.5 overflow-y-auto pr-1">
                    {notifyQ.data.log.map((e) => (
                      <li
                        key={e.id}
                        className="flex items-start gap-2.5 rounded-lg border bg-muted/30 px-3 py-2"
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
                            e.channel === "email"
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                          )}
                          aria-hidden="true"
                        >
                          {e.channel === "email" ? (
                            <Mail className="h-3.5 w-3.5" />
                          ) : (
                            <Send className="h-3.5 w-3.5" />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-xs font-medium">{e.message}</p>
                          <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                            {e.target} · {e.source} · {timeAgo(e.sentAt)}
                          </p>
                        </div>
                        <Badge
                          variant="outline"
                          className="shrink-0 border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0 text-[10px] text-emerald-700 dark:text-emerald-400"
                        >
                          Terkirim
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </SectionCard>
      )}

      {/* ================= Roadmap Platform (PRD) ================= */}
      <SectionCard
        title="Roadmap Platform (PRD)"
        description="Transparansi cakupan MVP — 8 modul, 50 fitur PRD: sudah Live vs jadwal Roadmap"
      >
        <Accordion type="single" collapsible className="w-full" defaultValue="module-a">
          {ROADMAP.map((m) => {
            const liveCount = m.features.filter((f) => f.live).length;
            return (
              <AccordionItem key={m.code} value={`module-${m.code.toLowerCase()}`}>
                <AccordionTrigger className="hover:no-underline">
                  <span className="flex flex-wrap items-center gap-2 pr-2 text-left">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 font-mono text-xs font-bold text-emerald-700 dark:text-emerald-400">
                      {m.code}
                    </span>
                    <span className="font-medium">{m.name}</span>
                    <Badge
                      variant="outline"
                      className="border-zinc-500/40 px-1.5 py-0 text-[10px] tabular-nums text-muted-foreground"
                    >
                      {liveCount}/{m.features.length} Live
                    </Badge>
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <ul className="grid gap-2 pt-1 sm:grid-cols-2">
                    {m.features.map((f) => (
                      <li
                        key={f.label}
                        className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                      >
                        <span className="min-w-0 truncate">{f.label}</span>
                        <LiveBadge live={f.live} />
                      </li>
                    ))}
                  </ul>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
        <p className="mt-4 flex items-start gap-1.5 text-xs text-muted-foreground/70">
          <PieChart className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Fitur bertanda &ldquo;Live&rdquo; sudah berjalan di platform ini; &ldquo;Roadmap&rdquo;
          menyusul pada fase berikutnya sesuai PRD (Fase 0–4).
        </p>
      </SectionCard>

      {/* ================= Dialog: Aktifkan MFA (setup) ================= */}
      <Dialog open={setupOpen} onOpenChange={setSetupOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto scrollbar-thin sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Smartphone className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              Aktifkan Autentikasi Dua Faktor
            </DialogTitle>
            <DialogDescription>
              Tambahkan secret ke aplikasi authenticator (Google Authenticator, Authy), lalu masukkan
              kode 6 digit yang muncul untuk konfirmasi.
            </DialogDescription>
          </DialogHeader>

          {mfaSetupM.isPending || !setupData ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Menyiapkan secret…
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="mfa-secret">Secret</Label>
                <div className="flex items-center gap-2">
                  <code
                    id="mfa-secret"
                    className="min-w-0 flex-1 truncate rounded-lg border bg-muted px-3 py-2 font-mono text-sm tracking-wider"
                  >
                    {setupData.secret}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn(focusRing, "h-9 shrink-0")}
                    onClick={() => void copySecret()}
                  >
                    {copied ? (
                      <Check className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Copy className="h-4 w-4" aria-hidden="true" />
                    )}
                    {copied ? "Tersalin" : "Salin"}
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Tautan otpauth://</Label>
                <a
                  href={setupData.otpauthUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    focusRing,
                    "block truncate rounded-lg border px-3 py-2 font-mono text-xs text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400",
                  )}
                  title={setupData.otpauthUrl}
                >
                  {setupData.otpauthUrl}
                </a>
                <p className="text-xs text-muted-foreground">
                  Buka tautan di perangkat ini untuk menambahkan akun otomatis ke aplikasi
                  authenticator.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="mfa-enable-code">
                  Masukkan kode 6 digit dari aplikasi authenticator
                </Label>
                <Input
                  id="mfa-enable-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="000000"
                  value={setupCode}
                  onChange={(e) => setSetupCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className={cn(focusRing, "text-center font-mono text-lg tracking-[0.4em]")}
                  disabled={mfaEnableM.isPending}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setSetupOpen(false)}
              disabled={mfaEnableM.isPending}
            >
              Batal
            </Button>
            <Button
              type="button"
              className={cn(focusRing, "bg-emerald-600 text-primary-foreground hover:bg-emerald-700")}
              disabled={mfaSetupM.isPending || !setupData || setupCode.length !== 6 || mfaEnableM.isPending}
              onClick={() => mfaEnableM.mutate(setupCode)}
            >
              {mfaEnableM.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Aktifkan MFA
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================= Dialog: Nonaktifkan MFA ================= */}
      <Dialog open={disableOpen} onOpenChange={setDisableOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              Nonaktifkan Autentikasi Dua Faktor?
            </DialogTitle>
            <DialogDescription>
              Akun Anda hanya dilindungi email &amp; password. Masukkan kode 6 digit dari aplikasi
              authenticator untuk konfirmasi.
            </DialogDescription>
          </DialogHeader>
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            value={disableCode}
            onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className={cn(focusRing, "text-center font-mono text-lg tracking-[0.4em]")}
            disabled={mfaDisableM.isPending}
            aria-label="Kode authenticator untuk konfirmasi nonaktif"
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDisableOpen(false)}
              disabled={mfaDisableM.isPending}
            >
              Batal
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={disableCode.length !== 6 || mfaDisableM.isPending}
              onClick={() => mfaDisableM.mutate(disableCode)}
            >
              {mfaDisableM.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Nonaktifkan MFA
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================= Dialog konfirmasi PANIC ================= */}
      <Dialog open={panicOpen} onOpenChange={setPanicOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
              <Siren className="h-5 w-5" aria-hidden="true" />
              Aktifkan Panic Mode?
            </DialogTitle>
            <DialogDescription>
              Seluruh operasi tulis (aset, transaksi, riset, suksesi, pengaturan) akan diblokir
              hingga owner mematikannya. Ketik <span className="font-mono font-semibold">PANIC</span>{" "}
              untuk konfirmasi.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={panicText}
            onChange={(e) => setPanicText(e.target.value)}
            placeholder="Ketik PANIC"
            className="font-mono tracking-widest"
            aria-label="Ketik PANIC untuk konfirmasi"
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setPanicOpen(false);
                setPanicText("");
              }}
              disabled={panicM.isPending}
            >
              Batal
            </Button>
            <Button
              variant="destructive"
              disabled={panicText !== "PANIC" || panicM.isPending}
              onClick={() => panicM.mutate(true)}
            >
              {panicM.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              AKTIFKAN PANIC MODE
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
