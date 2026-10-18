import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Runs on the Linux VM from the deployed services directory. Installs the news
// bridge and price-alert monitor as systemd units for the deploying user, run by Bun.
const SERVICES = {
  'tradingview-news': {
    description: 'TradingView news bridge (X, Telegram, Digg, Paste)',
    entry: 'scripts/news-feed-server.mjs',
    environment: { NEWS_FEED_HOST: '127.0.0.1', NEWS_FEED_PORT: '8430' },
  },
  'tradingview-price-alerts': {
    description: 'TradingView Hyperliquid price-alert monitor',
    entry: 'scripts/price-alert-monitor.mjs',
    environment: {},
  },
};
const action = process.argv[2] ?? 'status';
const user = os.userInfo();
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sudo = (args, stdio = 'inherit') => execFileSync('/usr/bin/sudo', ['-n', ...args], { stdio });
const units = Object.keys(SERVICES).map((name) => `${name}.service`);
const bun = path.join(user.homedir, '.bun', 'bin', 'bun');

function curlImpersonate() {
  const root = path.join(user.homedir, '.local', 'opt');
  const releases = existsSync(root)
    ? readdirSync(root).filter((name) => name.startsWith('curl-impersonate-')).sort()
    : [];
  const candidate = releases.length ? path.join(root, releases.at(-1), 'curl_chrome136') : undefined;
  return candidate && existsSync(candidate) ? candidate : undefined;
}

function unitFile({ description, entry, environment }) {
  const values = {
    HOME: user.homedir,
    PATH: `${path.join(user.homedir, '.local', 'bin')}:${path.dirname(bun)}:/usr/local/bin:/usr/bin:/bin`,
    ...(curlImpersonate() ? { CURL_IMPERSONATE_PATH: curlImpersonate() } : {}),
    ...environment,
  };
  return `[Unit]
Description=${description}
After=network-online.target
Wants=network-online.target

[Service]
User=${user.username}
WorkingDirectory=${directory}
${Object.entries(values).map(([key, value]) => `Environment=${key}=${value}`).join('\n')}
ExecStart=${bun} ${entry}
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
`;
}

if (process.platform !== 'linux' || user.uid === 0) throw new Error('Run on the Linux VM as the service user with sudo access.');
if (!existsSync(bun)) throw new Error(`Bun is not installed at ${bun}.`);
if (action === 'install') {
  const staging = mkdtempSync(path.join(os.tmpdir(), 'tradingview-units-'));
  try {
    for (const [name, service] of Object.entries(SERVICES)) {
      const file = path.join(staging, `${name}.service`);
      writeFileSync(file, unitFile(service));
      sudo(['/usr/bin/install', '-o', 'root', '-g', 'root', '-m', '644', file, `/etc/systemd/system/${name}.service`]);
    }
  } finally { rmSync(staging, { recursive: true, force: true }); }
  sudo(['/usr/bin/systemctl', 'daemon-reload']);
  sudo(['/usr/bin/systemctl', 'enable', '--quiet', ...units]);
  if (process.argv.includes('--no-start')) {
    console.log(`Installed ${units.join(' and ')} from ${directory}; start them with "start".`);
  } else {
    sudo(['/usr/bin/systemctl', 'restart', ...units]);
    console.log(`Installed and started ${units.join(' and ')} from ${directory}.`);
  }
} else if (action === 'start') {
  sudo(['/usr/bin/systemctl', 'restart', ...units]);
  console.log(`Started ${units.join(' and ')}.`);
} else if (action === 'stop') {
  sudo(['/usr/bin/systemctl', 'disable', '--now', '--quiet', ...units]);
  console.log(`Stopped and disabled ${units.join(' and ')}.`);
} else if (action === 'status') {
  for (const unit of units) {
    let state = 'inactive';
    try { state = execFileSync('/usr/bin/systemctl', ['is-active', unit], { encoding: 'utf8' }).trim(); } catch { /* Reported as inactive. */ }
    console.log(`${unit}: ${state}`);
  }
} else {
  throw new Error('Usage: linux-services.mjs [install [--no-start]|start|status|stop]');
}
