"use client";

// ============================================================
// Family Office — Mr.Z · Command Palette (global)
// Cmd+K / Ctrl+K atau tombol ikon pencarian di topbar.
// - Navigasi cepat ke 11 view (NAV_ITEMS) — fuzzy substring via cmdk
// - Tindakan cepat: toggle tema, Keluar, Perdagangan cepat BTC,
//   Catat Transaksi, Laporan Kinerja, Backup Database (owner-only, ronde 7)
// - Keyboard: ↑/↓ pindah, Enter pilih, Esc tutup (CommandDialog shadcn)
// ============================================================
import * as React from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { useAppStore } from "@/lib/store";
import { NAV_ITEMS, type ViewKey } from "@/lib/nav";
import ShortcutHelpDialog from "@/components/shell/shortcut-help";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Moon, Sun, LogOut, Zap, Plus, FileText, DatabaseBackup, Keyboard } from "lucide-react";

export default function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const setActiveView = useAppStore((s) => s.setActiveView);
  const clearAuth = useAppStore((s) => s.clearAuth);
  const user = useAppStore((s) => s.user);
  const isOwner = user?.role === "owner";
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";

  // Bantuan pintasan (ronde 9) — dibuka dari item palette / footer
  const [helpOpen, setHelpOpen] = React.useState(false);

  // Hint shortcut G+<key> per view (konsisten dgn GO_SHORTCUTS di app-shell)
  const VIEW_G_KEY: Partial<Record<ViewKey, string>> = {
    dashboard: "G D",
    assets: "G A",
    transactions: "G T",
    portfolio: "G P",
    trading: "G R",
    market: "G M",
    governance: "G G",
    tax: "G X",
    research: "G I",
    succession: "G S",
    settings: "G ,",
  };

  // Cmd+K / Ctrl+K — toggle palette (listener global, hanya saat ter-mount = sudah login)
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const run = (fn: () => void) => {
    onOpenChange(false);
    // tunggu dialog tertutup sebelum aksi (hindari focus-modal radix ikut menangkap)
    window.setTimeout(fn, 80);
  };

  const goView = (view: ViewKey) =>
    run(() => {
      setActiveView(view);
      // fokus main region (tabIndex -1) agar keyboard/Screen reader pindah konteks
      window.setTimeout(() => {
        const main = document.querySelector<HTMLElement>("main");
        main?.focus({ preventScroll: false });
      }, 120);
    });

  return (
    <>
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command Palette"
      description="Cari navigasi atau tindakan cepat…"
      className="rounded-xl shadow-xl sm:max-w-xl"
    >
      <CommandInput placeholder="Ketik perintah atau cari halaman…" />

      <CommandList className="max-h-[min(60dvh,420px)]">
        <CommandEmpty>Tidak ada hasil — coba kata kunci lain.</CommandEmpty>

        {/* ---------- Navigasi (11 view) ---------- */}
        <CommandGroup heading="Navigasi">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <CommandItem
                key={item.key}
                value={item.label}
                keywords={[item.key, "navigasi", "buka", "halaman"]}
                onSelect={() => goView(item.key)}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
                <CommandShortcut className="font-mono text-[10px] tracking-wide">
                  {VIEW_G_KEY[item.key]}
                </CommandShortcut>
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        {/* ---------- Tindakan Cepat ---------- */}
        <CommandGroup heading="Tindakan Cepat">
          <CommandItem
            value={isDark ? "Beralih ke mode terang" : "Beralih ke mode gelap"}
            keywords={["tema", "theme", "gelap", "terang", "dark", "light"]}
            onSelect={() =>
              run(() => {
                setTheme(isDark ? "light" : "dark");
                toast.success(
                  isDark ? "Mode terang diaktifkan" : "Mode gelap diaktifkan",
                );
              })
            }
          >
            {isDark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
            <span>{isDark ? "Beralih ke mode terang" : "Beralih ke mode gelap"}</span>
          </CommandItem>

          <CommandItem
            value="Perdagangan cepat BTC"
            keywords={["btc", "bitcoin", "trade", "trading", "pasar", "market", "beli", "jual"]}
            onSelect={() => goView("market")}
          >
            <Zap className="text-amber-500" aria-hidden="true" />
            <span>Perdagangan cepat BTC</span>
            <span className="ml-auto text-xs text-muted-foreground">Pasar</span>
          </CommandItem>

          <CommandItem
            value="Catat transaksi baru"
            keywords={["transaksi", "catat", "beli", "jual", "transfer", "pemasukan", "pengeluaran", "record"]}
            onSelect={() => goView("transactions")}
          >
            <Plus className="text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            <span>Catat transaksi baru</span>
            <span className="ml-auto text-xs text-muted-foreground">Transaksi</span>
          </CommandItem>

          <CommandItem
            value="Laporan kinerja & cetak PDF"
            keywords={["laporan", "kinerja", "report", "pdf", "cetak", "print", "benchmark"]}
            onSelect={() => goView("portfolio")}
          >
            <FileText className="text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            <span>Laporan kinerja &amp; cetak PDF</span>
            <span className="ml-auto text-xs text-muted-foreground">Portofolio</span>
          </CommandItem>

          {isOwner && (
            <CommandItem
              value="Backup database"
              keywords={["backup", "database", "cadangan", "snapshot", "restore", "sqlite"]}
              onSelect={() => goView("settings")}
            >
              <DatabaseBackup className="text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <span>Backup database</span>
              <span className="ml-auto text-xs text-muted-foreground">Pengaturan</span>
            </CommandItem>
          )}

          <CommandItem
            value="Bantuan pintasan keyboard"
            keywords={["bantuan", "pintasan", "shortcut", "keyboard", "hotkey", "help"]}
            onSelect={() =>
              run(() => setHelpOpen(true))
            }
          >
            <Keyboard className="text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            <span>Bantuan pintasan keyboard</span>
            <CommandShortcut className="font-mono text-[10px] tracking-wide">?</CommandShortcut>
          </CommandItem>

          <CommandItem
            value="Keluar"
            keywords={["logout", "keluar", "sesi", "keluar akun"]}
            className="text-rose-600 data-[selected=true]:bg-rose-500/10 data-[selected=true]:text-rose-700 dark:text-rose-400 dark:data-[selected=true]:text-rose-300"
            onSelect={() =>
              run(() => {
                clearAuth();
                toast.info("Anda telah keluar", {
                  description: "Sesi diakhiri dengan aman.",
                });
              })
            }
          >
            <LogOut aria-hidden="true" />
            <span>Keluar</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>

      {/* Footer hint shortcut (ronde 8/9) — tombol buka bantuan pintasan */}
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-2 text-[11px] text-muted-foreground"
      >
        <span className="flex items-center gap-1" aria-hidden="true">
          <kbd className="rounded border bg-muted px-1 font-mono text-[10px] font-semibold">G</kbd>
          lalu
          <kbd className="rounded border bg-muted px-1 font-mono text-[10px] font-semibold">D/A/T/M…</kbd>
          lompat view
        </span>
        <button
          type="button"
          className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 underline-offset-2 transition-colors hover:bg-accent hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
          onClick={() => {
            onOpenChange(false);
            window.setTimeout(() => setHelpOpen(true), 80);
          }}
        >
          <Keyboard className="h-3 w-3" aria-hidden="true" />
          Lihat semua pintasan
        </button>
      </div>
    </CommandDialog>

    {/* Modal bantuan pintasan (ronde 9) — DI LUAR CommandDialog agar tidak ikut
        ter-unmount saat palette ditutup (radix Dialog unmount children) */}
    <ShortcutHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </>
  );
}
