# TradingView

TradingView is a SolidJS/Vite trading UI with a Convex paper-trading backend and
an optional Hyperliquid API-wallet execution adapter with encrypted,
device-verified reload unlock. It shows
real-time market data, an interactive candlestick chart, an order book, and
trade controls. Paper settlement uses server-fetched Hyperliquid prices;
client price arguments are never authoritative. Missing, malformed, stale, or
future-dated oracle data fails closed.

## Features
- Trade view with market stats, chart, order book, and order form
- Portfolio view and simple mobile navigation
- Brief, economic-calendar, multi-chart, options, and vault views
- Symbol search modal with keyboard shortcuts
- Candlestick chart with volume and moving averages
- Local caching for chart data and UI settings
- Explicit Paper and Hyperliquid Testnet/Mainnet execution modes
- Session-only API-wallet connection with agent/master validation
- Hyperliquid Standard, Unified, and Portfolio account-mode display
- Live spot/perp placement, cancellation, position close, leverage, and
  position-level TP/SL updates

## Execution modes

**Paper** uses the Convex ledger and its own simulated portfolio-margin model.
When the paper portfolio toggle is enabled, weighted spot holdings join the
paper perps collateral pool. The formulas in `specs.md` apply only to that
simulator; they are not a reimplementation or prediction of Hyperliquid's risk
engine.

**Hyperliquid** signs a deliberately limited set of exchange actions in the
browser with an approved API wallet (Hyperliquid calls this an agent wallet).
Connecting requires both the agent private key and the separate master account
address. Never enter a master private key, seed phrase, or hardware-wallet
secret. The app validates the agent/master relationship on the selected
network and reads account state using the master address.

By default, the API-wallet private key is kept only in memory for the current
page session. Users can explicitly enable reload-safe unlock with Touch ID or
Mac device verification. That flow creates a platform WebAuthn credential,
derives a non-extractable AES-256-GCM key from the credential's PRF output, and
stores only authenticated ciphertext plus non-secret metadata in IndexedDB.
The private key, PRF output, and derived AES key are never persisted in Web
Storage, IndexedDB, Convex, URLs, logs, or environment files.

The saved vault is scoped to the exact site origin and must be re-enrolled on a
different hostname. A reload leaves it locked until the user explicitly
unlocks it; the app never silently triggers device verification. WebAuthn can
use Touch ID, Apple Watch, or the Mac login password, so the website cannot
guarantee fingerprint-only verification. Browser extensions and any script
running in the page can still access the decrypted key while the vault is
unlocked, and JavaScript cannot reliably zeroize strings. Use a dedicated,
short-expiry API wallet and limited funds. Disconnecting clears the live signer
but retains encrypted vault data; forgetting the device removes that data.
Neither action revokes the agent, which must be revoked in Hyperliquid.

The connection defaults to testnet. Initial Mainnet connection and Touch ID
enrollment require typing `MAINNET`. A later explicit device-verified unlock
restores that saved network without another typed confirmation. Hyperliquid
account mode is read from the exchange.
An agent can initialize Standard, Unified, or Portfolio only while the account
is still in the `default` mode. Changing an already initialized mode requires
the master wallet in official Hyperliquid settings; this app never requests the
master key.

Only spot and perpetual orders from the Trade view use the API wallet. Options
and the Convex-specific vault/admin workflows remain paper/application
features. One API wallet is limited to one active TradingView tab; use a separate
agent for another tab or trading process. When execution is paused, market data
returns to mainnet so it stays aligned with the Convex paper-settlement oracle.
Live TP/SL can be added to a filled position from the Positions table. It is
intentionally unavailable on an unfilled live limit ticket because protection
must not be sized against a position that may never exist or may only partially
fill.

