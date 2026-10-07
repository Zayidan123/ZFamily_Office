"use client";

// ============================================================
// Pasar — watchlist simbol & harga live
// GET /market/watchlist (30s) · GET /market/symbols · GET /market/history
// Sparkline mini (SVG) + dialog detail (AreaChart 7/30/90 hari)
// RBAC: owner CRUD, lainnya read-only
// ============================================================
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch, ApiError } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { formatDate, formatPct } from "@/lib/format";
import {
  StatCard,
  PageHeader,
  EmptyState,
  ErrorBox,
  CurrencyText,
  useFormatCurrency,
  useRates,
  ConfirmButton,
} from "@/components/shared/kit";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  LineChart as LineChartIcon,
  Eye,
  Plus,
  Trash2,
  Loader2,
  TrendingUp,
  TrendingDown,
  Coins,
  StickyNote,
} from "lucide-react";

// ------------------------------------------------------------
// Types (inline sesuai kontrak R-b — types.ts tidak diubah)
// ------------------------------------------------------------
interface WatchPrice {
  usd: number;
  change24hPct: number;
}

interface WatchlistItem {
  id: number;
  symbol: string;
  note: string | null;
  addedAt: string;
  price: WatchPrice;
}

interface SymbolInfo {
  symbol: string;
  usd: number;
  change24hPct: number;
}

interface MarketHistoryPoint {
  date: string;
  price: number;
}

interface MarketHistory {
  symbol: string;
  days: number;
  points: MarketHistoryPoint[];
}

