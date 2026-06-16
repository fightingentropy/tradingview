/**
 * Cboe delayed-quotes CDN — public, keyless, ~15-min delayed. Source for the real
 * CBOE Volatility Index (VIX) and its history. Fetched directly from the app (no
 * proxy: there is no API key to hide). Cboe addresses symbols with an underscore
 * prefix on this CDN, e.g. the "^VIX" index is "_VIX".
 */
const BASE = 'https://cdn.cboe.com/api/global/delayed_quotes';

export interface CboeQuote {
  current_price?: number;
  price_change_percent?: number;
  prev_day_close?: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
}

export interface CboeDailyBar {
  date: string; // "YYYY-MM-DD"
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string;
}

export interface CboeIntradayBar {
  datetime: string; // "YYYY-MM-DDTHH:mm:ss" (US Eastern, no tz suffix)
  price?: { open: number; high: number; low: number; close: number };
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchCboeQuote(cboeKey: string): Promise<CboeQuote | null> {
  const json = await getJson<{ data?: CboeQuote }>(`${BASE}/quotes/${cboeKey}.json`);
  return json?.data ?? null;
}

export async function fetchCboeDaily(cboeKey: string): Promise<CboeDailyBar[]> {
  const json = await getJson<{ data?: CboeDailyBar[] }>(
    `${BASE}/charts/historical/${cboeKey}.json`,
  );
  return json?.data ?? [];
}

export async function fetchCboeIntraday(cboeKey: string): Promise<CboeIntradayBar[]> {
  const json = await getJson<{ data?: CboeIntradayBar[] }>(
    `${BASE}/charts/intraday/${cboeKey}.json`,
  );
  return json?.data ?? [];
}
