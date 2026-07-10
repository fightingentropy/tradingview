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
  tokens = new Set();
  seen = new Set();
  initialized = false;
  receipts = new Map();

  async initialize() {
    if (this.initialized) return;
    const tokens = await readJson(TOKENS_FILE, []);
    const seen = await readJson(SEEN_FILE, []);
    if (Array.isArray(tokens)) {
      for (const token of tokens) if (TOKEN_PATTERN.test(token)) this.tokens.add(token);
    }
    if (Array.isArray(seen)) for (const key of seen) if (typeof key === 'string') this.seen.add(key);
    this.initialized = true;
  }

  async register(token) {
    await this.initialize();
    if (!TOKEN_PATTERN.test(token)) throw new Error('Invalid Expo push token');
    this.tokens.add(token);
    await this.saveTokens();
  }

  async unregister(token) {
    await this.initialize();
    this.tokens.delete(token);
    await this.saveTokens();
  }

  async saveTokens() {
    await atomicWriteJson(TOKENS_FILE, [...this.tokens]);
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
    if (fresh.length === 0 || this.tokens.size === 0) return;

    await this.sendItems(fresh);
  }

  async sendItems(items) {
    const selected = items.slice(0, 3);
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
    if (items.length > selected.length) {
      notifications.push({
        sound: 'default',
        title: `${items.length - selected.length} more news updates`,
        body: 'Open the News tab to see the latest X and Telegram posts.',
        data: { type: 'news', screen: '/news', itemId: 'news:summary' },
      });
    }

    const messages = [...this.tokens].flatMap((to) =>
      notifications.map((notification) => ({ to, ...notification })),
    );
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
        this.tokens.delete(token);
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
      if (receipt.details?.error === 'DeviceNotRegistered' && token) this.tokens.delete(token);
      this.receipts.delete(id);
    }
    await this.saveTokens();
  }
}
