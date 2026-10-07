"use client";

// ============================================================
// ShortcutHelpDialog — modal "Bantuan Pintasan Keyboard" (ronde 9)
// Daftar semua pintasan global: G+<key> (11 view), ⌘K palette, ? bantuan.
// Dibuka dari: item palette "Bantuan pintasan" + footer palette.
// ============================================================
import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NAV_ITEMS, type ViewKey } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { Keyboard } from "lucide-react";

/** Peta mnemonic G+<key> — harus konsisten dgn GO_SHORTCUTS di app-shell.tsx */
export const SHORTCUT_ROWS: { keys: string; label: string; group: "nav" | "umum" }[] = [
  ...NAV_ITEMS.map((item) => {
    const map: Partial<Record<ViewKey, string>> = {
      dashboard: "D",
      assets: "A",
      transactions: "T",
      portfolio: "P",
      trading: "R",
      market: "M",
      governance: "G",
      tax: "X",
      research: "I",
      succession: "S",
      settings: ",",
    };
    return { keys: `G ${map[item.key] ?? "?"}`, label: `Buka ${item.label}`, group: "nav" as const };
  }),
  { keys: "⌘ K", label: "Buka command palette", group: "umum" },
  { keys: "?", label: "Buka palette / bantuan ini", group: "umum" },
  { keys: "↑ ↓", label: "Navigasi hasil palette", group: "umum" },
  { keys: "Enter", label: "Pilih item palette", group: "umum" },
  { keys: "Esc", label: "Tutup dialog / palette", group: "umum" },
];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-7 min-w-7 items-center justify-center rounded-md border bg-muted px-1.5 font-mono text-[11px] font-semibold text-foreground shadow-sm">
      {children}
    </kbd>
  );
}

export default function ShortcutHelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const navRows = SHORTCUT_ROWS.filter((r) => r.group === "nav");
  const umumRows = SHORTCUT_ROWS.filter((r) => r.group === "umum");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              aria-hidden="true"
            >
              <Keyboard className="h-5 w-5" />
            </span>
            Bantuan Pintasan Keyboard
          </DialogTitle>
          <DialogDescription>
            Tekan <Kbd>G</Kbd> lalu tombol mnemonic untuk lompat ke halaman — tanpa mouse.
          </DialogDescription>
        </DialogHeader>

        <div className="scrollbar-thin max-h-[60dvh] space-y-5 overflow-y-auto pr-1">
          {/* ---------- Navigasi (G+key) ---------- */}
          <section aria-label="Pintasan navigasi">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Navigasi — teks G lalu tombol
            </h3>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {navRows.map((r) => (
                <li
                  key={r.keys}
                  className="flex items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm"
                >
                  <span className="min-w-0 truncate text-muted-foreground">{r.label}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {r.keys.split(" ").map((k, i) => (
                      <Kbd key={i}>{k}</Kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* ---------- Umum ---------- */}
          <section aria-label="Pintasan umum">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Umum
            </h3>
            <ul className="space-y-1.5">
              {umumRows.map((r) => (
                <li
                  key={r.keys}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm",
                  )}
                >
                  <span className="min-w-0 truncate text-muted-foreground">{r.label}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {r.keys.split(" ").map((k, i) => (
                      <Kbd key={i}>{k}</Kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <p className="border-t pt-3 text-xs text-muted-foreground/70">
          Pintasan dinonaktifkan otomatis saat Anda sedang mengetik di kolom input.
        </p>
      </DialogContent>
    </Dialog>
  );
}
