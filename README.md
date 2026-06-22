# TradingView Clone (Expo)

A fast, snappy TradingView-style mobile app: watchlists of ticker symbols showing
where they trade, tap a symbol for a live candlestick chart.

## Data sources

- **Hyperliquid** (`https://api.hyperliquid.xyz`) — crypto perps + spot, fully public/keyless,
  REST snapshot + WebSocket streaming (`allMids`, `candle`).
- **trade.xyz** — real US stocks plus commodity / FX perps (HIP-3 `xyz` dex), reached through the
  *same* Hyperliquid endpoints. Also keyless; the live `xyz` universe drives the catalog directly.
- **Cboe** — the real CBOE Volatility Index (**VIX**) via Cboe's free public delayed-quotes CDN
  (`cdn.cboe.com`). Keyless; fetched directly (quote + daily/intraday OHLC history).

## Stack

Expo SDK 56 (New Architecture) · Expo Router · React Query + Zustand · MMKV · FlashList v2 ·
Victory Native XL + Skia + Reanimated (chart).

## Run (iOS-first, dev build — not Expo Go)

The native stack (Skia, MMKV, Reanimated) requires a custom dev client.

```bash
npx expo run:ios          # build + launch on the iOS simulator
# then, for subsequent JS work, just:
npx expo start            # Fast Refresh over the dev client
```

> The dev client connects to the React Native default port **8081**. If another Metro server
> is already on 8081, free it first (the dev client ignores `--port` overrides in this SDK).

## Structure

```
src/app/            Expo Router routes (tabs: Watchlist | Markets | Settings; symbol/[id])
src/providers/      hyperliquid/ (rest, ws, coins, provider) · cboe/ · registry
src/data/           React Query hooks (useMarkets, useCandles, useLivePriceFeed)
src/store/          Zustand stores (watchlists + MMKV persistence, live prices)
src/components/     SymbolRow, PriceChart, TimeframeBar, VenueBadge, WatchlistTabs, ui/
scripts/hl-probe.mjs  Dev script to inspect live Hyperliquid response shapes
```
