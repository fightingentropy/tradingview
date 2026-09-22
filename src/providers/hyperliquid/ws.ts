import type { HlNetwork } from '@/lib/hyperliquid/info';
import { acceptAccountSnapshot, displayReadCache } from '@/lib/hyperliquid/displayReadCache';
/**
 * Single multiplexed Hyperliquid websocket shared across the app.
 * Handles auto-reconnect, periodic ping, AppState pause/resume, and routing of
 * `allMids` and `candle` messages to subscribers. Subscriptions persist across
 * reconnects so the feed self-heals after silent drops.
 */
import { AppState, type AppStateStatus } from 'react-native';
import type { FeedConnectionStatus } from '../types';

import type { HlCandle } from './rest';
import { HL_WS_URL } from './rest';

type MidsHandler = (mids: Record<string, string>) => void;
type CandleHandler = (candle: HlCandle) => void;

interface Entry {
  /** Subscription object sent to the server. */
  sub: Record<string, unknown>;
  handlers: Set<(data: unknown) => void>;
}

const PING_INTERVAL = 15_000;
const MESSAGE_TIMEOUT = 45_000;
const CONNECT_TIMEOUT = 15_000;
const MAX_BACKOFF = 15_000;

class HyperliquidSocket {
  private ws: WebSocket | null = null;
  private entries = new Map<string, Entry>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private backgrounded = false;
  private status: FeedConnectionStatus = 'idle';
  private statusHandlers = new Set<(status: FeedConnectionStatus) => void>();
  private lastMessageAt = 0;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;

  subscribeConnection(handler: (status: FeedConnectionStatus) => void): () => void {
    this.statusHandlers.add(handler);
    handler(this.status);
    return () => { this.statusHandlers.delete(handler); };
  }

  private setStatus(status: FeedConnectionStatus) {
    if (this.status === status) return;
    this.status = status;
    this.statusHandlers.forEach((handler) => handler(status));
  }

  constructor(private url = HL_WS_URL) {
    AppState.addEventListener('change', this.onAppState);
  }

  private onAppState = (state: AppStateStatus) => {
    if (state === 'active') {
      this.backgrounded = false;
      if (this.entries.size > 0) this.connect();
    } else if (state === 'background') {
      this.backgrounded = true;
      this.teardown();
      this.setStatus('paused');
    }
  };

  private subKey(sub: Record<string, unknown>): string {
    if (sub.type === 'allMids') return `allMids:${(sub.dex as string) ?? ''}`;
    if (sub.type === 'spotState' || sub.type === 'allDexsClearinghouseState') return `${sub.type}:${String(sub.user).toLowerCase()}`;
    if (sub.type === 'candle') return `candle:${sub.coin}:${sub.interval}`;
    return JSON.stringify(sub);
  }

  subscribe(sub: Record<string, unknown>, handler: (data: unknown) => void): () => void {
    const key = this.subKey(sub);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { sub, handlers: new Set() };
      this.entries.set(key, entry);
      this.send({ method: 'subscribe', subscription: sub });
    }
    entry.handlers.add(handler);
    this.connect();

