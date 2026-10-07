"use client";

// ============================================================
// App Shell — layout utama SPA single-route
// Sidebar gelap (desktop) / Sheet (mobile) + topbar + konten + footer
// Navigasi antar-view via zustand store (TANPA router)
// ============================================================
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { useAppStore } from "@/lib/store";
import { api, ApiError } from "@/lib/api";
import { NAV_ITEMS, VIEW_TITLES, type ViewKey } from "@/lib/nav";
import { VIEW_COMPONENTS } from "@/components/views/registry";
import { Monogram, RoleBadge } from "@/components/shared/kit";
import PriceTicker from "@/components/shared/price-ticker";
import NotificationBell from "@/components/shell/notification-bell";
import LoginView from "@/components/auth/login-view";
import CommandPalette from "@/components/command-palette";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Menu, LogOut, AlertOctagon, Search, PanelLeftClose, PanelLeftOpen } from "lucide-react";

// ------------------------------------------------------------
// Splash (menghindari hydration mismatch saat store rehydrate)
// ------------------------------------------------------------
function Splash() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
      <Monogram size={56} className="animate-pulse" />
      <p className="text-sm text-muted-foreground">Memuat Z Family Office…</p>
    </div>
  );
}

// ------------------------------------------------------------
// Jam server
// ------------------------------------------------------------
function useServerClock(serverTime?: string) {
  const [offset, setOffset] = React.useState(0);
  const [now, setNow] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!serverTime) return;
    const t = new Date(serverTime).getTime();
    if (!Number.isNaN(t)) setOffset(t - Date.now());
  }, [serverTime]);

  React.useEffect(() => {
    setNow(Date.now());
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);

  if (now === null) return "—";
  const d = new Date(now + offset);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

// ------------------------------------------------------------
// Inisial user utk avatar rail kompak
// ------------------------------------------------------------
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

// ------------------------------------------------------------
// Item navigasi (dipakai sidebar desktop & sheet mobile)
// collapsed = mode rail ikon (desktop saja)
// ------------------------------------------------------------
function NavButton({
  item,
  active,
  onSelect,
  collapsed = false,
}: {
  item: (typeof NAV_ITEMS)[number];
  active: boolean;
  onSelect: () => void;
  collapsed?: boolean;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      title={collapsed ? item.label : undefined}
      className={cn(
        "flex min-h-[44px] w-full items-center gap-3 border-l-2 text-sm font-medium transition-colors rounded-r-lg",
        collapsed ? "justify-center border-l-2 px-0 py-2" : "px-4 py-2",
        active
          ? "border-l-emerald-500 bg-emerald-600/10 text-emerald-400"
          : "border-l-transparent text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100",
      )}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
      {!collapsed && item.label}
    </button>
  );
}

function SidebarContent({
  activeView,
  onSelect,
  collapsed = false,
  onToggleCollapse,
}: {
  activeView: ViewKey;
  onSelect: (v: ViewKey) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const user = useAppStore((s) => s.user);
  const clearAuth = useAppStore((s) => s.clearAuth);

  const handleLogout = () => {
    clearAuth();
    toast.info("Anda telah keluar", { description: "Sesi diakhiri dengan aman." });
  };

  return (
    <div className="flex h-full flex-col">
      {/* Brand + toggle rail (desktop) */}
      <div
        className={cn(
          "flex items-center pb-5 pt-6",
          collapsed ? "flex-col gap-3 px-2" : "gap-3 px-4",
        )}
      >
        <Monogram size={collapsed ? 32 : 38} />
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate font-semibold tracking-tight text-zinc-100">
              Z Family Office
            </p>
            <p className="truncate text-[11px] text-zinc-500">Internal Wealth Platform</p>
          </div>
        )}
        {onToggleCollapse && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Perlebar sidebar" : "Ciutkan sidebar jadi rail ikon"}
            aria-pressed={collapsed}
            title={collapsed ? "Perlebar sidebar" : "Ciutkan sidebar"}
            className={cn(
              "h-8 w-8 shrink-0 text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-200",
              collapsed ? "" : "ml-auto",
            )}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
        )}
      </div>

      {/* Nav */}
      <nav
        className="scrollbar-thin flex-1 space-y-1 overflow-y-auto px-2"
        aria-label="Navigasi utama"
      >
        {NAV_ITEMS.map((item) => (
          <NavButton
            key={item.key}
            item={item}
            active={activeView === item.key}
            onSelect={() => onSelect(item.key)}
            collapsed={collapsed}
          />
        ))}
      </nav>

      {/* User + logout */}
      <div className={cn("border-t border-white/10", collapsed ? "p-2" : "p-4")}>
        {user && !collapsed && (
          <div className="mb-3 space-y-1.5">
            <p className="truncate text-sm font-medium text-zinc-200">{user.name}</p>
            <p className="truncate text-[11px] text-zinc-500">{user.email}</p>
            <RoleBadge role={user.role} />
          </div>
        )}
        {user && collapsed && (
          <div
            className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600/20 text-xs font-bold text-emerald-400"
            title={`${user.name} (${user.email})`}
            aria-label={`Pengguna: ${user.name}`}
          >
            {initials(user.name)}
          </div>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          title="Keluar dari platform"
          className={cn(
            "min-h-[44px] text-zinc-400 hover:bg-rose-500/10 hover:text-rose-400",
            collapsed ? "w-full justify-center px-0" : "w-full justify-start",
          )}
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          {!collapsed && "Keluar"}
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// AppShell
// ------------------------------------------------------------
export default function AppShell() {
  const token = useAppStore((s) => s.token);
  const user = useAppStore((s) => s.user);
  const activeView = useAppStore((s) => s.activeView);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const displayCurrency = useAppStore((s) => s.displayCurrency);
  const setDisplayCurrency = useAppStore((s) => s.setDisplayCurrency);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed);

  const [mounted, setMounted] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  // Polling status sistem (30s) — panicMode + jam server
  const statusQuery = useQuery({
    queryKey: ["system-status"],
    queryFn: () => api.systemStatus(),
    refetchInterval: 30_000,
    staleTime: 25_000,
    retry: false,
  });
  const clock = useServerClock(statusQuery.data?.serverTime);

  if (!mounted) return <Splash />;
  if (!token || !user) return <LoginView />;

  const panicMode = statusQuery.data?.panicMode === true;
  const ActiveView = VIEW_COMPONENTS[activeView] ?? VIEW_COMPONENTS.dashboard;

  const goTo = (v: ViewKey) => {
    setActiveView(v);
    setMobileOpen(false);
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="flex flex-1">
        {/* ============ Sidebar desktop ============ */}
        <aside
          className={cn(
            "sticky top-0 hidden h-screen shrink-0 flex-col bg-zinc-950 transition-[width] duration-200 ease-in-out lg:flex",
            sidebarCollapsed ? "w-[68px]" : "w-64",
          )}
          aria-label="Sidebar navigasi"
        >
          <SidebarContent
            activeView={activeView}
            onSelect={goTo}
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          />
        </aside>

        {/* ============ Sheet mobile ============ */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent
            side="left"
            className="w-72 bg-zinc-950 p-0 text-zinc-300 [&>button]:text-zinc-400"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>Menu Navigasi</SheetTitle>
            </SheetHeader>
            <SidebarContent activeView={activeView} onSelect={goTo} />
          </SheetContent>
        </Sheet>

        {/* ============ Kolom konten ============ */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Topbar */}
          <header
            className={cn(
              "sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur lg:px-8",
              panicMode && "border-rose-500/50",
            )}
          >
            {/* hamburger (mobile) */}
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label="Buka menu navigasi"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>

            <div className="flex min-w-0 items-center gap-3">
              <h2 className="truncate text-base font-semibold tracking-tight lg:text-lg">
                {VIEW_TITLES[activeView]}
              </h2>
              {panicMode && (
                <span
                  role="status"
                  className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/50 bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-600 dark:text-rose-400"
                >
                  <AlertOctagon className="h-3.5 w-3.5 animate-pulse" aria-hidden="true" />
                  Panic Mode Aktif
                </span>
              )}
            </div>

            <div className="ml-auto flex items-center gap-2 sm:gap-3">
              {/* Lonceng notifikasi (polling unread 30 dtk) */}
              <NotificationBell />

              {/* Command palette (Cmd+K) */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 gap-2 px-2.5 text-muted-foreground sm:pr-2"
                aria-label="Buka command palette (Ctrl+K)"
                aria-keyshortcuts="Meta+K Control+K"
                onClick={() => setPaletteOpen(true)}
              >
                <Search className="h-4 w-4" aria-hidden="true" />
                <kbd className="hidden rounded border bg-muted px-1.5 font-mono text-[10px] font-semibold text-muted-foreground sm:inline-block">
                  ⌘K
                </kbd>
              </Button>

              {/* Toggle currency */}
              <Select
                value={displayCurrency}
                onValueChange={(v) => setDisplayCurrency(v as "USD" | "IDR")}
              >
                <SelectTrigger
                  className="h-9 w-[86px] text-xs font-medium"
                  aria-label="Mata uang tampilan"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD $</SelectItem>
                  <SelectItem value="IDR">IDR Rp</SelectItem>
                </SelectContent>
              </Select>

              {/* Jam server */}
              <span
                className="hidden items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs tabular-nums text-muted-foreground sm:inline-flex"
                title="Waktu server"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                {clock}
              </span>
            </div>
          </header>

          {/* Price ticker — strip marquee harga live di bawah topbar */}
          <PriceTicker />

          {/* Konten view — tabIndex agar bisa difokus dari command palette */}
          <main
            tabIndex={-1}
            className="flex-1 overflow-y-auto p-6 scrollbar-thin outline-none lg:p-8"
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={activeView}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              >
                <ActiveView />
              </motion.div>
            </AnimatePresence>
          </main>

          {/* Footer */}
          <footer className="mt-auto border-t px-6 py-4 lg:px-8">
            <p className="text-xs text-muted-foreground">
              Z Family Office v1.0 · Internal Use Only —{" "}
              {statusQuery.isError
                ? "Server: terputus (mencoba lagi)"
                : statusQuery.data?.version
                  ? `Server v${statusQuery.data.version}`
                  : "Menyambungkan ke server…"}
            </p>
          </footer>
        </div>
      </div>

      {/* Command palette global (⌘K) */}
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}


