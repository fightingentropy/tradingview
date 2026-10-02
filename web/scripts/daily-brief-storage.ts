import { setTimeout as sleep } from 'node:timers/promises';

export type CommandResult = { status: number | null; stdout: string; stderr: string; error?: Error };
type Execute = (args: string[]) => CommandResult;
const retryDelays = [1_000, 3_000, 10_000];

/** Retry only idempotent KV operations; auth/transport errors are never missing keys. */
export async function runBriefStorageCommand(
  args: string[],
  execute: Execute,
  wait: (milliseconds: number) => Promise<unknown> = sleep,
): Promise<string | null> {
  for (let attempt = 0; ; attempt += 1) {
    const result = execute(args);
    if (!result.error && result.status === 0) return result.stdout.trim();
    const error = result.error?.message ?? result.stderr;
    if (!result.error && args[0] === 'get' &&
        error.includes(`/values/${encodeURIComponent(args[1]!)} - 404: Not Found`)) return null;
    const retryable = /\b(?:401|408|429|500|502|503|504)\b|fetch failed|ECONNRESET|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|UND_ERR_|timed out|Authentication error/i.test(error);
    if (!retryable || attempt >= retryDelays.length) {
      throw new Error(`Cloudflare operation failed; publication stopped. ${error.trim()}`);
    }
    // The raw KV value endpoint can reject credentials without Wrangler's usual
    // API error handling. Exercise its supported OAuth refresh/auth check before
    // retrying the same operation. Credentials and whoami output stay in Wrangler.
    if (/\b401\b|Authentication error/i.test(error)) execute(['whoami', '--json']);
    await wait(retryDelays[attempt]!);
  }
}
