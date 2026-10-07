"use client";

// ============================================================
// PriceTicker — strip marquee harga live di bawah topbar
// Sumber: useRates (/rates, refresh 60s) · loop mulus 2x konten
// CSS marquee 40s linear infinite · pause on hover · ringan 1 baris
// ============================================================
import * as React from "react";
import { useRates } from "@/components/shared/kit";
import { formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";

const usdNoCents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const usdCents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const idrPlain = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

function fmtPrice(usd: number): string {
  return usd >= 1000 ? usdNoCents.format(usd) : usdCents.format(usd);
}

interface TickerEntry {
  key: string;
  symbol: string;
  price: string;
  change: number | null;
}

export default function PriceTicker() {
  const { data: rates } = useRates();

  const entries = React.useMemo<TickerEntry[]>(() => {
    if (!rates?.prices) return [];
    const list: TickerEntry[] = Object.entries(rates.prices).map(
      ([symbol, p]) => ({
        key: symbol,
        symbol,
        price: fmtPrice(p.usd),
        change: typeof p.change24hPct === "number" ? p.change24hPct : null,
      }),
    );
    if (typeof rates.USDIDR === "number" && rates.USDIDR > 0) {
      list.push({
        key: "USDIDR",
        symbol: "USD/IDR",
        price: idrPlain.format(rates.USDIDR),
        change: null,
      });
    }
    return list;
  }, [rates]);

  // Belum ada data → bar tipis stabil (tanpa lompatan layout)
  if (entries.length === 0) {
    return <div className="h-8 shrink-0 border-b bg-muted/30" aria-hidden="true" />;
  }

  // Duplikasi 2x untuk loop mulus (translateX -50%)
  const loop = [...entries, ...entries];

  return (
    <div
      className="marquee-paused relative flex h-8 shrink-0 items-center overflow-hidden border-b bg-muted/40 dark:bg-zinc-900/50"
      aria-label="Ticker harga pasar"
      role="status"
    >
      <div className="animate-marquee flex w-max shrink-0 items-center whitespace-nowrap py-1">
        {loop.map((e, i) => (
          <span
            key={`${e.key}-${i}`}
            className="mr-8 inline-flex items-center gap-1.5 pl-0 text-xs"
            aria-hidden={i >= entries.length}
          >
            <span className="font-semibold tracking-wide">{e.symbol}</span>
            <span className="tabular-nums text-muted-foreground">{e.price}</span>
            {e.change !== null && (
              <span
                className={cn(
                  "font-medium tabular-nums",
                  e.change >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-rose-600 dark:text-rose-400",
                )}
              >
                {formatPct(e.change)}
              </span>
            )}
          </span>
        ))}
      </div>
      {/* Fade tepi */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-background to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-background to-transparent" />
    </div>
  );
}
