# BRIEF.md — Global Macro PM Market Brief

## Purpose

Produce a timely, decision-useful market brief that explains:

- What is happening now
- What changed since the previous brief or session
- The current growth, inflation, liquidity, and volatility regime
- The most important risks, opportunities, and regime shifts
- What would confirm or invalidate the current read
- What matters next

Write in a **direct, decisive, but calibrated global-macro PM style**:

- Lead with the market verdict
- Prioritize signal over narrative
- Separate verified facts, interpretation, and positioning implications
- Never manufacture conviction or precision
- Keep the default brief concise enough to read in chat

---

## Invocation Contract

Interpret short chat requests as follows:

| User request | Output | Target length |
| --- | --- | ---: |
| `update` / `what changed?` | Delta since the previous brief or session; do not repeat unchanged themes | 250–450 words |
| `brief` / `brief me` / `what's happening?` | Standard market brief using the Core Brief format below | 700–1,000 words |
| `full brief` | Core Brief plus all relevant Expanded Research Modules; print in chat and save a dated file | 1,800–3,500 words |
| `brief, focus on <topic>` | Use the requested mode, overweight the named topic, and keep unrelated modules compressed | Mode target |

If no previous brief is available in the current conversation, compare against:

1. The prior close for traded-market moves
2. The last 24–72 hours for news and macro developments
3. The previous comparable data release or earnings period where relevant

User instructions about geography, assets, tickers, themes, or length override these defaults.

---

## Runtime and Market-Status Rules

Start every output with:

```text
Generated: YYYY-MM-DD HH:MM (Europe/London)
Market state: pre-market / open / post-close / weekend / holiday
Data cutoff: <latest common cutoff, plus any material exceptions>
```

Apply these rules:

- Confirm whether relevant cash markets are open before describing moves as live.
- On weekends and market holidays, use the latest close plus subsequent geopolitical, policy, futures, FX, commodity, and crypto developments. Frame the output as the **next-session setup**, not a live cash-equity session.
- Keep live figures on the closest practical common timestamp.
- Never blend pre-market, intraday, and closing prices without labeling each period.
- When sources disagree, use the most authoritative and recent source, disclose the conflict, and avoid false precision.
- If a live figure cannot be verified, omit it or label it as stale/unverified.

### Return and Unit Conventions

- Equities, ETFs, FX, and commodities: change from the relevant prior close unless explicitly labeled otherwise
- Treasury and other yields: level plus change in basis points
- Yield-curve spreads: basis points
- Crypto: 24-hour change unless a session comparison is explicitly more useful
- Volatility: index level plus absolute and percentage change when material
- Economic data: actual, consensus, prior, and revision when available
- Company results: reported period, actual versus consensus/company guidance, and price reaction at a stated cutoff

---

## Evidence and Source Standards

### Source Hierarchy

Prefer, in order:

1. Primary sources: central banks, statistics agencies, Treasury/finance ministries, regulators, exchanges, company filings, investor relations, and official transcripts
2. Direct market data or established market-data providers
3. High-quality reporting such as Reuters, AP, FT, Bloomberg, or equivalent
4. Prediction markets, sell-side commentary, podcasts, and social media as supplementary evidence

Social posts and prediction-market prices are measures of attention, belief, or positioning—not independently verified facts.

### Supplementary News and Trader-View Feeds

Use these public feeds as a fast discovery layer for material developments that may not yet be prominent in conventional reporting:

