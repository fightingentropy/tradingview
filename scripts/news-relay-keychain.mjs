import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const SERVICE = 'com.erlinhoxha.tradingview.news-relay';
const ACCOUNTS = {
  accessToken: 'app-access-token',
  bridgeSecret: 'bridge-secret',
  url: 'relay-url',
};

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
  return accessToken && bridgeSecret ? { accessToken, bridgeSecret, url } : undefined;
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
