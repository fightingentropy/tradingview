/**
 * Public `outcomeMeta` shapes. Outcome markets are spot-style contracts whose
 * two sides are addressed independently by Hyperliquid.
 */
export interface HlOutcomeSideSpec {
  name: string;
}

export interface HlOutcomeDefinition {
  outcome: number;
  name: string;
  description: string;
  sideSpecs: HlOutcomeSideSpec[];
  quoteToken: string;
}

export interface HlOutcomeQuestion {
  question: number;
  name: string;
  description: string;
  fallbackOutcome: number;
  namedOutcomes: number[];
  settledNamedOutcomes: number[];
}

export interface HlOutcomeMeta {
  outcomes: HlOutcomeDefinition[];
  questions: HlOutcomeQuestion[];
}

/** Hyperliquid's compact side encoding (`10 * outcome + side`). */
export function outcomeEncoding(outcome: number, side: number): number {
  return outcome * 10 + side;
}

/** Public market-data key used by candles, books, trades, and all-mids. */
export function outcomeCoinKey(outcome: number, side: number): string {
  return `#${outcomeEncoding(outcome, side)}`;
}

/** Integer asset id used by signed order actions. Kept here for safe future trading support. */
export function outcomeAssetId(outcome: number, side: number): number {
  return 100_000_000 + outcomeEncoding(outcome, side);
}

/**
 * A grouped question already represents each named choice as its own outcome,
 * so only that outcome's affirmative side is shown. A standalone binary market
 * exposes both independently-addressable sides, matching Hyperliquid's UI.
 */
export function visibleOutcomeSides(
  sideSpecs: readonly HlOutcomeSideSpec[],
  groupedQuestion = false,
): number[] {
  return groupedQuestion ? [0] : sideSpecs.map((_, index) => index).slice(0, 2);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function descriptor(value: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const part of value.split('|')) {
    const colon = part.indexOf(':');
    if (colon <= 0) continue;
    fields[part.slice(0, colon)] = part.slice(colon + 1);
  }
  return fields;
}

function compactUsd(value: string | undefined): string | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const [whole, fractional] = String(value).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `$${grouped}${fractional ? `.${fractional}` : ''}`;
}

function expiryLabel(value: string | undefined): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(value ?? '');
  if (!match) return null;
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return null;
  return `${month} ${Number(match[3])}, ${match[4]}:${match[5]} UTC`;
}

export interface OutcomePresentation {
  /** Compact primary row/header label. */
  symbol: string;
  /** Parent question or expiry context shown below it. */
  name: string;
}

/** Turn machine-oriented recurring metadata into a stable human-readable label. */
export function outcomePresentation(
  outcome: HlOutcomeDefinition,
  question?: HlOutcomeQuestion,
  side = 0,
): OutcomePresentation {
  const sideName = outcome.sideSpecs[side]?.name ?? `Side ${side + 1}`;
  const yesNo =
    outcome.sideSpecs.length === 2 &&
    outcome.sideSpecs[0]?.name.toLowerCase() === 'yes' &&
    outcome.sideSpecs[1]?.name.toLowerCase() === 'no';
  if (!question && !yesNo) {
    return { symbol: sideName, name: outcome.name };
  }

  const own = descriptor(outcome.description);
  if (own.class === 'priceBinary') {
    const target = compactUsd(own.targetPrice);
    const expiry = expiryLabel(own.expiry);
    const baseSymbol = [own.underlying, 'above', target].filter(Boolean).join(' ') || outcome.name;
    return {
      symbol: question ? baseSymbol : `${baseSymbol} · ${sideName}`,
      name: [expiry, 'price outcome'].filter(Boolean).join(' · '),
    };
  }

  const parent = question ? descriptor(question.description) : {};
  if (parent.class === 'priceBucket') {
    const thresholds = (parent.priceThresholds ?? '').split(',').map(compactUsd);
    const index = Number(descriptor(outcome.description).index);
    let bucket = outcome.name;
    if (index === 0 && thresholds[0]) bucket = `< ${thresholds[0]}`;
    else if (index === thresholds.length && thresholds.at(-1)) bucket = `> ${thresholds.at(-1)}`;
    else if (index > 0 && thresholds[index - 1] && thresholds[index]) {
      bucket = `${thresholds[index - 1]}–${thresholds[index]}`;
    }
    const expiry = expiryLabel(parent.expiry);
    return {
      symbol: [parent.underlying, bucket].filter(Boolean).join(' '),
      name: [expiry, 'price range'].filter(Boolean).join(' · '),
    };
  }

  return {
    symbol: question ? outcome.name : `${outcome.name} · ${sideName}`,
    name: question?.name ?? 'Outcome market',
  };
}
