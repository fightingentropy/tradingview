import { Image } from 'expo-image';
import { memo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { Instrument } from '@/domain/types';

/** Brand colours for well-known tickers; everything else gets a stable hashed colour. */
const BRAND: Record<string, string> = {
  BTC: '#F7931A',
  ETH: '#627EEA',
  SOL: '#9945FF',
  BNB: '#F3BA2F',
  XRP: '#23A8E0',
  DOGE: '#C2A633',
  ADA: '#0033AD',
  AVAX: '#E84142',
  LINK: '#2A5ADA',
  DOT: '#E6007A',
  LTC: '#345D9D',
  HYPE: '#11D6A6',
  ZEC: '#ECB244',
  SUI: '#4DA2FF',
  ARB: '#28A0F0',
  OP: '#FF0420',
  APT: '#1AB7A8',
  TON: '#0098EA',
  // Index "badges", styled like the TradingView reference.
  SP500: '#E3242B',
  XYZ100: '#2962FF',
};

/** Index tickers rendered as a short numeric badge (mirrors TradingView's SPX/NDX). */
const INDEX_LABEL: Record<string, string> = {
  SP500: '500',
  XYZ100: '100',
};

/**
 * Markets whose art we pull from Hyperliquid's own coin CDN (keyed by `coinKey`),
 * with the brand background to sit behind it. HYPE's mark is a transparent glyph
 * so the colour shows through; the trade.xyz indices ship an opaque tile but the
 * colour still covers the load-in. Requested explicitly for these three rows.
 */
const HL_LOGO_BG: Record<string, string> = {
  HYPE: '#0B1C18',
  'xyz:SP500': '#D6002A',
  'xyz:XYZ100': '#24344B',
};

/**
 * Ticker -> TradingView logo id, verified against s3-symbol-logo.tradingview.com.
 * Covers the default watchlist plus common US names; unmapped tickers fall back
 * to the initials circle (their logo isn't derivable from the ticker alone).
 */
const STOCK_LOGO: Record<string, string> = {
  NVDA: 'nvidia',
  GOOGL: 'alphabet',
  GOOG: 'alphabet',
  AMZN: 'amazon',
  TSLA: 'tesla',
  SPCX: 'spacex',
  HOOD: 'robinhood',
  SNDK: 'sandisk',
  MU: 'micron-technology',
  HIMS: 'hims-and-hers-health',
  LLY: 'eli-lilly',
  LITE: 'lumentum-hldgs',
  AAPL: 'apple',
  MSFT: 'microsoft',
  META: 'meta-platforms',
  NFLX: 'netflix',
  AMD: 'advanced-micro-devices',
  COIN: 'coinbase',
  AVGO: 'broadcom',
  ABNB: 'airbnb',
  PYPL: 'paypal',
  INTC: 'intel',
  MRNA: 'moderna',
  PFE: 'pfizer',
  SBUX: 'starbucks',
  ORCL: 'oracle',
  CRM: 'salesforce',
  QCOM: 'qualcomm',
  BE: 'bloom-energy',
  STRC: 'microstrategy',
};

const PALETTE = [
  '#5B8DEF',
  '#9B6DFF',
  '#2EBD85',
  '#F6465D',
  '#F0B90B',
  '#26A69A',
  '#EC6F9B',
  '#E8A33D',
  '#4FC3F7',
  '#7E57FF',
];

function colorFor(symbol: string): string {
  const key = symbol.toUpperCase();
  if (BRAND[key]) return BRAND[key];
  // Outcome labels can carry a target/side after the underlying (`BTC $64,911 · Yes`).
  // Keep the recognizable underlying colour while still rendering the contract initials.
  const underlying = key.split(/[\s·]/)[0];
  if (BRAND[underlying]) return BRAND[underlying];
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function initialsFor(symbol: string): string {
  const s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.slice(0, 3) || '?';
}

/**
 * Spot token -> the coin whose brand art we render. Unit wrappers map to the asset
 * they wrap (UBTC -> BTC), so we show the same icon Hyperliquid's own app does; the
 * HL-native tokens map to themselves. Hyperliquid's coin CDN serves art by *base*
 * name (coins/BTC.svg), not the wrapper name (coins/UBTC.svg returns the SPA shell).
 */
const SPOT_BASE: Record<string, string> = {
  HYPE: 'HYPE',
  PURR: 'PURR',
  UBTC: 'BTC',
  UETH: 'ETH',
  UZEC: 'ZEC',
  USOL: 'SOL',
  UXPL: 'XPL',
  UPUMP: 'PUMP',
};
/**
 * Bases we pull from TradingView instead of Hyperliquid's coin CDN: HL's ETH art is a
 * flat single-tone diamond that reads as the wrong icon, so we use TradingView's proper
 * multi-tone Ethereum mark.
 */
const SPOT_TV_BASE = new Set(['ETH']);

/**
 * Best logo URL for a spot coin. Mapped tokens use Hyperliquid's own art (matching the
 * trade.xyz / HL app), except the few whose HL art is poor (see SPOT_TV_BASE). Unmapped
 * coins try their own name on the HL CDN (covers USDC and future HL-native tokens);
 * anything the CDN lacks decodes as the SPA shell and falls to the initials circle.
 */
function spotArtUrl(symbol: string): string | null {
  const sym = symbol.trim();
  if (!sym) return null;
  const base = SPOT_BASE[sym.toUpperCase()];
  if (base) {
    return SPOT_TV_BASE.has(base)
      ? `https://s3-symbol-logo.tradingview.com/crypto/XTVC${base}.svg`
      : `https://app.hyperliquid.xyz/coins/${base}.svg`;
  }
  return `https://app.hyperliquid.xyz/coins/${encodeURIComponent(sym)}.svg`;
}

function spotCoinUrl(instrument: Instrument): string | null {
  return instrument.assetClass === 'crypto-spot' ? spotArtUrl(instrument.symbol) : null;
}

/**
 * TradingView serves crypto logos reliably keyed by `XTVC<SYMBOL>`. Used for crypto
 * perps; stocks/indices fall back to a mapped logo or the initials circle (their logos
 * aren't derivable from the ticker alone). Spot art is handled by spotCoinUrl above.
 */
function cryptoLogoUrl(instrument: Instrument): string | null {
  if (instrument.assetClass !== 'crypto-perp') return null;
  const sym = instrument.symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return sym ? `https://s3-symbol-logo.tradingview.com/crypto/XTVC${sym}.svg` : null;
}

/** Branded stock logo for mapped tickers (see STOCK_LOGO). */
function stockLogoUrl(instrument: Instrument): string | null {
  const id = STOCK_LOGO[instrument.symbol.toUpperCase()];
  return id ? `https://s3-symbol-logo.tradingview.com/${id}.svg` : null;
}

/**
 * Logo for a bare coin ticker (spot balances carry no Instrument). Resolves through the
 * same spot-art mapping as the markets list, so a UBTC balance shows BTC's icon and USDC
 * shows its own; an unknown coin falls back to the coloured initials circle.
 */
function coinLogoUrl(coin: string): string | null {
  return spotArtUrl(coin);
}

/** HYPE perp + the two trade.xyz indices use tuned Hyperliquid coin art (with a brand bg). */
function hyperliquidLogoUrl(instrument: Instrument): string | null {
  if (!(instrument.coinKey in HL_LOGO_BG)) return null;
  return `https://app.hyperliquid.xyz/coins/${encodeURIComponent(instrument.coinKey)}.svg`;
}

/**
 * trade.xyz hosts a branded icon for every market at `/markets/<ticker>.svg` — except a
 * handful served as `.png` (TSLA, NVDA, PLTR), so we try both. This is the preferred art
 * for the whole `xyz:` HIP-3 dex (equities, commodities, indices, FX).
 */
function tradexyzUrls(symbol: string): string[] {
  const slug = symbol.toLowerCase().replace(/[^a-z0-9]/g, '');
  return slug
    ? [`https://app.trade.xyz/markets/${slug}.svg`, `https://app.trade.xyz/markets/${slug}.png`]
    : [];
}

/**
 * Ordered logo candidates, best first; the component falls through to the next on a load
 * error and to the initials circle once exhausted.
 *
 * xyz markets prefer trade.xyz's own brand art, then a mapped TradingView logo (QCOM, BE,
 * STRC — the few trade.xyz omits), then Hyperliquid's coin CDN as a final net. Crypto + spot
 * keep their single best source (tuned HL art → spot/perp coin art → mapped brand logo).
 */
function logoCandidates(instrument: Instrument): string[] {
  const out: (string | null)[] = [];
  if (instrument.coinKey.startsWith('xyz:')) {
    out.push(
      ...tradexyzUrls(instrument.symbol),
      stockLogoUrl(instrument),
      `https://app.hyperliquid.xyz/coins/${encodeURIComponent(instrument.coinKey)}.svg`,
    );
  } else {
    out.push(
      hyperliquidLogoUrl(instrument),
      spotCoinUrl(instrument),
      cryptoLogoUrl(instrument),
      stockLogoUrl(instrument),
    );
  }
  // Drop nulls and de-dupe while preserving order.
  return out.filter((u, i): u is string => !!u && out.indexOf(u) === i);
}

/**
 * Once a symbol's first working candidate is known, remember its index so a recycled
 * FlashList row jumps straight to it instead of re-walking the 404 fallback chain. The
 * exhausted index is cached too, so a no-art ticker shows initials without re-fetching.
 */
const resolvedIdx = new Map<string, number>();

/**
 * Circular symbol logo, TradingView-style. Renders the real logo when available (over a
 * coloured initials circle that shows while it loads), falling through the candidate list
 * on error and to the initials circle for everything else.
 */
function SymbolLogoImpl({
  instrument,
  coin,
  size = 40,
}: {
  /** Full catalog instrument (markets/positions). */
  instrument?: Instrument;
  /** Bare coin ticker fallback when there's no Instrument (spot balances). */
  coin?: string;
  size?: number;
}) {
  const symbol = instrument?.symbol ?? coin ?? '?';
  const key = instrument?.id ?? coin ?? '';
  const candidates = instrument
    ? logoCandidates(instrument)
    : coin
      ? ([coinLogoUrl(coin)].filter(Boolean) as string[])
      : [];

  // Walk the candidates, advancing past any that fail to load. When a recycled cell
  // switches symbols, reset to that key's cached start index during render (no effect).
  const [idx, setIdx] = useState(() => resolvedIdx.get(key) ?? 0);
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setIdx(resolvedIdx.get(key) ?? 0);
  }

  const url = candidates[idx] ?? null;
  const showImage = !!url;
  const initials = INDEX_LABEL[symbol.toUpperCase()] ?? initialsFor(symbol);
  const fontSize = initials.length >= 3 ? size * 0.3 : size * 0.36;
  // Hyperliquid marks are full-bleed (and HYPE's is a transparent glyph), so sit
  // them on the brand colour and drop the initials that would otherwise peek through.
  // Spot HYPE's coinKey is the raw `@index`, so fall back to matching by symbol —
  // otherwise its glyph renders nearly invisible on the plain teal circle.
  const hlBg =
    showImage && instrument
      ? HL_LOGO_BG[instrument.coinKey] ?? HL_LOGO_BG[symbol.toUpperCase()]
      : undefined;
  const backgroundColor = hlBg ?? colorFor(symbol);

  return (
    <View
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: size / 2, backgroundColor },
      ]}>
      {hlBg ? null : (
        <Text style={[styles.initials, { fontSize }]} numberOfLines={1} allowFontScaling={false}>
          {initials}
        </Text>
      )}
      {showImage ? (
        <Image
          source={url}
          style={[StyleSheet.absoluteFill, { borderRadius: size / 2 }]}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={0}
          onLoad={() => {
            if (resolvedIdx.get(key) !== idx) resolvedIdx.set(key, idx);
          }}
          onError={() =>
            setIdx((i) => {
              const next = i + 1;
              if (next >= candidates.length) resolvedIdx.set(key, next); // stop re-walking a dead chain
              return next;
            })
          }
        />
      ) : null}
    </View>
  );
}

export const SymbolLogo = memo(SymbolLogoImpl);

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  initials: { color: '#FFFFFF', fontWeight: '700', letterSpacing: -0.3 },
});
