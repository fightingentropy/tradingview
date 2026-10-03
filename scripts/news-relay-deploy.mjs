import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureNewsRelaySecrets, storeNewsRelayUrl } from './news-relay-keychain.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cf = path.join(repo, 'node_modules/cf/bin/cf');
const secrets = ensureNewsRelaySecrets();
const directory = mkdtempSync(path.join(tmpdir(), 'tradingview-relay-'));
try {
  const file = path.join(directory, 'secrets.json');
  writeFileSync(file, JSON.stringify({ APP_ACCESS_TOKEN: secrets.accessToken, BRIDGE_SECRET: secrets.bridgeSecret }), { mode: 0o600 });
  const output = execFileSync(process.execPath, [cf, 'deploy', '--secrets-file', file], {
    cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: '9349e7e9527ec0aad29368255a686ec4' },
  });
  process.stdout.write(output);
  const url = output.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0];
  if (!url) throw new Error('cf deployed the relay but did not report its workers.dev URL.');
  storeNewsRelayUrl(url);
  console.log(`News relay ready at ${url}`);
  console.log('The access token remains in macOS Keychain and was not printed.');
} finally { rmSync(directory, { recursive: true, force: true }); }
