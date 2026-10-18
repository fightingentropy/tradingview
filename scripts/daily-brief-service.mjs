import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';

// The daily brief now runs as a Cloudflare Workflow. This only retires the old
// Mac mini LaunchDaemon that ran the Codex research job.
const label = 'com.erlinhoxha.tradingview-daily-brief';
const action = process.argv[2] ?? 'status';
const plist = `/Library/LaunchDaemons/${label}.plist`;
const sudo = args => execFileSync('/usr/bin/sudo', ['-n', ...args], { stdio: 'inherit' });
if (process.platform !== 'darwin' || os.userInfo().uid === 0) throw new Error('Run as the Mac mini service user with sudo access.');
if (action === 'status') {
  console.log(existsSync(plist) ? `${label} is still installed; run "uninstall" to retire it.` : `${label} is not installed.`);
} else if (action === 'uninstall') {
  try { sudo(['/bin/launchctl', 'bootout', `system/${label}`]); } catch { /* Already unloaded. */ }
  if (existsSync(plist)) sudo(['/bin/rm', plist]);
  console.log(`Retired ${label} on ${os.hostname()}. The brief is published by the tradingview-web Worker.`);
} else {
  throw new Error('Usage: daily-brief-service.mjs [status|uninstall]');
}
