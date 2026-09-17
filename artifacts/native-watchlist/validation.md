# Native watchlist and interface polish

## Changes

- One watchlist selector in the header, with add and overflow icons.
- Compact symbol / last price / 24-hour percentage columns; tap a heading to sort.
- Readable company and asset names, absolute price moves, and aligned percentage badges.
- Fixed percentage text size during live updates, including the HYPE shrinking-text issue.
- Price freshness details behind accessible status icons.
- Spinner-only loading states and shorter copy across Account, Settings, charts, news, brief, and order forms.
- Existing trading checks, order confirmation, saved credentials, watchlist ordering, and remembered Account tab remain in place.

## Validation

- `npm run check`: lint, native/worker types, all 208 tests, 13 signing checks, and identity checks passed.
- Final naming changes passed lint and native/worker types; final font adjustment passed lint.
- iOS Release simulator and signed device builds succeeded.
- `watchlist_polished.png`: actual final simulator screen. Percentage badges use a consistent readable size while live quotes update.
- The final signed build was installed on the paired iPhone without uninstalling the app.
- Simulator rendering was checked in serve-sim. Automated navigation was not verified because simulator input was unreliable in this environment.
- Per the user's updated preference, physical-device visual checks are left to the user. iPhone Mirroring is only used when explicitly requested.
