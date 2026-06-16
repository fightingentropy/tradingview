# TradingView Clone (Expo)

A fast, snappy TradingView-style mobile app: watchlists of ticker symbols showing
where they trade, tap a symbol for a live candlestick chart.

## Data sources

- **Hyperliquid** (`https://api.hyperliquid.xyz`) — crypto perps + spot, fully public/keyless,
  REST snapshot + WebSocket streaming (`allMids`, `candle`).
- **trade.xyz** — equity / commodity / FX perps (HIP-3 `xyz` dex), reached through the *same*
  Hyperliquid endpoints. Also keyless.
- **Twelve Data** — real exchange-listed US stocks (NASDAQ/NYSE), proxied server-side.
  Optional: set `TWELVE_DATA_KEY` in `.env` (free key at https://twelvedata.com). Inert without it.
- **Cboe** — the real CBOE Volatility Index (**VIX**) via Cboe's free public delayed-quotes CDN
  (`cdn.cboe.com`). Keyless; fetched directly (quote + daily/intraday OHLC history).

## Stack

Expo SDK 56 (New Architecture) · Expo Router · React Query + Zustand · MMKV · FlashList v2 ·
Victory Native XL + Skia + Reanimated (chart) · Expo Router API routes (stocks proxy).

## Run (iOS-first, dev build — not Expo Go)

The native stack (Skia, MMKV, Reanimated) requires a custom dev client.

```bash
npx expo run:ios          # build + launch on the iOS simulator
# then, for subsequent JS work, just:
npx expo start            # Fast Refresh over the dev client
```

> The dev client connects to the React Native default port **8081**. If another Metro server
> is already on 8081, free it first (the dev client ignores `--port` overrides in this SDK).

To enable real stocks: add `TWELVE_DATA_KEY=...` to `.env`, restart `expo start`.

## Structure

```
src/app/            Expo Router routes (tabs: Watchlist | Markets | Settings; symbol/[id]; api/stocks/*)
src/providers/      hyperliquid/ (rest, ws, coins, provider) · stocks/ · registry
src/data/           React Query hooks (useMarkets, useCandles, useLivePriceFeed)
src/store/          Zustand stores (watchlists + MMKV persistence, live prices)
src/components/     SymbolRow, PriceChart, TimeframeBar, VenueBadge, WatchlistTabs, ui/
scripts/hl-probe.mjs  Dev script to inspect live Hyperliquid response shapes
```
