import {
  ALL_NEWS_NOTIFICATION_SOURCE_IDS,
  filterNewsItemsByNotificationSources,
  normalizeNewsNotificationSourceIds,
} from '../src/domain/newsNotificationSources';

const FEED_KEY = 'feed:all';
const RECEIPTS_KEY = 'push:receipts';
const TOKEN_PREFIX = 'push:token:';
const PUSH_SEND_URL = 'https://exp.host/--/api/v2/push/send';
const PUSH_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const TOKEN_PATTERN = /^(?:Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$/;
const MAX_FEED_ITEMS = 200;
const MAX_PUSH_TOKENS = 25;
const MAX_INGEST_BODY_BYTES = 2_000_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type NewsSource = 'x' | 'telegram' | 'digg' | 'paste';

interface NewsItem {
  id: string;
  source: NewsSource;
  text: string;
  publishedAt: string;
  author: { name: string; handle?: string; avatarUrl?: string };
  url?: string;
  media?: Array<{ type: 'image' | 'video'; previewUrl: string }>;
}

interface NewsNotice {
  id: string;
  source: NewsSource;
  message: string;
}

interface NewsSummarySourceReference {
  itemKey: string;
  source: NewsSource;
  title: string;
  author: string;
  publishedAt: string;
  url: string;
}

interface NewsExecutiveSummary {
  id: string;
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  headline: string;
  overview: string;
  pulse: {
    label: 'risk-on' | 'risk-off' | 'mixed' | 'calm' | 'event-driven';
    summary: string;
  };
  bullets: Array<{
    headline: string;
    summary: string;
    whyItMatters: string;
    details: string;
    sources: NewsSummarySourceReference[];
  }>;
  watchNext: string[];
  noiseSummary: string;
  analyzedItems: number;
  sourceCounts: Record<NewsSource, number>;
  model: string;
  reasoningEffort: string;
}

interface FeedSnapshot {
  items: NewsItem[];
  notices: NewsNotice[];
  executiveSummary?: NewsExecutiveSummary;
  updatedAt: string;
}

interface PushReceiptRef {
  id: string;
  tokenKey: string;
}

interface PushSubscription {
  token: string;
  sourceIds: string[];
  updatedAt: string;
}

interface ExpoPushTicket {
  status?: string;
  id?: string;
  details?: { error?: string };
}

interface ExpoPushReceipt {
  status?: string;
  details?: { error?: string };
}

function json(body: unknown, status = 200, cors = false): Response {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  if (cors) headers.set('Access-Control-Allow-Origin', '*');
  return new Response(JSON.stringify(body), { status, headers });
}

function asString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function asHttpsUrl(value: unknown): string | undefined {
  const text = asString(value, 2_048);
  if (!text) return undefined;
  try {
    return new URL(text).protocol === 'https:' ? text : undefined;
  } catch {
    return undefined;
  }
}

async function readBoundedText(request: Request, maxBytes: number): Promise<string | undefined> {
  const declaredLength = Number(request.headers.get('Content-Length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return undefined;
  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel('Request body is too large');
      return undefined;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return decoder.decode(body);
}

function normalizeItem(value: unknown): NewsItem | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Record<string, unknown>;
  const author = item.author as Record<string, unknown> | undefined;
  const id = asString(item.id, 256);
  const text = asString(item.text, 10_000);
  const publishedAt = asString(item.publishedAt, 64);
  const name = asString(author?.name, 256);
  if (
    !id ||
    !text ||
    !publishedAt ||
    !name ||
    !Number.isFinite(Date.parse(publishedAt)) ||
    (item.source !== 'x' &&
      item.source !== 'telegram' &&
      item.source !== 'digg' &&
      item.source !== 'paste')
  ) {
    return undefined;
  }

  const media = Array.isArray(item.media)
    ? item.media.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return [];
        const candidate = entry as Record<string, unknown>;
        const previewUrl = asHttpsUrl(candidate.previewUrl);
        if (!previewUrl || (candidate.type !== 'image' && candidate.type !== 'video')) return [];
        const type: 'image' | 'video' = candidate.type;
        return [{ type, previewUrl }];
      }).slice(0, 4)
    : undefined;

  return {
    id,
    source: item.source,
    text,
    publishedAt: new Date(publishedAt).toISOString(),
    author: {
      name,
      handle: asString(author?.handle, 256),
      avatarUrl: asHttpsUrl(author?.avatarUrl),
    },
    url: asHttpsUrl(item.url),
    media,
  };
}

