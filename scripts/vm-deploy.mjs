import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Ships the news bridge and price-alert monitor to the Linux VM: only the files
// they import, their npm packages at the lockfile versions, and the systemd units.
// Bun installs the packages and runs both services.
const ENTRIES = ['scripts/news-feed-server.mjs', 'scripts/price-alert-monitor.mjs'];
const args = process.argv.slice(2);
const start = !args.includes('--no-start');
const host = args.find((value) => !value.startsWith('--')) ?? 'oracle';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(readFileSync(path.join(repo, 'package-lock.json'), 'utf8'));

const files = new Set(['scripts/linux-services.mjs']);
const packages = new Set();
for (const entry of ENTRIES) {
  const result = await build({
    entryPoints: [path.join(repo, entry)], absWorkingDir: repo, bundle: true, platform: 'node',
    format: 'esm', packages: 'external', write: false, metafile: true, logLevel: 'silent',
  });
  for (const [file, input] of Object.entries(result.metafile.inputs)) {
    files.add(file);
    for (const { path: specifier, external } of input.imports) {
      if (!external || specifier.startsWith('node:')) continue;
      packages.add(specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/'));
    }
  }
}
const dependencies = Object.fromEntries([...packages].sort().map((name) => {
  const version = lock.packages[`node_modules/${name}`]?.version;
  if (!version) throw new Error(`${name} is missing from package-lock.json`);
  return [name, version];
}));

const staging = mkdtempSync(path.join(tmpdir(), 'tradingview-vm-'));
try {
  for (const file of files) {
    mkdirSync(path.join(staging, path.dirname(file)), { recursive: true });
    cpSync(path.join(repo, file), path.join(staging, file));
  }
  writeFileSync(path.join(staging, 'package.json'), `${JSON.stringify({
    name: 'tradingview-services', private: true, type: 'module', dependencies,
  }, null, 2)}\n`);
  const archive = execFileSync('/usr/bin/tar', ['-czf', '-', '-C', staging, '.']);
  const remote = [
    'set -e', 'R="$HOME/tradingview-services"', 'BUN="$HOME/.bun/bin/bun"',
    'rm -rf "$R.next" && mkdir -p "$R.next" && tar -xzf - -C "$R.next"',
    'cd "$R.next" && "$BUN" install --production --no-progress',
    'rm -rf "$R.previous" && if [ -d "$R" ]; then mv "$R" "$R.previous"; fi && mv "$R.next" "$R"',
    `"$BUN" "$R/scripts/linux-services.mjs" install${start ? '' : ' --no-start'}`,
  ].join('\n');
  execFileSync('ssh', ['-o', 'BatchMode=yes', host, remote], { input: archive, stdio: ['pipe', 'inherit', 'inherit'] });
  console.log(`Deployed ${files.size} files and ${Object.keys(dependencies).join(', ')} to ${host}:~/tradingview-services.`);
} finally { rmSync(staging, { recursive: true, force: true }); }
