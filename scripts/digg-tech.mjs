import { load } from 'cheerio';

export const DIGG_TECH_URL = 'https://digg.com/tech';

function storyTimestamps(html) {
  const timestamps = new Map();
  const pattern = /\{\\"clusterId\\":\\"([^"\\]+)\\"[\s\S]{0,4000}?\\"createdAt\\":\\"([^"\\]+)\\"/g;
  for (const match of html.matchAll(pattern)) {
    const date = new Date(match[2]);
    if (Number.isFinite(date.getTime())) timestamps.set(match[1], date.toISOString());
  }
  return timestamps;
}

export function parseDiggTech(html) {
  const $ = load(html);
  const timestamps = storyTimestamps(html);
  const items = [];

  $('[data-testid="top-stories-stack"] [data-story-row="true"]').each((_, node) => {
    const story = $(node);
    const id = story.attr('data-story-id')?.trim();
    const anchor = story.find('a[href] h3').first().parent('a');
    const title = anchor.find('h3').first().text().replace(/\s+/g, ' ').trim();
    const href = anchor.attr('href')?.trim();
    const publishedAt = id ? timestamps.get(id) : undefined;
    if (!id || !title || !href || !publishedAt) return;

    const summary = anchor.nextAll('p').first().text().replace(/\s+/g, ' ').trim();
    let url;
    try {
      url = new URL(href, DIGG_TECH_URL).toString();
    } catch {
      return;
    }
    if (!url.startsWith('https://digg.com/')) return;

    items.push({
      id,
      source: 'digg',
      author: { name: 'Digg Tech', handle: 'tech' },
      text: summary ? `${title}\n\n${summary}` : title,
      publishedAt,
      url,
      media: [],
    });
  });

  return items;
}

export async function fetchDiggTech() {
  const response = await fetch(DIGG_TECH_URL, {
    headers: {
      Accept: 'text/html',
      'User-Agent': 'TradingViewNewsBridge/1.0 (+localhost personal feed)',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Digg returned ${response.status}`);
  const items = parseDiggTech(await response.text());
  if (items.length === 0) throw new Error('Digg returned no recognizable Tech stories');
  return items;
}
