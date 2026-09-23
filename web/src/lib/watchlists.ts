import { WATCHLIST_THEMES, classifyTradfiSymbol } from "../../../src/domain/marketThemes";

export { WATCHLIST_THEMES };
export const WATCHLISTS_KEY = "trade-xyz-watchlists";
export const DEFAULT_WATCHLISTS: Record<string, string[]> = {
  watchlist: ["xyz:SP500", "xyz:XYZ100", "xyz:NVDA", "xyz:GOOGL", "xyz:AMZN", "xyz:TSLA", "xyz:SPCX", "xyz:HOOD", "xyz:SNDK", "xyz:MU", "xyz:HIMS", "xyz:LLY", "xyz:LITE", "BTC", "ETH", "HYPE", "ZEC"],
  indices: ["xyz:SP500", "xyz:XYZ100", "xyz:JP225", "xyz:KR200"],
  rates: ["para:10Y", "xyz:TLT"],
  commodities: ["xyz:GOLD", "xyz:SILVER", "xyz:COPPER", "xyz:CL", "xyz:BRENTOIL", "xyz:NATGAS"],
  stocks: ["xyz:AAPL", "xyz:MSFT", "xyz:NVDA", "xyz:GOOGL", "xyz:AMZN", "xyz:META", "xyz:TSLA"],
  etfs: ["xyz:SMH", "xyz:URNM"],
  forex: ["xyz:EUR", "xyz:GBP", "xyz:JPY"],
  crypto: ["BTC", "ETH", "HYPE", "SOL", "XRP", "ZEC"],
};

export interface WatchlistsState {
  version: 2;
  activeId: string;
  lists: Record<string, string[]>;
  knownSymbols: Record<string, string[]>;
}

const symbols = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.filter((entry): entry is string => typeof entry === "string" && !!entry.trim()).map(entry => entry.trim()))]
  : [];
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
// Previously shipped members are already known on upgrade; newly listed members
// can be added without undoing a user's earlier removals.
const legacyMembers: Record<string, string[]> = {
  crypto: ["BTC", "ETH", "HYPE"],
  indices: ["xyz:XYZ100"],
  commodities: ["ALUMINIUM", "COPPER", "GOLD", "NATGAS", "PLATINUM", "SILVER", "URNM"].map(symbol => `xyz:${symbol}`),
  stocks: ["AAPL", "TSLA", "NVDA", "MSFT", "META", "GOOGL", "AMZN", "NFLX", "AMD", "PLTR", "HOOD", "MSTR", "MU", "SNDK"].map(symbol => `xyz:${symbol}`),
};
export const watchlistLabel = (id: string) => id === "watchlist" ? "Watchlist" : WATCHLIST_THEMES.find(theme => theme.id === id)?.name ?? id;
export const isDefaultWatchlist = (id: string) => Object.hasOwn(DEFAULT_WATCHLISTS, id);

export function restoreWatchlists(raw: unknown, legacy?: unknown): WatchlistsState {
  const stored = record(raw) ? raw : {};
  const savedLists = record(stored.lists) ? stored.lists : {};
  const lists = Object.fromEntries(Object.entries(DEFAULT_WATCHLISTS).map(([id, entries]) => [id, [...entries]]));
  for (const [id, entries] of Object.entries(savedLists)) {
    if (Array.isArray(entries)) Object.defineProperty(lists, id, { value: symbols(entries), enumerable: true, writable: true, configurable: true });
  }
  if (!Object.hasOwn(savedLists, "watchlist") && Array.isArray(legacy)) lists.watchlist = symbols(legacy);
  const savedKnown = record(stored.knownSymbols) ? stored.knownSymbols : {};
  const knownSymbols = Object.fromEntries(WATCHLIST_THEMES.map(theme => [theme.id,
    symbols(savedKnown[theme.id] ?? [...(lists[theme.id] ?? []), ...(Object.hasOwn(savedLists, theme.id) ? legacyMembers[theme.id] ?? [] : [])]),
  ]));
  const activeId = typeof stored.activeId === "string" && Object.hasOwn(lists, stored.activeId) ? stored.activeId : "watchlist";
  return { version: 2, activeId, lists, knownSymbols };
}

const ETFs = new Set(["URNM", "EWY", "EWJ", "EWZ", "EWT", "XLE", "SMH", "KORU", "SOXL", "MAGS", "XBI"]);
export function themeForMarket(market: { symbol: string; type: string }): string | null {
  if (market.type === "spot") return null;
  if (!market.symbol.includes(":")) return "crypto";
  const ticker = market.symbol.split(":")[1].toUpperCase();
  const category = classifyTradfiSymbol(ticker);
  if (category === "index") return "indices";
  if (category === "rates") return "rates";
  if (category === "commodity") return "commodities";
  if (category === "fx") return "forex";
  return ETFs.has(ticker) ? "etfs" : "stocks";
}

export function syncWatchlistThemes(state: WatchlistsState, markets: readonly { symbol: string; type: string }[]): WatchlistsState {
  let next = state;
  for (const theme of WATCHLIST_THEMES) {
    const known = new Set(state.knownSymbols[theme.id] ?? []);
    const additions = [...new Set(markets.filter(market => themeForMarket(market) === theme.id)
      .map(market => market.symbol))].filter(symbol => !known.has(symbol)).sort();
    if (!additions.length) continue;
    next = { ...next,
      lists: { ...next.lists, [theme.id]: [...(next.lists[theme.id] ?? []), ...additions] },
      knownSymbols: { ...next.knownSymbols, [theme.id]: [...known, ...additions] },
    };
  }
  return next;
}
