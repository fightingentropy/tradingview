// The native and web readers share the same publication and safe Markdown parser.
import { parseBriefIndex, parseBriefPayload, type BriefEntry } from '@tradingview/shared/brief-feed';
import type { DailyBrief } from '@tradingview/shared/brief';

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

/** Commit an edition only when its index and complete body have both validated. */
export async function loadLatestBrief(previous?: DailyBrief, signal?: AbortSignal) {
  const index = await loadBriefIndex(signal);
  const latest = index.editions[0]!;
  if (previous?.id === latest.id && previous.title === latest.title && previous.generated === latest.generated) return previous;
  return loadBriefEdition(latest, signal);
}

export interface BriefRunState {
  status: string;
  startedAt?: string;
  error?: string;
}

const RUN_URL = `${FEED_URL}/run`;
// The relay access token also authorizes on-demand brief runs on the web Worker.
const RUN_TOKEN = process.env.EXPO_PUBLIC_NEWS_RELAY_ACCESS_TOKEN?.trim();
export const canRunBrief = Boolean(RUN_TOKEN);
export const ACTIVE_BRIEF_RUN = new Set(['queued', 'running', 'waiting', 'paused', 'waitingForPause', 'rollingBack']);

function runState(value: unknown): BriefRunState {
  const body = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    status: typeof body.status === 'string' ? body.status : 'unknown',
    ...(typeof body.startedAt === 'string' ? { startedAt: body.startedAt } : {}),
    ...(typeof body.error === 'string' ? { error: body.error } : {}),
  };
}

export async function loadBriefRunStatus(): Promise<BriefRunState> {
  const response = await fetch(RUN_URL, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Brief run status failed (${response.status}).`);
  return runState(await response.json());
}

/** Starts a paid research run; a run already in progress is returned as-is. */
export async function startBriefRun(): Promise<BriefRunState> {
  if (!RUN_TOKEN) throw new Error('On-demand briefs are not configured in this build.');
  const response = await fetch(RUN_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', Authorization: `Bearer ${RUN_TOKEN}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok && response.status !== 409) throw new Error(`The brief could not start (${response.status}).`);
  return runState(await response.json());
}
