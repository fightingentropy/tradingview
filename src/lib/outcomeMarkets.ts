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
  settledNamedOutcomes?: number[];
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

/** Token name returned by `spotClearinghouseState` for an outcome balance. */
export function outcomeTokenName(outcome: number, side: number): string {
  return `+${outcomeEncoding(outcome, side)}`;
}

/** Integer asset id used by signed order and cancel actions. */
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

/** Minimal spot-context fields needed to render event odds and activity. */
export interface OutcomeMarketContext {
  coin?: string;
  markPx?: number | string | null;
  prevDayPx?: number | string | null;
  dayNtlVlm?: number | string | null;
}

/**
 * Accepts the API's context array directly, or a pre-indexed record/Map. Keeping
 * this shape local avoids coupling the event UI model to a specific provider.
 */
export type OutcomeContextLookup =
  | readonly OutcomeMarketContext[]
  | ReadonlyMap<string, OutcomeMarketContext>
  | Readonly<Record<string, OutcomeMarketContext | undefined>>;

export interface PriceBinaryOutcomeTemplate {
  class: 'priceBinary';
  underlying: string;
  expiry: string;
  targetPrice: string;
  period: string;
}

export interface PriceBucketOutcomeTemplate {
  class: 'priceBucket';
  underlying: string;
  expiry: string;
  priceThresholds: [string, string];
  period: string;
}

export interface DummyOutcomeTemplate {
  class: 'dummy';
  name: string;
  description: string;
}

export type OutcomeTemplate =
  | PriceBinaryOutcomeTemplate
  | PriceBucketOutcomeTemplate
  | DummyOutcomeTemplate;

export interface OutcomeMetadata {
  category: string | null;
  subCategory: string | null;
}

/** One independently tradable side of a displayed outcome choice. */
export interface OutcomeTradeContract {
  outcomeId: number;
  side: number;
  sideLabel: string;
  instrumentId: string;
  coinKey: string;
  tokenName: string;
  assetId: number;
  quoteToken: string;
  probability: number | null;
  previousProbability: number | null;
  change24hPoints: number | null;
  dayVolume: number | null;
}

export interface OutcomeChoice {
  /** Stable id shared with the existing flattened market catalog. */
  id: string;
  instrumentId: string;
  outcomeId: number;
  side: number;
  coinKey: string;
  assetId: number;
  label: string;
  description: string;
  quoteToken: string;
  /** Hyperliquid's mark price, expressed as a 0..1 implied probability. */
  probability: number | null;
  previousProbability: number | null;
  /** Absolute probability movement; 0.05 means five percentage points. */
  change24hPoints: number | null;
  dayVolume: number | null;
  /**
   * Signed-order contracts available from this card choice. Grouped questions
   * keep their Yes and No contracts here while rendering one named choice.
   */
  tradeContracts: OutcomeTradeContract[];
}

export interface OutcomeEvent {
  /**
   * Plain events use native ids. Recurring events use template identity so a
   * saved route survives when Hyperliquid rolls the contract to a new expiry.
   */
  id: string;
  kind: 'question' | 'standalone';
  title: string;
  description: string;
  category: string;
  subCategory: string | null;
  expiryAt: number | null;
  expiryLabel: string | null;
  period: string | null;
  quoteToken: string;
  questionId: number | null;
  fallbackOutcomeId: number | null;
  outcomeIds: number[];
  choices: OutcomeChoice[];
  /** Sum of the choices visible on the event card. */
  dayVolume: number | null;
}

const METADATA_MARKER = 'metadata=';
const ECONOMICS_NAME = /\b(?:cpi|fed)\b/i;

function cleanMetadataValue(value: string | undefined): string | null {
  const cleaned = value?.trim();
  if (!cleaned || cleaned.toLowerCase() === 'n/a') return null;
  return cleaned.toLowerCase();
}

/** Resolution text without Hyperliquid's machine-readable metadata suffix. */
export function outcomeDescription(value: string): string {
  const marker = value.indexOf(METADATA_MARKER);
  return (marker < 0 ? value : value.slice(0, marker)).trimEnd();
}

