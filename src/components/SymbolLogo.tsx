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
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function initialsFor(symbol: string): string {
  const s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.slice(0, 3) || '?';
}

/**
 * TradingView serves crypto logos reliably keyed by `XTVC<SYMBOL>`. We only try
 * for crypto markets; stocks/indices/perps fall back to the initials circle
 * (their logos aren't derivable from the ticker alone).
 */
function cryptoLogoUrl(instrument: Instrument): string | null {
  if (instrument.assetClass !== 'crypto-perp' && instrument.assetClass !== 'crypto-spot') return null;
  const sym = instrument.symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return sym ? `https://s3-symbol-logo.tradingview.com/crypto/XTVC${sym}.svg` : null;
}

/** Branded stock logo for mapped tickers (see STOCK_LOGO). */
function stockLogoUrl(instrument: Instrument): string | null {
  const id = STOCK_LOGO[instrument.symbol.toUpperCase()];
  return id ? `https://s3-symbol-logo.tradingview.com/${id}.svg` : null;
}

/**
 * Crypto logo for a bare coin ticker (spot balances carry no Instrument). Uses
 * TradingView's `XTVC<SYMBOL>` crypto art (verified for USDC/HYPE/USDT…); an
 * unknown coin 404s and falls back to the coloured initials circle.
 */
function coinLogoUrl(coin: string): string | null {
  const sym = coin.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return sym ? `https://s3-symbol-logo.tradingview.com/crypto/XTVC${sym}.svg` : null;
}

/** HYPE perp + trade.xyz indices use Hyperliquid's own coin art, keyed by coinKey. */
function hyperliquidLogoUrl(instrument: Instrument): string | null {
  if (!(instrument.coinKey in HL_LOGO_BG)) return null;
  return `https://app.hyperliquid.xyz/coins/${encodeURIComponent(instrument.coinKey)}.svg`;
}

/** Best available logo: Hyperliquid art first, then crypto, then mapped stocks. */
function logoUrl(instrument: Instrument): string | null {
  return hyperliquidLogoUrl(instrument) ?? cryptoLogoUrl(instrument) ?? stockLogoUrl(instrument);
}

/**
 * Circular symbol logo, TradingView-style. Renders the real crypto logo when
 * available (over a coloured initials circle that shows while it loads or if it
 * 404s), and a coloured initials circle for everything else.
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
  const url = instrument ? logoUrl(instrument) : coin ? coinLogoUrl(coin) : null;
  const [failed, setFailed] = useState(false);
  const showImage = !!url && !failed;
  const initials = INDEX_LABEL[symbol.toUpperCase()] ?? initialsFor(symbol);
  const fontSize = initials.length >= 3 ? size * 0.3 : size * 0.36;
  // Hyperliquid marks are full-bleed (and HYPE's is a transparent glyph), so sit
  // them on the brand colour and drop the initials that would otherwise peek through.
  const hlBg = showImage && instrument ? HL_LOGO_BG[instrument.coinKey] : undefined;
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
          onError={() => setFailed(true)}
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
