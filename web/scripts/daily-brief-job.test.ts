import { expect, test } from 'bun:test';
import { canAttempt, failureState } from './daily-brief-job';

test('starts at 08:00 London across daylight saving changes and weekends', () => {
  expect(canAttempt(new Date('2026-09-17T06:59:00Z'))).toBe(false);
  expect(canAttempt(new Date('2026-09-17T07:00:00Z'))).toBe(true);
  expect(canAttempt(new Date('2026-12-20T07:59:00Z'))).toBe(false);
  expect(canAttempt(new Date('2026-12-20T08:00:00Z'))).toBe(true);
});
test('does not repeat a completed edition and allows the following day', () => {
  const state = { day: '2026-09-17', attempts: 1, lastAttempt: '2026-09-17T07:00:00Z', state: 'published', host: 'm4mini' };
  expect(canAttempt(new Date('2026-09-17T13:00:00Z'), state)).toBe(false);
  expect(canAttempt(new Date('2026-09-18T07:00:00Z'), state)).toBe(true);
});
test('spaces retries and stops after four failed attempts', () => {
  const state = { day: '2026-09-17', attempts: 1, lastAttempt: '2026-09-17T07:00:00Z', state: 'failed', host: 'm4mini' };
  expect(canAttempt(new Date('2026-09-17T07:15:00Z'), state)).toBe(false);
  expect(canAttempt(new Date('2026-09-17T07:30:00Z'), state)).toBe(true);
  expect(canAttempt(new Date('2026-09-17T12:00:00Z'), { ...state, attempts: 4 })).toBe(false);
});


test('quota failures become eligible again on the same day after the cooldown', () => {
  const state = { day: '2026-09-17', attempts: 4, lastAttempt: '2026-09-17T10:00:00Z', state: 'failed', host: 'm4mini', ...failureState(new Error("You have hit your usage limit"), new Date('2026-09-17T10:00:00Z')) };
  expect(canAttempt(new Date('2026-09-17T10:59:59Z'), state)).toBe(false);
  expect(canAttempt(new Date('2026-09-17T11:00:00Z'), state)).toBe(true);
  expect(canAttempt(new Date('2026-09-17T12:00:00Z'), { ...state, state: 'published' })).toBe(false);
});

test('old quota-blocked status files recover without manual edits', () => {
  const state = { day: '2026-09-17', attempts: 8, lastAttempt: '2026-09-17T10:00:00Z', state: 'failed', host: 'm4mini', error: 'Usage limit reached. Try again later.' };
  expect(canAttempt(new Date('2026-09-17T11:00:00Z'), state)).toBe(true);
  expect(canAttempt(new Date('2026-09-17T11:00:00Z'), { ...state, error: 'Invalid evidence' })).toBe(false);
});
