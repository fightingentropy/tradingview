import { execFile, execFileSync } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ACCOUNT = os.userInfo().username;
const SERVICES = {
  apiId: 'com.erlinhoxha.tradingview.telegram.api-id',
  apiHash: 'com.erlinhoxha.tradingview.telegram.api-hash',
  session: 'com.erlinhoxha.tradingview.telegram.session',
};

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

export function readTelegramCredentials() {
  const apiId = Number(readSecret(SERVICES.apiId));
  const apiHash = readSecret(SERVICES.apiHash);
  const session = readSecret(SERVICES.session);
  if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash || !session) return undefined;
  return { apiId, apiHash, session };
}

export async function storeTelegramCredentials({ apiId, apiHash, session }) {
  await writeSecret(SERVICES.apiId, String(apiId));
  await writeSecret(SERVICES.apiHash, apiHash);
  await writeSecret(SERVICES.session, session);
}
