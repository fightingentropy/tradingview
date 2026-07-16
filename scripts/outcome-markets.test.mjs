import assert from 'node:assert/strict';
import test from 'node:test';

import { formatProbability, formatProbabilityPointChange } from '../src/lib/format.ts';
import {
  buildOutcomeEvents,
  outcomeAssetId,
  outcomeCoinKey,
  outcomeDescription,
  outcomeEncoding,
  outcomeMetadata,
  outcomePresentation,
  parseOutcomeTemplate,
  visibleOutcomeSides,
} from '../src/lib/outcomeMarkets.ts';

const yesNo = [{ name: 'Yes' }, { name: 'No' }];

test('encodes outcome sides with Hyperliquid native ids', () => {
  assert.equal(outcomeEncoding(856, 0), 8560);
  assert.equal(outcomeCoinKey(856, 1), '#8561');
  assert.equal(outcomeAssetId(856, 1), 100_008_561);
});

test('shows both standalone sides but one affirmative side per grouped choice', () => {
  assert.deepEqual(visibleOutcomeSides(yesNo), [0, 1]);
  assert.deepEqual(visibleOutcomeSides(yesNo, true), [0]);
  assert.deepEqual(visibleOutcomeSides([{ name: 'Spain' }, { name: 'Argentina' }]), [0, 1]);
});

test('labels grouped and standalone event contracts without leaking internal ids', () => {
  const grouped = {
    outcome: 173,
    name: 'Argentina',
    description: 'Resolves Yes if Argentina wins.',
    sideSpecs: yesNo,
    quoteToken: 'USDC',
  };
  const question = {
    question: 32,
    name: '2026 World Cup Champion',
    description: '',
    fallbackOutcome: 171,
    namedOutcomes: [173],
    settledNamedOutcomes: [],
  };
  assert.deepEqual(outcomePresentation(grouped, question, 0), {
    symbol: 'Argentina',
    name: '2026 World Cup Champion',
  });

  const final = {
    outcome: 856,
    name: 'World Cup Final: Spain vs Argentina',
    description: 'Resolution rules',
    sideSpecs: [{ name: 'Spain' }, { name: 'Argentina' }],
    quoteToken: 'USDC',
  };
  assert.deepEqual(outcomePresentation(final, undefined, 1), {
    symbol: 'Argentina',
    name: 'World Cup Final: Spain vs Argentina',
  });
});

test('turns recurring price metadata into readable contract labels', () => {
  const binary = {
    outcome: 847,
    name: 'Recurring',
    description:
      'class:priceBinary|underlying:BTC|expiry:20260717-0600|targetPrice:64911|period:1d',
    sideSpecs: yesNo,
    quoteToken: 'USDC',
  };
  assert.deepEqual(outcomePresentation(binary, undefined, 1), {
    symbol: 'BTC above $64,911 · No',
    name: 'Jul 17, 06:00 UTC · price outcome',
  });

  const bucketQuestion = {
    question: 146,
    name: 'Recurring',
    description:
      'class:priceBucket|underlying:BTC|expiry:20260717-0600|priceThresholds:63613,66209|period:1d',
    fallbackOutcome: 851,
    namedOutcomes: [852, 853, 854],
    settledNamedOutcomes: [],
  };
  const middle = {
    outcome: 853,
    name: 'Recurring Named Outcome',
    description: 'index:1',
    sideSpecs: yesNo,
    quoteToken: 'USDC',
  };
  assert.deepEqual(outcomePresentation(middle, bucketQuestion, 0), {
    symbol: 'BTC $63,613–$66,209',
    name: 'Jul 17, 06:00 UTC · price range',
  });
});

test('formats outcome prices as probabilities and point changes', () => {
  assert.equal(formatProbability(0.58448), '58.45%');
  assert.equal(formatProbabilityPointChange(0.05449), '+5.45 pts');
  assert.equal(formatProbabilityPointChange(-0.1), '-10.00 pts');
});

test('parses ordinary metadata without leaking it into resolution text', () => {
  const description =
    'The market resolves from the official result. metadata=category:sports|subCategory:football';
  assert.equal(outcomeDescription(description), 'The market resolves from the official result.');
  assert.deepEqual(outcomeMetadata(description), {
    category: 'sports',
    subCategory: 'football',
  });
  assert.deepEqual(outcomeMetadata('No metadata'), { category: null, subCategory: null });
});

test('validates recurring templates instead of interpreting ordinary prose', () => {
  assert.deepEqual(
    parseOutcomeTemplate(
      'class:priceBinary|underlying:BTC|expiry:20260717-0600|targetPrice:64911|period:1d',
    ),
    {
      class: 'priceBinary',
      underlying: 'BTC',
      expiry: '20260717-0600',
      targetPrice: '64911',
      period: '1d',
    },
  );
  assert.equal(
    parseOutcomeTemplate(
      'class:priceBucket|underlying:BTC|expiry:20260717-0600|priceThresholds:1,2,3|period:1d',
    ),
    null,
  );
  assert.equal(parseOutcomeTemplate('Resolution time: 23:59 UTC.'), null);
});

