import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ensureNewsRelaySecrets,
  storeNewsRelayUrl,
} from './news-relay-keychain.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wrangler = path.join(repo, 'node_modules', '.bin', 'wrangler');
const secrets = ensureNewsRelaySecrets();

execFileSync(wrangler, ['secret', 'bulk'], {
  cwd: repo,
  input: JSON.stringify({
    APP_ACCESS_TOKEN: secrets.accessToken,
    BRIDGE_SECRET: secrets.bridgeSecret,
  }),
  stdio: ['pipe', 'inherit', 'inherit'],
});

const output = execFileSync(wrangler, ['deploy'], {
  cwd: repo,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});
process.stdout.write(output);
const url = output.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0];
if (!url) throw new Error('Wrangler deployed the relay but did not report its workers.dev URL.');
storeNewsRelayUrl(url);
console.log(`News relay ready at ${url}`);
console.log('The access token remains in macOS Keychain and was not printed.');
