import { createHmac } from 'node:crypto';

import type { NewsFeedNotice, NewsItem } from '../src/domain/news.ts';
import { readNewsRelayConfiguration } from './news-relay-keychain.ts';

export interface NewsRelaySnapshot {
  items: NewsItem[];
  notices: NewsFeedNotice[];
  updatedAt: string;
}

export async function publishNewsRelaySnapshot(snapshot: NewsRelaySnapshot): Promise<boolean> {
  const configuration = readNewsRelayConfiguration();
  if (!configuration?.url) return false;
  const body = JSON.stringify(snapshot);
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const signature = createHmac('sha256', configuration.bridgeSecret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  const response = await fetch(new URL('/ingest', configuration.url), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-News-Signature': signature,
      'X-News-Timestamp': timestamp,
    },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`News relay returned ${response.status}`);
  return true;
}
