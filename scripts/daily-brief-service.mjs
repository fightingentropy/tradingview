import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const label = 'com.erlinhoxha.tradingview-daily-brief';
const action = process.argv[2] ?? 'status';
const taskUser = os.userInfo();
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const plist = `/Library/LaunchDaemons/${label}.plist`;
const logs = path.join(taskUser.homedir, 'Library/Logs/TradingView Daily Brief');
const runtime = path.join(taskUser.homedir, 'Library/Application Support/TradingView Daily Brief/runtime');
const wrangler = process.env.DAILY_BRIEF_WRANGLER ?? path.join(runtime, 'node_modules/.bin/wrangler');
const escaped = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const sudo = args => execFileSync('/usr/bin/sudo', ['-n', ...args], { stdio: 'inherit' });
const stop = () => { try { sudo(['/bin/launchctl', 'bootout', `system/${label}`]); } catch { /* May not be installed yet. */ } };
if (process.platform !== 'darwin' || taskUser.uid === 0) throw new Error('Run as the Mac mini service user with sudo access.');
if (action === 'status') { execFileSync('/bin/launchctl', ['print', `system/${label}`], { stdio: 'inherit' }); process.exit(0); }
if (action === 'stop') { stop(); process.exit(0); }
if (action !== 'install') throw new Error('Usage: daily-brief-service.mjs [install|status|stop]');
if (!existsSync('/opt/homebrew/bin/bun') || !existsSync(wrangler)) throw new Error('Install Bun and the dedicated Wrangler runtime first.');
mkdirSync(logs, { recursive: true, mode: 0o700 });
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>UserName</key><string>${escaped(taskUser.username)}</string>
<key>ProgramArguments</key><array><string>/opt/homebrew/bin/bun</string><string>${escaped(path.join(repo, 'web/scripts/daily-brief-job.ts'))}</string></array>
<key>WorkingDirectory</key><string>${escaped(repo)}</string>
<key>EnvironmentVariables</key><dict>
<key>HOME</key><string>${escaped(taskUser.homedir)}</string>
<key>PATH</key><string>${escaped(path.join(taskUser.homedir, '.local/bin'))}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
<key>TZ</key><string>Europe/London</string>
<key>NODE_OPTIONS</key><string>--dns-result-order=ipv4first</string>
<key>DAILY_BRIEF_WRANGLER</key><string>${escaped(wrangler)}</string>
<key>WRANGLER_SEND_METRICS</key><string>false</string>
</dict>
<key>RunAtLoad</key><true/>
<key>StartCalendarInterval</key><dict><key>Hour</key><integer>8</integer><key>Minute</key><integer>0</integer></dict>
<key>StartInterval</key><integer>900</integer>
<key>ProcessType</key><string>Background</string>
<key>ExitTimeOut</key><integer>30</integer>
<key>StandardOutPath</key><string>${escaped(path.join(logs, 'service.log'))}</string>
<key>StandardErrorPath</key><string>${escaped(path.join(logs, 'service.error.log'))}</string>
</dict></plist>`;
const temporary = mkdtempSync(path.join(os.tmpdir(), 'tradingview-brief-service-'));
try {
  const generated = path.join(temporary, `${label}.plist`);
  writeFileSync(generated, xml, { mode: 0o600 });
  execFileSync('/usr/bin/plutil', ['-lint', generated], { stdio: 'inherit' });
  stop();
  sudo(['/usr/bin/install', '-o', 'root', '-g', 'wheel', '-m', '644', generated, plist]);
  sudo(['/bin/launchctl', 'bootstrap', 'system', plist]);
  console.log(`Installed ${label} on ${os.hostname()} as ${taskUser.username}; starts at boot and checks the London publication schedule.`);
} finally { rmSync(temporary, { recursive: true, force: true }); }
