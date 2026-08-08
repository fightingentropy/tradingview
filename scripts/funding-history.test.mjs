import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateFundingPoints,
  formatFundingRatePercent,
} from '../src/lib/fundingHistory.ts';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

test('sums hourly rates into daily funding and preserves the cumulative path', () => {
  const now = 100 * DAY;
  const points = [
    { t: now - DAY + HOUR, rate: 0.00001 },
    { t: now - DAY + 2 * HOUR, rate: -0.000004 },
    { t: now - DAY + 3 * HOUR, rate: 0.000002 },
    { t: now, rate: 0.000005 },
  ];

  const rows = aggregateFundingPoints(points, '1d', now);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map(({ t, samples }) => ({ t, samples })),
    [
      { t: now - DAY, samples: 3 },
      { t: now, samples: 1 },
    ],
  );
  assert.ok(Math.abs(rows[0].rate - 0.000008) < 1e-12);
  assert.ok(Math.abs(rows[1].cumulative - 0.000013) < 1e-12);
});

test('filters the visible horizon selected by the chart resolution', () => {
  const now = 200 * DAY;
  const rows = aggregateFundingPoints(
    [
      { t: now - 8 * DAY, rate: 0.5 },
      { t: now - 6 * DAY, rate: 0.25 },
    ],
    '1h',
    now,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rate, 0.25);
});

test('formats small hourly rates without rounding them away', () => {
  assert.equal(formatFundingRatePercent(0.0000125), '0.0013%');
  assert.equal(formatFundingRatePercent(-0.0000008), '-0.0001%');
});
