# News feed service contract

In development, the app reads from `http://127.0.0.1:8430/feed`. Run
`npm run news:server` to start the localhost bridge. Its X source intentionally
matches YinYang: the local `bird` CLI reads list `1933193197817135501` using the
existing browser-cookie login, so no X developer account or token is required.

Telegram posts are read from the public web feeds for these configured channels:

- `@tradfi_t3`
- `@trad_fin`
- `@WatcherGuru`
- `@chain_alerts`
- `@dbnewsdelayed`
- `@tradexyz_announcements`
- `@hyperliquid_announcements`

No Telegram credentials are needed for channels that expose public message
history. The response includes a notice when a configured channel disables that
history and therefore needs an authenticated Telegram user session. Run
`npm run telegram:login` once; the API ID, hash, and reusable session are stored
in macOS Keychain.

The production relay is deployed at
`https://tradingview-news-relay.erlinhoxha.workers.dev`. The Mac bridge signs each
snapshot with an ingest secret, then publishes it to the relay. Cloudflare KV holds
the latest normalized feed and registered Expo push tokens. Both relay secrets are
stored in macOS Keychain and Cloudflare encrypted secret bindings.

The app uses `EXPO_PUBLIC_NEWS_FEED_URL` and
`EXPO_PUBLIC_NEWS_RELAY_ACCESS_TOKEN`. The access token is a lightweight guard for
this personal app, not a confidential upstream credential: like every
`EXPO_PUBLIC_*` value it is embedded in the client bundle. X cookies, Telegram API
credentials, the Telegram session, and the relay ingest secret never ship in the app.

Deploy or update the relay with `npm run relay:deploy`. Wrangler validates the
Worker, provisions its KV namespace, uploads the encrypted secrets, and stores the
workers.dev URL in Keychain for the background bridge.

## Request

```http
GET /feed?source=all&limit=40
Accept: application/json
Authorization: Bearer app-access-token
```

`source` is `all`, `x`, or `telegram`.

## Response

```json
{
  "items": [
    {
      "id": "x:1900000000000000000",
      "source": "x",
      "author": {
        "name": "Example Research",
        "handle": "example",
        "avatarUrl": "https://..."
      },
      "text": "Post or channel message text",
      "publishedAt": "2026-07-10T10:30:00.000Z",
      "url": "https://x.com/example/status/1900000000000000000",
      "media": [{ "type": "image", "previewUrl": "https://..." }]
    }
  ],
  "notices": [],
  "updatedAt": "2026-07-10T10:31:00.000Z"
}
```

The client discards malformed items and any non-HTTPS links.

## Local X bridge

The included bridge:

- Binds to loopback only by default.
- Runs `bird list-timeline 1933193197817135501 --json-full` without a shell.
- Normalizes author details, media previews, timestamps, and canonical X links.
- Keeps a short in-memory cache so filter changes do not repeatedly hit X.
- Never logs tweet bodies or browser-cookie credentials.
- Fetches the configured Telegram public feeds independently, so one unavailable
  channel does not blank the others.
- Polls once per minute when installed with `npm run news:install`, detects only
  newly published items, and publishes an HMAC-authenticated snapshot to the relay.
- Persists push tokens and the seen-item watermark in the user's Application
  Support directory with user-only permissions.

The Cloudflare relay:

- Requires a separate bearer token for feed reads and device registration.
- Stores each device token under its own hashed KV key, avoiding shared-key write races.
- Sends no notifications on the initial snapshot, then deduplicates later snapshots.
- Sends at most three individual news alerts plus one summary per poll.
- Checks Expo push receipts and removes devices reported as unregistered.
- Keeps preview URLs disabled and emits structured Worker logs.

The loopback address works from the iOS simulator on the same Mac. Physical devices
use the authenticated HTTPS relay; do not expose the local bridge to the LAN by
changing its host.

## Push provisioning

The app asks for notification permission only when **Settings → News Alerts → Push
notifications** is enabled. It obtains the Expo push token using the EAS project ID,
registers it with the relay, and routes notification taps to the News tab. Apple push
credentials still need to be configured once through EAS for the paid Apple Developer
team before installing the physical-device build.