test('builds event-first grouped, standalone, and recurring cards', () => {
  const meta = {
    outcomes: [
      {
        outcome: 171,
        name: 'Fallback',
        description: '',
        sideSpecs: yesNo,
        quoteToken: 'USDC',
      },
      {
        outcome: 173,
        name: 'Argentina',
        description: 'Resolves Yes if Argentina wins.',
        sideSpecs: yesNo,
        quoteToken: 'USDC',
      },
      {
        outcome: 212,
        name: 'Spain',
        description: 'Resolves Yes if Spain wins.',
        sideSpecs: yesNo,
        quoteToken: 'USDC',
      },
      {
        outcome: 856,
        name: 'World Cup Final: Spain vs Argentina',
        description:
          'Official FIFA result. metadata=category:sports|subCategory:football',
        sideSpecs: [{ name: 'Spain' }, { name: 'Argentina' }],
        quoteToken: 'USDC',
      },
      {
        outcome: 847,
        name: 'Recurring',
        description:
          'class:priceBinary|underlying:BTC|expiry:20260717-0600|targetPrice:64911|period:1d',
        sideSpecs: yesNo,
        quoteToken: 'USDC',
      },
    ],
    questions: [
      {
        question: 32,
        name: '2026 World Cup Champion',
        description:
          'Official FIFA champion. metadata=category:sports|subCategory:football',
        fallbackOutcome: 171,
        namedOutcomes: [173, 212],
        settledNamedOutcomes: [174],
      },
    ],
  };
  const contexts = {
    '#1730': { markPx: '0.41686', prevDayPx: '0.2044', dayNtlVlm: '183005.422' },
    '#2120': { markPx: '0.58342', prevDayPx: '0.57969', dayNtlVlm: '694110.28' },
    '#8560': { markPx: '0.582075', prevDayPx: '0.57901', dayNtlVlm: '26597.04' },
    '#8561': { markPx: '0.417925', prevDayPx: '0.42099', dayNtlVlm: '18925.95' },
    '#8470': { markPx: '0.14251', prevDayPx: '0.52999', dayNtlVlm: '163898.04' },
    '#8471': { markPx: '0.85749', prevDayPx: '0.47001', dayNtlVlm: '386503.95' },
  };

  const events = buildOutcomeEvents(meta, contexts);
  assert.equal(events.length, 3);

  const champion = events.find((event) => event.questionId === 32);
  assert.ok(champion);
  assert.equal(champion.id, 'hl:outcome:event:question:32');
  assert.equal(champion.category, 'sports');
  assert.equal(champion.subCategory, 'football');
  assert.deepEqual(champion.choices.map((choice) => choice.label), ['Argentina', 'Spain']);
  assert.deepEqual(champion.choices.map((choice) => choice.coinKey), ['#1730', '#2120']);
  assert.equal(champion.choices[0].probability, 0.41686);
  assert.equal(champion.choices[0].change24hPoints, 0.41686 - 0.2044);
  assert.equal(champion.dayVolume, 877115.702);

  const final = events.find((event) => event.outcomeIds[0] === 856);
  assert.ok(final);
  assert.equal(final.kind, 'standalone');
  assert.equal(final.description, 'Official FIFA result.');
  assert.deepEqual(final.choices.map((choice) => choice.label), ['Spain', 'Argentina']);
  assert.deepEqual(final.choices.map((choice) => choice.instrumentId), [
    'hl:outcome:8560',
    'hl:outcome:8561',
  ]);

  const recurring = events.find((event) => event.outcomeIds[0] === 847);
  assert.ok(recurring);
  assert.equal(recurring.id, 'hl:outcome:event:recurring:priceBinary:BTC:1d');
  assert.equal(recurring.title, 'BTC above $64,911 on Jul 17, 2026 06:00 UTC?');
  assert.equal(recurring.category, 'crypto');
  assert.equal(recurring.expiryAt, Date.UTC(2026, 6, 17, 6, 0));
  assert.equal(recurring.dayVolume, 163898.04);
});

test('names price buckets and keeps only the newest rolling event identity', () => {
  const bucketOutcomes = (base, question, expiry, thresholds) => ({
    outcomes: [0, 1, 2].map((index) => ({
      outcome: base + index,
      name: 'Recurring Named Outcome',
      description: `index:${index}`,
      sideSpecs: yesNo,
      quoteToken: 'USDC',
    })),
    question: {
      question,
      name: 'Recurring',
      description: `class:priceBucket|underlying:BTC|expiry:${expiry}|priceThresholds:${thresholds}|period:1d`,
      fallbackOutcome: base - 1,
      namedOutcomes: [base, base + 1, base + 2],
      settledNamedOutcomes: [],
    },
  });
  const old = bucketOutcomes(800, 140, '20260716-0600', '62000,65000');
  const current = bucketOutcomes(852, 146, '20260717-0600', '63613,66209');
  const events = buildOutcomeEvents({
    outcomes: [...old.outcomes, ...current.outcomes],
    questions: [old.question, current.question],
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].id, 'hl:outcome:event:recurring:priceBucket:BTC:1d');
  assert.equal(events[0].questionId, 146);
  assert.equal(events[0].title, 'BTC price range on Jul 17, 2026 06:00 UTC?');
  assert.deepEqual(events[0].choices.map((choice) => choice.label), [
    'Below $63,613',
    '$63,613 to $66,209',
    'Above $66,209',
  ]);
});

test('keeps choices visible when an odds context is temporarily unavailable', () => {
  const events = buildOutcomeEvents({
    outcomes: [
      {
        outcome: 900,
        name: 'Will it happen?',
        description: 'Resolution rules',
        sideSpecs: yesNo,
        quoteToken: 'USDC',
      },
    ],
    questions: [],
  });
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].choices.map((choice) => choice.probability), [null, null]);
  assert.equal(events[0].dayVolume, null);
});
