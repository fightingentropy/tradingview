// The native and web readers share the same publication and safe Markdown parser.
import { parseBriefIndex, parseBriefPayload, type BriefEntry } from '../../../web/src/lib/dailyBriefFeed';

export const DAILY_BRIEF_URL = 'https://trade.erlin.org/brief';
const FEED_URL = 'https://trade.erlin.org/api/daily-briefs';

async function request(suffix: string, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(abort, 15_000);
  try {
    const response = await fetch(`${FEED_URL}${suffix}`, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Brief request failed (${response.status}).`);
    const body = await response.text();
    if (body.length > 2_000_000) throw new Error('Brief response is too large.');
    return JSON.parse(body);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export async function loadBriefIndex(signal?: AbortSignal) {
  return parseBriefIndex(await request('', signal));
}

export async function loadBriefEdition(entry: BriefEntry, signal?: AbortSignal) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.id)) throw new Error('Invalid brief edition date.');
  return parseBriefPayload(await request(`/${entry.id}`, signal), entry);
}
