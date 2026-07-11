import { execFile } from 'node:child_process';
import { accessSync, constants, existsSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import { promisify } from 'node:util';
import { load } from 'cheerio';

import { DIGG_TECH_URL, fetchDiggTech } from './digg-tech.mjs';
import { NewsPushService } from './news-push.mjs';
import {
  NEWS_SCHEDULER_INTERVAL_MS,
  NEWS_SOURCE_REFRESH_INTERVAL_MS,
  isNewsSourceCacheFresh,
} from './news-refresh-policy.mjs';
import { publishNewsRelaySnapshot } from './news-relay-client.mjs';
import { readTelegramCredentials } from './telegram-keychain.mjs';

const execFileAsync = promisify(execFile);
const LIST_ID = '1933193197817135501';
const HOST = process.env.NEWS_FEED_HOST ?? '127.0.0.1';
const PORT = Number(process.env.NEWS_FEED_PORT ?? 8430);
const MAX_COUNT = 100;
const TELEGRAM_CHANNELS = [
  'tradfi_t3',
  'trad_fin',
  'WatcherGuru',
  'chain_alerts',
  'dbnewsdelayed',
  'tradexyz_announcements',
  'hyperliquid_announcements',
];

let cached;
let inFlight;
let telegramCached;
let telegramInFlight;
let telegramClientPromise;
let diggCached;
let diggInFlight;
const pushService = new NewsPushService({ xListId: LIST_ID, telegramChannels: TELEGRAM_CHANNELS });

function findBird() {
  const candidates = [
    '/usr/local/bin/bird',
    '/opt/homebrew/bin/bird',
    `${os.homedir()}/.local/bin/bird`,
    `${os.homedir()}/.bun/bin/bird`,
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep looking for an executable copy.
    }
  }
  throw new Error("Couldn't find the bird CLI. Expected it in /usr/local/bin or Homebrew.");
}

