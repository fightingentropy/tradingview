import { createHmac } from 'node:crypto';

import { readNewsRelayConfiguration } from './news-relay-keychain.mjs';

export async function publishNewsRelaySnapshot(snapshot) {
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
