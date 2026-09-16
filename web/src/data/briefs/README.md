# Daily market brief

The page publishes a newly researched edition each day. The editorial contract
is [BRIEF.md](../../../../docs/BRIEF.md), copied from the user's `brief` task.
When available, read the latest original at
`/Users/erlinhoxha/Documents/Codex/2026-07-09/public-equity-investing-plugin-public-equity/BRIEF.md`.

## Daily workflow

The Mac mini service starts research at **08:00 Europe/London every day**.
It runs at boot as the `hermes` service user and uses the authenticated Codex CLI;
neither the laptop nor a desktop app needs to stay open. Publication follows
research and verification; 08:00 is the start time, not a promised completion time.
See [Mac mini operation](../../../../docs/daily-brief-service.md) for installation,
retry behavior, status and logs. The original laptop heartbeat is paused.

1. Read the latest published edition from
   `https://trade.erlin.org/api/daily-briefs` and its dated endpoint.
2. Research current primary releases, direct market data and material news.
   Follow BRIEF.md's supplementary feed checks and disclose real coverage gaps.
   On weekends and holidays, use the last close and a fresh next-session setup.
3. Write a new 700–1,000-word Markdown brief to a temporary staging file. Include
   the exact London timestamp, market state, data cutoff, all eight core sections,
   claim-level source links, and three judgmental scenarios totalling 100%.
4. From the repository root, validate and publish with the same headline:

   ```sh
   bun web/scripts/publish-daily-brief.ts --file /absolute/path/to/edition.md --title "Headline" --dry-run
   bun web/scripts/publish-daily-brief.ts --file /absolute/path/to/edition.md --title "Headline"
   ```

5. Verify today's entry and exact content through the public API. KV propagation
   and the edge/browser cache can take a few minutes. Report a failure if current
   evidence cannot be verified; leave the previous edition available.

The publisher uses the existing authenticated Wrangler CLI. No credentials or
write endpoint are exposed to the browser. It refuses stale/future dates,
invalid structure, missing citations, and overwrites of an existing dated
edition. Re-running the exact same edition is safe. Do not run concurrent
publishers or use `--initialize` after the first publication.

## Storage and reader

Cloudflare KV binding `DAILY_BRIEFS` stores each edition separately under
`edition:v1:YYYY-MM-DD`. `index:v1` contains dates/headlines only and is published
last, after all content writes succeed. The publication process retains all
previous editions. No frontend rebuild or Git commit is needed for daily content.

The reader loads the index and fetches editions on demand, with safe Markdown
rendering, archive navigation, source links, and a Markdown download. It checks
for new publications every five minutes while visible and when returning to
the tab. Later publications do not interrupt an edition already being read.
Missing editions are never synthesized or relabeled as today's news.

Bundled editions provide an honest dated fallback if the feed is unavailable.
The initial 7 September, 5 September, and 25 August 2026 editions preserve final
responses from task `brief` (`019f4806-e3d3-70d1-84f0-2d83dfa6d712`). The
16 September edition is fresh research prepared during this feature's setup.

## Validation

```sh
bun run --cwd web check
node --test scripts/web-daily-brief.test.mjs scripts/web-calendar-proxy.test.mjs scripts/web-routing.test.mjs
```

Tests cover publication freshness, source-safe rendering, index integrity,
scenario totals, missing storage, read-only API behavior, and existing routes.
