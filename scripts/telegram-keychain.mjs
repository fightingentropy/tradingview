import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ACCOUNT = os.userInfo().username;
const SERVICES = {
  apiId: 'com.erlinhoxha.tradingview.telegram.api-id',
  apiHash: 'com.erlinhoxha.tradingview.telegram.api-hash',
  session: 'com.erlinhoxha.tradingview.telegram.session',
};
const FILE_PATH = process.env.TELEGRAM_CREDENTIALS_FILE ?? path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'TradingView News',
  'telegram.json',
);

function readSecret(service) {
  try {
    return execFileSync('security', ['find-generic-password', '-a', ACCOUNT, '-s', service, '-w'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

async function writeSecret(service, value) {
  await execFileAsync('security', [
    'add-generic-password',
    '-U',
    '-a',
    ACCOUNT,
    '-s',
    service,
    '-w',
    value,
  ]);
}

function readFileCredentials() {
  try {
    const value = JSON.parse(readFileSync(FILE_PATH, 'utf8'));
    const apiId = Number(value.apiId);
    const apiHash = typeof value.apiHash === 'string' ? value.apiHash.trim() : '';
    const session = typeof value.session === 'string' ? value.session.trim() : '';
    if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash || !session) return undefined;
    return { apiId, apiHash, session };
  } catch {
    return undefined;
  }
}

function writeFileCredentials({ apiId, apiHash, session }) {
  mkdirSync(path.dirname(FILE_PATH), { recursive: true });
  writeFileSync(
    FILE_PATH,
    `${JSON.stringify({ apiId, apiHash, session }, null, 2)}\n`,
    { mode: 0o600 },
  );
}

export function readTelegramCredentials() {
  const apiId = Number(readSecret(SERVICES.apiId));
  const apiHash = readSecret(SERVICES.apiHash);
  const session = readSecret(SERVICES.session);
  if (Number.isInteger(apiId) && apiId > 0 && apiHash && session) {
    return { apiId, apiHash, session };
  }
  return readFileCredentials();
}

export async function storeTelegramCredentials({ apiId, apiHash, session }) {
  try {
    await writeSecret(SERVICES.apiId, String(apiId));
    await writeSecret(SERVICES.apiHash, apiHash);
    await writeSecret(SERVICES.session, session);
  } catch {
    writeFileCredentials({ apiId, apiHash, session });
  }
}