Exchange integration uses the community-maintained
[`@nktkas/hyperliquid`](https://github.com/nktkas/hyperliquid) TypeScript SDK.
Hyperliquid's canonical SDK is the
[`hyperliquid-python-sdk`](https://github.com/hyperliquid-dex/hyperliquid-python-sdk).
See the official [API overview](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api),
[API-wallet and nonce guidance](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets),
and [account modes](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/account-abstraction-modes).
The exchange, not this UI, enforces current [portfolio-margin eligibility,
collateral, caps, and liquidation rules](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/portfolio-margin).

## Data sources and caching
- REST data:
  - Hyperliquid perps/spot/equity metadata and market stats
  - Hyperliquid account state when an API wallet is connected
- Websocket data:
  - Live candle and order-book updates from the selected mainnet or testnet
    Hyperliquid WebSocket endpoint
  - Relevant HIP-3 DEX and open-order discovery for a connected account; REST
    refreshes remain scoped to the default and currently relevant DEXes
- Caching:
  - Candle data cached in `localStorage` per symbol and resolution
  - Last selected symbol saved so refreshes return to the same market
  - Chart settings and order book visibility stored in `localStorage`
- Performance behavior:
  - Live polling and streaming pause when the tab is hidden
  - Stale requests are aborted on symbol changes

## Project structure
- `src/App.tsx`: top-level layout and page switching
- `src/components`: UI components (chart, order book, forms)
- `src/stores`: SolidJS signal stores for market data, routing, and cache
- `src/lib/hyperliquid.ts`: Hyperliquid API helpers and formatting utilities

## Development
Install dependencies:

```sh
bun install
```

Create `.env.local` with at least:

```
# Convex will set CONVEX_DEPLOYMENT when you run convex dev the first time
VITE_CONVEX_URL=http://127.0.0.1:3210

# Custom auth (Convex) – local dev
CUSTOM_AUTH_ISSUER=http://127.0.0.1:3210
CUSTOM_AUTH_JWKS_URL=http://127.0.0.1:3210/http/.well-known/jwks.json
CUSTOM_AUTH_AUDIENCE=trade-xyz
CUSTOM_AUTH_PRIVATE_KEY=...   # see Auth section below
CUSTOM_AUTH_PUBLIC_JWK=...   # see Auth section below
```

**One-time Convex setup (use an interactive terminal – e.g. Terminal.app):**

1. Log in and create/link a project (Convex will prompt for device name and project):
   ```sh
   bun x convex dev --env-file .env.local --local
   ```
2. When prompted, choose to create a new project or use an existing one. Convex will write `CONVEX_DEPLOYMENT` to `.env.local` and start the local backend. Stop it with Ctrl+C when ready.

**If you see WebSocket 101/1006 errors** when running Convex with Bun, the CLI’s sync has a known issue with Bun’s WebSocket. Workaround: install Node (e.g. `brew install node`) and run the Convex backend with Node only: `npx convex dev --env-file .env.local --local` in one terminal, then `bun run dev:ui` in another. The rest of the project stays on Bun.

Start the Vite UI:

```sh
bun run dev
```

`bun run dev` and `bun run dev:ui` both run Vite only. For a local Convex
backend, run `bun run dev:convex` in one terminal and `bun run dev:ui` in
another.

Build and preview:

```sh
bun run build
bun run preview
```

Run the complete local/CI contract:

```sh
bun run check
```

This runs separate UI and Convex type-checks, the fixed-point/property and API
boundary tests, then the production build.

All client-triggered money mutations require a URL-safe idempotency key. The
frontend generates one key per user intent and reuses it across transport and
compatibility retries.

## Auth (custom JWT)
This project uses a custom email/password flow backed by Convex (no Auth0).
Generate an RSA key pair and derive a public JWK for the JWKS endpoint.

Access tokens are short-lived and bound to a `jti`/device session. Refresh
tokens rotate on every refresh, and logout revokes only the current session;
device-wide and account-wide revocation endpoints remain available.
Password hashing is asynchronous scrypt with global concurrency and attempt
budgets in addition to the email-scoped budget. Expired sessions, receipts,
work leases, and rate-limit keys are pruned on a bounded schedule.

Generate a local RSA key:

```
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out dev_private.pem
```

Then flatten it for `.env.local`:

```
awk 'BEGIN{printf "CUSTOM_AUTH_PRIVATE_KEY="} {printf "%s\\n",$0} END{print ""}' dev_private.pem
```

Generate the public JWK (single line) and paste into `CUSTOM_AUTH_PUBLIC_JWK`:

```
node -e "const { createPublicKey } = require('crypto'); const fs = require('fs'); const key = fs.readFileSync('dev_private.pem'); const jwk = createPublicKey(key).export({ format: 'jwk' }); jwk.use='sig'; jwk.alg='RS256'; jwk.kid='trade-xyz-dev'; console.log(JSON.stringify(jwk));"
```

If you change `kid`, also set `CUSTOM_AUTH_KEY_ID` to match.

## Production (Convex + TradingView Worker)
### Convex (backend)
Set these environment variables in the Convex production deployment:

```
CUSTOM_AUTH_ISSUER=https://YOUR_DEPLOYMENT.convex.site
CUSTOM_AUTH_JWKS_URL=https://YOUR_DEPLOYMENT.convex.site/.well-known/jwks.json
CUSTOM_AUTH_AUDIENCE=trade-xyz
CUSTOM_AUTH_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nREPLACE_ME\n-----END PRIVATE KEY-----
CUSTOM_AUTH_PUBLIC_JWK={"kty":"RSA","kid":"trade-xyz-prod","use":"sig","alg":"RS256","n":"REPLACE_ME","e":"AQAB"}
# Optional: override the kid used in JWT headers
# CUSTOM_AUTH_KEY_ID=trade-xyz-prod

# Optional but recommended signup protection. Configure both halves together.
TURNSTILE_SECRET_KEY=REPLACE_ME
TURNSTILE_EXPECTED_HOSTNAME=trade.example.com
```

Deploy the Convex functions:

```sh
CONVEX_NO_UPDATE_CHECK=true bun x convex deploy --yes --env-file .env.local
```

If your project is already configured, this also works:

```sh
bun x convex deploy --prod
```

Redeploy after changing Convex environment variables or schema.

### TradingView frontend

This package lives at `tradingview/web`. The root `wrangler.web.jsonc` publishes
`web/dist` to https://trade.erlin.org using a Cloudflare Worker custom domain.
Cloudflare manages its DNS record and HTTPS certificate. The original
`tradingview-web.erlinhoxha.workers.dev` address remains available for existing
links and the native calendar API. The standalone
`trade-xyz` Pages project is retired.

From the **repository root**:

```sh
npm run web:install
npm run web:check
npm run web:deploy
```

Set `VITE_CONVEX_URL` in `web/.env.production` for production builds. If signup
protection is enabled, also set `VITE_TURNSTILE_SITE_KEY` and allow the TradingView
hostname in the existing Turnstile widget and backend configuration. Rebuild
after changing a `VITE_` value. These values are public browser configuration;
keep backend secrets in Convex.

The existing Convex deployment and its account data are retained. Changing the
frontend hostname does not migrate browser storage or passkeys: reconnect the
API wallet and enroll device unlock on the new hostname. Keep the existing
`trade-xyz` auth audience and storage identifiers for compatibility.

Turnstile is enforced only when `TURNSTILE_SECRET_KEY` is configured in Convex;
when enabled, the matching `VITE_TURNSTILE_SITE_KEY` must be present in the
frontend build. Tokens are validated server-side and are never trusted from the
widget alone.

## Fixed-point accounting migration

New balance, order, position, trade, vault and price writes include canonical
decimal values plus `fixed-point-v1` precision metadata. Existing rows remain
readable and are lazily upgraded when mutated. Before declaring an existing
deployment fully migrated, run `migrations:backfillAccountingV1` for every
supported table in batches, passing each returned `continueCursor` into the
next call until `isDone` is true. For example:

```sh
bun run migrate:accounting:prod
```

The production runner requires an exact confirmation flag internally, selects
the project's production deployment on every batch, follows every cursor, and
stops on malformed output, a stalled cursor, or a safety cap. The full table
list is the validator in `convex/migrations.ts`. The executable
accounting specification is `fixtures/accounting-v1.json`; formulas and
rounding policy are documented in `specs.md`.

### Optional local production build
If you want a local prod build, you can create `.env.production` with just:

```
VITE_CONVEX_URL=https://qualified-zebra-483.eu-west-1.convex.cloud
```

Keep private keys and Convex secrets in the Convex dashboard, not in frontend
env files.

## Notes
- Routes are handled manually via `window.history`:
  - `/trade` or `/trade/SYMBOL`
  - `/portfolio`
  - `/brief`
  - `/calendar`
  - `/charts`
  - `/options`
  - `/vaults` or `/vaults/VAULT_ID`
- The app expects network access to the selected Hyperliquid endpoint for live
  market/account data and to Convex for paper trading and custom auth.
- Unit tests, type-checks, builds, and dependency audits do not prove exchange
  execution. Testnet and mainnet order submission require a user-supplied,
  approved API wallet and must be verified separately. No repository fixture
  contains credentials, and the documented setup does not claim a live or
  testnet trade has been placed.