/** Extract the category metadata appended to ordinary event descriptions. */
export function outcomeMetadata(value: string): OutcomeMetadata {
  const marker = value.indexOf(METADATA_MARKER);
  if (marker < 0) return { category: null, subCategory: null };
  const fields = descriptor(value.slice(marker + METADATA_MARKER.length).trim());
  return {
    category: cleanMetadataValue(fields.category),
    subCategory: cleanMetadataValue(fields.subCategory),
  };
}

/** Parse the structured description used by Hyperliquid's rolling markets. */
export function parseOutcomeTemplate(value: string): OutcomeTemplate | null {
  const fields = descriptor(value);
  if (fields.class === 'priceBinary') {
    if (!fields.underlying || !fields.expiry || !fields.targetPrice || !fields.period) return null;
    return {
      class: 'priceBinary',
      underlying: fields.underlying,
      expiry: fields.expiry,
      targetPrice: fields.targetPrice,
      period: fields.period,
    };
  }
  if (fields.class === 'priceBucket') {
    const thresholds = fields.priceThresholds?.split(',');
    if (
      !fields.underlying ||
      !fields.expiry ||
      !fields.period ||
      thresholds?.length !== 2 ||
      !thresholds[0] ||
      !thresholds[1]
    ) {
      return null;
    }
    return {
      class: 'priceBucket',
      underlying: fields.underlying,
      expiry: fields.expiry,
      priceThresholds: [thresholds[0], thresholds[1]],
      period: fields.period,
    };
  }
  if (fields.class === 'dummy' && fields.name && fields.description) {
    return { class: 'dummy', name: fields.name, description: fields.description };
  }
  return null;
}

function parseExpiry(value: string | undefined): { at: number; label: string } | null {
  const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(value ?? '');
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const at = Date.UTC(year, month - 1, day, hour, minute);
  const parsed = new Date(at);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day ||
    parsed.getUTCHours() !== hour ||
    parsed.getUTCMinutes() !== minute
  ) {
    return null;
  }
  const monthName = MONTHS[month - 1];
  if (!monthName) return null;
  return {
    at,
    label: `${monthName} ${day}, ${year} ${match[4]}:${match[5]} UTC`,
  };
}

function finiteNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function probability(value: number | string | null | undefined): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed >= 0 && parsed <= 1 ? parsed : null;
}

function contextsByCoin(source: OutcomeContextLookup | undefined): Map<string, OutcomeMarketContext> {
  const indexed = new Map<string, OutcomeMarketContext>();
  if (!source) return indexed;
  if (Array.isArray(source)) {
    for (const context of source) {
      if (context.coin) indexed.set(context.coin, context);
    }
    return indexed;
  }
  if (source instanceof Map) return new Map(source);
  for (const [coin, context] of Object.entries(source)) {
    if (context) indexed.set(coin, context);
  }
  return indexed;
}

function makeTradeContract(
  outcome: HlOutcomeDefinition,
  side: number,
  contexts: ReadonlyMap<string, OutcomeMarketContext>,
): OutcomeTradeContract {
  const coinKey = outcomeCoinKey(outcome.outcome, side);
  const context = contexts.get(coinKey);
  const current = probability(context?.markPx);
  const previous = probability(context?.prevDayPx);
  const volume = finiteNumber(context?.dayNtlVlm);
  const instrumentId = `hl:outcome:${coinKey.slice(1)}`;
  return {
    outcomeId: outcome.outcome,
    side,
    sideLabel: outcome.sideSpecs[side]?.name ?? `Side ${side + 1}`,
    instrumentId,
    coinKey,
    tokenName: outcomeTokenName(outcome.outcome, side),
    assetId: outcomeAssetId(outcome.outcome, side),
    quoteToken: outcome.quoteToken || 'USDC',
    probability: current,
    previousProbability: previous,
    change24hPoints: current !== null && previous !== null ? current - previous : null,
    dayVolume: volume !== null && volume >= 0 ? volume : null,
  };
}

function makeChoice(
  outcome: HlOutcomeDefinition,
  side: number,
  label: string,
  contexts: ReadonlyMap<string, OutcomeMarketContext>,
  tradeSides: readonly number[] = [side],
): OutcomeChoice {
  const primary = makeTradeContract(outcome, side, contexts);
  return {
    id: primary.instrumentId,
    instrumentId: primary.instrumentId,
    outcomeId: primary.outcomeId,
    side: primary.side,
    coinKey: primary.coinKey,
    assetId: primary.assetId,
    label,
    description: outcomeDescription(outcome.description),
    quoteToken: primary.quoteToken,
    probability: primary.probability,
    previousProbability: primary.previousProbability,
    change24hPoints: primary.change24hPoints,
    dayVolume: primary.dayVolume,
    tradeContracts: tradeSides.map((tradeSide) =>
      makeTradeContract(outcome, tradeSide, contexts),
    ),
  };
}

