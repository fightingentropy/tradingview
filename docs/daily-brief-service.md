# Daily brief service

The brief is researched and published by the `tradingview-web` Worker on
Cloudflare with the Claude API. Neither the Mac mini nor the laptop needs to be
on for it; the Mac mini only keeps feeding the news relay that the brief reads.

## Schedule and failure handling

- An hourly cron (`0 * * * *`) checks the Europe/London clock. From 08:00 London,
  including weekends and daylight-saving changes, it starts one Cloudflare
  Workflow instance named `daily-brief-YYYY-MM-DD`. Later cron ticks see that
  instance and leave it alone.
- An edition already in the public index for the London date is never
  regenerated or overwritten.
- The research step retries after 30, 60, then 120 minutes: four attempts per
  day. Each attempt has a 45-minute limit. The last published edition stays
  online until a new one is published.
- Completed Workflow steps are durable. A publication failure retries the exact
  validated edition (up to six times, with exponential backoff from one minute)
  without paying for research again.
- Every step stops for good once the London day has ended, so yesterday's
  research is never published as today's brief.

## Research and evidence

`worker/daily-brief.ts` sends the versioned `docs/BRIEF.md` contract (bundled as
text), the previous edition and the latest news relay items to
`claude-opus-5-5` with adaptive thinking at `high` effort. Claude researches
with server-side web search (up to 30 searches) and web fetch (up to 20 pages),
then calls a `submit_brief` tool with the headline and Markdown.

The relay items are the brief's CT, Telegram, Digg and Paste Trade evidence: the
curated X list, the Telegram channels BRIEF.md names, the Digg homepage and Paste
Trade, as last ingested from the Mac mini bridge, limited to the past 72 hours.
`scripts/ct-pulse.mjs` is not part of the cloud brief, so there is no Following or
Home / For You sample. A missing or stale relay is disclosed in Data Caveats.

The runner stamps the `Generated:` line with the exact submission time and runs
the shared `validateFreshBrief` checks: the eight sections in order, five or more
source links, 700–1,000 words, and Base, Alternative and Tail probabilities
totalling 100%. A failed check goes back to Claude as a tool error so it can
correct the brief, up to three submissions per attempt. Probability validation
reads the case labels only; yields and returns in the explanations do not count.

Requests opt into server-side refusal fallbacks (`fallbacks: "default"`), so a
safety-classifier decline is retried on Anthropic's recommended fallback model.
Each Claude request logs its token and server-tool usage as a `claude_usage` event
in the Worker's observability logs.

## Credentials and deployment

`ANTHROPIC_API_KEY` is a Worker secret on both `tradingview-web` and
`tradingview-news-relay`. Store the key once in macOS Keychain; you are prompted
for it, so it never appears in shell history:

```sh
security add-generic-password -U -s com.erlinhoxha.tradingview.anthropic -a api-key -w
```

`npm run web:deploy` and `npm run relay:deploy` read it from Keychain and upload
it with the Worker version. Writes to `DAILY_BRIEFS` go through the Worker's KV
binding; no Wrangler sign-in or write endpoint is involved.

`web/scripts/publish-daily-brief.ts` remains for manual publication and the first
`--initialize`. Do not run it while a Workflow instance for the same day is
publishing.

## Evidence and troubleshooting

Workflow instances, step attempts and errors are listed under **Workers &
Pages → Workflows → tradingview-daily-brief** in the Cloudflare dashboard. Check the
exact public index and dated content at `https://trade.erlin.org/api/daily-briefs`
before claiming a publication succeeded.

## Retiring the Mac mini job

The old `com.erlinhoxha.tradingview-daily-brief` LaunchDaemon ran Codex on the Mac
mini. On the Mac mini, from the service checkout, as the service user with sudo
access:

```sh
node scripts/daily-brief-service.mjs uninstall
```

## Native iPhone reader

The iPhone app opens **News → Daily brief** by default. It reads the same public
index and dated editions as the website, so new publications need no app update.
Both renderers use the shared publication validation and safe
Markdown parser in `@tradingview/shared`; the content, timestamps and sources stay identical. Both readers
show only the latest edition, with no archive picker or bundled historical fallback.
Each publication replaces the discovery index with its single current entry.

The reader refreshes the index on focus, app foreground and every five minutes
while open. Pull to refresh checks the index and current edition. A newer
publication automatically replaces the previous one. The latest loaded public
edition uses the app's existing 24-hour cache, with its original date and a
refresh warning when the network fails. Private News feeds retain their separate
cache policy.

Native feed checks run with `npm run test:daily-brief` and are included in
`npm run check`. Build simulator and physical targets sequentially: ExpoModulesJSI
uses a shared native build directory even when app DerivedData paths differ.
