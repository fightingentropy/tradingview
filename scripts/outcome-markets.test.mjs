import assert from 'node:assert/strict';
import test from 'node:test';

import { formatProbability, formatProbabilityPointChange } from '../src/lib/format.ts';
import {
  outcomeAssetId,
  outcomeCoinKey,
  outcomeEncoding,
  outcomePresentation,
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
