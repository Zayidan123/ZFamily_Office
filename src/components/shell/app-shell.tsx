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
import LoginView from "@/components/auth/login-view";
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
import { Menu, LogOut, AlertOctagon } from "lucide-react";

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
// Item navigasi (dipakai sidebar desktop & sheet mobile)
// ------------------------------------------------------------
function NavButton({
  item,
  active,
  onSelect,
}: {
  item: (typeof NAV_ITEMS)[number];
  active: boolean;
  onSelect: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-[44px] w-full items-center gap-3 border-l-2 px-4 py-2 text-sm font-medium transition-colors rounded-r-lg",
        active
          ? "border-l-emerald-500 bg-emerald-600/10 text-emerald-400"
          : "border-l-transparent text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100",
      )}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
      {item.label}
    </button>
  );
}

function SidebarContent({
  activeView,
  onSelect,
}: {
  activeView: ViewKey;
  onSelect: (v: ViewKey) => void;
}) {
  const user = useAppStore((s) => s.user);
  const clearAuth = useAppStore((s) => s.clearAuth);

  const handleLogout = () => {
    clearAuth();
    toast.info("Anda telah keluar", { description: "Sesi diakhiri dengan aman." });
  };

  return (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <div className="flex items-center gap-3 px-4 pb-5 pt-6">
        <Monogram size={38} />
        <div className="min-w-0">
          <p className="truncate font-semibold tracking-tight text-zinc-100">
            Z Family Office
          </p>
          <p className="truncate text-[11px] text-zinc-500">Internal Wealth Platform</p>
        </div>
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
          />
        ))}
      </nav>

      {/* User + logout */}
      <div className="border-t border-white/10 p-4">
        {user && (
          <div className="mb-3 space-y-1.5">
            <p className="truncate text-sm font-medium text-zinc-200">{user.name}</p>
            <p className="truncate text-[11px] text-zinc-500">{user.email}</p>
            <RoleBadge role={user.role} />
          </div>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          className="min-h-[44px] w-full justify-start text-zinc-400 hover:bg-rose-500/10 hover:text-rose-400"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Keluar
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

  const [mounted, setMounted] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
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
          className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-zinc-950 lg:flex"
          aria-label="Sidebar navigasi"
        >
          <SidebarContent activeView={activeView} onSelect={goTo} />
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

          {/* Konten view */}
          <main className="flex-1 overflow-y-auto p-6 scrollbar-thin lg:p-8">
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
    </div>
  );
}


