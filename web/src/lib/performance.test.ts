import { afterEach, describe, expect, mock, test } from "bun:test";
import { SharedRead } from "./sharedRead";
import { InfoScheduler } from "./infoScheduler";
import { HyperliquidStreams } from "./hyperliquidStreams";
import { reconcileInBackground } from "./backgroundReconcile";
import { fetchHyperliquidCandles } from "./hyperliquid";
import { setHyperliquidDataNetwork } from "./hyperliquidNetwork";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
afterEach(() => { mock.restore(); setHyperliquidDataNetwork("mainnet"); });

describe("shared market reads", () => {
  test("one cancelled chart does not cancel its sibling's history", async () => {
    const reads = new SharedRead<number>(1_000);
    const response = deferred<number>();
    const a = new AbortController(), b = new AbortController();
    let sharedSignal!: AbortSignal;
    const load = mock((signal: AbortSignal) => { sharedSignal = signal; return response.promise; });
    const first = reads.read("mainnet:BTC", load, a.signal);
    const second = reads.read("mainnet:BTC", load, b.signal);
    await tick(); a.abort();
    expect(await first).toBeNull();
    expect(sharedSignal.aborted).toBe(false);
    response.resolve(42);
    expect(await second).toBe(42);
    expect(await reads.read("mainnet:BTC", load)).toBe(42);
    expect(load).toHaveBeenCalledTimes(1);
  });
  test("all consumers leaving cancels a read and the next visit retries", async () => {
    const reads = new SharedRead<number>(0);
    const a = new AbortController();
    let signal!: AbortSignal;
    const first = reads.read("BTC", current => { signal = current; return new Promise(() => {}); }, a.signal);
    await tick(); a.abort();
    expect(await first).toBeNull(); expect(signal.aborted).toBe(true);
    expect(await reads.read("BTC", async () => 12)).toBe(12);
  });
  test("concurrent matching candles share HTTP and different networks never do", async () => {
    const original = globalThis.fetch;
    const requests: string[] = [];
    globalThis.fetch = mock(async (url, init) => {
      requests.push(String(url));
      const { req } = JSON.parse(String(init?.body));
      await tick();
      return Response.json([{ t: 600_000, T: 899_999, s: req.coin, i: req.interval,
        o: "10", h: "12", l: "9", c: "11", v: "20", n: 2 }]);
    }) as typeof fetch;
    try {
      const args = { coin: "HYPE", resolution: "5", fromMs: 600_001, toMs: 900_001, priority: "high" as const };
      const a = fetchHyperliquidCandles(args);
      const b = fetchHyperliquidCandles({ ...args, fromMs: 600_003, toMs: 900_003 });
      setHyperliquidDataNetwork("testnet");
      const c = fetchHyperliquidCandles(args);
      expect((await Promise.all([a, b, c])).map(candles => candles.length)).toEqual([1, 1, 1]);
      expect(requests).toEqual(["https://api.hyperliquid.xyz/info", "https://api.hyperliquid-testnet.xyz/info"]);
    } finally { globalThis.fetch = original; }
  });
});

describe("bounded request scheduling", () => {
  test("reserves concurrency for chart history and skips cancelled queued work", async () => {
    const scheduler = new InfoScheduler(0);
    const held = deferred<number>();
    const a = scheduler.schedule(() => held.promise), b = scheduler.schedule(() => held.promise);
    const abort = new AbortController();
    const cancelled = mock(async () => 0);
    const c = scheduler.schedule(cancelled, { signal: abort.signal }).catch(error => error.name);
    expect(await scheduler.schedule(async () => 3, { priority: "high" })).toBe(3);
    abort.abort(); held.resolve(1);
    expect(await Promise.all([a, b, c])).toEqual([1, 1, "AbortError"]);
    expect(cancelled).not.toHaveBeenCalled();
  });
  test("honours a rolling weighted budget even when concurrency is free", async () => {
    const scheduler = new InfoScheduler(0, 40, 35);
    const starts: number[] = [];
    await Promise.all(Array.from({ length: 3 }, () => scheduler.schedule(async () => { starts.push(Date.now()); }, { weight: 20 })));
    expect(starts[2] - starts[0]).toBeGreaterThanOrEqual(34);
  });
});

class FakeSocket {
  readyState = 0;
  sent: any[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  frame(channel: string, data: unknown) { this.onmessage?.({ data: JSON.stringify({ channel, data }) }); }
}

test("shared socket deduplicates subscriptions, routes by instrument/DEX and closes when unused", () => {
  const sockets: FakeSocket[] = [];
  const streams = new HyperliquidStreams("wss://test", () => { const socket = new FakeSocket(); sockets.push(socket); return socket as unknown as WebSocket; });
  const a = mock(() => {}), b = mock(() => {}), xyz = mock(() => {}), core = mock(() => {});
  const off = [streams.subscribe({ type: "candle", coin: "BTC", interval: "5m" }, a),
    streams.subscribe({ type: "candle", coin: "BTC", interval: "5m" }, b),
    streams.subscribe({ type: "allMids", dex: "xyz" }, xyz), streams.subscribe({ type: "allMids" }, core)];
  try {
    expect(sockets.length).toBe(1);
    const socket = sockets[0]; socket.open();
    expect(socket.sent.length).toBe(3);
    socket.frame("candle", { s: "HYPE", i: "5m" }); expect(a).not.toHaveBeenCalled();
    socket.frame("candle", { s: "BTC", i: "5m" }); expect(a).toHaveBeenCalledTimes(1); expect(b).toHaveBeenCalledTimes(1);
    socket.frame("allMids", { dex: "xyz", mids: {} }); expect(xyz).toHaveBeenCalledTimes(1); expect(core).not.toHaveBeenCalled();
    off[0](); expect(socket.sent.length).toBe(3);
    off[1](); expect(socket.sent.at(-1).method).toBe("unsubscribe");
  } finally { off.forEach(unsubscribe => unsubscribe()); }
  expect(sockets[0].readyState).toBe(3);
});

test("acknowledgement does not wait for refresh, and reconciliation reads after an older request", async () => {
  const existing = deferred<void>();
  const refresh = mock(async () => {});
  expect(reconcileInBackground(existing.promise, () => true, refresh)).toBeUndefined();
  await tick(); expect(refresh).not.toHaveBeenCalled();
  existing.resolve(); await tick(); expect(refresh).toHaveBeenCalledTimes(1);
  reconcileInBackground(undefined, () => false, refresh);
  await tick(); expect(refresh).toHaveBeenCalledTimes(1);
});
