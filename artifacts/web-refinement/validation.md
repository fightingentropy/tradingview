# Web refinement validation

- `bun run --cwd web check`: passed UI and Convex type checks, 89 tests, and the production build.
- `git diff --check`: passed.
- Browser: live HYPE chart and order book; market/limit and buy/sell controls; spot/perpetual market switching; connection chooser; Portfolio, Brief, Calendar, and Charts navigation.
- Responsive visual checks: 1440 × 900 desktop and 390 × 844 mobile. Both fit the viewport. The mobile ticket keeps its primary action visible and the market picker fits its columns.
- Retired routes `/options`, `/vaults`, and `/vaults/retired-account` return to Trade. Back and forward navigation work.
- Regression tests verify archived vault orders and other users' orders cannot be cancelled or filled by the personal-account APIs, and personal-order cancellation still works.
- Historical database records and encrypted API-wallet security storage are retained. No live trade was submitted.
- Changes are local; the frontend and Convex backend have not been deployed.

## Evidence

- `desktop-terminal.png`: desktop trading layout with live data.
- `mobile-ticket.png`: mobile order ticket with a fixed primary action.
- `mobile-walkthrough.mp4`: mobile chart, order book, order ticket, limit sell controls, market picker, and return to chart.
