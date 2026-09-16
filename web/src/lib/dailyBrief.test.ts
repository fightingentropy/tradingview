import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { editionStatus, londonDateKey, parseDailyBrief, safeBriefUrl } from './dailyBrief';

const fixture = (body: string, generated = '2026-09-07 19:44') => `Generated: ${generated} (Europe/London)  
Market state: U.S. holiday; cash markets closed  
Data cutoff: Friday close; crypto at 19:40 BST

${body}`;

describe('daily brief publication boundaries', () => {
  test('keeps the original edition, market state and cutoff together', () => {
    const brief = parseDailyBrief('A dated view', fixture('## Market verdict\n\nThe **published** view.'));
    expect(brief.id).toBe('2026-09-07');
    expect(brief.generated).toBe('2026-09-07 19:44');
    expect(brief.marketState).toContain('holiday');
    expect(brief.cutoff).toBe('Friday close; crypto at 19:40 BST');
    expect(brief.sections[0]?.blocks[0]).toEqual({ type: 'paragraph', children: [
      { type: 'text', text: 'The ' },
      { type: 'strong', children: [{ type: 'text', text: 'published' }] },
      { type: 'text', text: ' view.' },
    ] });
  });

  test('rejects missing cutoffs and impossible publication dates', () => {
    expect(() => parseDailyBrief('Missing metadata', '## Market verdict\n\nText')).toThrow('timestamp');
    for (const date of ['2026-02-30 12:00', '2026-13-01 12:00', '2026-09-07 25:00']) {
      expect(() => parseDailyBrief('Bad date', fixture('## Market verdict\n\nText', date))).toThrow('date');
    }
    expect(() => parseDailyBrief('No sections', fixture('Text only'))).toThrow('section');
  });

  test('uses the London calendar day and never relabels an archive as current', () => {
    expect(londonDateKey(new Date('2026-09-06T23:30:00Z'))).toBe('2026-09-07');
    expect(londonDateKey(new Date('2026-12-06T23:30:00Z'))).toBe('2026-12-06');
    const brief = parseDailyBrief('A dated view', fixture('## Market verdict\n\nText'));
    expect(editionStatus(brief, brief.id, new Date('2026-09-06T23:30:00Z'))).toBe('today');
    expect(editionStatus(brief, brief.id, new Date('2026-09-16T12:00:00Z'))).toBe('latest');
    expect(editionStatus(brief, '2026-09-08', new Date('2026-09-16T12:00:00Z'))).toBe('archive');
  });

  test('retains claim-level source links and deduplicates the source index', () => {
    const brief = parseDailyBrief('Sources', fixture('## Verdict\n\n[Release](https://example.com/release) confirms the fact.\n\n## What changed\n\n- [Same release](https://example.com/release)\n- [Market data](https://data.example.com/quote)'));
    expect(brief.sources).toEqual([
      { label: 'Release', href: 'https://example.com/release' },
      { label: 'Market data', href: 'https://data.example.com/quote' },
    ]);
    expect(brief.sections[1]?.blocks[0]?.type).toBe('list');
    expect(JSON.stringify(brief.sections).match(/"type":"link"/g)).toHaveLength(3);
  });

  test('keeps unsafe links, embedded images and raw HTML out of executable markup', () => {
    for (const href of ['javascript:alert(1)', 'data:text/html,test', '//example.com', 'https://secret@example.com', 'file:///tmp/test']) expect(safeBriefUrl(href)).toBeUndefined();
    const brief = parseDailyBrief('Untrusted source text', fixture('## Verdict\n\n[Unsafe](javascript:alert) ![Image label](https://example.com/tracker.png) <script>alert(1)</script>'));
    expect(brief.sources).toHaveLength(0);
    const serialized = JSON.stringify(brief.sections);
    expect(serialized).not.toContain('"type":"link"');
    expect(serialized).not.toContain('"type":"html"');
    expect(serialized).not.toContain('tracker.png');
    expect(serialized).toContain('Unsafe');
    expect(serialized).toContain('Image label');
  });

  test('gives existing source caveats their own section without rewriting them', () => {
    const brief = parseDailyBrief('Caveats', fixture('## 7) PM Bottom Line\n\nA conditional view.\n\n*Data gaps: no direct flow data.*'));
    expect(brief.sections.map((section) => section.title)).toEqual(['PM Bottom Line', 'Data caveats']);
    expect(brief.sections[1]?.blocks[0]).toEqual({ type: 'paragraph', children: [{ type: 'em', children: [{ type: 'text', text: 'Data gaps: no direct flow data.' }] }] });
  });

  test('the imported task editions retain their original publication dates and source trails', () => {
    for (const id of ['2026-09-07', '2026-09-05', '2026-08-25']) {
      const markdown = readFileSync(new URL(`../data/briefs/${id}.md`, import.meta.url), 'utf8');
      const brief = parseDailyBrief('Imported edition', markdown);
      expect(brief.id).toBe(id);
      expect(brief.sources.length).toBeGreaterThan(10);
      expect(brief.sections.length).toBeGreaterThanOrEqual(6);
      expect(brief.raw).toBe(markdown.trim());
      expect(new Set(brief.sections.map((section) => section.id)).size).toBe(brief.sections.length);
    }
  });
});
