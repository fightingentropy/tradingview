import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { londonDateKey } from '../src/lib/dailyBrief';

const publisher = fileURLToPath(new URL('./publish-daily-brief.ts', import.meta.url));
const fixture = readFileSync(new URL('../src/data/briefs/2026-09-16.md', import.meta.url), 'utf8');

async function publishWithFakeStorage(mode: 'unauthorized-once' | 'forbidden' | 'existing-edition') {
  const directory = mkdtempSync(join(tmpdir(), 'brief-publisher-test-'));
  try {
    const now = new Date();
    const day = londonDateKey(now);
    const yesterday = londonDateKey(new Date(now.getTime() - 86_400_000));
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
    const markdown = fixture.replace(/^Generated: .*$/m, `Generated: ${day} ${time} (Europe/London)`);
    const storePath = join(directory, 'store.json');
    const callsPath = join(directory, 'calls.jsonl');
    const wranglerPath = join(directory, 'wrangler.mjs');
    const file = join(directory, 'edition.md');
    const stderrPath = join(directory, 'stderr.log');
    const initial: Record<string, unknown> = {
      'index:v1': { version: 1, publishedAt: now.toISOString(), editions: [{ id: yesterday, title: 'Previous brief', generated: `${yesterday} 08:00` }] },
    };
    if (mode === 'existing-edition') initial[`edition:v1:${day}`] = { title: 'Already published', markdown };
    writeFileSync(storePath, JSON.stringify(initial));
    writeFileSync(file, markdown);
    writeFileSync(wranglerPath, `#!${process.execPath}
import fs from 'node:fs';
const args = process.argv.slice(2), base = process.env.BRIEF_TEST_DIRECTORY;
const calls = base + '/calls.jsonl', storePath = base + '/store.json';
const first = !fs.existsSync(calls);
fs.appendFileSync(calls, JSON.stringify(args) + '\\n');
if (args[0] === 'whoami') { console.log(JSON.stringify({loggedIn: true})); process.exit(0); }
const action = args[2], key = args[3];
if (process.env.BRIEF_TEST_MODE === 'forbidden') { console.error('403: Forbidden'); process.exit(1); }
if (first && process.env.BRIEF_TEST_MODE === 'unauthorized-once') { console.error('Failed to fetch /values/index%3Av1 - 401: Unauthorized'); process.exit(1); }
const store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
if (action === 'get') {
  if (!(key in store)) { console.error('Failed to fetch /values/' + encodeURIComponent(key) + ' - 404: Not Found'); process.exit(1); }
  console.log(JSON.stringify(store[key]));
} else if (action === 'put') {
  store[key] = JSON.parse(fs.readFileSync(args[args.indexOf('--path') + 1], 'utf8'));
  fs.writeFileSync(storePath, JSON.stringify(store));
} else process.exit(2);
`, { mode: 0o700 });
    const child = Bun.spawn([process.execPath, publisher, '--file', file, '--title', 'New brief'], {
      env: { ...process.env, DAILY_BRIEF_WRANGLER: wranglerPath, BRIEF_TEST_DIRECTORY: directory, BRIEF_TEST_MODE: mode },
      stdout: 'ignore', stderr: Bun.file(stderrPath),
    });
    const code = await child.exited;
    const stderr = readFileSync(stderrPath, 'utf8');
    return { code, stderr, day, initial, store: JSON.parse(readFileSync(storePath, 'utf8')), calls: readFileSync(callsPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as string[]) };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('publisher recovers from a 401, writes the edition before its index and verifies storage', async () => {
  const result = await publishWithFakeStorage('unauthorized-once');
  expect(result.code).toBe(0);
  expect(result.calls[1]?.slice(0, 2)).toEqual(['whoami', '--json']);
  expect(result.calls.filter((args) => args[2] === 'put').map((args) => args[3])).toEqual([`edition:v1:${result.day}`, 'index:v1']);
  expect(result.store['index:v1'].editions[0].id).toBe(result.day);
  expect(result.store[`edition:v1:${result.day}`].title).toBe('New brief');
  expect(result.calls.at(-1)?.slice(0, 4)).toEqual(['kv', 'key', 'get', 'index:v1']);
});

test('publisher never writes through an authorization failure or overwrites an existing edition', async () => {
  for (const mode of ['forbidden', 'existing-edition'] as const) {
    const result = await publishWithFakeStorage(mode);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain(mode === 'forbidden' ? '403' : 'Refusing to overwrite');
    expect(result.store).toEqual(result.initial);
    expect(result.calls.some((args) => args[2] === 'put')).toBe(false);
  }
});
