import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SERVICE = 'com.erlinhoxha.tradingview.news-relay';
const ACCOUNTS = {
  accessToken: 'app-access-token',
  bridgeSecret: 'bridge-secret',
  url: 'relay-url',
};
const CONFIG_FILE = process.env.NEWS_RELAY_CONFIG_FILE ?? path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'TradingView News',
  'relay.json',
);

function validConfiguration(value) {
  if (!value || typeof value !== 'object') return undefined;
  const accessToken = typeof value.accessToken === 'string' ? value.accessToken.trim() : '';
  const bridgeSecret = typeof value.bridgeSecret === 'string' ? value.bridgeSecret.trim() : '';
  const url = typeof value.url === 'string' ? value.url.trim().replace(/\/+$/, '') : '';
  return accessToken && bridgeSecret && url ? { accessToken, bridgeSecret, url } : undefined;
}

function readFileConfiguration() {
  try {
    return validConfiguration(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')));
  } catch {
    return undefined;
  }
}

function read(account) {
  try {
    return execFileSync(
      'security',
      ['find-generic-password', '-s', SERVICE, '-a', account, '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
  } catch {
    return undefined;
  }
}

function write(account, value) {
  execFileSync(
    'security',
    ['add-generic-password', '-U', '-s', SERVICE, '-a', account, '-w', value],
    { stdio: 'ignore' },
  );
}

export function readNewsRelayConfiguration() {
  const accessToken = read(ACCOUNTS.accessToken);
  const bridgeSecret = read(ACCOUNTS.bridgeSecret);
  const url = read(ACCOUNTS.url);
  return validConfiguration({ accessToken, bridgeSecret, url }) ?? readFileConfiguration();
}

export function ensureNewsRelaySecrets() {
  const accessToken = read(ACCOUNTS.accessToken) ?? randomBytes(32).toString('hex');
  const bridgeSecret = read(ACCOUNTS.bridgeSecret) ?? randomBytes(32).toString('hex');
  write(ACCOUNTS.accessToken, accessToken);
  write(ACCOUNTS.bridgeSecret, bridgeSecret);
  return { accessToken, bridgeSecret };
}

export function storeNewsRelayUrl(url) {
  write(ACCOUNTS.url, url.replace(/\/+$/, ''));
}