    return () => {
      const e = this.entries.get(key);
      if (!e) return;
      e.handlers.delete(handler);
      if (e.handlers.size === 0) {
        this.entries.delete(key);
        this.send({ method: 'unsubscribe', subscription: sub });
      }
      if (this.entries.size === 0) {
        this.teardown();
        this.setStatus('idle');
      }
    };
  }

  private connect() {
    if (this.backgrounded || this.entries.size === 0) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.setStatus(this.attempts > 0 ? 'reconnecting' : 'connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;
    this.connectTimer = setTimeout(() => this.reconnect(ws), CONNECT_TIMEOUT);

    ws.onopen = () => {
      if (this.ws !== ws) return;
      if (this.connectTimer) clearTimeout(this.connectTimer);
      this.connectTimer = null;
      this.attempts = 0;
      this.lastMessageAt = Date.now();
      // Re-send every active subscription after a (re)connect.
      this.entries.forEach((entry) => {
        ws.send(JSON.stringify({ method: 'subscribe', subscription: entry.sub }));
      });
      this.startPing();
      this.setStatus('connected');
    };

    ws.onmessage = (event) => {
      if (this.ws !== ws) return;
      try {
        this.lastMessageAt = Date.now();
        this.route(JSON.parse(event.data as string));
      } catch {
        // ignore malformed frames
      }
    };

    ws.onerror = () => {
      this.reconnect(ws);
    };

    ws.onclose = () => {
      this.reconnect(ws);
    };
  }

  private reconnect(ws: WebSocket) {
    if (this.ws !== ws) return;
    this.teardown();
    this.scheduleReconnect();
  }

  private route(msg: { channel?: string; data?: unknown }) {
    if (!msg || !msg.channel) return;
    if (msg.channel === 'spotState' || msg.channel === 'allDexsClearinghouseState') {
      const user = (msg.data as { user?: unknown })?.user;
      if (typeof user !== 'string') return;
      this.entries.get(`${msg.channel}:${user.toLowerCase()}`)?.handlers.forEach(h => h(msg.data));
    } else if (msg.channel === 'allMids') {
      const mids = (msg.data as { mids?: Record<string, string> })?.mids;
      if (!mids) return;
      this.entries.forEach((entry, key) => {
        if (key.startsWith('allMids:')) entry.handlers.forEach((h) => h(mids));
      });
    } else if (msg.channel === 'candle') {
      const c = msg.data as HlCandle;
      const entry = this.entries.get(`candle:${c.s}:${c.i}`);
      entry?.handlers.forEach((h) => h(c));
    }
  }

  private send(obj: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  private startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (Date.now() - this.lastMessageAt >= MESSAGE_TIMEOUT) {
        if (this.ws) this.reconnect(this.ws);
      } else {
        this.send({ method: 'ping' });
      }
    }, PING_INTERVAL);
  }

  private stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect() {
    if (this.backgrounded || this.entries.size === 0 || this.reconnectTimer) return;
    this.setStatus('reconnecting');
    const delay = Math.min(MAX_BACKOFF, 500 * 2 ** this.attempts);
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private teardown() {
    this.stopPing();
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
  }
}

export const hlSocket = new HyperliquidSocket();

// ----- typed helpers -----

export function subscribeAllMids(dexes: (string | undefined)[], onMids: MidsHandler): () => void {
  const unsubs = dexes.map((dex) =>
    hlSocket.subscribe({ type: 'allMids', ...(dex ? { dex } : {}) }, (data) =>
      onMids(data as Record<string, string>),
    ),
  );
  return () => unsubs.forEach((u) => u());
}

export function subscribeCandle(
  coin: string,
  interval: string,
  onCandle: CandleHandler,
): () => void {
  return hlSocket.subscribe({ type: 'candle', coin, interval }, (data) => onCandle(data as HlCandle));
}

let testnetSocket: HyperliquidSocket | undefined;
const accountFeeds = new Map<string, { users: number; stop: () => void }>();

/** Reuse the market socket while an account screen or order ticket is visible. */
export function subscribeAccountDisplay(network: HlNetwork, user: string): () => void {
  const address = user.toLowerCase();
  const key = `${network}:${address}`;
  let feed = accountFeeds.get(key);
  if (!feed) {
    const socket = network === 'mainnet' ? hlSocket
      : testnetSocket ??= new HyperliquidSocket('wss://api.hyperliquid-testnet.xyz/ws');
    const status = socket.subscribeConnection(value => {
      if (value !== 'connected') displayReadCache.invalidateAccount(network, address);
    });
    const subscriptions = ['allDexsClearinghouseState', 'spotState'].map(type =>
      socket.subscribe({ type, user: address }, data => acceptAccountSnapshot(network, address, type, data)));
    feed = { users: 0, stop: () => {
      status(); subscriptions.forEach(unsubscribe => unsubscribe());
      displayReadCache.invalidateAccount(network, address);
    } };
    accountFeeds.set(key, feed);
  }
  feed.users++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--feed.users === 0) { feed.stop(); accountFeeds.delete(key); }
  };
}
