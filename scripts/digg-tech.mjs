import { load } from 'cheerio';

export const DIGG_TECH_URL = 'https://digg.com/tech';

function faviconUrl($) {
  const href = $('link[rel="icon"][href]').first().attr('href')?.trim();
  if (!href) return undefined;
  try {
    const url = new URL(href, DIGG_TECH_URL);
    return url.protocol === 'https:' && url.hostname === 'digg.com' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function storyTimestamps(html) {
  const timestamps = new Map();
  const pattern = /\{\\"clusterId\\":\\"([^"\\]+)\\"[\s\S]{0,4000}?\\"createdAt\\":\\"([^"\\]+)\\"/g;
  for (const match of html.matchAll(pattern)) {
    const date = new Date(match[2]);
    if (Number.isFinite(date.getTime())) timestamps.set(match[1], date.toISOString());
  }
  return timestamps;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseNextDataEnvelope(script) {
  const match = /^self\.__next_f\.push\((.+)\);?$/s.exec(script.trim());
  if (!match) return undefined;

  try {
    const envelope = JSON.parse(match[1]);
    const chunk = Array.isArray(envelope) ? envelope[1] : undefined;
    if (typeof chunk !== 'string') return undefined;
    const separator = chunk.indexOf(':');
    return separator >= 0 ? JSON.parse(chunk.slice(separator + 1)) : undefined;
  } catch {
    return undefined;
  }
}

function findTopStoriesFeed(value) {
  if (!value || typeof value !== 'object') return undefined;
  if (isRecord(value) && isRecord(value.storiesByFilter)) {
    const top = value.storiesByFilter.top;
    if (isRecord(top) && Array.isArray(top.posts)) {
      return {
        posts: top.posts,
        topic: typeof value.topic === 'string' ? value.topic.trim() : '',
      };
    }
  }

  const children = Array.isArray(value) ? value : Object.values(value);
  for (const child of children) {
    const feed = findTopStoriesFeed(child);
    if (feed) return feed;
  }
  return undefined;
}

function parseStructuredStories($, avatarUrl) {
  let feed;
  $('script').each((_, node) => {
    if (feed) return;
    const payload = parseNextDataEnvelope($(node).html() ?? '');
    if (payload) feed = findTopStoriesFeed(payload);
  });
  if (!feed) return [];

  return feed.posts.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = typeof value.clusterId === 'string' ? value.clusterId.trim() : '';
    const slug = typeof value.clusterUrlId === 'string' ? value.clusterUrlId.trim() : '';
    const title = typeof value.title === 'string' ? value.title.replace(/\s+/g, ' ').trim() : '';
    const summary = typeof value.tldr === 'string' ? value.tldr.replace(/\s+/g, ' ').trim() : '';
    const publishedAt = typeof value.createdAt === 'string' ? new Date(value.createdAt) : undefined;
    const topic = feed.topic && /^[a-z0-9-]+$/i.test(feed.topic) ? feed.topic : 'tech';
    if (!id || !slug || !title || !publishedAt || !Number.isFinite(publishedAt.getTime())) return [];

    return [{
      id,
      source: 'digg',
      author: { name: 'Digg Tech', handle: 'tech', ...(avatarUrl ? { avatarUrl } : {}) },
      text: summary ? `${title}\n\n${summary}` : title,
      publishedAt: publishedAt.toISOString(),
      url: new URL(`/${topic}/${encodeURIComponent(slug)}`, DIGG_TECH_URL).toString(),
      media: [],
    }];
  });
}

function parseLegacyStories($, html, avatarUrl) {
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
      author: { name: 'Digg Tech', handle: 'tech', ...(avatarUrl ? { avatarUrl } : {}) },
      text: summary ? `${title}\n\n${summary}` : title,
      publishedAt,
      url,
      media: [],
    });
  });

  return items;
}

export function parseDiggTech(html) {
  const $ = load(html);
  const avatarUrl = faviconUrl($);
  const structuredStories = parseStructuredStories($, avatarUrl);
  return structuredStories.length > 0
    ? structuredStories
    : parseLegacyStories($, html, avatarUrl);
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