function asNonEmptyString(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asHttpsUrl(value) {
  const string = asNonEmptyString(value);
  if (!string) return undefined;
  try {
    const url = new URL(string);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function avatarUrl(tweet) {
  const value = tweet?.raw?.core?.user_results?.result?.avatar?.image_url;
  return asHttpsUrl(value)?.replace('_normal.', '_bigger.');
}

function normalizeMedia(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const isPhoto = entry.type === 'photo';
    const previewUrl = asHttpsUrl(isPhoto ? entry.url ?? entry.previewUrl : entry.previewUrl ?? entry.url);
    if (!previewUrl) return [];
    return [{ type: isPhoto ? 'image' : 'video', previewUrl }];
  });
}

function displayText(tweet) {
  let text = asNonEmptyString(tweet.text) ?? '';
  const hasAttachment =
    (Array.isArray(tweet.media) && tweet.media.length > 0) || tweet.quotedTweet || tweet.raw?.card;
  if (hasAttachment) {
    text = text.replace(/(?:^|[\s\n]+)https?:\/\/t\.co\/[A-Za-z0-9]+\s*$/gi, '').trim();
  }
  return text;
}

function normalizeTweet(tweet) {
  if (!tweet || typeof tweet !== 'object') return undefined;
  const id = asNonEmptyString(tweet.id);
  const username = asNonEmptyString(tweet.author?.username);
  if (!id || !username) return undefined;

  const date = new Date(tweet.createdAt);
  return {
    id,
    source: 'x',
    author: {
      name: asNonEmptyString(tweet.author?.name) ?? `@${username}`,
      handle: username,
      avatarUrl: avatarUrl(tweet),
    },
    text: displayText(tweet),
    publishedAt: Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString(),
    url: `https://x.com/${encodeURIComponent(username)}/status/${encodeURIComponent(id)}`,
    media: normalizeMedia(tweet.media),
  };
}

function backgroundImageUrl(style) {
  if (typeof style !== 'string') return undefined;
  const match = style.match(/background-image\s*:\s*url\((['"]?)(.*?)\1\)/i);
  return asHttpsUrl(match?.[2]);
}

function normalizeTelegramText(element) {
  if (!element.length) return '';
  const copy = element.clone();
  copy.find('br').replaceWith('\n');
  return copy
    .text()
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function fetchTelegramChannel(handle) {
  const response = await fetch(`https://t.me/s/${encodeURIComponent(handle)}`, {
    headers: {
      Accept: 'text/html',
      'User-Agent': 'TradingViewNewsBridge/1.0 (+localhost personal feed)',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Telegram returned ${response.status}`);

  const html = await response.text();
  const $ = load(html);
  const channelName =
    asNonEmptyString($('meta[property="og:title"]').attr('content')) ?? `@${handle}`;
  const channelAvatar = asHttpsUrl($('meta[property="og:image"]').attr('content'));
  const items = [];

  $('.js-widget_message[data-post]').each((_, node) => {
    const message = $(node);
    const post = asNonEmptyString(message.attr('data-post'));
    if (!post) return;
    const separator = post.lastIndexOf('/');
    if (separator <= 0 || separator === post.length - 1) return;
    const postHandle = post.slice(0, separator);
    const messageID = post.slice(separator + 1);
    const publishedAt = message.find('time[datetime]').first().attr('datetime');
    const date = new Date(publishedAt);
    if (!Number.isFinite(date.getTime())) return;

    const photoUrl = backgroundImageUrl(
      message.find('.tgme_widget_message_photo_wrap').first().attr('style'),
    );
    const videoUrl = backgroundImageUrl(
      message.find('.tgme_widget_message_video_thumb').first().attr('style'),
    );
    const media = videoUrl
      ? [{ type: 'video', previewUrl: videoUrl }]
      : photoUrl
        ? [{ type: 'image', previewUrl: photoUrl }]
        : [];
    const text = normalizeTelegramText(message.find('.js-message_text').first());

    items.push({
      id: `${postHandle}:${messageID}`,
      source: 'telegram',
      author: { name: channelName, handle, avatarUrl: channelAvatar },
      text: text || (videoUrl ? 'Video' : photoUrl ? 'Photo' : 'Channel update'),
      publishedAt: date.toISOString(),
      url: `https://t.me/${postHandle}/${messageID}`,
      media,
    });
  });

  if (items.length === 0) {
    const authenticated = await fetchAuthenticatedTelegramChannel(handle);
    if (authenticated) return { items: authenticated, notices: [] };
  }
  const notices = items.length === 0
    ? [{
        id: `telegram:${handle}:no-public-history`,
        source: 'telegram',
        message: `@${handle} hides its public message history; run “npm run telegram:login” once.`,
      }]
    : [];
  return { items, notices };
}

async function authenticatedTelegramClient() {
  const credentials = readTelegramCredentials();
  if (!credentials) return undefined;
  if (!telegramClientPromise) {
    telegramClientPromise = (async () => {
      const [{ TelegramClient }, { StringSession }] = await Promise.all([
        import('telegram'),
        import('telegram/sessions/index.js'),
      ]);
      const client = new TelegramClient(
        new StringSession(credentials.session),
        credentials.apiId,
        credentials.apiHash,
        { connectionRetries: 5 },
      );
      await client.connect();
      if (!(await client.isUserAuthorized())) {
        throw new Error('Telegram session is no longer authorized');
      }
      return client;
    })().catch((error) => {
      telegramClientPromise = undefined;
      throw error;
    });
  }
  return telegramClientPromise;
}

async function fetchAuthenticatedTelegramChannel(handle) {
  const client = await authenticatedTelegramClient();
  if (!client) return undefined;
  const entity = await client.getEntity(handle);
  const messages = await client.getMessages(entity, { limit: 20 });
  const channelName = asNonEmptyString(entity.title) ?? `@${handle}`;
  return messages.flatMap((message) => {
    const id = asNonEmptyString(String(message.id));
    const date = message.date instanceof Date ? message.date : new Date(Number(message.date) * 1000);
    if (!id || !Number.isFinite(date.getTime())) return [];
    return [{
      id: `${handle}:${id}`,
      source: 'telegram',
      author: { name: channelName, handle },
      text: asNonEmptyString(message.message) ?? 'Channel update',
      publishedAt: date.toISOString(),
      url: `https://t.me/${handle}/${id}`,
      media: [],
    }];
  });
}

async function fetchTelegramTimeline(count) {
  const now = Date.now();
  if (telegramCached && isNewsSourceCacheFresh('telegram', telegramCached.fetchedAt, now)) {
    return { ...telegramCached, items: telegramCached.items.slice(0, count) };
  }
  if (telegramInFlight) {
    const result = await telegramInFlight;
    return { ...result, items: result.items.slice(0, count) };
  }

  telegramInFlight = (async () => {
    const results = await Promise.allSettled(TELEGRAM_CHANNELS.map(fetchTelegramChannel));
    const items = [];
    const notices = [];
    results.forEach((result, index) => {
      const handle = TELEGRAM_CHANNELS[index];
      if (result.status === 'fulfilled') {
        items.push(...result.value.items);
        notices.push(...result.value.notices);
      } else {
        notices.push({
          id: `telegram:${handle}:unavailable`,
          source: 'telegram',
          message: `@${handle} is temporarily unavailable.`,
        });
      }
    });
    items.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
    telegramCached = { fetchedAt: Date.now(), items, notices };
    return telegramCached;
  })();

  try {
    const result = await telegramInFlight;
    return { ...result, items: result.items.slice(0, count) };
  } finally {
    telegramInFlight = undefined;
  }
}

async function fetchXTimeline(count) {
  const now = Date.now();
  if (
    cached &&
    isNewsSourceCacheFresh('x', cached.fetchedAt, now) &&
    cached.requestedCount >= count
  ) {
    return cached.items.slice(0, count);
  }
  if (inFlight) return (await inFlight).slice(0, count);

  inFlight = (async () => {
    const bird = findBird();
    const { stdout } = await execFileAsync(
      bird,
      ['list-timeline', LIST_ID, '--count', String(count), '--json-full'],
      { timeout: 20_000, maxBuffer: 25 * 1024 * 1024 },
    );
    const payload = JSON.parse(stdout);
    const tweets = Array.isArray(payload) ? payload : payload?.tweets;
    if (!Array.isArray(tweets)) throw new Error('bird returned an unexpected timeline payload');
    const items = tweets.map(normalizeTweet).filter(Boolean);
    cached = { fetchedAt: Date.now(), requestedCount: count, items };
    return items;
  })();

  try {
    return (await inFlight).slice(0, count);
  } finally {
    inFlight = undefined;
  }
}

async function fetchDiggTimeline(count) {
  const now = Date.now();
  if (diggCached && isNewsSourceCacheFresh('digg', diggCached.fetchedAt, now)) {
    return diggCached.items.slice(0, count);
  }
  if (diggInFlight) return (await diggInFlight).slice(0, count);

  diggInFlight = (async () => {
    const items = await fetchDiggTech();
    diggCached = { fetchedAt: Date.now(), items };
    return items;
  })();

  try {
    return (await diggInFlight).slice(0, count);
  } finally {
    diggInFlight = undefined;
  }
}

async function fetchDiggSnapshot(count) {
  try {
    return { items: await fetchDiggTimeline(count), notices: [] };
  } catch {
    return {
      items: [],
      notices: [{
        id: 'digg:tech:unavailable',
        source: 'digg',
        message: 'Digg Tech is temporarily unavailable.',
      }],
    };
  }
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 16_384) throw new Error('Request body is too large');
  }
  return JSON.parse(body || '{}');
}

async function latestCombinedSnapshot(count = MAX_COUNT) {
  const [xItems, telegram, digg] = await Promise.all([
    fetchXTimeline(count),
    fetchTelegramTimeline(count),
    fetchDiggSnapshot(count),
  ]);
  return {
    items: [...xItems, ...telegram.items, ...digg.items]
      .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
      .slice(0, count),
    notices: [...telegram.notices, ...digg.notices],
    updatedAt: new Date().toISOString(),
  };
}

let polling = false;
async function pollForPushNotifications() {
  if (polling) return;
  polling = true;
  try {
    await pushService.checkReceipts();
    const snapshot = await latestCombinedSnapshot();
    await pushService.processSnapshot(snapshot.items);
    await publishNewsRelaySnapshot(snapshot);
  } catch (error) {
    console.error(`News push poll failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    polling = false;
  }
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Origin': '*',
    });
    response.end();
    return;
  }

  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? HOST}`);
  if (url.pathname === '/push/register') {
    if (request.method !== 'POST' && request.method !== 'DELETE') {
      sendJson(response, 405, { error: 'Method not allowed' });
      return;
    }
    try {
      const body = await readJsonBody(request);
      if (typeof body.expoPushToken !== 'string') throw new Error('expoPushToken is required');
      if (request.method === 'POST') {
        await pushService.register(body.expoPushToken, body.sourceIds);
      } else {
        await pushService.unregister(body.expoPushToken);
      }
      sendJson(response, 200, { ok: true });
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : 'Invalid request' });
    }
    return;
  }
  if (request.method !== 'GET') {
    sendJson(response, 405, { error: 'Method not allowed' });
    return;
  }
  if (url.pathname === '/health') {
    sendJson(response, 200, {
      ok: true,
      xSource: `list:${LIST_ID}`,
      telegramChannels: TELEGRAM_CHANNELS,
      diggSource: DIGG_TECH_URL,
      refreshIntervalsMs: NEWS_SOURCE_REFRESH_INTERVAL_MS,
      lastFetchedAt: {
        x: cached ? new Date(cached.fetchedAt).toISOString() : null,
        telegram: telegramCached ? new Date(telegramCached.fetchedAt).toISOString() : null,
        digg: diggCached ? new Date(diggCached.fetchedAt).toISOString() : null,
      },
    });
    return;
  }
  if (url.pathname !== '/feed') {
    sendJson(response, 404, { error: 'Not found' });
    return;
  }

  const source = url.searchParams.get('source') ?? 'all';
  if (!['all', 'x', 'telegram', 'digg'].includes(source)) {
    sendJson(response, 400, { error: 'source must be all, x, telegram, or digg' });
    return;
  }
  const requested = Number(url.searchParams.get('limit') ?? 40);
  const count = Number.isFinite(requested) ? Math.min(MAX_COUNT, Math.max(1, Math.floor(requested))) : 40;

  try {
    let items;
    let notices = [];
    if (source === 'x') {
      items = await fetchXTimeline(count);
    } else if (source === 'telegram') {
      const telegram = await fetchTelegramTimeline(count);
      items = telegram.items;
      notices = telegram.notices;
    } else if (source === 'digg') {
      items = await fetchDiggTimeline(count);
    } else {
      const snapshot = await latestCombinedSnapshot(count);
      items = snapshot.items;
      notices = snapshot.notices;
    }
    sendJson(response, 200, { items, notices, updatedAt: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load the X timeline';
    sendJson(response, 502, { error: message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`News feed bridge listening on http://${HOST}:${PORT}`);
  console.log(`X source: https://x.com/i/lists/${LIST_ID} via bird browser-cookie auth`);
  console.log(`Digg source: ${DIGG_TECH_URL}`);
  console.log(
    `Refresh intervals: X ${NEWS_SOURCE_REFRESH_INTERVAL_MS.x / 60_000}m, ` +
    `Telegram ${NEWS_SOURCE_REFRESH_INTERVAL_MS.telegram / 60_000}m, ` +
    `Digg ${NEWS_SOURCE_REFRESH_INTERVAL_MS.digg / 60_000}m`,
  );
  void pollForPushNotifications();
  setInterval(() => void pollForPushNotifications(), NEWS_SCHEDULER_INTERVAL_MS).unref();
});
