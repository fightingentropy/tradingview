# Mac mini price monitoring

Price thresholds are evaluated by a separate Node service on the Mac mini. The phone
syncs alert rules over HTTPS and receives Expo/APNs notifications when the app is
closed. Cloudflare stores rules, trigger history and notification delivery state; it
does not poll market prices. No trading credentials or order operations are involved.

## Runtime

- Service: `com.erlinhoxha.tradingview-price-alerts`, a system LaunchDaemon running
  as the Mac mini's regular service user, starting at boot without an interactive login.
- Node 22 or newer with native TypeScript stripping and WebSocket support.
- Hyperliquid and trade.xyz mids arrive over one reconnecting WebSocket. Heartbeats
  run every 15 seconds; a silent connection is replaced after 40 seconds.
- Cboe VIX is polled once per minute when a VIX rule exists. Cboe is delayed data.
- Rule/health sync runs every 15 seconds. Evaluation pauses if the last successful
  rule sync is more than 60 seconds old. Downtime can miss a brief threshold crossing;
  it is not reconstructed from historical ticks.
- A localhost-only TCP socket at `127.0.0.1:3401` prevents duplicate service instances.
  It exposes no commands or HTTP endpoint. Set `PRICE_ALERT_LOCK_PORT` to move it.

The existing news relay configuration is read from Keychain or
`~/Library/Application Support/TradingView News/relay.json`. Do not print, copy into
source control, or rotate its credentials during a price-monitor update. Price state
is stored separately in `~/Library/Application Support/TradingView Price Alerts/`.
Trigger state is fsynced before dispatch, survives restarts, and refuses to silently
reset if corrupted. `health.json` contains health timestamps and counts, without
push tokens or rule contents. Logs are under `~/Library/Logs/TradingView Price Alerts/`.

## Install or update

Deploy the relay with `npx wrangler deploy` after `npm run check`. The first deployment
adds the `MacMiniAlertRelay` SQLite Durable Object migration. Preserve the existing
`APP_ACCESS_TOKEN`, `BRIDGE_SECRET`, and news KV binding.

Copy these files into a dedicated directory on the Mac mini, retaining their paths:

- `scripts/price-alert-monitor.mjs`
- `scripts/price-alert-service.mjs`
- `scripts/news-relay-keychain.mjs`
- `src/domain/priceAlerts.ts`

Run `node scripts/price-alert-service.mjs install` there as the regular service user
with noninteractive sudo access. The installer changes only the price-alert service,
not the existing news service. `status` shows launchd status; `stop` stops this service.
A running service with fresh `health.json` source timestamps and successful relay
check-ins proves monitoring health. It does not prove a notification reached a phone.

## Phone behavior

Enable **Settings → Price alerts → Monitor on Mac mini**. Settings shows whether changes
have reached the relay and whether the Mac mini has acknowledged them. An unacknowledged
disable stays pending and retries across launches. Previous remote rules may remain
active until a change is acknowledged. The app must be open to sync new changes.

Each alert has a generation, replaced on rearm. Completed generations stay completed
through a disable/re-enable or push-token change. Incoming notifications cannot trigger
a deleted or newer generation. The phone's local foreground watcher is suspended while
remote monitoring is enabled; with it off, alerts are in-app only. Earlier background
fetch registrations are removed on upgrade.

Push delivery is tracked separately from the threshold crossing: queued, sending,
accepted, sent, failed, or unconfirmed. A lost send response is left unconfirmed and
is not blindly resent. A provider receipt is not proof that iOS displayed the banner.
Explicit provider rejection can retry with bounded backoff. Rearm/delete/disable is
checked again before any queued notification dispatch.

Run `npm test` for pure, daemon-fault and real-workerd relay tests. All automated
outbound notification requests are mocked; no real orders or notifications are sent.
