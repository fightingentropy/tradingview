import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { NewsItem } from '../src/domain/news.ts';
import { buildNewsPushNotificationContent } from '../src/domain/newsNotificationSources.ts';

interface ExpoPushTicket {
  status?: string;
  id?: unknown;
  details?: { error?: string };
}

interface ExpoPushReceipt {
  details?: { error?: string };
}

const STATE_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'TradingView News');
const TOKENS_FILE = path.join(STATE_DIR, 'push-tokens.json');
const SEEN_FILE = path.join(STATE_DIR, 'seen-news.json');
const PUSH_SEND_URL = 'https://exp.host/--/api/v2/push/send';
const PUSH_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const TOKEN_PATTERN = /^(?:Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$/;

async function readJson(file: string, fallback: unknown): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function atomicWriteJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

function itemKey(item: Pick<NewsItem, 'source' | 'id'>): string {
  return `${item.source}:${item.id}`;
}

export class NewsPushService {
  subscriptions = new Map<string, string[]>();
  seen = new Set<string>();
  initialized = false;
  receipts = new Map<string, string>();
  xSourceId: string;
  validSourceIds: Set<string>;

  constructor({ xListId, telegramChannels }: { xListId: string; telegramChannels: readonly string[] }) {
    this.xSourceId = `x:list:${xListId}`;
    this.validSourceIds = new Set([
      this.xSourceId,
      ...telegramChannels.map((handle) => `telegram:${handle.toLowerCase()}`),
    ]);
  }

  normalizeSourceIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [...this.validSourceIds];
    return [...new Set(value.filter((id): id is string => typeof id === 'string'))].filter((id) =>
      this.validSourceIds.has(id),
    );
  }

  sourceIdForItem(item: Pick<NewsItem, 'source' | 'author'> | undefined): string | undefined {
    if (item?.source === 'x') return this.xSourceId;
    const handle = String(item?.author?.handle ?? '').replace(/^@/, '').toLowerCase();
    const sourceId = handle ? `telegram:${handle}` : undefined;
    return sourceId && this.validSourceIds.has(sourceId) ? sourceId : undefined;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    const tokens = await readJson(TOKENS_FILE, []);
    const seen = await readJson(SEEN_FILE, []);
    if (Array.isArray(tokens)) {
      for (const value of tokens) {
        if (typeof value === 'string' && TOKEN_PATTERN.test(value)) {
          this.subscriptions.set(value, [...this.validSourceIds]);
          continue;
        }
        if (!value || typeof value !== 'object') continue;
        const { token, sourceIds: stored } = value as { token?: unknown; sourceIds?: unknown };
        if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) continue;
        const sourceIds = this.normalizeSourceIds(stored);
        if (sourceIds.length > 0) this.subscriptions.set(token, sourceIds);
      }
    }
    if (Array.isArray(seen)) for (const key of seen) if (typeof key === 'string') this.seen.add(key);
    this.initialized = true;
  }

  async register(token: string, sourceIds: unknown): Promise<void> {
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

  async unregister(token: string): Promise<void> {
    await this.initialize();
    this.subscriptions.delete(token);
    await this.saveTokens();
  }

  async saveTokens(): Promise<void> {
    await atomicWriteJson(
      TOKENS_FILE,
      [...this.subscriptions].map(([token, sourceIds]) => ({ token, sourceIds })),
    );
  }

  async processSnapshot(items: NewsItem[]): Promise<void> {
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

  async sendItems(items: NewsItem[]): Promise<void> {
    const messages = [...this.subscriptions].flatMap(([to, sourceIds]) => {
      const allowed = new Set(sourceIds);
      const allowedItems = items.filter((item) => {
        const sourceId = this.sourceIdForItem(item);
        return sourceId ? allowed.has(sourceId) : false;
      });
      const notification = buildNewsPushNotificationContent(allowedItems);
      return notification
        ? [{
            to,
            sound: 'default',
            title: notification.title,
            body: notification.body,
            data: {
              type: 'news',
              screen: '/news',
              itemUrl: notification.itemUrl,
              itemId: notification.itemId,
            },
          }]
        : [];
    });
    if (messages.length === 0) return;
    const response = await fetch(PUSH_SEND_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Expo Push Service returned ${response.status}`);
    const payload = await response.json() as { data?: ExpoPushTicket | ExpoPushTicket[] };
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

  async checkReceipts(): Promise<void> {
    if (this.receipts.size === 0) return;
    const ids = [...this.receipts.keys()].slice(0, 300);
    const response = await fetch(PUSH_RECEIPTS_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return;
    const payload = await response.json() as { data?: Record<string, ExpoPushReceipt | undefined> };
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
