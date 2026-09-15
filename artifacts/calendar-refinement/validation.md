# Economic calendar refinement

Verified locally on 15 September 2026. These changes have not been deployed.

## Delivered

- Replaced the fixed seven-event snapshot with the existing economic-calendar feed covering 18 economies.
- Monday–Sunday week navigation, previous/next controls, a native date picker, and This week reset.
- Daily counts, country/category/impact/search filters, expandable source notes, actual/forecast/previous values, and the next upcoming high-impact release.
- Current-week refresh every minute while the app is visible. Loading, empty, retry, and stale-data states are explicit.
- London release times with daylight-saving handling. Provider scales such as K, M, and B are retained.
- Responsive desktop rows and mobile event cards with collapsible filters.

## Automated verification

- `bun run --cwd web check`: UI and Convex TypeScript checks, **100 passing tests**, and production build passed.
- `node --test scripts/web-calendar-proxy.test.mjs scripts/economic-calendar.test.mjs`: **10 passing checks** for the existing proxy and shared domain.
- `git diff --check`: passed.
- New tests cover week/year boundaries, invalid dates, DST, padded-response trimming, duplicate events, provider failures, source URL validation, numerical scales, and combined filters.

## Browser verification

- Desktop and 390 × 844 mobile views verified; 320 × 720 year-boundary navigation also fits without horizontal page overflow.
- Combined United Kingdom + high impact + inflation search returned the matching release; expanded notes and source link verified.
- Mobile impact/day filters work, and event details remain scrollable.
- Recorded default medium/high-impact results: 81 events for 14–20 September, 71 for 21–27 September, 103 for 28 September–4 October, and 62 for 12–18 October. Counts can change as the provider updates its schedule.
- Previous-week navigation was also verified with 5–11 October (53 events).
- A distant unpublished/unavailable provider range showed a retry state instead of invented events.
- Final clean reload: 81 rendered events, no alert, no horizontal overflow, and no new browser errors.

## Artifacts

- `desktop_calendar.png`: finished desktop calendar.
- `mobile_calendar.png`: mobile day and high-impact filtering.
- `browse_weeks.mp4`: actual browser captures showing next-week navigation, a jump to October, and return to the current week.

Future-week coverage depends on what the data provider has published. Local Vite requests use the existing read-only production calendar proxy; no server deployment or financial transaction was performed.
