import { Component, createEffect, createMemo, createSignal } from "solid-js";
import SymbolChart from "./SymbolChart";
import { MARKETS, currentMarketType, type Market } from "../stores/market";
import { normalizeSymbol } from "../lib/hyperliquid";

const STORAGE_KEY = "trade-xyz-charts-grid";
const RESOLUTION_KEY = "trade-xyz-charts-resolution";
const CHART_COUNT_KEY = "trade-xyz-charts-count";
const DEFAULT_SYMBOLS = ["BTC", "HYPE", "BTC", "HYPE", "BTC", "HYPE"];
const CHART_COUNTS = [2, 4, 6] as const;
type ChartCount = (typeof CHART_COUNTS)[number];
const RESOLUTIONS = ["5", "15", "60", "240", "1D", "1W"] as const;
type Resolution = (typeof RESOLUTIONS)[number];
const RESOLUTION_LABELS: Record<Resolution, string> = {
  "5": "5m",
  "15": "15m",
  "60": "1h",
  "240": "4h",
  "1D": "1d",
  "1W": "1w",
};
const RAW_SYMBOLS = new Set([
  "COPPER",
  "NATGAS",
  "PLATINUM",
  "SILVER",
  "GOLD",
  "ALUMINIUM",
  "URANIUM",
]);

const loadResolution = (): Resolution => {
  try {
    const stored = localStorage.getItem(RESOLUTION_KEY);
    if (stored && RESOLUTIONS.includes(stored as Resolution)) {
      return stored as Resolution;
    }
  } catch (error) {
    // Ignore storage errors
  }
  return "5";
};

const normalizeSymbolsList = (values: string[], count: number): string[] => {
  const normalized = values.map((entry, index) => {
    const fallback = DEFAULT_SYMBOLS[index] ?? DEFAULT_SYMBOLS[0];
    const value = String(entry ?? "").trim();
    if (!value) return fallback;
    const next = normalizeSymbol(value);
    return next || fallback;
  });
  const trimmed = normalized.slice(0, count);
  while (trimmed.length < count) {
    trimmed.push(DEFAULT_SYMBOLS[trimmed.length] ?? DEFAULT_SYMBOLS[0]);
  }
  return trimmed;
};

const loadSymbols = (count: number): string[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as string[];
      if (Array.isArray(parsed)) {
        return normalizeSymbolsList(parsed, count);
      }
    }
  } catch (error) {
    // Ignore storage errors
  }
  return normalizeSymbolsList(DEFAULT_SYMBOLS, count);
};

const loadChartCount = (): ChartCount => {
  try {
    const stored = localStorage.getItem(CHART_COUNT_KEY);
    if (stored) {
      const parsed = Number(stored);
      if (CHART_COUNTS.includes(parsed as ChartCount)) {
        return parsed as ChartCount;
      }
    }
  } catch (error) {
    // Ignore storage errors
  }
  return 4;
};

const getSymbolOptions = (): string[] => {
  const set = new Set<string>();
  MARKETS().forEach((market) => set.add(market.symbol));
  DEFAULT_SYMBOLS.forEach((symbol) => set.add(symbol));
  return Array.from(set).sort();
};

