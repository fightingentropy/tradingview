import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const STATE_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'TradingView News');
const TOKENS_FILE = path.join(STATE_DIR, 'push-tokens.json');
const SEEN_FILE = path.join(STATE_DIR, 'seen-news.json');
const PUSH_SEND_URL = 'https://exp.host/--/api/v2/push/send';
const PUSH_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const TOKEN_PATTERN = /^(?:Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$/;

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function atomicWriteJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

function itemKey(item) {
  return `${item.source}:${item.id}`;
}

function compactBody(text) {
  const body = String(text ?? '').replace(/\s+/g, ' ').trim();
  return body.length > 180 ? `${body.slice(0, 177)}…` : body;
}

export class NewsPushService {
  subscriptions = new Map();
  seen = new Set();
  initialized = false;
  receipts = new Map();

  constructor({ xListId, telegramChannels }) {
    this.xSourceId = `x:list:${xListId}`;
    this.validSourceIds = new Set([
      this.xSourceId,
      ...telegramChannels.map((handle) => `telegram:${handle.toLowerCase()}`),
    ]);
  }

  normalizeSourceIds(value) {
    if (!Array.isArray(value)) return [...this.validSourceIds];
    return [...new Set(value.filter((id) => typeof id === 'string'))].filter((id) =>
      this.validSourceIds.has(id),
    );
  }

  sourceIdForItem(item) {
    if (item?.source === 'x') return this.xSourceId;
    const handle = String(item?.author?.handle ?? '').replace(/^@/, '').toLowerCase();
    const sourceId = handle ? `telegram:${handle}` : undefined;
    return sourceId && this.validSourceIds.has(sourceId) ? sourceId : undefined;
  }

  async initialize() {
    if (this.initialized) return;
    const tokens = await readJson(TOKENS_FILE, []);
    const seen = await readJson(SEEN_FILE, []);
    if (Array.isArray(tokens)) {
      for (const value of tokens) {
        if (typeof value === 'string' && TOKEN_PATTERN.test(value)) {
          this.subscriptions.set(value, [...this.validSourceIds]);
          continue;
        }
        if (!value || typeof value !== 'object' || !TOKEN_PATTERN.test(value.token)) continue;
        const sourceIds = this.normalizeSourceIds(value.sourceIds);
        if (sourceIds.length > 0) this.subscriptions.set(value.token, sourceIds);
      }
    }
    if (Array.isArray(seen)) for (const key of seen) if (typeof key === 'string') this.seen.add(key);
    this.initialized = true;
  }

  async register(token, sourceIds) {
    await this.initialize();
    if (!TOKEN_PATTERN.test(token)) throw new Error('Invalid Expo push token');
    if (sourceIds !== undefined && !Array.isArray(sourceIds)) {
      throw new Error('sourceIds must be an array');
    }
    const normalizedSourceIds = this.normalizeSourceIds(sourceIds);
    if (normalizedSourceIds.length === 0) throw new Error('Choose at least one notification source');
    this.subscriptions.set(token, normalizedSourceIds);
    await this.saveTokens();
  }

  async unregister(token) {
    await this.initialize();
    this.subscriptions.delete(token);
    await this.saveTokens();
  }

  async saveTokens() {
    await atomicWriteJson(
      TOKENS_FILE,
      [...this.subscriptions].map(([token, sourceIds]) => ({ token, sourceIds })),
    );
  }

  async processSnapshot(items) {
    await this.initialize();
    const keys = items.map(itemKey);
    if (this.seen.size === 0) {
      this.seen = new Set(keys);
      await atomicWriteJson(SEEN_FILE, keys.slice(0, 1000));
      return;
    }

    const fresh = items.filter((item) => !this.seen.has(itemKey(item)));
    this.seen = new Set([...keys, ...this.seen].slice(0, 1000));
    await atomicWriteJson(SEEN_FILE, [...this.seen]);
    if (fresh.length === 0 || this.subscriptions.size === 0) return;

    await this.sendItems(fresh);
  }

  async sendItems(items) {
    const messages = [...this.subscriptions].flatMap(([to, sourceIds]) => {
      const allowed = new Set(sourceIds);
      const allowedItems = items.filter((item) => {
        const sourceId = this.sourceIdForItem(item);
        return sourceId ? allowed.has(sourceId) : false;
      });
      const selected = allowedItems.slice(0, 3);
      const notifications = selected.map((item) => ({
        sound: 'default',
        title: `${item.source === 'x' ? 'X' : 'Telegram'} · ${item.author.name}`,
        body: compactBody(item.text),
        data: {
          type: 'news',
          screen: '/news',
          itemUrl: item.url,
          itemId: itemKey(item),
        },
      }));
      if (allowedItems.length > selected.length) {
        notifications.push({
          sound: 'default',
          title: `${allowedItems.length - selected.length} more selected news updates`,
          body: 'Open the News tab to see the latest posts from your alert sources.',
          data: { type: 'news', screen: '/news', itemId: 'news:summary' },
        });
      }
      return notifications.map((notification) => ({ to, ...notification }));
    });
    if (messages.length === 0) return;
    const response = await fetch(PUSH_SEND_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Expo Push Service returned ${response.status}`);
    const payload = await response.json();
    const tickets = Array.isArray(payload.data) ? payload.data : [payload.data];
    tickets.forEach((ticket, index) => {
      const token = messages[index]?.to;
      if (ticket?.status === 'ok' && typeof ticket.id === 'string' && token) {
        this.receipts.set(ticket.id, token);
      } else if (ticket?.details?.error === 'DeviceNotRegistered' && token) {
        this.subscriptions.delete(token);
      }
    });
    await this.saveTokens();
  }

  async checkReceipts() {
    if (this.receipts.size === 0) return;
    const ids = [...this.receipts.keys()].slice(0, 300);
    const response = await fetch(PUSH_RECEIPTS_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return;
    const payload = await response.json();
    for (const id of ids) {
      const receipt = payload.data?.[id];
      if (!receipt) continue;
      const token = this.receipts.get(id);
      if (receipt.details?.error === 'DeviceNotRegistered' && token) {
        this.subscriptions.delete(token);
      }
      this.receipts.delete(id);
    }
    await this.saveTokens();
  }
}
