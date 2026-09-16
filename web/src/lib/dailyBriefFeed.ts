import { londonDateKey, parseDailyBrief, type DailyBrief } from './dailyBrief';

export type BriefEntry = Pick<DailyBrief, 'id' | 'title' | 'generated'>;
export type BriefIndex = { version: 1; publishedAt: string; editions: BriefEntry[] };
export const briefEntry = ({ id, title, generated }: DailyBrief): BriefEntry => ({ id, title, generated });

export function parseBriefIndex(value: unknown): BriefIndex {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('publishedAt' in value) || typeof value.publishedAt !== 'string' || !Number.isFinite(Date.parse(value.publishedAt)) || !('editions' in value) || !Array.isArray(value.editions) || !value.editions.length || value.editions.length > 10_000) throw new Error('Invalid brief index.');
  const ids = new Set<string>();
  const editions = value.editions.map((item: unknown): BriefEntry => {
    if (!item || typeof item !== 'object' || !('id' in item) || typeof item.id !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.id) || !('title' in item) || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 180 || !('generated' in item) || typeof item.generated !== 'string' || !new RegExp(`^${item.id} \\d{2}:\\d{2}$`).test(item.generated) || ids.has(item.id)) throw new Error('Invalid brief index entry.');
    const date = new Date(`${item.generated.replace(' ', 'T')}:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 16).replace('T', ' ') !== item.generated) throw new Error('Invalid brief index date.');
    ids.add(item.id);
    return { id: item.id, title: item.title, generated: item.generated };
  }).sort((a, b) => b.generated.localeCompare(a.generated));
  return { version: 1, publishedAt: value.publishedAt, editions };
}

export function parseBriefPayload(value: unknown, expected?: BriefEntry): DailyBrief {
  if (!value || typeof value !== 'object' || !('title' in value) || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 180 || !('markdown' in value) || typeof value.markdown !== 'string' || value.markdown.length > 60_000) throw new Error('Invalid brief edition.');
  const brief = parseDailyBrief(value.title, value.markdown);
  if (expected && (brief.id !== expected.id || brief.title !== expected.title || brief.generated !== expected.generated)) throw new Error('Brief edition does not match the publication index.');
  return brief;
}

export function validateFreshBrief(title: string, markdown: string, now = new Date()): DailyBrief {
  const brief = parseBriefPayload({ title, markdown });
  if (brief.id !== londonDateKey(now)) throw new Error('A new publication must be generated today in Europe/London.');
  const currentLondonTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  if (brief.generated.slice(11) > currentLondonTime) throw new Error('The generation time cannot be in the future.');
  const expected = ['market verdict', 'what changed', 'regime assessment', 'cross-asset read', 'risk and opportunity radar', 'what matters next', 'pm bottom line', 'data caveats'];
  const headings = brief.sections.map((section) => section.title.toLowerCase());
  if (expected.some((heading, index) => headings[index] !== heading)) throw new Error('The new brief must contain the eight BRIEF.md sections in order.');
  if (brief.sources.length < 5) throw new Error('A new brief needs at least five linked sources.');
  const words = brief.raw.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').split(/\s+/).length;
  if (words < 700 || words > 1_100) throw new Error(`Standard brief length is 700–1,000 words (received ${words}).`);
  const bottomLine = brief.raw.split(/^## (?:\d+[.)]\s*)?PM Bottom Line\s*$/im)[1]?.split(/^## /m)[0] ?? '';
  const probabilities = [...bottomLine.matchAll(/\b(\d{1,3})%/g)].map((match) => Number(match[1]));
  if (probabilities.length !== 3 || probabilities.reduce((sum, value) => sum + value, 0) !== 100) throw new Error('PM Bottom Line needs three scenario probabilities totalling 100%.');
  return brief;
}
