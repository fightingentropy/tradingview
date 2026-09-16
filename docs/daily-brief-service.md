# Mac mini daily brief service

The publisher runs on `m4mini` in the isolated checkout
`/Users/hermes/Services/tradingview-daily-brief`. It is a system LaunchDaemon,
`com.erlinhoxha.tradingview-daily-brief`, running as `hermes`. It starts without an
interactive login and does not require the Codex desktop app or the laptop.

## Schedule and failure handling

- Daily research starts at 08:00 Europe/London, including weekends. A fifteen-minute
  check handles reboots, a missed scheduled launch, and bounded retries.
- The date/hour gate uses Europe/London explicitly, including daylight saving.
- A verified edition already published for the London date is never regenerated
  or overwritten. An existing edition is checked through the public API.
- Failed generation retries after 30, 60, then 120 minutes, with four attempts
  maximum per day. The last published edition remains online.
- A loopback-only process lock prevents overlapping research. A separate lock
  serializes publication. The OS releases both locks after termination/reboot.
- Research has a 40-minute limit. Publication runs through the existing validated
  publisher and is followed by public index/content verification, allowing two
  minutes for KV propagation. Timed-out or interrupted child processes are stopped.

## Research and credentials

`web/scripts/daily-brief-job.ts` reads the versioned `docs/BRIEF.md` contract and
the previous publication. It first runs the maintained `scripts/ct-pulse.mjs`
collector, which overwrites only the latest CT source pack. It then runs Codex
with live web search and a scratch workspace. The model returns a structured
headline/Markdown result; the outer runner validates and publishes it.

The service reuses the Mac mini's Codex and Bird sign-ins. Wrangler has its own
renewable Mac mini sign-in for account/user reads and KV storage. Credentials
are stored by the tools, outside the repository and service definition.
The laptop's Codex heartbeat `publish-daily-market-brief` is paused after cutover.

## Runtime and installation

Dependencies:

- `/opt/homebrew/bin/bun` and `/opt/homebrew/bin/node` (stable Homebrew paths)
- `/Users/hermes/.local/bin/codex` and `bird`
- Web dependencies installed with `bun install --cwd web --frozen-lockfile`
- Dedicated Wrangler 4.118.0 runtime under
  `~/Library/Application Support/TradingView Daily Brief/runtime/`

The service prefers IPv4 for Node requests to avoid intermittent IPv6 connection
timeouts on the mini's network.

From the service checkout, as the regular service user with existing sudo access:

```sh
node scripts/daily-brief-service.mjs install
node scripts/daily-brief-service.mjs status
```

The installer changes only this daily-brief service. For a complete fresh research
check without changing the live publication:

```sh
bun web/scripts/daily-brief-job.ts --research-only
```

Run `node scripts/daily-brief-service.mjs stop` to unload the job. Its definition
remains available for reinstalling. Update the dedicated checkout deliberately;
the scheduled job does not pull or execute new repository code automatically.

## Evidence and troubleshooting

State and verified candidates: `~/Library/Application Support/TradingView Daily Brief/`.
`status.json` records the publication date, attempts, host and latest result;
`verification.json` records the last successful research-only test.
Logs: `~/Library/Logs/TradingView Daily Brief/service.log` and `service.error.log`.
Check the exact public index and dated content at
`https://trade.erlin.org/api/daily-briefs` before claiming a publication succeeded.

If credentials expire or a provider is unavailable, renew the affected tool's
sign-in on the Mac mini. Never copy secrets into the repository or plist.

## Native iPhone reader

The iPhone app opens **News → Daily brief** by default. It reads the same public
index and dated editions as the website, so new publications need no app update.
The native renderer uses the web reader's publication validation and safe
Markdown parser; the content, timestamps, sources and archive dates stay identical.

The reader refreshes the index on focus, app foreground and every five minutes
while open. Pull to refresh checks the index and the selected edition. A newer
edition is offered without interrupting the current read. Previously loaded public
editions use the app's existing 24-hour cache, with their original dates and a
refresh warning when the network fails. Private News feeds retain their separate
cache policy.

Native feed checks run with `npm run test:daily-brief` and are included in
`npm run check`. Build simulator and physical targets sequentially: ExpoModulesJSI
uses a shared native build directory even when app DerivedData paths differ.
