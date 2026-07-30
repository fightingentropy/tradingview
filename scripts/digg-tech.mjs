import { execFile } from 'node:child_process';
import { accessSync, constants, existsSync } from 'node:fs';
import os from 'node:os';
import { join as pathJoin } from 'node:path';
import { promisify } from 'node:util';
import { load } from 'cheerio';

const execFileAsync = promisify(execFile);

export const DIGG_TECH_URL = 'https://digg.com/tech';
const FETCH_TIMEOUT_MS = 20_000;
const FETCH_MAX_BUFFER_BYTES = 25 * 1024 * 1024;

function findCurlImpersonate() {
  const homeBin = pathJoin(os.homedir(), '.local', 'bin');
  const candidates = [
    process.env.CURL_IMPERSONATE_PATH,
    `${homeBin}/curl_chrome136`,
    `${homeBin}/curl_chrome131`,
    `${homeBin}/curl_chrome124`,
    `${homeBin}/curl_chrome110`,
    '/opt/homebrew/bin/curl_chrome136',
    '/opt/homebrew/bin/curl_chrome131',
    '/opt/homebrew/bin/curl_chrome124',
    '/opt/homebrew/bin/curl_chrome110',
    '/opt/homebrew/bin/curl_chrome107',
    '/opt/homebrew/bin/curl_chrome104',
    '/usr/local/bin/curl_chrome131',
    '/usr/local/bin/curl_chrome110',
  ].filter((value) => typeof value === 'string' && value.trim());

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep looking.
    }
  }

  throw new Error(
    "Couldn't find curl-impersonate (curl_chrome*). Install via Homebrew (`brew install curl-impersonate`) or set CURL_IMPERSONATE_PATH.",
  );
}

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

function storyTitle(value) {
  if (typeof value.title === 'string') return value.title.replace(/\s+/g, ' ').trim();
  if (isRecord(value.summary) && typeof value.summary.title === 'string') {
    return value.summary.title.replace(/\s+/g, ' ').trim();
  }
  return '';
}

function storySummary(value) {
  if (typeof value.tldr === 'string') return value.tldr.replace(/\s+/g, ' ').trim();
  if (isRecord(value.summary) && typeof value.summary.description === 'string') {
    return value.summary.description.replace(/\s+/g, ' ').trim();
  }
  return '';
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
    const title = storyTitle(value);
    const summary = storySummary(value);
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

/** Keep only the icon + RSC scripts cheerio needs — avoids parsing a 1MB+ DOM. */
function trimDiggHtml(html) {
  const parts = [];
  const icon = html.match(/<link[^>]+rel=["']icon["'][^>]*>/i);
  if (icon) parts.push(`<head>${icon[0]}</head>`);

  const pushPattern = /<script[^>]*>\s*self\.__next_f\.push\([\s\S]*?<\/script>/gi;
  for (const match of html.matchAll(pushPattern)) {
    if (match[0].includes('storiesByFilter') || match[0].includes('clusterId')) {
      parts.push(match[0]);
    }
  }

  if (parts.length === 0) return html;
  return `<!doctype html><html>${parts.join('')}</html>`;
}

export function parseDiggTech(html) {
  const trimmed = load(trimDiggHtml(html));
  const avatarUrl = faviconUrl(trimmed);
  const structuredStories = parseStructuredStories(trimmed, avatarUrl);
  if (structuredStories.length > 0) return structuredStories;

  const $ = load(html);
  return parseLegacyStories($, html, faviconUrl($));
}

function isVercelChallenge(html) {
  return /Vercel Security Checkpoint/i.test(html);
}

async function fetchDiggHtmlViaCurlImpersonate() {
  const curl = findCurlImpersonate();

  // curl-impersonate mimics Chrome's TLS/HTTP2 fingerprint, which is enough to
  // pass Digg's Vercel bot check without launching a real browser.
  const { stdout, stderr } = await execFileAsync(
    curl,
    [
      '--silent',
      '--show-error',
      '--location',
      '--max-time',
      String(Math.ceil(FETCH_TIMEOUT_MS / 1000)),
      '--compressed',
      DIGG_TECH_URL,
    ],
    {
      timeout: FETCH_TIMEOUT_MS + 2_000,
      maxBuffer: FETCH_MAX_BUFFER_BYTES,
      env: { ...process.env, HOME: os.homedir() },
    },
  );

  const html = typeof stdout === 'string' ? stdout : String(stdout);
  if (!html || isVercelChallenge(html)) {
    const detail = typeof stderr === 'string' && stderr.trim() ? `: ${stderr.trim().slice(0, 200)}` : '';
    throw new Error(`Digg curl-impersonate fetch returned a Vercel challenge page${detail}`);
  }
  return html;
}

export async function fetchDiggTech() {
  const html = await fetchDiggHtmlViaCurlImpersonate();
  const items = parseDiggTech(html);
  if (items.length === 0) throw new Error('Digg returned no recognizable Tech stories');
  return items;
}
