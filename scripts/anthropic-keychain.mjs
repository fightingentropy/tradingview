import { execFileSync } from 'node:child_process';

const SERVICE = 'com.erlinhoxha.tradingview.anthropic';
const ACCOUNT = 'api-key';

/** The Claude API key both Workers use; it lives only in macOS Keychain and Worker secrets. */
export function readAnthropicApiKey() {
  let value = '';
  try {
    value = execFileSync(
      'security',
      ['find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
  } catch {
    // Reported below with the command that stores the key.
  }
  if (!value) {
    throw new Error(
      `No Anthropic API key in Keychain. Store one (you will be prompted) with:\n  security add-generic-password -U -s ${SERVICE} -a ${ACCOUNT} -w`,
    );
  }
  return value;
}