- **TradFi headlines:** [`@tradfi_t3`](https://t.me/tradfi_t3), [`@trad_fin`](https://t.me/trad_fin), [`@WatcherGuru`](https://t.me/WatcherGuru), and [`@dbnewsdelayed`](https://t.me/dbnewsdelayed)
- **Hyperliquid platform developments:** [`@hyperliquid_announcements`](https://t.me/hyperliquid_announcements)
- **Technology discovery:** [Digg Tech](https://digg.com/tech)
- **Trader theses:** [Paste Trade](https://app.paste.trade)

For `update`, scan the latest relevant posts since the prior brief. For `brief` and `full brief`, use a 24–72-hour window, extending it only when an older item is still driving current price action.

Fetch Digg directly through the maintained TradingView adapter:

```bash
cd /Users/erlinhoxha/Developer/tradingview && node --input-type=module -e 'import { fetchDiggTech } from "./scripts/digg-tech.mjs"; console.log(JSON.stringify(await fetchDiggTech(), null, 2));'
```

The adapter uses `curl-impersonate` with a Chrome TLS fingerprint. Do not start the TradingView news server or use a browser challenge flow merely to retrieve Digg for a brief. The persistent relay/server is optional app infrastructure, not a briefing dependency.

Apply these source-specific rules:

- Treat Telegram headline feeds as fast, aggregated reporting. Follow through to the original report, filing, policy statement, or market data whenever available.
- If the underlying source cannot be verified, link the exact Telegram message and label the claim **reported** rather than confirmed.
- Do not count several channels repeating the same underlying report as independent confirmation.
- Use Digg only for material technology, AI, cybersecurity, semiconductor, platform, or policy developments with plausible market relevance. It is a discovery source, not confirmation.
- Use Paste Trade as named trader-thesis and directional-view evidence. It is not verified news, consensus positioning, or direct flow data.
- Use Hyperliquid announcements as platform-specific evidence only; verify broader market claims independently.
- Exclude `@chain_alerts` and all whale, large-wallet-transfer, or similar on-chain alert feeds. Do not elevate isolated wallet movements into a market thesis.
- Use the underlying feeds only. Do not treat a pre-generated summary of these feeds as an independent source.
- Include only material, non-duplicative items and link the exact source item whenever possible.

### Citation Rules

- Link material claims as close as possible to the relevant sentence or bullet.
- For X/CT claims, name the account and link the exact post.
- Do not rely only on a generic source list at the end.
- Keep direct quotations short; prefer accurate paraphrases.
- Label reported claims, estimates, consensus, inference, and PM judgment distinctly.

### Independent-Signal Rule

Mark something **Actionable alpha** only when it is supported by at least two genuinely independent signals from different evidence categories, such as:

- Price action or market internals
- Primary macro/company data
- Verified news or policy developments
- Options, credit, fund-flow, or positioning data
- Prediction-market changes
- Independently sourced management or industry commentary

Two tweets, two articles repeating the same original report, or several price series driven by the same event do not automatically count as independent confirmation.

### Confidence Tags

- **[High]**: at least three independent confirming categories, including primary or direct market evidence, with no material unresolved contradiction
- **[Med]**: two independent confirming categories, with manageable uncertainty
- **[Low]**: one signal, weak sourcing, or a largely inferential/speculative conclusion

If evidence conflicts, lower confidence and explain the hinge.

### Positioning Language

- Use conditional portfolio implications, not unsupported certainty.
- If no portfolio, benchmark, mandate, or risk limits are supplied, express relative leans and hedging logic without prescribing position size.
- Never invent dealer gamma, CTA thresholds, systematic flows, consensus positioning, or fund exposure. Omit them or label the best available proxy.

---

## Core Brief

Use this structure for `brief`.

### 1) Market Verdict

One or two sentences stating:

- The dominant market regime or shock
- Whether the tape is risk-on, risk-off, rotational, unstable, or consolidating
- The key reason the read matters

### 2) What Changed

Provide 4–7 bullets covering only material changes since the previous brief/session.

Preferred structure:

**Fact → Why it matters → Conditional positioning implication**

Do not repeat an unchanged narrative unless new evidence strengthens, weakens, or invalidates it.

### 3) Regime Assessment

Cover compactly:

- Growth: accelerating / stable / slowing / contractionary
- Inflation: disinflating / sticky / reaccelerating / shock-driven
- Liquidity: easing / neutral / tightening
- Volatility: suppressed / transitioning / unstable / stressed
- Overall regime call and confidence
- The observable signal that would invalidate the call

### 4) Cross-Asset Read

Cover only material developments, normally one or two bullets per relevant asset:

- **Rates:** front end, long end, curve, real yields, and implied policy path
- **FX:** broad USD, key crosses, carry or EM stress
- **Equities:** major indices, equal weight, small caps, breadth, sectors, factors, and leadership
- **Credit:** IG/HY spreads or clearly labeled liquid proxies; refinancing/default stress when evidenced
- **Commodities:** oil, gas, gold, copper, and material macro implications
- **Crypto:** BTC/ETH and other assets only when relevant to liquidity, risk appetite, or the user’s focus

Explicitly distinguish:

- Narrow leadership or rotation
- Broad risk appetite
- A macro shock affecting multiple assets
- A single-company or sector-specific move

### 5) Risk and Opportunity Radar

List:

- Top 2–3 upside developments
- Top 2–3 downside risks
- Explicit confirmation or invalidation levels/events where defensible

Do not fabricate technical levels. Use observable market levels, data thresholds, or dated events.

### 6) What Matters Next

List the 3–5 highest-sensitivity catalysts over the next 72 hours or next trading session:

- Date/time in Europe/London
- Event
- Consensus when reliably available
- Why markets care
- Likely cross-asset reaction under a meaningful beat/upside and miss/downside

If the user asks during a weekend, extend this to the next full trading week.

### 7) PM Bottom Line

Give three exact probabilities that total 100%:

- **Base case:** regime path, market implication, confirmation signal
- **Alternative case:** regime path, market implication, trigger
- **Tail case:** regime path, market implication, trigger

For each case, state a relative overweight/underweight/hedge implication only when supported. Name the reference asset or benchmark where ambiguity would matter.

### 8) Data Caveats

Include only when material. Keep it to 1–4 bullets covering stale data, unavailable sources, conflicting feeds, failed tools, or unsupported flow claims.

---

## Update Format

Use this structure for `update`:

1. Timestamp, market state, and cutoff
2. One-sentence verdict
3. Three to five bullets on what changed
4. One short line on what has **not** changed, if important
5. The next trigger that could change the read
6. Material data caveats only

An update must refresh live evidence. Do not merely restate the previous brief.

---

## Expanded Research Modules

Use these in `full brief`, or when specifically requested. In a standard `brief`, include only a compressed version when the module contains genuinely material new information.

### A) Positioning and Flow

Include only sourced or clearly labeled proxy evidence:

- Consensus and crowded trades
- Options skew, volatility term structure, dealer gamma, CTA/systematic thresholds, or ETF/fund flows
- Sentiment extremes and squeeze risk
- Recent Paste Trade LONG/SHORT theses when they provide relevant named trader color; label them as views, not direct positioning or flow

State the provider, timestamp, and whether the evidence is direct data, an estimate, or a proxy. If credible data is unavailable, write:

`Positioning/flow data unavailable; no unsupported inference included.`

### B) Regime Shifts and Inflections

List up to five high-signal shifts:

- What is changing
- Why it matters
- Observable confirmation
- Observable invalidation
- Relevant time horizon

### C) Polymarket Signal Check

Use only macro-, policy-, geopolitical-, technology-, or market-relevant events. Exclude sports, entertainment, duplicated markets, and high-volume events with no plausible cross-asset relevance.

#### Access and Fallback

1. If the `polymarket` CLI is installed, use it.
2. Otherwise use an accessible public Polymarket web/API source.
3. If neither route works, state the gap and continue the rest of the brief.

Never let this module block the core market brief.

#### Required Event Fields

For the top 3–5 relevant events, provide:

- Event title and direct link
- Current implied probability
- 24-hour probability change, when available
- 24-hour volume
- Liquidity, if decision-relevant
- Data timestamp

Rules:

- Do not call a static probability snapshot “flow.”
- If probability change is unavailable, label the result as a snapshot.
- Keep total event volume separate from 24-hour volume.
- Match the price to the explicitly labeled `Yes` outcome; do not assume the first array element is always `Yes`.
- Highlight the largest probability changes, not merely the highest probabilities.
- Flag event-driven noise, low-liquidity distortions, and narratives based on unverified claims.

Finish with 2–4 bullets explaining whether prediction markets add a durable macro signal or merely reflect headline attention.

### D) CT, Following, and Home Pulse

Primary list:

`https://x.com/i/lists/1933193197817135501`

Run the maintained collector from the Stocks task:

```bash
./scripts/ct-pulse.mjs
```

The collector must:

- Pull 400 CT-list posts and 400 Following-feed posts, then filter both to the latest 24 hours.
- Pull the latest 100 Home / For You posts as a separate algorithmic-attention sample.
- Collapse originals, retweets, compact retweets, and quote amplification into underlying stories.
- Preserve raw concentration diagnostics and cap the balanced synthesis at three stories per author.
- Reserve half of the balanced view for Following-only stories; use CT-only and cross-surface stories for the remainder.
- Keep Home / For You separate from the balanced CT + Following evidence.
- Overwrite `.ct-pulse/latest-ct-pulse.md` and `.ct-pulse/latest-ct-pulse.json`; never create timestamped history.

Use the JSON file as the analysis input and the Markdown file as the auditable source pack with exact X links.

If the collector fails, diagnose Bird/authentication first. A direct Bird fallback may use `bird list-timeline --json -n 400`, `bird home --following --json -n 400`, and `bird home --json -n 100`. Disclose any failure and continue without fabricating social sentiment.

#### Analysis Rules

- Read posts semantically; do not use keyword-only sentiment scoring.
- Distinguish directional stance, conditional stance, sarcasm, news-posting, promotion, and commentary.
- Treat the balanced CT + Following view as the primary social-evidence sample.
- Treat Home / For You as an attention and narrative-distribution lens, not a consensus sample.
- Deduplicate reposts, quote amplification, and repeated news headlines.
- Report sample size, freshness, unique-author count, and material account concentration.
- Weight account diversity; one prolific account must not dominate the conclusion.
- Treat cross-surface visibility as distribution breadth, not independent confirmation.
- Separate sentiment by asset/theme—such as equities, rates, oil, BTC, or HYPE—rather than forcing incompatible views into one aggregate score.
- Treat social claims as reported views unless independently verified.
- Keep social evidence supplementary to verified market, company, and primary-source evidence elsewhere in this brief.

#### Standard-Brief Output

Include only:

- Three to five strongest market signals
- Named accounts and exact tweet links
- Brief `My read`
- Material divergence between the balanced feed and Home / For You
- Noise/feed-quality caveat when material

#### Full-Brief Output

Provide:

- Bullish / bearish / neutral counts by material asset or theme
- Who is bullish, bearish, and watchful, with thesis tags
- Areas of genuine agreement and disagreement
- Five to ten highest-signal observations
- Source diagnostics for CT, Following, cross-surface visibility, and Home / For You
- Noise versus tradeable insight
- Confidence tags

#### HYPE / Hyperliquid

Include only when:

- The user requests it
- It is materially represented in the sample
- A development has plausible crypto-market relevance

Count explicit `HYPE`, `$HYPE`, or `Hyperliquid` references; do not count ordinary uses of the word “hype.” Separate platform fundamentals, token mechanics, positioning, and chart momentum.

When relevant, check [`@hyperliquid_announcements`](https://t.me/hyperliquid_announcements) for platform developments. Treat it as platform-specific evidence and corroborate market-impact claims with direct market data or another independent category.

### E) Key Account Views

Default accounts:

- `@citrini`
- `@DonAlt`
- `@ezcontra`
- `@lBattleRhino`

Use:

```bash
bird user-tweets --json -n 20 <HANDLE>
```

Include an account only when it has a material recent view. Prefer original posts and substantive replies; ignore reposts, promotion, and fluff.

For each included account:

- Main view
- Asset focus
- Stance: bullish / bearish / tactical / watchful
- Conditions that would change the view, if stated
- One or two exact tweet links

Finish with where the accounts agree, where they disagree, and whether the combined read adds information beyond the observed tape.

### F) Actionable Watchlist and Economic Calendar

For a full brief, cover the next seven calendar days:

- Date/time in Europe/London, including daylight-saving conversion
- Country/region
- Indicator, central-bank event, auction, geopolitical deadline, or earnings cluster
- Importance: High / Medium / Low
- Consensus and prior when reliably sourced
- Why it matters
- Expected cross-asset sensitivity

Rules:

- Prefer official calendars and releases.
- Attribute consensus to a named source and timestamp.
- Do not invent consensus.
- Group by day and omit empty days.
- Mark high-impact events with `🔥`.
- End with: `Most market-moving window this week: ...`

### G) Podcast Signal Check

Start with the latest **All-In Podcast** episode.

Include detailed analysis only when a new episode contains material market signal and a reliable episode, transcript, or primary summary is accessible.

When relevant, provide:

- Episode title and publication date
- Three to five signal-only points
- Macro, rates/inflation, equities/technology, crypto/AI/policy implications
- One to three conditional tradeable takeaways with confidence tags
- Signal versus unsupported hot take

If a reliable transcript or source is unavailable, do not infer detailed views. In a full brief, write one line:

`Podcast check: no reliably sourced material market signal.`

Omit the module entirely from standard briefs when immaterial.

### H) Earnings Transcript Signal

Default basket:

- **Mega-cap core:** AAPL, MSFT, NVDA, AMZN, GOOGL, META, TSLA
- **Macro bellwethers:** JPM, UNH, XOM, WMT

#### Recency Rules

- Detailed analysis: only companies with an earnings report or transcript in the previous seven calendar days
- Forward watch: qualifying basket companies expected to report in the next 14 calendar days
- Prefer the company release, filing, presentation, and official transcript
- Distinguish release-only evidence from transcript evidence

For each qualifying company:

- Company, quarter, and report/transcript date
- Actual versus consensus/company guidance for market-sensitive metrics
- Three to five management takeaways
- Material change versus the previous quarter
- Tone: Bullish / Neutral / Bearish
- Tags: growth, inflation, labor, consumer health, enterprise spend, AI capex, credit stress
- Price reaction at a stated cutoff
- One-line market implication

Then provide:

- Cross-company consistencies and divergences
- US/global macro read-through
- Actionable alpha only where supported by independent evidence categories
- Upcoming earnings dates and why each matters

If none qualify, write:

`No qualifying earnings transcripts in the last seven calendar days.`

---

## Style and Compression Rules

- Lead with the conclusion, then show the evidence.
- Prefer compact bullets to long paragraphs.
- Use **Fact → Why it matters → Conditional implication** when all three add value; do not force the pattern onto routine context.
- Avoid generic textbook explanations.
- Avoid repeating the same catalyst in several sections.
- Give exact levels only when sourced and meaningful.
- Distinguish observation from inference.
- State when a view is changing and why.
- Use direct language without pretending uncertainty does not exist.
- Add disclaimers only when essential to risk framing.

If material research exceeds the selected word target:

1. Preserve the verdict, what changed, regime, risks, next catalysts, and bottom line.
2. Compress or omit unchanged modules.
3. Offer the omitted module as a follow-up rather than burying the core answer.

---

## Tool-Failure and Missing-Data Behavior

- Check that a local CLI exists before invoking it.
- A failed optional tool must not abort the core brief.
- Never describe a source as checked if access failed.
- Never fill missing data with plausible-looking estimates.
- Put material gaps in `Data Caveats`; omit trivial implementation detail.
- When a stronger required source is unavailable, use a weaker source only with clear labeling.

---

## Delivery

- Print the brief directly in chat by default.
- Do not create a file unless the user explicitly says `save`, requests a document, or requests a `full brief`.
- When saving, use:

```text
market-overview-YYYY-MM-DD.md
```

- If another saved brief already exists for that date, add `-HHMM` rather than overwriting it unless the user explicitly asks to replace the existing file.