function normalizeNotice(value: unknown): NewsNotice | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const notice = value as Record<string, unknown>;
  const id = asString(notice.id, 256);
  const message = asString(notice.message, 1_000);
  if (
    !id ||
    !message ||
    (notice.source !== 'x' &&
      notice.source !== 'telegram' &&
      notice.source !== 'digg' &&
      notice.source !== 'paste')
  ) {
    return undefined;
  }
  return { id, source: notice.source, message };
}

function isNewsSource(value: unknown): value is NewsSource {
  return value === 'x' || value === 'telegram' || value === 'digg' || value === 'paste';
}

function normalizeSummarySource(value: unknown): NewsSummarySourceReference | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;
  const itemKey = asString(source.itemKey, 300);
  const title = asString(source.title, 180);
  const author = asString(source.author, 180);
  const publishedAt = asString(source.publishedAt, 64);
  const url = asHttpsUrl(source.url);
  if (
    !itemKey || !isNewsSource(source.source) || !title || !author || !publishedAt || !url ||
    !Number.isFinite(Date.parse(publishedAt))
  ) {
    return undefined;
  }
  return {
    itemKey,
    source: source.source,
    title,
    author,
    publishedAt: new Date(publishedAt).toISOString(),
    url,
  };
}

function normalizeExecutiveSummary(value: unknown): NewsExecutiveSummary | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const summary = value as Record<string, unknown>;
  const pulse = summary.pulse as Record<string, unknown> | undefined;
  const id = asString(summary.id, 160);
  const generatedAt = asString(summary.generatedAt, 64);
  const windowStart = asString(summary.windowStart, 64);
  const windowEnd = asString(summary.windowEnd, 64);
  const headline = asString(summary.headline, 120);
  const overview = asString(summary.overview, 700);
  const pulseLabel = asString(pulse?.label, 32);
  const pulseSummary = asString(pulse?.summary, 400);
  const validPulseLabels = ['risk-on', 'risk-off', 'mixed', 'calm', 'event-driven'] as const;
  if (
    !id || !generatedAt || !windowStart || !windowEnd || !headline || !overview ||
    !pulseLabel || !validPulseLabels.includes(pulseLabel as (typeof validPulseLabels)[number]) ||
    !pulseSummary || !Number.isFinite(Date.parse(generatedAt)) ||
    !Number.isFinite(Date.parse(windowStart)) || !Number.isFinite(Date.parse(windowEnd)) ||
    !Array.isArray(summary.bullets)
  ) {
    return undefined;
  }

  const bullets = summary.bullets.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const bullet = entry as Record<string, unknown>;
    const bulletHeadline = asString(bullet.headline, 110);
    const bulletSummary = asString(bullet.summary, 360);
    const whyItMatters = asString(bullet.whyItMatters, 420);
    const details = asString(bullet.details, 900);
    const sources = Array.isArray(bullet.sources)
      ? bullet.sources.map(normalizeSummarySource).filter((source): source is NewsSummarySourceReference => Boolean(source)).slice(0, 6)
      : [];
    if (!bulletHeadline || !bulletSummary || !whyItMatters || !details || sources.length === 0) {
      return [];
    }
    return [{ headline: bulletHeadline, summary: bulletSummary, whyItMatters, details, sources }];
  }).slice(0, 7);
  if (bullets.length === 0) return undefined;

  const watchNext = Array.isArray(summary.watchNext)
    ? summary.watchNext.flatMap((entry) => asString(entry, 240) ?? []).slice(0, 5)
    : [];
  const noiseSummary = asString(summary.noiseSummary, 400);
  if (!noiseSummary) return undefined;
  const sourceCountsValue = summary.sourceCounts as Record<string, unknown> | undefined;
  const sourceCounts = Object.fromEntries(
    (['x', 'telegram', 'digg', 'paste'] as const).map((source) => [
      source,
      typeof sourceCountsValue?.[source] === 'number' && Number.isFinite(sourceCountsValue[source])
        ? Math.max(0, Math.floor(sourceCountsValue[source]))
        : 0,
    ]),
  ) as Record<NewsSource, number>;
  return {
    id,
    generatedAt: new Date(generatedAt).toISOString(),
    windowStart: new Date(windowStart).toISOString(),
    windowEnd: new Date(windowEnd).toISOString(),
    headline,
    overview,
    pulse: {
      label: pulseLabel as NewsExecutiveSummary['pulse']['label'],
      summary: pulseSummary,
    },
    bullets,
    watchNext,
    noiseSummary,
    analyzedItems:
      typeof summary.analyzedItems === 'number' && Number.isFinite(summary.analyzedItems)
        ? Math.max(0, Math.floor(summary.analyzedItems))
        : 0,
    sourceCounts,
    model: asString(summary.model, 80) ?? 'gpt-5.6-sol',
    reasoningEffort: asString(summary.reasoningEffort, 32) ?? 'xhigh',
  };
}