function groupedEventVolume(choices: readonly OutcomeChoice[]): number | null {
  const volumes = choices.flatMap((choice) =>
    choice.dayVolume === null ? [] : [choice.dayVolume],
  );
  return volumes.length ? volumes.reduce((total, value) => total + value, 0) : null;
}

function affirmativeSide(outcome: HlOutcomeDefinition): number {
  const yes = outcome.sideSpecs.findIndex((side) => side.name.trim().toLowerCase() === 'yes');
  return yes >= 0 ? yes : 0;
}

function bucketChoiceLabel(outcome: HlOutcomeDefinition, template: PriceBucketOutcomeTemplate): string {
  const index = Number(descriptor(outcome.description).index);
  const [low, high] = template.priceThresholds.map(compactUsd);
  if (index === 0 && low) return `Below ${low}`;
  if (index === 1 && low && high) return `${low} to ${high}`;
  if (index === 2 && high) return `Above ${high}`;
  return outcome.name;
}

function templateExpiry(template: OutcomeTemplate | null): { at: number; label: string } | null {
  return template?.class === 'priceBinary' || template?.class === 'priceBucket'
    ? parseExpiry(template.expiry)
    : null;
}

function templateIdentity(template: OutcomeTemplate | null): string | null {
  if (template?.class !== 'priceBinary' && template?.class !== 'priceBucket') return null;
  return [template.class, template.underlying, template.period].map(encodeURIComponent).join(':');
}

function eventTitle(
  fallback: string,
  template: OutcomeTemplate | null,
  expiry: { at: number; label: string } | null,
): string {
  if (template?.class === 'dummy') return template.name;
  if (template?.class === 'priceBinary') {
    const target = compactUsd(template.targetPrice) ?? template.targetPrice;
    return `${template.underlying} above ${target}${expiry ? ` on ${expiry.label}` : ''}?`;
  }
  if (template?.class === 'priceBucket') {
    return `${template.underlying} price range${expiry ? ` on ${expiry.label}` : ''}?`;
  }
  return fallback;
}

function eventDescription(
  fallback: string,
  template: OutcomeTemplate | null,
  expiry: { at: number; label: string } | null,
): string {
  if (template?.class === 'dummy') return template.description;
  if (template?.class === 'priceBinary') {
    const target = compactUsd(template.targetPrice) ?? template.targetPrice;
    return `Resolves Yes if the ${template.underlying} mark price is above ${target}${expiry ? ` at ${expiry.label}` : ''}; otherwise resolves No.`;
  }
  if (template?.class === 'priceBucket') {
    return `The ${template.underlying} mark price${expiry ? ` at ${expiry.label}` : ''} determines the winning range.`;
  }
  return outcomeDescription(fallback);
}

function categoryFor(name: string, description: string, template: OutcomeTemplate | null): OutcomeMetadata & { category: string } {
  if (template?.class === 'priceBinary' || template?.class === 'priceBucket') {
    return { category: 'crypto', subCategory: template.underlying.toLowerCase() };
  }
  const metadata = outcomeMetadata(description);
  return {
    category: metadata.category ?? (ECONOMICS_NAME.test(name) ? 'economics' : 'other'),
    subCategory: metadata.subCategory,
  };
}

function preferNewerRecurring(
  previous: OutcomeEvent | undefined,
  candidate: OutcomeEvent,
): OutcomeEvent {
  if (!previous) return candidate;
  const previousExpiry = previous.expiryAt ?? Number.NEGATIVE_INFINITY;
  const candidateExpiry = candidate.expiryAt ?? Number.NEGATIVE_INFINITY;
  if (candidateExpiry !== previousExpiry) return candidateExpiry > previousExpiry ? candidate : previous;
  const previousNative = previous.questionId ?? previous.outcomeIds[0] ?? -1;
  const candidateNative = candidate.questionId ?? candidate.outcomeIds[0] ?? -1;
  return candidateNative > previousNative ? candidate : previous;
}

