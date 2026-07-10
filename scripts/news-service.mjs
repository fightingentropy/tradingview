import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LABEL = 'com.erlinhoxha.tradingview-news';
const uid = process.getuid();
const home = os.homedir();
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const agents = path.join(home, 'Library', 'LaunchAgents');
const logs = path.join(home, 'Library', 'Logs', 'TradingView News');
const plist = path.join(agents, `${LABEL}.plist`);
const action = process.argv[2] ?? 'install';

function runLaunchctl(args, ignoreFailure = false) {
  try {
    execFileSync('launchctl', args, { stdio: ignoreFailure ? 'ignore' : 'inherit' });
  } catch (error) {
    if (!ignoreFailure) throw error;
  }
}

if (action === 'uninstall') {
  runLaunchctl(['bootout', `gui/${uid}`, plist], true);
  console.log(`Stopped ${LABEL}. Remove ${plist} manually if you no longer want the configuration.`);
  process.exit(0);
}
if (action !== 'install') throw new Error('Usage: news-service.mjs [install|uninstall]');

mkdirSync(agents, { recursive: true });
mkdirSync(logs, { recursive: true });
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${path.join(repo, 'scripts', 'news-feed-server.mjs')}</string>
  </array>
  <key>WorkingDirectory</key><string>${repo}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>${home}</string>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:${path.join(home, '.bun', 'bin')}:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${path.join(logs, 'service.log')}</string>
  <key>StandardErrorPath</key><string>${path.join(logs, 'service.error.log')}</string>
</dict>
</plist>
`;
writeFileSync(plist, xml, { mode: 0o600 });
runLaunchctl(['bootout', `gui/${uid}`, plist], true);
runLaunchctl(['bootstrap', `gui/${uid}`, plist]);
runLaunchctl(['kickstart', '-k', `gui/${uid}/${LABEL}`]);
console.log(`Installed and started ${LABEL}.`);
console.log(`Configuration: ${plist}`);
