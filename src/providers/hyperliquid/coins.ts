import type { AssetClass, Instrument, Quote } from '@/domain/types';
import { toNum } from '@/lib/format';

import type {
  MetaAndAssetCtxs,
  PerpAssetCtx,
  SpotAssetCtx,
  SpotMetaAndAssetCtxs,
} from './rest';

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

const perpPriceDecimals = (szDecimals: number) => clamp(6 - szDecimals, 0, 6);
const spotPriceDecimals = (szDecimals: number) => clamp(8 - szDecimals, 0, 8);

const COMMODITIES = new Set([
  'GOLD', 'SILVER', 'OIL', 'WTI', 'BRENT', 'NATGAS', 'GAS', 'ALUMINIUM',
  'COPPER', 'PLATINUM', 'PALLADIUM', 'WHEAT', 'CORN', 'SUGAR',
]);
const INDICES = new Set(['XYZ100', 'SPX', 'NDX', 'DJI', 'RUT', 'VIX', 'SPX500', 'US500']);

function classifyXyz(sym: string): AssetClass {
  if (COMMODITIES.has(sym)) return 'commodity';
  if (INDICES.has(sym)) return 'index';
  if (/^[A-Z]{6}$/.test(sym)) return 'fx'; // EURUSD-style
  return 'equity-perp';
}

/** Returns null when the context has no finite price, so callers can skip the instrument. */
function quoteFromCtx(
  instrumentId: string,
  ctx: PerpAssetCtx | SpotAssetCtx,
  ts: number,
): Quote | null {
  const last = toNum(ctx.markPx ?? ctx.midPx);
  if (last === null) return null;
  const prevClose = toNum(ctx.prevDayPx);
  const change24hPct =
    prevClose !== null && prevClose !== 0 ? ((last - prevClose) / prevClose) * 100 : null;
  // `funding` is only present on perp contexts (hourly rate, as a string).
  const funding = 'funding' in ctx ? toNum(ctx.funding) : null;
  return {
    instrumentId,
    last,
    prevClose,
    change24hPct,
    dayVolume: Number(ctx.dayNtlVlm) || null,
    funding,
    ts,
  };
}

/** Build perp instruments + quotes. `dex` undefined = default crypto perps; `xyz` = trade.xyz. */
export function buildPerps(
  [meta, ctxs]: MetaAndAssetCtxs,
  dex: 'default' | 'xyz',
): { instruments: Instrument[]; quotes: Record<string, Quote> } {
  const ts = Date.now();
  const instruments: Instrument[] = [];
  const quotes: Record<string, Quote> = {};

  meta.universe.forEach((u, i) => {
    if (u.isDelisted) return;
    const ctx = ctxs[i];
    if (!ctx) return;

    const isXyz = dex === 'xyz';
    const display = isXyz ? u.name.replace(/^xyz:/, '') : u.name;
    // u.name is already `xyz:NAME` for the xyz dex, so `hl:${u.name}` => `hl:xyz:NAME`.
    const id = isXyz ? `hl:${u.name}` : `hl:perp:${u.name}`;
    const quote = quoteFromCtx(id, ctx, ts);
    if (!quote) return; // no finite price → skip the instrument
    const instrument: Instrument = {
      id,
      source: 'hyperliquid',
      assetClass: isXyz ? classifyXyz(display) : 'crypto-perp',
      symbol: display,
      name: isXyz ? `${display} Perp` : `${u.name} Perpetual`,
      venue: isXyz ? 'trade.xyz' : 'Hyperliquid',
      priceDecimals: perpPriceDecimals(u.szDecimals),
      coinKey: u.name, // perps use plain name; xyz uses `xyz:NAME`
      quoteCurrency: 'USDC',
    };
    instruments.push(instrument);
    quotes[id] = quote;
  });

  return { instruments, quotes };
}

/** Build canonical spot instruments + quotes. Spot coins are addressed by `@index`. */
export function buildSpot([meta, ctxs]: SpotMetaAndAssetCtxs): {
  instruments: Instrument[];
  quotes: Record<string, Quote>;
} {
  const ts = Date.now();
  const instruments: Instrument[] = [];
  const quotes: Record<string, Quote> = {};
  const tokenByIndex = new Map(meta.tokens.map((t) => [t.index, t]));

  meta.universe.forEach((u, i) => {
    if (!u.isCanonical) return;
    const ctx = ctxs[i];
    if (!ctx) return;

    const baseToken = tokenByIndex.get(u.tokens[0]);
    const quoteToken = tokenByIndex.get(u.tokens[1]);
    const base = baseToken?.name ?? u.name.split('/')[0];
    const coinKey = `@${u.index}`;
    const id = `hl:spot:${coinKey}`;
    const quote = quoteFromCtx(id, ctx, ts);
    if (!quote) return; // no finite price → skip the instrument

    const instrument: Instrument = {
      id,
      source: 'hyperliquid',
      assetClass: 'crypto-spot',
      symbol: base,
      name: u.name,
      venue: 'Hyperliquid',
      priceDecimals: spotPriceDecimals(baseToken?.szDecimals ?? 4),
      coinKey,
      quoteCurrency: quoteToken?.name ?? 'USDC',
    };
    instruments.push(instrument);
    quotes[id] = quote;
  });

  return { instruments, quotes };
}
