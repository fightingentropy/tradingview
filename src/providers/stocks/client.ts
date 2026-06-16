/**
 * Talks to the in-repo stocks proxy (Expo Router API routes), never to Twelve
 * Data directly, so the API key stays server-side. In dev the proxy is served
 * by the Metro dev server; we resolve its origin from expo-constants.
 */
import Constants from 'expo-constants';
import { NativeModules } from 'react-native';

export interface TdQuote {
  symbol?: string;
  name?: string;
  close?: string;
  previous_close?: string;
  percent_change?: string;
  volume?: string;
  exchange?: string;
  mic_code?: string;
  /** present on error responses */
  code?: number;
  status?: string;
}

export interface TdCandleValue {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

/**
 * Resolve the origin that serves our Expo Router API routes (the stocks proxy).
 * In a dev build that's the Metro dev server. `Constants.expoConfig.hostUri` is
 * NOT reliably populated in a custom dev client (it's an Expo Go convenience),
 * so we fall back to the URL the JS bundle was actually loaded from — RN's
 * `SourceCode.scriptURL`, e.g. "http://192.168.1.5:8081/index.bundle?..." — which
 * always points at the dev server (and uses the right LAN IP on a physical
 * device). In production set EXPO_PUBLIC_API_ORIGIN to your deployed proxy.
 */
function originFromUrl(url?: string | null): string | null {
  const m = url?.match(/^(https?:\/\/[^/]+)/);
  return m ? m[1] : null;
}

function apiBase(): string | null {
  const explicit = process.env.EXPO_PUBLIC_API_ORIGIN;
  if (explicit) return explicit.replace(/\/$/, '');

  const hostUri = Constants.expoConfig?.hostUri; // "192.168.1.102:8081" — Expo Go / sometimes dev
  if (hostUri) return `http://${hostUri.split('?')[0].replace(/\/$/, '')}`;

  const scriptURL = (NativeModules as { SourceCode?: { scriptURL?: string } }).SourceCode?.scriptURL;
  const fromScript = originFromUrl(scriptURL);
  if (fromScript) return fromScript;

  // Last-resort dev fallback: the iOS simulator shares the Mac's loopback.
  return __DEV__ ? 'http://localhost:8081' : null;
}

export async function fetchStockQuotes(symbols: string[]): Promise<Record<string, TdQuote>> {
  const base = apiBase();
  if (!base || symbols.length === 0) return {};
  const res = await fetch(`${base}/api/stocks/quote?symbols=${encodeURIComponent(symbols.join(','))}`);
  if (!res.ok) return {};
  const data = (await res.json()) as Record<string, TdQuote> | TdQuote;
  // Twelve Data signals rate-limit / errors with a 200 body like
  // {code:429, status:"error", message:"..."} (no per-symbol keys). Surface it
  // in dev so it isn't mistaken for "stocks unavailable", and degrade to empty.
  const envelope = data as TdQuote;
  if (envelope && (envelope.status === 'error' || typeof envelope.code === 'number')) {
    if (__DEV__) console.warn('[stocks] quote error:', (envelope as { message?: string }).message ?? envelope.code);
    return {};
  }
  // Twelve Data returns a bare object for a single symbol, a keyed map for many.
  if (symbols.length === 1 && data && !(symbols[0] in (data as object))) {
    return { [symbols[0]]: data as TdQuote };
  }
  return data as Record<string, TdQuote>;
}

export async function fetchStockCandles(
  symbol: string,
  interval: string,
): Promise<TdCandleValue[]> {
  const base = apiBase();
  if (!base) return [];
  const res = await fetch(
    `${base}/api/stocks/candles?symbol=${encodeURIComponent(symbol)}&interval=${interval}`,
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { values?: TdCandleValue[] };
  return data.values ?? [];
}