/**
 * Convert `outcomeMeta` into the event-first model used by a Polymarket-style
 * feed and detail screen. Grouped questions become one event with affirmative
 * choices; standalone contracts become one event with both native sides.
 */
export function buildOutcomeEvents(
  meta: HlOutcomeMeta,
  contextSource?: OutcomeContextLookup,
): OutcomeEvent[] {
  const contexts = contextsByCoin(contextSource);
  const outcomeById = new Map(meta.outcomes.map((outcome) => [outcome.outcome, outcome]));
  const ownedOutcomeIds = new Set<number>();
  const events = new Map<string, OutcomeEvent>();

  for (const question of meta.questions) {
    ownedOutcomeIds.add(question.fallbackOutcome);
    question.namedOutcomes.forEach((outcome) => ownedOutcomeIds.add(outcome));
    question.settledNamedOutcomes?.forEach((outcome) => ownedOutcomeIds.add(outcome));

    const template = parseOutcomeTemplate(question.description);
    const expiry = templateExpiry(template);
    const settled = new Set(question.settledNamedOutcomes ?? []);
    const choices = question.namedOutcomes.flatMap((outcomeId) => {
      if (settled.has(outcomeId)) return [];
      const outcome = outcomeById.get(outcomeId);
      if (!outcome) return [];
      const label =
        template?.class === 'priceBucket'
          ? bucketChoiceLabel(outcome, template)
          : outcome.name;
      return [
        makeChoice(
          outcome,
          affirmativeSide(outcome),
          label,
          contexts,
          visibleOutcomeSides(outcome.sideSpecs),
        ),
      ];
    });
    if (!choices.length) continue;

    const recurringId = templateIdentity(template);
    const id = recurringId
      ? `hl:outcome:event:recurring:${recurringId}`
      : `hl:outcome:event:question:${question.question}`;
    const categorization = categoryFor(question.name, question.description, template);
    const candidate: OutcomeEvent = {
      id,
      kind: 'question',
      title: eventTitle(question.name, template, expiry),
      description: eventDescription(question.description, template, expiry),
      ...categorization,
      expiryAt: expiry?.at ?? null,
      expiryLabel: expiry?.label ?? null,
      period:
        template?.class === 'priceBinary' || template?.class === 'priceBucket'
          ? template.period
          : null,
      quoteToken: choices[0]?.quoteToken ?? 'USDC',
      questionId: question.question,
      fallbackOutcomeId: question.fallbackOutcome,
      outcomeIds: choices.map((choice) => choice.outcomeId),
      choices,
      dayVolume: groupedEventVolume(choices),
    };
    events.set(id, preferNewerRecurring(events.get(id), candidate));
  }

  for (const outcome of meta.outcomes) {
    if (ownedOutcomeIds.has(outcome.outcome)) continue;
    const template = parseOutcomeTemplate(outcome.description);
    const expiry = templateExpiry(template);
    const choices = outcome.sideSpecs.map((side, index) =>
      makeChoice(outcome, index, side.name, contexts),
    );
    if (!choices.length) continue;

    const recurringId = templateIdentity(template);
    const id = recurringId
      ? `hl:outcome:event:recurring:${recurringId}`
      : `hl:outcome:event:outcome:${outcome.outcome}`;
    const categorization = categoryFor(outcome.name, outcome.description, template);
    const candidate: OutcomeEvent = {
      id,
      kind: 'standalone',
      title: eventTitle(outcome.name, template, expiry),
      description: eventDescription(outcome.description, template, expiry),
      ...categorization,
      expiryAt: expiry?.at ?? null,
      expiryLabel: expiry?.label ?? null,
      period:
        template?.class === 'priceBinary' || template?.class === 'priceBucket'
          ? template.period
          : null,
      quoteToken: choices[0]?.quoteToken ?? outcome.quoteToken ?? 'USDC',
      questionId: null,
      fallbackOutcomeId: null,
      outcomeIds: [outcome.outcome],
      choices,
      // The two sides are complementary views of one standalone market. The
      // Hyperliquid card reports the primary side's notional instead of adding
      // Yes + No and double-counting the same event activity.
      dayVolume: choices[0]?.dayVolume ?? null,
    };
    events.set(id, preferNewerRecurring(events.get(id), candidate));
  }

  return [...events.values()];
}
