import assert from 'node:assert/strict';
import test from 'node:test';

import {
  executiveSummaryScheduleSlot,
  selectScheduledExecutiveSummary,
} from './news-relay';

test('accepts only weekday summaries after a New York market slot', () => {
  assert.equal(executiveSummaryScheduleSlot('2026-08-11T09:21:41.291Z'), undefined);
  assert.equal(
    executiveSummaryScheduleSlot('2026-08-11T13:35:00.000Z'),
    '2026-08-11:open',
  );
  assert.equal(
    executiveSummaryScheduleSlot('2026-08-11T15:21:00.000Z'),
    '2026-08-11:open',
  );
  assert.equal(
    executiveSummaryScheduleSlot('2026-08-11T20:05:00.000Z'),
    '2026-08-11:close',
  );
  assert.equal(executiveSummaryScheduleSlot('2026-08-15T13:35:00.000Z'), undefined);
  assert.equal(
    executiveSummaryScheduleSlot('2026-12-14T14:35:00.000Z'),
    '2026-12-14:open',
  );
});

test('keeps at most one summary per slot and advances at the next slot', () => {
  const mondayClose = { id: 'monday-close', generatedAt: '2026-08-10T20:05:14.126Z' };
  const offSlot = { id: 'off-slot', generatedAt: '2026-08-11T09:21:41.291Z' };
  const tuesdayOpen = { id: 'tuesday-open', generatedAt: '2026-08-11T13:35:10.000Z' };
  const duplicateOpen = { id: 'duplicate-open', generatedAt: '2026-08-11T15:21:00.000Z' };
  const tuesdayClose = { id: 'tuesday-close', generatedAt: '2026-08-11T20:05:10.000Z' };

  assert.equal(selectScheduledExecutiveSummary(offSlot, undefined), undefined);
  assert.equal(selectScheduledExecutiveSummary(mondayClose, offSlot), mondayClose);
  assert.equal(selectScheduledExecutiveSummary(tuesdayOpen, mondayClose), tuesdayOpen);
  assert.equal(selectScheduledExecutiveSummary(duplicateOpen, tuesdayOpen), tuesdayOpen);
  assert.equal(selectScheduledExecutiveSummary(tuesdayClose, tuesdayOpen), tuesdayClose);
  assert.equal(selectScheduledExecutiveSummary(mondayClose, tuesdayClose), tuesdayClose);
});
