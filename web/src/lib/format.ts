/**
 * Shared formatting utilities for market data
 */

export interface OrderBookLevel {
  price: number;
  size: number;
  total: number;
}

export interface L2Book {
  asks: OrderBookLevel[];
  bids: OrderBookLevel[];
}

/**
 * Normalize a symbol to standard format (uppercase, no suffix).
 * Preserves supported venue prefixes and case-sensitive thousand-unit contracts.
 */
const normalizeCoreSymbol = (value: string): string => {
  const upper = value.toUpperCase();
  const cleaned = upper.replace(/[^A-Z0-9]/g, "");
  if (cleaned.endsWith("USDT")) return cleaned.slice(0, -4);
  if (cleaned.endsWith("USD")) return cleaned.slice(0, -3);
  if (cleaned.endsWith("PERP")) return cleaned.slice(0, -4);
  return cleaned;
};

export const normalizeSymbol = (symbolName: string): string => {
  if (!symbolName) return "BTC";
  const raw = String(symbolName);
  const trimmed = raw.trim();
  // Hyperliquid's thousand-unit contracts have a case-sensitive lowercase k.
  if (/^k[A-Z0-9]+$/.test(trimmed)) return trimmed;
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("xyz:") || lower.startsWith("para:")) {
    const suffix = trimmed.slice(trimmed.indexOf(":") + 1);
    const normalized = normalizeCoreSymbol(suffix);
    return normalized ? `${lower.split(":")[0]}:${normalized}` : "";
  }
  return normalizeCoreSymbol(raw);
};

/**
 * Format a price value for display
 */
export const formatPrice = (value: any): string => {
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  const abs = Math.abs(num);
  if (abs >= 1000) return num.toFixed(2);
  if (abs >= 100) return num.toFixed(2);
  if (abs >= 1) return num.toFixed(3);
  return num.toFixed(6);
};

/**
 * Format volume for display (with K, M, B suffixes)
 */
export const formatVolume = (value: number): string => {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
};

/**
 * Format a percentage value for display
 */
export const formatPercent = (value: number): string => {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
};
