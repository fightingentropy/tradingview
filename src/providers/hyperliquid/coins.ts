import type { AssetClass, Instrument, Quote } from '@/domain/types';
import { toNum } from '@/lib/format';
import {
  outcomeCoinKey,
  outcomePresentation,
  visibleOutcomeSides,
  type HlOutcomeMeta,
} from '@/lib/outcomeMarkets';

import type {
  MetaAndAssetCtxs,
  PerpAssetCtx,
  SpotAssetCtx,
  SpotMetaAndAssetCtxs,
} from './rest';

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

const perpPriceDecimals = (szDecimals: number) => clamp(6 - szDecimals, 0, 6);
const spotPriceDecimals = (szDecimals: number) => clamp(8 - szDecimals, 0, 8);

/**
 * Even within the Unit + HL-native set there are dead wrappers (UBONK, UVIRT,
 * UAVAX… at ~0 volume), so we still apply a 24h-volume floor. PURR/USDC is the
 * only `isCanonical` pair and is always kept; HYPE/USDC ($160M+/day) is a
 * non-canonical `@index` listing that clears the floor on its own.
 */
const SPOT_MIN_DAY_VOLUME = 100_000;

/**
 * Spot tokens we hide even though they pass the Unit/native filter: the dollar
 * stablecoins (USDH/USDE/USDT0) are near-identical $1.00 rows that just clutter the
 * list — USDC, the one that matters, is the quote currency and has no pair of its own —
 * and UFART was explicitly unwanted.
 */
const SPOT_HIDE = new Set(['USDH', 'USDE', 'USDT0', 'UFART']);

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

  meta.universe.forEach((u) => {
    // Spot asset contexts are keyed by the pair's asset index, NOT its position
    // in `universe` — the two arrays aren't parallel (ctxs is longer and
    // sparse). Indexing by position mispaired every non-canonical pair with
    // another coin's price/volume (e.g. WOW rendered HYPE's $72 / $157M and an
    // impossible % change). PURR only survived because its position == index 0.
    const ctx = ctxs[u.index];
    if (!ctx) return;

    const baseToken = tokenByIndex.get(u.tokens[0]);
    const quoteToken = tokenByIndex.get(u.tokens[1]);
    const base = baseToken?.name ?? u.name.split('/')[0];
    const quoteName = quoteToken?.name ?? 'USDC';

    // Only USDC-quoted spot from Unit (U-prefixed wrappers: UBTC/UETH/USOL/…) or
    // Hyperliquid itself (HYPE, PURR). Hides trade.xyz's tokenized equities and
    // the community long-tail the user doesn't want in the spot list. The USDC
    // filter also dedupes tokens that list against several quotes (e.g. HYPE).
    const isUnit = /^U[A-Z]/.test(base);
    if (quoteName !== 'USDC' || (!isUnit && base !== 'HYPE' && base !== 'PURR')) return;
    // ...minus the stablecoin/unwanted rows we explicitly suppress.
    if (SPOT_HIDE.has(base)) return;

    // Drop dead wrappers by volume; PURR (canonical) and the flagships always pass.
    const dayVolume = Number(ctx.dayNtlVlm) || 0;
    if (!u.isCanonical && dayVolume < SPOT_MIN_DAY_VOLUME) return;

    const coinKey = `@${u.index}`;
    const id = `hl:spot:${coinKey}`;
    const quote = quoteFromCtx(id, ctx, ts);
    if (!quote) return; // no finite price → skip the instrument

    const instrument: Instrument = {
      id,
      source: 'hyperliquid',
      assetClass: 'crypto-spot',
      symbol: base,
      // u.name is the raw "@107" for non-canonical pairs — show the pair instead.
      name: `${base}/${quoteName}`,
      venue: 'Hyperliquid',
      priceDecimals: spotPriceDecimals(baseToken?.szDecimals ?? 4),
      coinKey,
      quoteCurrency: quoteName,
    };
    instruments.push(instrument);
    quotes[id] = quote;
  });

  return { instruments, quotes };
}

/** Build the currently-active, user-facing Outcome Markets catalog. */
export function buildOutcomes(
  meta: HlOutcomeMeta,
  ctxs: SpotAssetCtx[],
): { instruments: Instrument[]; quotes: Record<string, Quote> } {
  const ts = Date.now();
  const instruments: Instrument[] = [];
  const quotes: Record<string, Quote> = {};
  const ctxByCoin = new Map(
    ctxs.flatMap((ctx) => (ctx.coin ? ([[ctx.coin, ctx]] as const) : [])),
  );
  const fallbackIds = new Set(meta.questions.map((question) => question.fallbackOutcome));
  const questionByOutcome = new Map(
    meta.questions.flatMap((question) =>
      question.namedOutcomes.map((outcome) => [outcome, question] as const),
    ),
  );

  for (const outcome of meta.outcomes) {
    // Fallback contracts are settlement plumbing, not choices shown to traders.
    if (fallbackIds.has(outcome.outcome)) continue;
    const question = questionByOutcome.get(outcome.outcome);

    for (const side of visibleOutcomeSides(outcome.sideSpecs, question !== undefined)) {
      const coinKey = outcomeCoinKey(outcome.outcome, side);
      const ctx = ctxByCoin.get(coinKey);
      if (!ctx) continue;

      const id = `hl:outcome:${coinKey.slice(1)}`;
      const quote = quoteFromCtx(id, ctx, ts);
      if (!quote) continue;
      const presentation = outcomePresentation(outcome, question, side);
      instruments.push({
        id,
        source: 'hyperliquid',
        assetClass: 'outcome',
        symbol: presentation.symbol,
        name: presentation.name,
        venue: 'Hyperliquid Outcomes',
        priceDecimals: 5,
        coinKey,
        quoteCurrency: outcome.quoteToken || 'USDC',
      });
      quotes[id] = quote;
    }
  }

  return { instruments, quotes };
}
