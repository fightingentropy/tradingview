import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canAttempt, failureState, loadPublicationCandidate, type Attempt } from './daily-brief-job';

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

test('publication failures keep retrying the saved edition after the research attempt limit', () => {
  const failedAt = new Date('2026-09-17T10:05:00Z');
  const state: Attempt = { day: '2026-09-17', attempts: 4, lastAttempt: '2026-09-17T10:00:00Z', state: 'failed', host: 'm4mini', candidate: { file: '/saved/edition.md', title: 'Saved brief' }, ...failureState(new Error('Cloudflare 401: Unauthorized'), failedAt, true) };
  expect(state.failureKind).toBe('publication');
  expect(canAttempt(new Date('2026-09-17T11:04:59Z'), state)).toBe(false);
  expect(canAttempt(new Date('2026-09-17T11:05:00Z'), state)).toBe(true);
  expect(canAttempt(new Date('2026-09-17T12:00:00Z'), { ...state, state: 'published' })).toBe(false);
  expect(canAttempt(new Date('2026-09-17T11:00:00Z'), { ...state, state: 'publishing', nextAttemptAt: undefined })).toBe(true);
});

test('a pending publication reuses the exact saved content only on its original London day', () => {
  const dir = mkdtempSync(join(tmpdir(), 'brief-resume-test-'));
  try {
    const file = join(dir, 'edition.md');
    const markdown = readFileSync(new URL('../src/data/briefs/2026-09-16.md', import.meta.url), 'utf8');
    writeFileSync(file, markdown);
    const state: Attempt = { day: '2026-09-16', attempts: 4, lastAttempt: '2026-09-16T21:00:00Z', state: 'failed', host: 'm4mini', candidate: { file, title: 'Original edition' } };
    const recovered = loadPublicationCandidate(state, new Date('2026-09-16T22:59:00Z'));
    expect(recovered?.brief.raw).toBe(markdown.trim());
    expect(recovered?.brief.title).toBe('Original edition');
    expect(recovered?.file).toBe(file);
    expect(loadPublicationCandidate(state, new Date('2026-09-16T23:00:00Z'))).toBeUndefined();
    expect(loadPublicationCandidate({ ...state, state: 'published' }, new Date('2026-09-16T22:59:00Z'))).toBeUndefined();
    writeFileSync(file, 'corrupt candidate');
    expect(() => loadPublicationCandidate(state, new Date('2026-09-16T22:59:00Z'))).toThrow('original London timestamp');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
