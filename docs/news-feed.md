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
- `@hyperliquid_announcements`

No Telegram credentials are needed for channels that expose public message
history. The response includes a notice when a configured channel disables that
history and therefore needs an authenticated Telegram user session. Run
`npm run telegram:login` once; the API ID, hash, and reusable session are stored
in macOS Keychain.

Digg stories are read from the ranked Top Tech Stories at `https://digg.com/tech`.
The bridge extracts each story's stable cluster ID, headline, summary, creation time,
and canonical Digg link. No Digg account or credential is required.

Paste trade calls are read from the public show index and show-detail endpoints at
`https://app.paste.trade`. The signed-in global feed is not used. The bridge selects shows
active within the last 14 days, refreshes details only when a show's latest-published timestamp
changes, and turns each recent source into a compact card containing up to six extracted
LONG/SHORT theses. No Paste account, session, or credential is required.

The production relay is deployed at
`https://tradingview-news-relay.erlinhoxha.workers.dev`. The Mac bridge signs each
snapshot with an ingest secret, then publishes it to the relay. Cloudflare KV holds
the latest normalized feed and per-device Expo push subscriptions. Both relay secrets are
stored in Cloudflare encrypted secret bindings. The always-on Mac mini keeps its copy in
`~/Library/Application Support/TradingView News/relay.json` with user-only permissions;
the bridge also supports macOS Keychain for interactive installations.

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

`source` is `all`, `x`, `telegram`, `digg`, or `paste`.

## Response

```json
{
  "executiveSummary": {
    "formatVersion": 2,
    "generatedAt": "2026-07-12T20:00:00.000Z",
    "headline": "Markets weigh a concentrated set of catalysts",
    "overview": "A crisp summary of what changed and what matters.",
    "pulse": {
      "label": "mixed",
      "summary": "Risk appetite is uneven while confirmation remains limited."
    },
    "bullets": [
      {
        "headline": "The material development",
        "summary": "The collapsed executive bullet.",
        "marketImpact": "The market relevance.",
        "details": "Expanded context, uncertainty, and corroboration.",
        "change": "new",
        "confidence": "confirmed",
        "sources": [
          {
            "source": "x",
            "author": "Primary source",
            "url": "https://x.com/source/status/123"
          }
        ]
      }
    ],
    "secondarySignals": ["A lower-priority development."],
    "watchNext": ["The next confirmation to monitor."],
    "noiseSummary": "Duplicates and unsupported reactions were excluded.",
    "model": "gpt-5.6-sol",
    "reasoningEffort": "xhigh"
  },
  "items": [
    {
      "id": "b9d9b03b-3021-4391-9ba6-0342072f8e96",
      "source": "digg",
      "author": {
        "name": "Digg Tech",
        "handle": "tech"
      },
      "text": "Tech story headline and summary",
      "publishedAt": "2026-07-10T10:30:00.000Z",
      "url": "https://digg.com/tech/example-story",
      "media": []
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
- Fetches Digg Tech independently, so a temporary Digg failure does not blank X or Telegram.
- Fetches Paste independently and reuses unchanged show histories, so its larger public payloads
  are not downloaded on every scheduler tick.
- Runs a lightweight scheduler once per minute when installed with `npm run news:install`.
  Upstream pulls are cached independently: X refreshes hourly, Telegram every five minutes,
  Digg hourly, and Paste hourly. Each scheduler tick detects newly published items and publishes an
  HMAC-authenticated snapshot to the relay without re-fetching sources that are still fresh.
- Builds a new executive pulse once per hour from up to six hours of recent source context. The
  format is deliberately terse: a nine-word headline, a two-sentence lead, exactly three ranked
  developments with change and confidence labels, optional secondary signals, and two watch items.
  It
  invokes the Mac mini's authenticated Codex CLI in an ephemeral, read-only session with
  `gpt-5.6-sol`, `xhigh` reasoning, web search disabled, and a strict JSON output schema.
- Persists the last valid pulse under `~/Library/Application Support/TradingView News/` and keeps
  serving it if a later Codex run fails. Failed runs retry after 15 minutes without interrupting
  the raw feed or relay publication. Summary runs have a 55-minute guard and never block the
  one-minute source scheduler while Codex is reasoning.
- Persists push tokens and the seen-item watermark in the user's Application
  Support directory with user-only permissions.

The Cloudflare relay:

- Requires a separate bearer token for feed reads and device registration.
- Stores each device token under its own hashed KV key, avoiding shared-key write races.
- Stores an allow-list with each token for the X list and individual Telegram channels;
  legacy token-only registrations safely default to every configured source.
- Sends no notifications on the initial snapshot, then deduplicates later snapshots.
- Filters every fresh batch per device, then sends at most three allowed alerts plus one
  summary per poll.
- Checks Expo push receipts and removes devices reported as unregistered.
- Keeps preview URLs disabled and emits structured Worker logs.

The loopback address works from the iOS simulator on the same Mac. Physical devices
use the authenticated HTTPS relay; do not expose the local bridge to the LAN by
changing its host.

## Push provisioning

The app asks for notification permission only when **Settings → News Alerts → Push
notifications** is enabled. The master switch is followed by one switch for the X list
and one for every configured Telegram channel. Changing a source switch immediately
updates that device's relay allow-list; disabling the last selected source turns the
master switch off and unregisters the device. The app obtains the Expo push token using
the EAS project ID and routes notification taps to the News tab.

Apple push key `9MRJ86RC8V` is assigned to `com.erlinhoxha.tradingview` on team
`T29NU9NCA2`. EAS also has an active ad-hoc profile containing Erlin's iPhone.
