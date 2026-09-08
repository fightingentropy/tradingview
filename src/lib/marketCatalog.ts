import type { Instrument, Quote } from '../domain/types';

/** Provider section whose refresh owns this instrument's presence in the catalog. */
export function marketSegment(instrument: Instrument): string {
  if (instrument.source !== 'hyperliquid') return instrument.source;
  if (instrument.assetClass === 'outcome') return 'hyperliquid:outcome';
  if (instrument.id.startsWith('hl:xyz:')) return 'hyperliquid:xyz';
  if (instrument.assetClass === 'crypto-spot') return 'hyperliquid:spot';
  return 'hyperliquid:perp';
}

export function marketDataError(instrument: Instrument, errors: Record<string, string> = {}) {
  return errors[instrument.source] ?? errors[marketSegment(instrument)] ?? null;
}

/** A failed first load can have no instrument yet; distinguish it from delisting. */
export function marketCatalogErrorForId(id: string | undefined, errors: Record<string, string> = {}) {
  if (!id) return null;
  if (id.startsWith('cboe:')) return errors.cboe ?? null;
  if (id.startsWith('hl:')) return errors.hyperliquid ?? errors[`hyperliquid:${id.split(':')[1]}`] ?? null;
  return null;
}

/**
 * Retain history only for failed sections. A successful empty/delisted market
 * must disappear normally; a timeout must not erase a user's saved symbols.
 * Retained quote timestamps stay unchanged so the UI can label them as stale.
 */
export function retainUnavailableMarkets(
  next: { instruments: Instrument[]; quotes: Record<string, Quote> },
  previous: { instruments: Instrument[]; quotes: Record<string, Quote> } | undefined,
  errors: Record<string, string>,
) {
  const instruments = [...next.instruments];
  const quotes = { ...next.quotes };
  const known = new Set(instruments.map((instrument) => instrument.id));
  for (const instrument of previous?.instruments ?? []) {
    if (known.has(instrument.id) || !marketDataError(instrument, errors)) continue;
    instruments.push(instrument);
    known.add(instrument.id);
    const quote = previous?.quotes[instrument.id];
    if (quote) quotes[instrument.id] = quote;
  }
  return { instruments, quotes };
}
