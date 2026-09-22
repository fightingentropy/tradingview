export type MarketSubscription =
  | { type: "allMids"; dex?: string }
  | { type: "candle"; coin: string; interval: string }
  | { type: "l2Book" | "activeAssetCtx"; coin: string };

type Listener = (data: any) => void;
type Entry = { subscription: MarketSubscription; listeners: Set<Listener> };

const subscriptionKey = (s: MarketSubscription) =>
  s.type === "allMids" ? `allMids:${s.dex || ""}`
    : s.type === "candle" ? `candle:${s.coin}:${s.interval}`
      : `${s.type}:${s.coin}`;

/** A connection belongs to its consumers, not to an imported store or a chart. */
export class HyperliquidStreams {
  private entries = new Map<string, Entry>();
  private socket: WebSocket | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private reconnect: ReturnType<typeof setTimeout> | undefined;
  private connectionTimeout: ReturnType<typeof setTimeout> | undefined;
  private attempts = 0;
  private lastMessageAt = 0;

  constructor(private url: string, private makeSocket = (url: string) => new WebSocket(url)) {}

  subscribe(subscription: MarketSubscription, listener: Listener): () => void {
    const key = subscriptionKey(subscription);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { subscription, listeners: new Set() };
      this.entries.set(key, entry);
      this.send({ method: "subscribe", subscription });
    }
    entry.listeners.add(listener);
    this.connect();
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      entry!.listeners.delete(listener);
      if (entry!.listeners.size === 0) {
        this.entries.delete(key);
        this.send({ method: "unsubscribe", subscription });
      }
      if (!this.entries.size) {
        this.stop();
        this.attempts = 0;
      }
    };
  }

  private send(payload: unknown) {
    if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(payload));
  }

  private connect() {
    if (this.socket || this.reconnect || !this.entries.size) return;
    const socket = this.makeSocket(this.url);
    this.socket = socket;
    this.connectionTimeout = setTimeout(() => this.retry(socket), 10_000);
    socket.onopen = () => {
      if (this.socket !== socket) return;
      clearTimeout(this.connectionTimeout);
      this.attempts = 0;
      this.lastMessageAt = Date.now();
      for (const entry of this.entries.values()) {
        this.send({ method: "subscribe", subscription: entry.subscription });
      }
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastMessageAt > 45_000) this.retry(socket);
        else this.send({ method: "ping" });
      }, 15_000);
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.lastMessageAt = Date.now();
      try {
        const { channel, data } = JSON.parse(String(event.data));
        if (!data || typeof data !== "object") return;
        const key = channel === "allMids" ? `allMids:${data.dex || ""}`
          : channel === "candle" ? `candle:${data.s}:${data.i}`
            : `${channel}:${data.coin}`;
        for (const listener of this.entries.get(key)?.listeners ?? []) {
          // One consumer must not interrupt delivery to the other charts.
          try { listener(data); } catch (error) { console.error("Market update failed", error); }
        }
      } catch { /* Ignore malformed frames; the heartbeat detects a dead feed. */ }
    };
    socket.onerror = () => this.retry(socket);
    socket.onclose = () => this.retry(socket);
  }

  private retry(socket: WebSocket) {
    if (this.socket !== socket) return;
    this.stop();
    if (!this.entries.size) return;
    const delay = Math.min(30_000, 500 * 2 ** this.attempts++);
    this.reconnect = setTimeout(() => {
      this.reconnect = undefined;
      this.connect();
    }, delay * (0.75 + Math.random() * 0.25));
  }

  private stop() {
    clearInterval(this.heartbeat);
    clearTimeout(this.reconnect);
    clearTimeout(this.connectionTimeout);
    this.heartbeat = this.reconnect = this.connectionTimeout = undefined;
    const socket = this.socket;
    this.socket = undefined;
    if (socket) {
      socket.onopen = socket.onclose = socket.onerror = socket.onmessage = null;
      socket.close();
    }
  }
}

const pools = new Map<string, HyperliquidStreams>();
export const subscribeHyperliquid = (url: string, subscription: MarketSubscription, listener: Listener) => {
  let pool = pools.get(url);
  if (!pool) { pool = new HyperliquidStreams(url); pools.set(url, pool); }
  return pool.subscribe(subscription, listener);
};
