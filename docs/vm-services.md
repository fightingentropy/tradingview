# Oracle VM services

The news bridge and the price-alert monitor run on the Oracle VM
(`oracle-free-01`, Ubuntu 24.04 on arm64) as the `ubuntu` user. They need a
logged-in X session and a long-lived Hyperliquid connection, which Cloudflare
Workers cannot hold. The AI steps (news pulse and daily brief) run on Cloudflare;
see [the daily brief service](daily-brief-service.md).

| systemd unit | Entry point | What it does |
| --- | --- | --- |
| `tradingview-news` | `scripts/news-feed-server.mjs` | Collects the X list, Telegram, Digg and Paste Trade, and publishes signed snapshots to the news relay. Listens on `127.0.0.1:8430`. |
| `tradingview-price-alerts` | `scripts/price-alert-monitor.mjs` | Watches Hyperliquid prices and delivers alerts through the relay. |

## Deploying

From this repository on the laptop:

```sh
node scripts/vm-deploy.mjs oracle
```

The script uses esbuild to find the files the two services import, ships only
those plus a `package.json` with their npm packages at the lockfile versions,
runs `npm install` on the VM and installs and restarts both units. The previous
release stays at `~/tradingview-services.previous`; to roll back, move it back to
`~/tradingview-services` and run `node ~/tradingview-services/scripts/linux-services.mjs start`.
Pass `--no-start` to install without restarting.

On the VM, `node ~/tradingview-services/scripts/linux-services.mjs status|start|stop`
manages both units. Logs: `journalctl -u tradingview-news -u tradingview-price-alerts`.

## Credentials and state

All files are mode `0600` in `0700` directories and are never committed.

- `~/.hermes/secrets/bird-credentials.json`: the X `auth_token` and `ct0`, read by
  the `~/.local/bin/bird` wrapper, which runs `~/.local/bin/bird.real`.
- `~/Library/Application Support/TradingView News/relay.json`: the relay URL,
  access token and bridge secret. `seen-news.json` beside it is the push watermark.
- `~/Library/Application Support/TradingView Price Alerts/`: the monitor's trigger state.
- Telegram channels are read from their public pages. For a logged-in session,
  `scripts/telegram-keychain.mjs` falls back to `telegram.json` in the news
  directory, or `TELEGRAM_CREDENTIALS_FILE`, when there is no macOS Keychain.

## Tools

- `bird` is built on the VM from `~/Developer/bird` (Linux uses the plain libcurl
  transport): `cargo build --release --locked -p bird-cli` in `~/src/bird`, then
  install `target/release/bird` as `~/.local/bin/bird.real`.
- curl-impersonate v2.2.3 for arm64 Linux lives in
  `~/.local/opt/curl-impersonate-v2.2.3`. The units point the Digg adapter at its
  `curl_chrome136` through `CURL_IMPERSONATE_PATH`.
