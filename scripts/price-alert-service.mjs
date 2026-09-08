import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const label = 'com.erlinhoxha.tradingview-price-alerts';
const action = process.argv[2] ?? 'install';
const taskUser = os.userInfo();
const taskHome = taskUser.homedir;
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const plist = `/Library/LaunchDaemons/${label}.plist`;
const logs = path.join(taskHome, 'Library', 'Logs', 'TradingView Price Alerts');
// Homebrew's stable link survives upgrades; process.execPath resolves into the
// versioned Cellar, which may be removed by a later brew cleanup.
const nodeBinary = existsSync('/opt/homebrew/bin/node') ? '/opt/homebrew/bin/node' : process.execPath;
const escaped = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const sudo = args => execFileSync('/usr/bin/sudo', ['-n', ...args], { stdio: 'inherit' });
const stop = () => { try { sudo(['/bin/launchctl', 'bootout', `system/${label}`]); } catch { /* First install may have no service. */ } };

if (process.platform !== 'darwin' || taskUser.uid === 0) throw new Error('Run as the Mac mini service user with sudo access, not as root.');
if (action === 'status') {
  execFileSync('/bin/launchctl', ['print', `system/${label}`], { stdio: 'inherit' });
  process.exit(0);
}
if (action === 'stop') { stop(); process.exit(0); }
if (action !== 'install') throw new Error('Usage: price-alert-service.mjs [install|status|stop]');
if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node 22 or newer is required.');
// Check existing configuration without printing or copying credentials into the service.
const config = JSON.parse(readFileSync(path.join(taskHome, 'Library', 'Application Support', 'TradingView News', 'relay.json'), 'utf8'));
if (!config.bridgeSecret || !String(config.url).startsWith('https://')) throw new Error('Configure the existing news relay on this Mac first.');
mkdirSync(logs, { recursive: true, mode: 0o700 });
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>UserName</key><string>${escaped(taskUser.username)}</string>
<key>ProgramArguments</key><array><string>${escaped(nodeBinary)}</string><string>--disable-warning=MODULE_TYPELESS_PACKAGE_JSON</string><string>${escaped(path.join(repo, 'scripts', 'price-alert-monitor.mjs'))}</string></array>
<key>WorkingDirectory</key><string>${escaped(repo)}</string>
<key>EnvironmentVariables</key><dict><key>HOME</key><string>${escaped(taskHome)}</string><key>PATH</key><string>/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>10</integer><key>ExitTimeOut</key><integer>45</integer>
<key>StandardOutPath</key><string>${escaped(path.join(logs, 'service.log'))}</string>
<key>StandardErrorPath</key><string>${escaped(path.join(logs, 'service.error.log'))}</string>
</dict></plist>
`;
const temporary = mkdtempSync(path.join(os.tmpdir(), 'tradingview-price-service-'));
try {
  const generated = path.join(temporary, `${label}.plist`);
  writeFileSync(generated, xml, { mode: 0o600 });
  execFileSync('/usr/bin/plutil', ['-lint', generated], { stdio: 'inherit' });
  stop();
  sudo(['/usr/bin/install', '-o', 'root', '-g', 'wheel', '-m', '644', generated, plist]);
  sudo(['/bin/launchctl', 'bootstrap', 'system', plist]);
  execFileSync('/bin/launchctl', ['print', `system/${label}`], { stdio: 'inherit' });
  console.log(`Installed ${label} as ${taskUser.username}; starts at boot without login.`);
} finally { rmSync(temporary, { recursive: true, force: true }); }
