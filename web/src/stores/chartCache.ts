import type { Candle } from "../lib/candles";
import { hyperliquidDataNetwork } from "../lib/hyperliquidNetwork";
import { getAllWatchlistSymbolSet, getWatchlistCoreSymbol, type DataProvider } from "./market";

const CACHE_KEY = "trade-xyz-chart-cache";
const CACHE_VERSION = 2;
const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CANDLES_PER_KEY = 1000;

interface CacheEntry {
  candles: Candle[];
  lastTimestamp: number;
  updatedAt: number;
}

interface CacheData {
  version: number;
  entries: Record<string, CacheEntry>;
}

// In-memory cache for fast access
const memoryCache = new Map<string, CacheEntry>();

const WATCHLIST_SYMBOL_SUFFIX = /-(perps|spot|equities)$/;

const normalizeWatchlistSymbol = (symbol: string): string => {
  const trimmed = symbol.replace(WATCHLIST_SYMBOL_SUFFIX, "");
  return getWatchlistCoreSymbol(trimmed);
};

const isWatchlistedSymbol = (symbol: string): boolean => {
  const baseSymbol = normalizeWatchlistSymbol(symbol);
  if (!baseSymbol) return false;
  return getAllWatchlistSymbolSet().has(baseSymbol);
};

const parseSymbolFromKey = (key: string): string | null => {
  const first = key.indexOf(":");
  const last = key.lastIndexOf(":");
  if (first < 0 || last < 0 || first === last) return null;
  return key.slice(first + 1, last);
};

const shouldKeepKey = (key: string): boolean => {
  const symbol = parseSymbolFromKey(key);
  if (!symbol) return false;
  return isWatchlistedSymbol(symbol);
};

const pruneMemoryCache = () => {
  const keysToRemove: string[] = [];
  memoryCache.forEach((_, key) => {
    if (!shouldKeepKey(key)) keysToRemove.push(key);
  });
  keysToRemove.forEach((key) => memoryCache.delete(key));
};

// Load cache from localStorage on init
const loadFromStorage = (): CacheData | null => {
  try {
    const stored = localStorage.getItem(CACHE_KEY);
    if (stored) {
      const data = JSON.parse(stored) as CacheData;
      if (data.version === CACHE_VERSION) {
        return data;
      }
    }
  } catch (e) {
    console.warn("Failed to load chart cache from storage:", e);
  }
  return null;
};

// Save cache to localStorage
const saveToStorage = () => {
  try {
    pruneMemoryCache();
    const entries: Record<string, CacheEntry> = {};
    memoryCache.forEach((entry, key) => {
      entries[key] = entry;
    });
    const data: CacheData = { version: CACHE_VERSION, entries };
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn("Failed to save chart cache to storage:", e);
  }
};

// Debounced save to avoid too many writes
let saveTimeout: number | undefined;
const debouncedSave = () => {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(saveToStorage, 1000) as unknown as number;
};

const flushSave = () => {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = undefined;
  }
  saveToStorage();
};

// Initialize memory cache from storage
const initCache = () => {
  const storedData = loadFromStorage();
  if (storedData) {
    const now = Date.now();
    Object.entries(storedData.entries).forEach(([key, entry]) => {
      // Only load entries that aren't too old
      if (now - entry.updatedAt < MAX_CACHE_AGE_MS && shouldKeepKey(key)) {
        memoryCache.set(key, entry);
      }
    });
  }
};

// Initialize on module load
initCache();
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushSave);
}

// Generate cache key
export const getCacheKey = (
  provider: DataProvider,
  symbol: string,
  resolution: string,
): string => {
  return `${provider}-${hyperliquidDataNetwork()}:${symbol}:${resolution}`;
};

// Get cached candles
export const getCachedCandles = (
  provider: DataProvider,
  symbol: string,
  resolution: string,
): CacheEntry | null => {
  if (!isWatchlistedSymbol(symbol)) return null;
  const key = getCacheKey(provider, symbol, resolution);
  return memoryCache.get(key) || null;
};

// Update cache with new candles
export const updateCachedCandles = (
  provider: DataProvider,
  symbol: string,
  resolution: string,
  newCandles: Candle[],
  replaceAll: boolean = false,
): Candle[] => {
  const key = getCacheKey(provider, symbol, resolution);
  if (!isWatchlistedSymbol(symbol)) {
    memoryCache.delete(key);
    let limited = newCandles;
    if (limited.length > MAX_CANDLES_PER_KEY) {
      limited = limited.slice(-MAX_CANDLES_PER_KEY);
    }
    return limited;
  }

  const existing = memoryCache.get(key);

  let mergedCandles: Candle[];

  if (replaceAll || !existing) {
    // Full replacement
    mergedCandles = newCandles;
  } else {
    // Merge: keep old candles, update/add new ones
    const candleMap = new Map<number, Candle>();

    // Add existing candles
    existing.candles.forEach((c) => candleMap.set(c.time, c));

    // Add/update with new candles
    newCandles.forEach((c) => candleMap.set(c.time, c));

    // Convert back to sorted array
    mergedCandles = Array.from(candleMap.values()).sort(
      (a, b) => a.time - b.time,
    );
  }

  // Limit cache size
  if (mergedCandles.length > MAX_CANDLES_PER_KEY) {
    mergedCandles = mergedCandles.slice(-MAX_CANDLES_PER_KEY);
  }

  const lastCandle = mergedCandles[mergedCandles.length - 1];
  const entry: CacheEntry = {
    candles: mergedCandles,
    lastTimestamp: lastCandle?.time || Date.now(),
    updatedAt: Date.now(),
  };

  memoryCache.set(key, entry);
  debouncedSave();

  return mergedCandles;
};

// Update just the last candle (for real-time updates)
export const updateLastCandle = (
  provider: DataProvider,
  symbol: string,
  resolution: string,
  candle: Candle,
): void => {
  const key = getCacheKey(provider, symbol, resolution);
  if (!isWatchlistedSymbol(symbol)) {
    memoryCache.delete(key);
    return;
  }
  const existing = memoryCache.get(key);

  if (!existing) return;

  const lastIdx = existing.candles.findIndex((c) => c.time === candle.time);

  if (lastIdx >= 0) {
    // Update existing candle
    existing.candles[lastIdx] = candle;
  } else if (candle.time > existing.lastTimestamp) {
    // Add new candle
    existing.candles.push(candle);
    existing.lastTimestamp = candle.time;

    // Limit size
    if (existing.candles.length > MAX_CANDLES_PER_KEY) {
      existing.candles = existing.candles.slice(-MAX_CANDLES_PER_KEY);
    }
  }

  existing.updatedAt = Date.now();
  memoryCache.set(key, existing);
  debouncedSave();
};