function normalizeSnapshot(value: unknown): FeedSnapshot | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const payload = value as Record<string, unknown>;
  if (!Array.isArray(payload.items)) return undefined;
  const items = payload.items
    .map(normalizeItem)
    .filter((item): item is NewsItem => item !== undefined)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, MAX_FEED_ITEMS);
  const notices = Array.isArray(payload.notices)
    ? payload.notices
        .map(normalizeNotice)
        .filter((notice): notice is NewsNotice => notice !== undefined)
        .slice(0, 20)
    : [];
  return {
    items,
    notices,
    executiveSummary: normalizeExecutiveSummary(payload.executiveSummary),
    updatedAt: new Date().toISOString(),
  };
}

function itemKey(item: NewsItem): string {
  return `${item.source}:${item.id}`;
}

async function authorized(request: Request, env: Env): Promise<boolean> {
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return false;
  const message = encoder.encode('tradingview-news-relay-access-check');
  const [expectedKey, suppliedKey] = await Promise.all(
    [env.APP_ACCESS_TOKEN, authorization.slice(7)].map((secret) =>
      crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify'],
      ),
    ),
  );
  const suppliedSignature = await crypto.subtle.sign('HMAC', suppliedKey, message);
  return crypto.subtle.verify('HMAC', expectedKey, suppliedSignature, message);
}