const ChartsGrid: Component = () => {
  const initialChartCount = loadChartCount();
  const [chartCount, setChartCount] =
    createSignal<ChartCount>(initialChartCount);
  const [symbols, setSymbols] = createSignal<string[]>(
    loadSymbols(initialChartCount),
  );
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [resolution, setResolution] =
    createSignal<Resolution>(loadResolution());
  const options = createMemo(() => {
    const merged = new Set(getSymbolOptions());
    symbols().forEach((symbol) => merged.add(symbol));
    return Array.from(merged).sort();
  });
  const marketBySymbol = createMemo(() => {
    const preferredType = currentMarketType();
    const list = MARKETS();
    const map = new Map<string, Market>();
    list.forEach((market) => {
      if (market.type === preferredType) {
        map.set(market.symbol, market);
      }
    });
    list.forEach((market) => {
      if (!map.has(market.symbol)) {
        map.set(market.symbol, market);
      }
    });
    return map;
  });

  const updateSymbol = (index: number, value: string) => {
    const normalized = normalizeSymbol(value);
    setSymbols((prev) => {
      const next = [...prev];
      next[index] = normalized || prev[index];
      return next;
    });
  };

  createEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(symbols()));
    } catch (error) {
      // Ignore storage errors
    }
  });

  createEffect(() => {
    try {
      localStorage.setItem(RESOLUTION_KEY, resolution());
    } catch (error) {
      // Ignore storage errors
    }
  });

  createEffect(() => {
    const count = chartCount();
    setSymbols((prev) => {
      const next = normalizeSymbolsList(prev, count);
      if (
        next.length === prev.length &&
        next.every((value, index) => value === prev[index])
      ) {
        return prev;
      }
      return next;
    });
    try {
      localStorage.setItem(CHART_COUNT_KEY, String(count));
    } catch (error) {
      // Ignore storage errors
    }
  });

  const gridClasses = createMemo(() => {
    const count = chartCount();
    if (count === 2) {
      return "grid-cols-1 grid-rows-2 md:grid-cols-2 md:grid-rows-1";
    }
    if (count === 6) {
      return "grid-cols-1 grid-rows-6 md:grid-cols-2 md:grid-rows-3";
    }
    return "grid-cols-1 grid-rows-4 md:grid-cols-2 md:grid-rows-2";
  });
  const changeForSymbol = (symbol: string) => {
    const market = marketBySymbol().get(symbol);
    if (!market || !Number.isFinite(market.change24h)) {
      return { text: "--", className: "text-brand-slate-500" };
    }
    const sign = market.change24h >= 0 ? "+" : "";
    return {
      text: `${sign}${market.change24h.toFixed(2)}%`,
      className:
        market.change24h >= 0 ? "text-brand-green-400" : "text-brand-red-400",
    };
  };
  const labelForSymbol = (symbol: string) => {
    const trimmed = symbol.trim();
    const withoutPrefix = trimmed.toLowerCase().startsWith("xyz:")
      ? trimmed.slice(trimmed.indexOf(":") + 1)
      : trimmed;
    const withoutSuffix = withoutPrefix.toUpperCase().endsWith("-USDC")
      ? withoutPrefix.slice(0, -5)
      : withoutPrefix;
    const base = withoutSuffix.toUpperCase();
    for (const raw of RAW_SYMBOLS) {
      if (base === raw || base.startsWith(`${raw}-`)) {
        return raw;
      }
    }
    return `${base}-USDC`;
  };

  return (
    <div class="relative h-full w-full bg-brand-screen">
      <div class="absolute right-4 top-4 z-20">
        <button
          class="flex items-center gap-2 rounded-lg border border-brand-border bg-brand-surface px-3 py-2 text-xs font-semibold text-brand-slate-200 shadow-lg hover:bg-brand-border/60"
          onClick={() => setMenuOpen(!menuOpen())}
        >
          <span>Charts</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        {menuOpen() && (
          <>
            <div
              class="fixed inset-0 z-30"
              onClick={() => setMenuOpen(false)}
            />
            <div class="absolute right-0 top-full z-40 mt-2 w-52 rounded-lg border border-brand-border bg-brand-surface shadow-xl">
              <div class="border-b border-brand-border px-3 py-2">
                <span class="text-[11px] font-medium uppercase tracking-wider text-brand-slate-400">
                  Layout
                </span>
              </div>
              <div class="space-y-2 px-3 py-3">
                <div class="flex items-center justify-between gap-2 text-xs text-brand-slate-300">
                  <span>Charts</span>
                  <select
                    class="rounded border border-brand-border bg-brand-screen px-2 py-1 text-xs text-slate-200 focus:border-brand-accent"
                    value={chartCount()}
                    onChange={(event) =>
                      setChartCount(
                        Number(event.currentTarget.value) as ChartCount,
                      )
                    }
                  >
                    {CHART_COUNTS.map((count) => (
                      <option value={count}>{count}</option>
                    ))}
                  </select>
                </div>
                <div class="flex items-center justify-between gap-2 text-xs text-brand-slate-300">
                  <span>Resolution</span>
                  <select
                    class="rounded border border-brand-border bg-brand-screen px-2 py-1 text-xs text-slate-200 focus:border-brand-accent"
                    value={resolution()}
                    onChange={(event) =>
                      setResolution(event.currentTarget.value as Resolution)
                    }
                  >
                    {RESOLUTIONS.map((option) => (
                      <option value={option}>
                        {RESOLUTION_LABELS[option]}
                      </option>
                    ))}
                  </select>
                </div>
                {symbols().map((symbol, index) => (
                  <label class="flex items-center justify-between gap-2 text-xs text-brand-slate-300">
                    <span>Chart {index + 1}</span>
                    <select
                      class="rounded border border-brand-border bg-brand-screen px-2 py-1 text-xs text-slate-200 focus:border-brand-accent"
                      value={symbol}
                      onChange={(event) =>
                        updateSymbol(index, event.currentTarget.value)
                      }
                    >
                      {options().map((option) => (
                        <option value={option} selected={option === symbol}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <div class={`grid h-full gap-px bg-brand-border ${gridClasses()}`}>
        {symbols().map((symbol) => (
          <div class="relative flex min-h-0 flex-col bg-brand-screen">
            <div class="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-md border border-brand-border bg-brand-surface/80 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-brand-slate-200">
              {(() => {
                const change = changeForSymbol(symbol);
                return (
                  <>
                    <span>{labelForSymbol(symbol)}</span>
                    <span class={change.className}>{change.text}</span>
                  </>
                );
              })()}
            </div>
            <SymbolChart symbol={symbol} resolution={resolution()} />
          </div>
        ))}
      </div>
    </div>
  );
};

export default ChartsGrid;
