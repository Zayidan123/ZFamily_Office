"use client";

// ============================================================
// Notification Bell (ronde 6 — Task V-b)
// Lonceng notifikasi di topbar: polling unread count (30 dtk),
// popover daftar notifikasi terbaru, tandai dibaca (satu/semua),
// jembatan ke Pusat Notifikasi Dashboard.
// Sumber data: GET /trading/alerts + /trading/alerts/unread-count
// RBAC: executor tidak punya akses read → komponen disembunyikan.
// ============================================================
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Bell, CheckCheck, Inbox, ArrowRight } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import type { TradingAlertRow, UnreadCount } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";

const LIST_LIMIT = 8;

/** Warna titik level — emerald/amber/rose (tanpa biru). */
function levelDotClass(level: string): string {
  if (level === "critical") return "bg-rose-500";
  if (level === "warning") return "bg-amber-500";
  return "bg-emerald-500";
}

/** Waktu relatif ringkas bahasa Indonesia. */
function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Math.max(0, Date.now() - t);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "baru saja";
  if (m < 60) return `${m} mnt lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam lalu`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} hari lalu`;
  return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}

export default function NotificationBell() {
  const user = useAppStore((s) => s.user);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);

  const canRead = user?.role !== "executor";

  const unreadQuery = useQuery<UnreadCount, ApiError>({
    queryKey: ["notif", "unread"],
    queryFn: () => apiFetch<UnreadCount>("/trading/alerts/unread-count"),
    enabled: canRead,
    refetchInterval: 30_000,
    staleTime: 20_000,
    retry: false,
  });

  const listQuery = useQuery<TradingAlertRow[], ApiError>({
    queryKey: ["notif", "list"],
    queryFn: () =>
      apiFetch<TradingAlertRow[]>("/trading/alerts", { params: { limit: String(LIST_LIMIT) } }),
    enabled: canRead && open,
    refetchInterval: open ? 30_000 : false, // daftar ikut menyegarkan selama popover terbuka
    staleTime: 15_000,
    retry: false,
  });

  // Tandai satu dibaca (idempotent) → refresh count + list
  const markReadM = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ id: string }>(`/trading/alerts/${id}/read`, { method: "POST" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notif"] });
      void qc.invalidateQueries({ queryKey: ["alerts"] }); // Pusat Notifikasi Dashboard
    },
    onError: (e) =>
      toast.error("Gagal menandai notifikasi", {
        description: e instanceof ApiError ? e.message : "Coba lagi",
      }),
  });

  // Tandai semua dibaca
  const markAllM = useMutation({
    mutationFn: () => apiFetch<{ updated: number }>("/trading/alerts/read-all", { method: "POST" }),
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey: ["notif"] });
      void qc.invalidateQueries({ queryKey: ["alerts"] });
      toast.success("Semua notifikasi ditandai dibaca", {
        description: `${d.updated} notifikasi diperbarui.`,
      });
    },
    onError: (e) =>
      toast.error("Gagal menandai semua notifikasi", {
        description: e instanceof ApiError ? e.message : "Coba lagi",
      }),
  });

  if (!canRead) return null;

  const unread = unreadQuery.data?.unread ?? 0;
  const items = listQuery.data ?? [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="relative h-9 w-9"
          aria-label={
            unread > 0
              ? `Notifikasi — ${unread} belum dibaca`
              : "Notifikasi — tidak ada yang belum dibaca"
          }
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
          {unread > 0 && (
            <motion.span
              key={unread}
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 22 }}
              className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-background bg-amber-500 px-1 text-[10px] font-bold leading-none text-zinc-950 tabular-nums"
              aria-hidden="true"
            >
              {unread > 99 ? "99+" : unread}
            </motion.span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden p-0"
        role="dialog"
        aria-label="Notifikasi terbaru"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold">Notifikasi</p>
            {unread > 0 && (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                {unread} belum dibaca
              </span>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2 text-xs text-muted-foreground"
            onClick={() => markAllM.mutate()}
            disabled={markAllM.isPending || unread === 0}
          >
            <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Tandai semua
          </Button>
        </div>

        {/* Daftar */}
        <div className="scrollbar-thin max-h-[320px] overflow-y-auto" aria-live="polite">
          {listQuery.isPending ? (
            <div className="space-y-3 p-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-start gap-3">
                  <Skeleton className="h-2 w-2 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-full" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                </div>
              ))}
            </div>
          ) : listQuery.isError ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {listQuery.error instanceof ApiError && listQuery.error.status === 403
                ? "Notifikasi tidak tersedia untuk peran Anda."
                : "Gagal memuat notifikasi — buka lagi untuk mencoba ulang."}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <Inbox className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
              <p className="text-sm font-medium">Belum ada notifikasi</p>
              <p className="text-xs text-muted-foreground">
                Alert harga & aktivitas trading akan muncul di sini.
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((n) => {
                const isUnread = n.isRead === false;
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => {
                        if (isUnread) markReadM.mutate(String(n.id));
                      }}
                      className={cn(
                        "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none",
                        isUnread && "bg-accent/50",
                      )}
                      aria-label={
                        isUnread
                          ? "Tandai notifikasi ini sudah dibaca"
                          : "Notifikasi sudah dibaca"
                      }
                    >
                      <span
                        className={cn(
                          "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                          levelDotClass(n.level),
                          isUnread ? "opacity-100" : "opacity-30",
                        )}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "line-clamp-2 text-xs leading-relaxed",
                            isUnread ? "font-medium text-foreground" : "text-muted-foreground",
                          )}
                        >
                          {n.message}
                        </span>
                        <span className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                          <span>{n.source ?? "sistem"}</span>
                          <span aria-hidden="true">·</span>
                          <span className="normal-case tracking-normal">{timeAgo(n.createdAt)}</span>
                        </span>
                      </span>
                      {isUnread && (
                        <span className="mt-1 shrink-0 rounded bg-emerald-600/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                          Baru
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer → Pusat Notifikasi Dashboard */}
        <button
          type="button"
          onClick={() => {
            setActiveView("dashboard");
            setOpen(false);
          }}
          className="flex w-full items-center justify-center gap-1.5 border-t bg-muted/30 px-4 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          Buka Pusat Notifikasi
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </PopoverContent>
    </Popover>
  );
}
