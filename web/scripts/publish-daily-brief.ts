import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { briefEntry, parseBriefIndex, parseBriefPayload, validateFreshBrief } from '../src/lib/dailyBriefFeed';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { values } = parseArgs({ options: {
  file: { type: 'string' }, title: { type: 'string' },
  initialize: { type: 'boolean', default: false },
  'dry-run': { type: 'boolean', default: false },
} });
if (!values.file || !values.title) throw new Error('Usage: bun web/scripts/publish-daily-brief.ts --file PATH --title "Headline" [--dry-run] [--initialize]');
const current = validateFreshBrief(values.title, readFileSync(resolve(values.file), 'utf8'));
if (values['dry-run']) {
  console.log(JSON.stringify({ validated: current.id, title: current.title, sources: current.sources.length, sections: current.sections.length }));
} else {
  // Serialize local writers without leaving a stale lock after a reboot or crash.
  const lock = createServer();
  await new Promise<void>((accept, reject) => { lock.once('error', reject); lock.listen(3403, '127.0.0.1', accept); });
  const staging = mkdtempSync(resolve(tmpdir(), 'tradingview-brief-'));
  try {
    const wrangler = (args: string[], allowMissing = false) => {
      const result = spawnSync(process.env.DAILY_BRIEF_WRANGLER ?? resolve(root, 'node_modules/.bin/wrangler'), ['kv', 'key', ...args, '--binding', 'DAILY_BRIEFS', '--remote', '--config', resolve(root, 'wrangler.web.jsonc')], { cwd: root, encoding: 'utf8', timeout: 60_000, maxBuffer: 5_000_000, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
      if (!result.error && allowMissing && result.status !== 0 && result.stderr.includes(`/values/${encodeURIComponent(args[1]!)} - 404: Not Found`)) return null;
      if (result.error || result.status !== 0) throw new Error(`Cloudflare operation failed; publication stopped. ${result.error?.message ?? result.stderr}`);
      return result.stdout.trim();
    };
    const get = (key: string): unknown | null => {
      const value = wrangler(['get', key, '--text'], true);
      // Only an explicit missing-key result can initialize storage. Auth/network errors throw.
      return value === null || value === 'Value not found' ? null : JSON.parse(value);
    };
    const put = (key: string, value: unknown) => {
      const path = resolve(staging, 'payload.json');
      writeFileSync(path, JSON.stringify(value));
      wrangler(['put', key, '--path', path]);
    };
    const existing = get('index:v1');
    if (existing === null && !values.initialize) throw new Error('No publication index. Use --initialize only for the first publication.');
    if (existing !== null && values.initialize) throw new Error('The index already exists; omit --initialize.');
    const previousIndex = existing === null ? undefined : parseBriefIndex(existing);
    if (previousIndex && previousIndex.editions[0]!.generated > current.generated) throw new Error('A newer edition is already published.');
    const key = `edition:v1:${current.id}`;
    const previous = get(key);
    if (previous !== null) {
      const published = parseBriefPayload(previous);
      if (published.raw !== current.raw || published.title !== current.title) throw new Error(`Edition ${current.id} is already published. Refusing to overwrite its original analysis.`);
    } else {
      put(key, { title: current.title, markdown: current.raw });
    }
    // Publish discovery last. The reader offers only the latest daily edition.
    const index = parseBriefIndex({ version: 1, publishedAt: new Date().toISOString(), editions: [briefEntry(current)] });
    put('index:v1', index);
    const verified = parseBriefIndex(get('index:v1'));
    if (!verified.editions.some((entry) => entry.id === current.id && entry.title === current.title)) throw new Error('Publication written but read-back verification is pending. Inspect the public feed before retrying.');
    console.log(JSON.stringify({ published: current.id, title: current.title, url: 'https://trade.erlin.org/brief' }));
  } finally {
    rmSync(staging, { recursive: true, force: true });
    await new Promise<void>((accept) => lock.close(() => accept()));
  }
}
