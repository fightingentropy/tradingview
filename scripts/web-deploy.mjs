import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAnthropicApiKey } from './anthropic-keychain.mjs';
import { readNewsRelayConfiguration } from './news-relay-keychain.ts';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cf = path.join(repo, 'node_modules/cf/bin/cf');
const apiKey = readAnthropicApiKey();
// The relay access token also authorizes on-demand brief runs.
const accessToken = readNewsRelayConfiguration()?.accessToken;
if (!accessToken) throw new Error('The news relay access token is missing from Keychain; run npm run relay:deploy first.');
const directory = mkdtempSync(path.join(tmpdir(), 'tradingview-web-'));
try {
  const file = path.join(directory, 'secrets.json');
  writeFileSync(file, JSON.stringify({ ANTHROPIC_API_KEY: apiKey, APP_ACCESS_TOKEN: accessToken }), { mode: 0o600 });
  execFileSync(process.execPath, [cf, 'deploy', '--mode', 'web', '--secrets-file', file], {
    cwd: repo, stdio: 'inherit',
  });
  console.log('The Anthropic API key and relay access token remain in macOS Keychain and were not printed.');
} finally { rmSync(directory, { recursive: true, force: true }); }
