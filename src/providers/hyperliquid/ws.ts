/**
 * Single multiplexed Hyperliquid websocket shared across the app.
 * Handles auto-reconnect, periodic ping, AppState pause/resume, and routing of
 * `allMids` and `candle` messages to subscribers. Subscriptions persist across
 * reconnects so the feed self-heals after silent drops.
 */
import { AppState, type AppStateStatus } from 'react-native';

import type { HlCandle } from './rest';
import { HL_WS_URL } from './rest';

type MidsHandler = (mids: Record<string, string>) => void;
type CandleHandler = (candle: HlCandle) => void;

interface Entry {
  /** Subscription object sent to the server. */
  sub: Record<string, unknown>;
  handlers: Set<(data: unknown) => void>;
}

const PING_INTERVAL = 50_000;
const MAX_BACKOFF = 15_000;

class HyperliquidSocket {
  private ws: WebSocket | null = null;
  private entries = new Map<string, Entry>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private backgrounded = false;

  constructor() {
    AppState.addEventListener('change', this.onAppState);
  }

  private onAppState = (state: AppStateStatus) => {
    if (state === 'active') {
      this.backgrounded = false;
      if (this.entries.size > 0) this.connect();
    } else if (state === 'background') {
      this.backgrounded = true;
      this.teardown();
    }
  };

  private subKey(sub: Record<string, unknown>): string {
    if (sub.type === 'allMids') return `allMids:${(sub.dex as string) ?? ''}`;
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
    };
  }

  private connect() {
    if (this.backgrounded) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const ws = new WebSocket(HL_WS_URL);
    this.ws = ws;

    ws.onopen = () => {
      this.attempts = 0;
      // Re-send every active subscription after a (re)connect.
      this.entries.forEach((entry) => {
        ws.send(JSON.stringify({ method: 'subscribe', subscription: entry.sub }));
      });
      this.startPing();
    };

    ws.onmessage = (event) => {
      try {
        this.route(JSON.parse(event.data as string));
      } catch {
        // ignore malformed frames
      }
    };

    ws.onerror = () => {
      // onclose will follow and trigger reconnect
    };

    ws.onclose = () => {
      this.stopPing();
      if (this.ws === ws) this.ws = null;
      this.scheduleReconnect();
    };
  }

  private route(msg: { channel?: string; data?: unknown }) {
    if (!msg || !msg.channel) return;
    if (msg.channel === 'allMids') {
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
    this.pingTimer = setInterval(() => this.send({ method: 'ping' }), PING_INTERVAL);
  }

  private stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect() {
    if (this.backgrounded || this.entries.size === 0 || this.reconnectTimer) return;
    const delay = Math.min(MAX_BACKOFF, 500 * 2 ** this.attempts);
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private teardown() {
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
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
