import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { briefEntry, parseBriefIndex, parseBriefPayload, validateFreshBrief } from './dailyBriefFeed';

const markdown = readFileSync(new URL('../data/briefs/2026-09-16.md', import.meta.url), 'utf8');
const payload = { title: 'The Fed restarts tightening; breadth weakens.', markdown };
const now = new Date('2026-09-16T22:59:00Z');

describe('daily publishing validation', () => {
  test('accepts a sourced current edition with the BRIEF.md structure', () => {
    const brief = validateFreshBrief(payload.title, markdown, now);
    expect(brief.id).toBe('2026-09-16');
    expect(brief.sections).toHaveLength(8);
    expect(brief.sources.length).toBeGreaterThanOrEqual(5);
  });
  test('rejects stale, future, incomplete, and invalid-probability editions', () => {
    expect(() => validateFreshBrief(payload.title, markdown, new Date('2026-09-17T12:00:00Z'))).toThrow('today');
    expect(() => validateFreshBrief(payload.title, markdown, new Date('2026-09-16T01:00:00Z'))).toThrow('future');
    expect(() => validateFreshBrief(payload.title, markdown.replace('Regime Assessment', 'Missing section'), now)).toThrow('eight');
    expect(() => validateFreshBrief(payload.title, markdown.replace('55%', '56%'), now)).toThrow('100%');
  });
  test('rejects oversized editions and index/content mismatches', () => {
    const brief = parseBriefPayload(payload);
    expect(() => parseBriefPayload({ ...payload, markdown: 'x'.repeat(60_001) })).toThrow('Invalid');
    expect(() => parseBriefPayload(payload, { ...briefEntry(brief), id: '2026-09-15' })).toThrow('match');
    expect(() => parseBriefPayload(payload, { ...briefEntry(brief), title: 'Different' })).toThrow('match');
  });
  test('validates and sorts the publication index without silently losing bad entries', () => {
    const latest = briefEntry(parseBriefPayload(payload));
    const previous = { ...latest, id: '2026-09-15', generated: '2026-09-15 08:00' };
    const index = { version: 1, publishedAt: now.toISOString(), editions: [previous, latest] };
    expect(parseBriefIndex(index).editions.map((entry) => entry.id)).toEqual(['2026-09-16', '2026-09-15']);
    expect(() => parseBriefIndex({ ...index, editions: [latest, latest] })).toThrow('entry');
    expect(() => parseBriefIndex({ ...index, editions: [{ ...latest, id: '2026-02-30', generated: '2026-02-30 08:00' }] })).toThrow('date');
    expect(() => parseBriefIndex({ ...index, version: 2 })).toThrow('index');
  });
});
