export const NEWS_SOURCE_REFRESH_INTERVAL_MS = Object.freeze({
  x: 60 * 60_000,
  telegram: 5 * 60_000,
  digg: 60 * 60_000,
  paste: 60 * 60_000,
});

// A lightweight scheduler tick publishes cached snapshots and retries overdue sources.
export const NEWS_SCHEDULER_INTERVAL_MS = 60_000;

export function isNewsSourceCacheFresh(source, fetchedAt, now = Date.now()) {
  if (typeof fetchedAt !== 'number' || !Number.isFinite(fetchedAt)) return false;
  const age = now - fetchedAt;
  return age >= 0 && age < NEWS_SOURCE_REFRESH_INTERVAL_MS[source];
}