function bytesFromHex(value: string): Uint8Array<ArrayBuffer> | undefined {
  if (!/^[0-9a-f]{64}$/i.test(value)) return undefined;
  const bytes = new Uint8Array(new ArrayBuffer(value.length / 2));
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

async function verifyIngest(request: Request, env: Env, body: string): Promise<boolean> {
  const timestamp = request.headers.get('X-News-Timestamp');
  const signature = bytesFromHex(request.headers.get('X-News-Signature') ?? '');
  if (!timestamp || !signature) return false;
  const unixSeconds = Number(timestamp);
  if (!Number.isFinite(unixSeconds) || Math.abs(Date.now() / 1_000 - unixSeconds) > 300) {
    return false;
  }
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(env.BRIDGE_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify(
    'HMAC',
    key,
    signature,
    encoder.encode(`${timestamp}.${body}`),
  );
}

async function tokenKey(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token));
  return `${TOKEN_PREFIX}${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}

function parseSubscription(raw: string): PushSubscription | undefined {
  if (TOKEN_PATTERN.test(raw)) {
    return {
      token: raw,
      sourceIds: [...ALL_NEWS_NOTIFICATION_SOURCE_IDS],
      updatedAt: new Date(0).toISOString(),
    };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const value = parsed as Record<string, unknown>;
    if (typeof value.token !== 'string' || !TOKEN_PATTERN.test(value.token)) return undefined;
    const sourceIds = normalizeNewsNotificationSourceIds(value.sourceIds);
    if (sourceIds.length === 0) return undefined;
    return {
      token: value.token,
      sourceIds,
      updatedAt: asString(value.updatedAt, 64) ?? new Date(0).toISOString(),
    };
  } catch {
    return undefined;
  }
}

async function listSubscriptions(
  env: Env,
): Promise<Array<{ key: string; subscription: PushSubscription }>> {
  const listed = await env.NEWS_RELAY_KV.list({ prefix: TOKEN_PREFIX, limit: MAX_PUSH_TOKENS });
  const entries = await Promise.all(
    listed.keys.map(async ({ name }) => ({ key: name, raw: await env.NEWS_RELAY_KV.get(name) })),
  );
  return entries.flatMap((entry) => {
    const subscription = entry.raw ? parseSubscription(entry.raw) : undefined;
    return subscription ? [{ key: entry.key, subscription }] : [];
  });
}

function compactBody(text: string): string {
  const body = text.replace(/\s+/g, ' ').trim();
  return body.length > 180 ? `${body.slice(0, 177)}…` : body;
}

async function checkReceipts(env: Env): Promise<void> {
  const refs = await env.NEWS_RELAY_KV.get<PushReceiptRef[]>(RECEIPTS_KEY, 'json');
  if (!Array.isArray(refs) || refs.length === 0) return;
  const response = await fetch(PUSH_RECEIPTS_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: refs.map(({ id }) => id) }),
  });
  if (!response.ok) throw new Error(`Expo receipt service returned ${response.status}`);
  const payload = (await response.json()) as { data?: Record<string, ExpoPushReceipt> };
  const pending: PushReceiptRef[] = [];
  for (const ref of refs) {
    const receipt = payload.data?.[ref.id];
    if (!receipt) {
      pending.push(ref);
    } else if (receipt.details?.error === 'DeviceNotRegistered') {
      await env.NEWS_RELAY_KV.delete(ref.tokenKey);
    }
  }
  if (pending.length > 0) await env.NEWS_RELAY_KV.put(RECEIPTS_KEY, JSON.stringify(pending));
  else await env.NEWS_RELAY_KV.delete(RECEIPTS_KEY);
}

async function sendNewsPushes(env: Env, items: NewsItem[]): Promise<void> {
  await checkReceipts(env);
  if (items.length === 0) return;
  const subscriptions = await listSubscriptions(env);
  if (subscriptions.length === 0) return;

  const messages = subscriptions.flatMap(({ key, subscription }) => {
    const allowedItems = filterNewsItemsByNotificationSources(items, subscription.sourceIds);
    const selected = allowedItems.slice(0, 3);
    const notifications = selected.map((item) => ({
      sound: 'default',
      title: `${item.source === 'x' ? 'X' : 'Telegram'} · ${item.author.name}`,
      body: compactBody(item.text),
      data: { type: 'news', screen: '/news', itemUrl: item.url, itemId: itemKey(item) },
    }));
    if (allowedItems.length > selected.length) {
      notifications.push({
        sound: 'default',
        title: `${allowedItems.length - selected.length} more selected news updates`,
        body: 'Open the News tab to see the latest posts from your alert sources.',
        data: { type: 'news', screen: '/news', itemUrl: undefined, itemId: 'news:summary' },
      });
    }
    return notifications.map((notification) => ({
      key,
      token: subscription.token,
      message: { to: subscription.token, ...notification },
    }));
  });
  if (messages.length === 0) return;
  const response = await fetch(PUSH_SEND_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(messages.map(({ message }) => message)),
  });
  if (!response.ok) throw new Error(`Expo push service returned ${response.status}`);
  const payload = (await response.json()) as { data?: ExpoPushTicket | ExpoPushTicket[] };
  const tickets = Array.isArray(payload.data) ? payload.data : payload.data ? [payload.data] : [];
  const refs: PushReceiptRef[] = [];
  for (const [index, ticket] of tickets.entries()) {
    const target = messages[index];
    if (!target) continue;
    if (ticket.status === 'ok' && ticket.id) refs.push({ id: ticket.id, tokenKey: target.key });
    else if (ticket.details?.error === 'DeviceNotRegistered') {
      await env.NEWS_RELAY_KV.delete(target.key);
    }
  }
  if (refs.length > 0) await env.NEWS_RELAY_KV.put(RECEIPTS_KEY, JSON.stringify(refs));
}

async function handleFeed(request: Request, env: Env): Promise<Response> {
  const snapshot = await env.NEWS_RELAY_KV.get<FeedSnapshot>(FEED_KEY, 'json');
  if (!snapshot) return json({ error: 'The news bridge has not published yet.' }, 503, true);
  const url = new URL(request.url);
  const source = url.searchParams.get('source') ?? 'all';
  if (
    source !== 'all' &&
    source !== 'x' &&
    source !== 'telegram' &&
    source !== 'digg' &&
    source !== 'paste'
  ) {
    return json({ error: 'source must be all, x, telegram, digg, or paste' }, 400, true);
  }
  const requested = Number(url.searchParams.get('limit') ?? 40);
  const limit = Number.isFinite(requested) ? Math.min(100, Math.max(1, Math.floor(requested))) : 40;
  const items = snapshot.items
    .filter((item) => source === 'all' || item.source === source)
    .slice(0, limit);
  const notices = snapshot.notices.filter((notice) => source === 'all' || notice.source === source);
  return json({
    items,
    notices,
    executiveSummary: source === 'all' ? snapshot.executiveSummary : undefined,
    updatedAt: snapshot.updatedAt,
  }, 200, true);
}

async function handleRegistration(request: Request, env: Env): Promise<Response> {
  const contentLength = Number(request.headers.get('Content-Length') ?? 0);
  if (contentLength > 16_384) return json({ error: 'Request body is too large' }, 413, true);
  const payload = (await request.json()) as { expoPushToken?: unknown; sourceIds?: unknown };
  if (typeof payload.expoPushToken !== 'string' || !TOKEN_PATTERN.test(payload.expoPushToken)) {
    return json({ error: 'Invalid Expo push token' }, 400, true);
  }
  if (payload.sourceIds !== undefined && !Array.isArray(payload.sourceIds)) {
    return json({ error: 'sourceIds must be an array' }, 400, true);
  }
  const key = await tokenKey(payload.expoPushToken);
  if (request.method === 'POST') {
    const sourceIds = normalizeNewsNotificationSourceIds(payload.sourceIds);
    if (sourceIds.length === 0) {
      return json({ error: 'Choose at least one notification source' }, 400, true);
    }
    const subscription: PushSubscription = {
      token: payload.expoPushToken,
      sourceIds,
      updatedAt: new Date().toISOString(),
    };
    await env.NEWS_RELAY_KV.put(key, JSON.stringify(subscription));
  } else {
    await env.NEWS_RELAY_KV.delete(key);
  }
  return json({ ok: true }, 200, true);
}

async function handleIngest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await readBoundedText(request, MAX_INGEST_BODY_BYTES);
  if (body === undefined) return json({ error: 'Request body is too large' }, 413);
  if (!(await verifyIngest(request, env, body))) return json({ error: 'Unauthorized' }, 401);
  const snapshot = normalizeSnapshot(JSON.parse(body) as unknown);
  if (!snapshot) return json({ error: 'Invalid snapshot' }, 400);

  const previous = await env.NEWS_RELAY_KV.get<FeedSnapshot>(FEED_KEY, 'json');
  if (!snapshot.executiveSummary && previous?.executiveSummary) {
    snapshot.executiveSummary = previous.executiveSummary;
  }
  await env.NEWS_RELAY_KV.put(FEED_KEY, JSON.stringify(snapshot));
  const seen = new Set(previous?.items.map(itemKey) ?? snapshot.items.map(itemKey));
  const fresh = snapshot.items.filter((item) => !seen.has(itemKey(item)));
  ctx.waitUntil(
    sendNewsPushes(env, fresh).catch((error: unknown) => {
      console.error(JSON.stringify({ event: 'push_failed', message: String(error) }));
    }),
  );
  console.log(JSON.stringify({ event: 'ingest', items: snapshot.items.length, fresh: fresh.length }));
  return json({ ok: true, items: snapshot.items.length, fresh: fresh.length });
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Headers': 'Authorization, Content-Type',
            'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
      if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true });
      if (url.pathname === '/ingest' && request.method === 'POST') {
        return handleIngest(request, env, ctx);
      }
      if (!(await authorized(request, env))) return json({ error: 'Unauthorized' }, 401, true);
      if (url.pathname === '/feed' && request.method === 'GET') return handleFeed(request, env);
      if (
        url.pathname === '/push/register' &&
        (request.method === 'POST' || request.method === 'DELETE')
      ) {
        return handleRegistration(request, env);
      }
      return json({ error: 'Not found' }, 404, true);
    } catch (error) {
      console.error(JSON.stringify({ event: 'request_failed', message: String(error) }));
      return json({ error: 'Internal server error' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