// ------------------------------------------------------------
// Sparkline mini — SVG polyline + area gradient
// ------------------------------------------------------------
function Sparkline({
  values,
  up,
  className,
}: {
  values: number[];
  up: boolean;
  className?: string;
}) {
  const id = React.useId().replace(/[:]/g, "");
  if (values.length < 2) return null;
  const w = 120;
  const h = 36;
  const pad = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = (w - pad * 2) / (values.length - 1);
  const coords = values.map((p, i) => {
    const x = pad + i * step;
    const y = h - pad - ((p - min) / span) * (h - pad * 2);
    return [x, y] as const;
  });
  const linePath = coords
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const last = coords[coords.length - 1];
  const first = coords[0];
  const areaPath = `${linePath} L${last[0].toFixed(1)},${h - pad} L${first[0].toFixed(1)},${h - pad} Z`;
  const pointsAttr = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const color = up ? "#10b981" : "#f43f5e";

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={cn("h-9 w-full", className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.32} />
          <stop offset="100%" stopColor={color} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#spark-${id})`} stroke="none" />
      <polyline
        points={pointsAttr}
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ------------------------------------------------------------
// Hook history per simbol
// ------------------------------------------------------------
function useMarketHistory(symbol: string, days: number, enabled = true) {
  return useQuery<MarketHistory, ApiError>({
    queryKey: ["market", "history", symbol, days],
    queryFn: () =>
      apiFetch<MarketHistory>("/market/history", { params: { symbol, days } }),
    enabled: enabled && Boolean(symbol),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

// ------------------------------------------------------------
// Kartu watchlist (sparkline mini + harga live)
// ------------------------------------------------------------
function WatchCard({
  item,
  isOwner,
  onOpen,
  onDelete,
  deleting,
}: {
  item: WatchlistItem;
  isOwner: boolean;
  onOpen: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const historyQuery = useMarketHistory(item.symbol, 30);
  const points = historyQuery.data?.points ?? [];
  const values = React.useMemo(() => points.map((p) => p.price), [points]);
  const up = item.price.change24hPct >= 0;

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={`Detail ${item.symbol}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group cursor-pointer rounded-xl p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-lg font-bold tracking-tight">{item.symbol}</p>
          {item.note ? (
            <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
              <StickyNote className="h-3 w-3 shrink-0" aria-hidden="true" />
              {item.note}
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground/60">
              Ditambahkan {formatDate(item.addedAt)}
            </p>
          )}
        </div>
        {isOwner && (
          <span onClick={(e) => e.stopPropagation()}>
            <ConfirmButton
              size="icon"
              variant="ghost"
              confirmLabel="?"
              title={`Hapus ${item.symbol} dari watchlist`}
              className="h-8 w-8 text-muted-foreground opacity-0 transition-opacity hover:text-rose-600 focus-visible:opacity-100 group-hover:opacity-100"
              onConfirm={onDelete}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              )}
            </ConfirmButton>
          </span>
        )}
      </div>

      <div className="mt-3 flex items-end justify-between gap-2">
        <CurrencyText
          usd={item.price.usd}
          className="text-xl font-semibold tabular-nums"
        />
        <Badge
          variant="outline"
          className={cn(
            "tabular-nums",
            up
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400",
          )}
        >
          {formatPct(item.price.change24hPct)}
        </Badge>
      </div>

      <div className="mt-2">
        {historyQuery.isPending ? (
          <Skeleton className="h-9 w-full rounded-md" />
        ) : historyQuery.isError ? (
          <p className="flex h-9 items-center text-xs text-muted-foreground">
            Sparkline tidak tersedia
          </p>
        ) : (
          <Sparkline values={values} up={up} />
        )}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------
// Dialog detail simbol (chart besar + toggle 7/30/90 hari)
// ------------------------------------------------------------
function WatchDetailDialog({
  item,
  open,
  onOpenChange,
}: {
  item: WatchlistItem | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [days, setDays] = React.useState<7 | 30 | 90>(30);
  const formatCurrency = useFormatCurrency();
  const symbol = item?.symbol ?? "";

  React.useEffect(() => {
    if (open) setDays(30);
  }, [open, symbol]);

  const historyQuery = useMarketHistory(symbol, days, open && Boolean(item));

  const points = historyQuery.data?.points ?? [];
  const first = points.length > 0 ? points[0].price : null;
  const lastPrice = points.length > 0 ? points[points.length - 1].price : null;
  const periodChange =
    first && lastPrice ? ((lastPrice - first) / first) * 100 : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {item && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-xl">
                {item.symbol}
                <Badge
                  variant="outline"
                  className={cn(
                    "tabular-nums",
                    item.price.change24hPct >= 0
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400",
                  )}
                >
                  {formatPct(item.price.change24hPct)} 24j
                </Badge>
              </DialogTitle>
              <DialogDescription>
                Harga sekarang{" "}
                <CurrencyText
                  usd={item.price.usd}
                  className="font-semibold text-foreground"
                />{" "}
                · ditambahkan {formatDate(item.addedAt)}
              </DialogDescription>
            </DialogHeader>

            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Riwayat Harga
              </p>
              <div className="flex gap-1" role="group" aria-label="Rentang hari">
                {([7, 30, 90] as const).map((d) => (
                  <Button
                    key={d}
                    type="button"
                    size="sm"
                    variant={days === d ? "default" : "outline"}
                    className="h-7 px-2.5 text-xs"
                    onClick={() => setDays(d)}
                    aria-pressed={days === d}
                  >
                    {d} hari
                  </Button>
                ))}
              </div>
            </div>

            <div className="h-[220px] w-full" role="img" aria-label={`Grafik harga ${symbol}`}>
              {historyQuery.isPending ? (
                <Skeleton className="h-full w-full rounded-lg" />
              ) : historyQuery.isError ? (
                <ErrorBox
                  className="h-full"
                  message={
                    historyQuery.error instanceof ApiError
                      ? historyQuery.error.message
                      : undefined
                  }
                  onRetry={() => void historyQuery.refetch()}
                />
              ) : points.length === 0 ? (
                <EmptyState title="Belum ada data riwayat" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id={`detailFill-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.32} />
                        <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="rgba(113,113,122,0.18)"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: "#71717a", fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={32}
                      tickFormatter={(v: string) => v.slice(5)}
                    />
                    <YAxis
                      tickFormatter={(v: number) => formatCurrency(v, true)}
                      tick={{ fill: "#71717a", fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      width={70}
                      domain={["auto", "auto"]}
                    />
                    <Tooltip
                      cursor={{ stroke: "rgba(113,113,122,0.35)", strokeDasharray: "4 4" }}
                      contentStyle={{
                        background: "var(--popover)",
                        border: "1px solid var(--border)",
                        borderRadius: 12,
                        fontSize: 12,
                      }}
                      formatter={(value) => [formatCurrency(Number(value)), "Harga"]}
                    />
                    <Area
                      type="monotone"
                      dataKey="price"
                      stroke="#10b981"
                      strokeWidth={2.2}
                      fill={`url(#detailFill-${symbol})`}
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 0 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Perubahan {days} hari:</span>
              {periodChange === null ? (
                <span className="tabular-nums">—</span>
              ) : (
                <span
                  className={cn(
                    "font-semibold tabular-nums",
                    periodChange >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400",
                  )}
                >
                  {formatPct(periodChange)}
                </span>
              )}
            </div>

            {item.note && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm">
                <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
                    Catatan
                  </p>
                  <p className="whitespace-pre-wrap">{item.note}</p>
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground/70">
              Untuk mengubah catatan, hapus simbol lalu tambahkan ulang dengan catatan baru.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------
// Dialog "+ Pantau Simbol" (owner)
// ------------------------------------------------------------
function AddWatchDialog({
  open,
  onOpenChange,
  symbols,
  watchedSymbols,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  symbols: SymbolInfo[];
  watchedSymbols: string[];
  pending: boolean;
  onSubmit: (symbol: string, note: string) => void;
}) {
  const [symbol, setSymbol] = React.useState("");
  const [note, setNote] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setSymbol("");
      setNote("");
    }
  }, [open]);

  const available = symbols.filter((s) => !watchedSymbols.includes(s.symbol));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pantau Simbol Baru</DialogTitle>
          <DialogDescription>
            Pilih simbol dari daftar harga yang tersedia, tambahkan catatan opsional.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="watch-symbol">Simbol</Label>
            <Select value={symbol} onValueChange={setSymbol}>
              <SelectTrigger id="watch-symbol" className="w-full" aria-label="Pilih simbol">
                <SelectValue placeholder="Pilih simbol…" />
              </SelectTrigger>
              <SelectContent>
                {available.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-muted-foreground">
                    Semua simbol sudah dipantau
                  </div>
                ) : (
                  available.map((s) => (
                    <SelectItem key={s.symbol} value={s.symbol}>
                      <span className="flex items-center gap-2">
                        <span className="font-semibold">{s.symbol}</span>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          ${s.usd >= 1000 ? s.usd.toLocaleString("en-US", { maximumFractionDigits: 0 }) : s.usd.toFixed(2)}
                        </span>
                      </span>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="watch-note">Catatan (opsional)</Label>
            <Input
              id="watch-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="mis. DCA bulanan, entry zone akumulasi…"
              maxLength={120}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button
            type="button"
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            disabled={!symbol || pending}
            onClick={() => onSubmit(symbol, note.trim())}
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="h-4 w-4" aria-hidden="true" />
            )}
            Pantau
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------
// MarketView
// ------------------------------------------------------------
export default function MarketView() {
  const queryClient = useQueryClient();
  const user = useAppStore((s) => s.user);
  const isOwner = user?.role === "owner";

  const [addOpen, setAddOpen] = React.useState(false);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<WatchlistItem | null>(null);

  // ---------- Queries ----------
  const watchlistQuery = useQuery<WatchlistItem[], ApiError>({
    queryKey: ["market", "watchlist"],
    queryFn: () => apiFetch<WatchlistItem[]>("/market/watchlist"),
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  const symbolsQuery = useQuery<SymbolInfo[], ApiError>({
    queryKey: ["market", "symbols"],
    queryFn: () => apiFetch<SymbolInfo[]>("/market/symbols"),
    staleTime: 60_000,
  });

  const ratesQuery = useRates();

  const watchlist = watchlistQuery.data ?? [];
  const symbols = symbolsQuery.data ?? [];

  // ---------- Mutations ----------
  const invalidateWatchlist = () =>
    void queryClient.invalidateQueries({ queryKey: ["market", "watchlist"] });

  const addMutation = useMutation({
    mutationFn: (body: { symbol: string; note?: string }) =>
      apiFetch<WatchlistItem>("/market/watchlist", { method: "POST", body }),
    onSuccess: (_data, vars) => {
      toast.success(`${vars.symbol} ditambahkan ke watchlist`);
      setAddOpen(false);
      invalidateWatchlist();
    },
    onError: (err) => {
      toast.error("Gagal menambah simbol", {
        description: err instanceof ApiError ? err.message : "Coba lagi sebentar",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch<void>(`/market/watchlist/${id}`, { method: "DELETE" }),
    onSuccess: (_d, id) => {
      const target = watchlist.find((w) => w.id === id);
      toast.success(`${target?.symbol ?? "Simbol"} dihapus dari watchlist`);
      if (selected?.id === id) {
        setDetailOpen(false);
        setSelected(null);
      }
      invalidateWatchlist();
    },
    onError: (err) => {
      toast.error("Gagal menghapus simbol", {
        description: err instanceof ApiError ? err.message : "Coba lagi sebentar",
      });
    },
  });

  // ---------- Derived stats ----------
  const gainers = watchlist.filter((w) => w.price?.change24hPct !== undefined);
  const topGainer =
    gainers.length > 0
      ? gainers.reduce((a, b) =>
          b.price.change24hPct > a.price.change24hPct ? b : a,
        )
      : null;
  const topLoser =
    gainers.length > 0
      ? gainers.reduce((a, b) =>
          b.price.change24hPct < a.price.change24hPct ? b : a,
        )
      : null;
  const xau =
    ratesQuery.data?.prices?.XAU ??
    (symbols.find((s) => s.symbol === "XAU")
      ? {
          usd: symbols.find((s) => s.symbol === "XAU")!.usd,
          change24hPct: symbols.find((s) => s.symbol === "XAU")!.change24hPct,
        }
      : null);

  const loadingAll = watchlistQuery.isPending && !watchlistQuery.data;
  const errMsg =
    watchlistQuery.error instanceof ApiError
      ? watchlistQuery.error.message
      : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pasar"
        subtitle="Watchlist simbol & harga live — diperbarui otomatis tiap 30 detik."
        actions={
          isOwner && (
            <Button
              type="button"
              size="sm"
              className="min-h-[40px] bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={() => setAddOpen(true)}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Pantau Simbol
            </Button>
          )
        }
      />

      {watchlistQuery.isError && !watchlistQuery.data && (
        <ErrorBox message={errMsg} onRetry={() => void watchlistQuery.refetch()} />
      )}

      {/* ---------- StatCards ---------- */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          loading={loadingAll}
          label="Simbol Dipantau"
          value={watchlistQuery.data ? `${watchlist.length}` : "—"}
          sub={`${symbols.length || "—"} simbol tersedia`}
          icon={<Eye className="h-5 w-5" />}
        />
        <StatCard
          loading={loadingAll}
          label="Gainer Teratas"
          value={topGainer ? topGainer.symbol : "—"}
          delta={topGainer?.price.change24hPct ?? null}
          sub={topGainer ? <CurrencyText usd={topGainer.price.usd} compact /> : undefined}
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <StatCard
          loading={loadingAll}
          label="Loser Teratas"
          value={topLoser ? topLoser.symbol : "—"}
          delta={topLoser?.price.change24hPct ?? null}
          sub={topLoser ? <CurrencyText usd={topLoser.price.usd} compact /> : undefined}
          accent="rose"
          icon={<TrendingDown className="h-5 w-5" />}
        />
        <StatCard
          label="XAU / USD"
          value={xau ? formatXauValue(xau.usd) : "—"}
          delta={xau?.change24hPct ?? null}
          sub="Emas spot per troy ounce"
          accent="amber"
          icon={<Coins className="h-5 w-5" />}
        />
      </div>

      {/* ---------- Grid watchlist ---------- */}
      {loadingAll ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="rounded-xl p-5">
              <Skeleton className="h-6 w-24" />
              <Skeleton className="mt-3 h-4 w-32" />
              <Skeleton className="mt-4 h-7 w-28" />
              <Skeleton className="mt-4 h-9 w-full rounded-md" />
            </Card>
          ))}
        </div>
      ) : watchlist.length === 0 ? (
        <EmptyState
          icon={<LineChartIcon className="h-6 w-6" />}
          title="Watchlist masih kosong"
          description={
            isOwner
              ? "Pantau simbol favorit — BTC, ETH, XAU, saham, dan lainnya — lengkap dengan harga live dan sparkline 30 hari."
              : "Belum ada simbol yang dipantau. Owner dapat menambahkan simbol untuk dipantau."
          }
          action={
            isOwner && (
              <Button
                type="button"
                size="sm"
                className="bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={() => setAddOpen(true)}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Pantau Simbol
              </Button>
            )
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {watchlist.map((item) => (
            <WatchCard
              key={item.id}
              item={item}
              isOwner={isOwner}
              onOpen={() => {
                setSelected(item);
                setDetailOpen(true);
              }}
              onDelete={() => deleteMutation.mutate(item.id)}
              deleting={deleteMutation.isPending && deleteMutation.variables === item.id}
            />
          ))}
        </div>
      )}

      {/* ---------- Dialogs ---------- */}
      <WatchDetailDialog
        item={selected}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />

      <AddWatchDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        symbols={symbols}
        watchedSymbols={watchlist.map((w) => w.symbol)}
        pending={addMutation.isPending}
        onSubmit={(symbol, note) =>
          addMutation.mutate({ symbol, note: note || undefined })
        }
      />
    </div>
  );
}

function formatXauValue(usd: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(usd);
}
