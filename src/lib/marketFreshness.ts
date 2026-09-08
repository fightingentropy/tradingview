import type { Instrument, Quote } from '../domain/types';
import type { FeedConnectionStatus } from '../providers/types';

export interface ObservedPrice { last: number; ts: number }
export const STREAM_STALE_MS = 30_000;
export const SNAPSHOT_STALE_MS = 120_000;

/** Compare observation times, never let an old socket tick mask a newer snapshot. */
export function marketPriceState(
  instrument: Pick<Instrument, 'source' | 'assetClass'>,
  quote: Quote | undefined,
  tick: ObservedPrice | undefined,
  connection: FeedConnectionStatus,
  now: number,
) {
  const valid = (value: ObservedPrice | undefined): value is ObservedPrice =>
    !!value && Number.isFinite(value.last) &&
    (instrument.assetClass === 'outcome' ? value.last >= 0 && value.last <= 1 : value.last > 0) &&
    Number.isFinite(value.ts) && value.ts > 0 && value.ts <= now + 5_000;
  const snapshot = valid(quote) ? quote : undefined;
  const streamed = valid(tick) ? tick : undefined;
  const latest = streamed && (!snapshot || streamed.ts >= snapshot.ts) ? streamed : snapshot;
  const age = latest ? Math.max(0, now - latest.ts) : Infinity;
  const stale = age > SNAPSHOT_STALE_MS;
  const streamFresh = !!streamed && now - streamed.ts <= STREAM_STALE_MS;
  const status = !latest ? 'unavailable'
    : stale ? 'stale'
    : instrument.source === 'cboe' ? 'delayed'
    : connection === 'paused' ? 'paused'
    : connection === 'reconnecting' ? 'reconnecting'
    : connection === 'connecting' ? 'connecting'
    : connection === 'connected' && streamFresh ? 'live'
    : 'snapshot';
  const labels = {
    unavailable: 'Price unavailable', stale: 'Stale price', delayed: 'Delayed',
    paused: 'Feed paused', reconnecting: 'Reconnecting', connecting: 'Connecting',
    live: 'Live', snapshot: 'Snapshot',
  };
  return { last: latest?.last ?? null, ts: latest?.ts ?? null, status, label: labels[status], stale };
}
