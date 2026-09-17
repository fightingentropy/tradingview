# Simple account setup — 17 September 2026

## Delivered

- One API-key field; the approved key identifies its Hyperliquid account automatically.
- Live accounts only. Old saved testnet connections require replacement and cannot unlock or restore.
- Direct Connect entry, separate Account and Appearance sections, and compact security preferences.
- Existing encrypted key storage, device verification, and execution-session safeguards remain in place.

## Validation

- `bun run check` in `web`: TypeScript passed, 120 tests passed, production build passed.
- `git diff --check` passed.
- Browser walkthrough at 1672 × 981 and 390 × 844: Account and Appearance fit without horizontal overflow.
- An invalid, non-secret key shows a readable error. No real credentials or orders were used.
- Published UI opened successfully at `https://trade.erlin.org/trade/HYPE`; Connect opens the simplified form.

## Deployment

- Cloudflare Worker: `tradingview-web`
- Version: `5e3ca14c-9e02-4eeb-9a50-8333b4b85652`
- Screenshots in this directory show the desktop and mobile layouts.
