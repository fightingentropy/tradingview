import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAnthropicApiKey } from './anthropic-keychain.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cf = path.join(repo, 'node_modules/cf/bin/cf');
const apiKey = readAnthropicApiKey();
const directory = mkdtempSync(path.join(tmpdir(), 'tradingview-web-'));
try {
  const file = path.join(directory, 'secrets.json');
  writeFileSync(file, JSON.stringify({ ANTHROPIC_API_KEY: apiKey }), { mode: 0o600 });
  execFileSync(process.execPath, [cf, 'deploy', '--mode', 'web', '--secrets-file', file], {
    cwd: repo, stdio: 'inherit',
  });
  console.log('The Anthropic API key remains in macOS Keychain and was not printed.');
} finally { rmSync(directory, { recursive: true, force: true }); }
