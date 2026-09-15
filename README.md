# TradingView

A native Expo app and a SolidJS web terminal in one repository. The native app
provides watchlists, charts, news and Hyperliquid account tools. The web app in
`web/` is the former xyz-dex terminal, including its existing Convex backend,
paper ledger, API-wallet trading, portfolio, research and multi-chart views.

## Web app

Live: https://trade.erlin.org

```sh
npm run web:install      # Bun 1.3.10; isolated web dependencies
npm run web              # Vite at http://localhost:3000
npm run web:check        # UI/backend types, tests and production build
npm run web:deploy       # build web/dist and publish the TradingView Worker
```

Copy `web/.env.example` to the appropriate local environment file and configure
`VITE_CONVEX_URL`. The existing production Convex deployment is retained. Backend
secrets stay in Convex. See [web/README.md](web/README.md) for backend setup,
API-wallet behavior and the hostname change.

The native and web packages intentionally keep independent dependencies and
compilers. `npm run check` validates the native app and relays; `npm run web:check`
validates the web package. CI runs both. The old Expo web UI is removed.


## Data sources

- **Hyperliquid** (`https://api.hyperliquid.xyz`) — crypto perps + spot, fully public/keyless,
  REST snapshot + WebSocket streaming (`allMids`, `candle`).
- **trade.xyz** — real US stocks plus commodity / FX perps (HIP-3 `xyz` dex), reached through the
  *same* Hyperliquid endpoints. Also keyless; the live `xyz` universe drives the catalog directly.
- **Cboe** — the real CBOE Volatility Index (**VIX**) via Cboe's free public delayed-quotes CDN
  (`cdn.cboe.com`). Keyless; fetched directly (quote + daily/intraday OHLC history).
- **News feed service** — a twice-daily weekday Codex executive pulse plus normalized X, Telegram,
  Paste Trade,
  and Digg feeds. In development,
  `npm run news:server` reuses YinYang's local `bird` browser-cookie auth and X list, then
  merges configured Telegram channels plus the public Paste and Digg sources. The installed
  bridge publishes signed snapshots to a protected
  Cloudflare Worker for physical-device feeds and push alerts; see `docs/news-feed.md`.

## Stack

Expo SDK 57 (New Architecture) · Expo Router · React Query + Zustand · MMKV · FlashList v2 ·
Victory Native XL + Skia + Reanimated (chart).

## Run (iOS-first, dev build — not Expo Go)

The native stack (Skia, MMKV, Reanimated) requires a custom dev client.

```bash
npx expo run:ios          # build + launch on the iOS simulator
# then, for subsequent JS work, just:
npx expo start            # Fast Refresh over the dev client
# in a second terminal:
npm run news:server       # X list feed through the local bird CLI
```

Before shipping native changes, smoke-test a bundled Release build with Metro stopped:

```bash
npm run ios:sim:release -- --device <simulator-udid>
```

Run the trading-risk math and Hyperliquid signing regression suite with
`npm run test:trading`.

Install the feed as a per-user background service so it starts automatically at login:

```bash
npm run news:install
```

The service uses the installed Codex CLI at 09:35 and 16:05 `America/New_York`, Monday through
Friday, with `gpt-5.6-sol` and `xhigh` reasoning to filter duplicates and noise into the News tab's
expandable **Pulse** homepage.
The source-specific tabs stay raw and every pulse point links back to its source.

Deploy the authenticated HTTPS relay with `npm run relay:deploy`. Relay credentials
stay in macOS Keychain and Cloudflare encrypted secrets. In the app, enable remote
alerts under **Settings → News Alerts**, then choose the X list and individual Telegram
channels that are allowed to notify this device.

For Telegram channels that hide their public web history, run `npm run telegram:login` once.
The API credentials and reusable session are stored in macOS Keychain, not the repository.

> The dev client connects to the React Native default port **8081**. If another Metro server
> is already on 8081, free it first (the dev client ignores `--port` overrides in this SDK).

## Structure

```
web/                SolidJS/Vite web app, Convex functions and independent Bun lockfile
src/app/            Native Expo Router routes (tabs: Watchlist | Markets | News | Account | Settings)
src/providers/      hyperliquid/ (rest, ws, coins, provider) · cboe/ · registry
src/data/           React Query hooks (useMarkets, useCandles, useLivePriceFeed)
src/store/          Zustand stores (watchlists + MMKV persistence, live prices)
src/components/     SymbolRow, PriceChart, TimeframeBar, VenueBadge, WatchlistTabs, ui/
scripts/hl-probe.mjs  Dev script to inspect live Hyperliquid response shapes
```
