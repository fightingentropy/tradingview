# Spec Definitions

This document defines key domain terms used by Trade XYZ.

## Accounting contract (`fixed-point-v1`)

The executable source of truth is `convex/lib/accounting.ts`, with versioned
examples in `fixtures/accounting-v1.json` and invariant/property tests in
`convex/lib/accounting.test.ts`. Monetary mutations persist canonical decimal
strings alongside temporary numeric display projections and tag trades,
positions, balances, vault records and ledger events with their accounting
version and precision.

- Cash: 6 decimals (USDC smallest units).
- Prices: 8 decimals.
- Quantities and vault shares: 8 decimals.
- Funding rates: 12 decimals.
- Domain-boundary rounding: round-half-to-even. Inputs with unsupported
  precision are rejected; performance fees round toward zero so they can never
  exceed profit.
- `number` values are display/backward-compatibility projections only. New
  accounting calculations use bigint atoms and canonical decimal strings.
- Money mutations require idempotency keys and commit their receipt, exact
  ledger entries, and balance changes in the same serializable Convex mutation.

## External market-data boundary

Paper settlement uses Hyperliquid's read-only Info API. Perps, spot, and candle
responses receive strict shape, length, uniqueness, decimal/range,
symbol/index, and freshness validation. Backend settlement and risk checks fail
closed when a non-stablecoin mark is unavailable or stale; client-supplied
prices are quote/slippage intent only.

The optional Hyperliquid execution adapter also reads account state through the
Info API and signs a fixed allowlist of exchange actions for order placement,
cancellation, leverage updates, and initial account-mode selection. It uses the
community `@nktkas/hyperliquid` TypeScript SDK and the SDK's asset-id and
price/size formatting utilities. Native perps, HIP-3 perps, and spot pairs must
resolve through current exchange metadata; symbol position in a UI list is
never treated as an asset id.

## Hyperliquid API-wallet execution boundary

Hyperliquid's “API key” is an approved agent/API-wallet private key, not an
HTTP authorization header. A connection requires that key plus the distinct
master account address. The adapter derives the agent address, queries
`userRole`, and rejects the connection unless the agent is approved for that
master on the selected network. All account queries use the master address.
The app must never request or accept a master private key or seed phrase.

- Testnet is the default. Initial Mainnet connection and encrypted-vault
  enrollment require exact `MAINNET` confirmation. A later explicit WebAuthn
  unlock may restore the saved network without silently reconnecting.
- Without opt-in vault enrollment, the agent key exists only in page memory.
  With enrollment, a platform WebAuthn credential with required user
  verification and PRF support derives a non-extractable AES-256-GCM key via
  HKDF-SHA-256. IndexedDB stores only authenticated ciphertext and non-secret,
  origin-bound metadata; the agent key, PRF output, and derived key are never
  persisted in Web Storage, IndexedDB, Convex, logs, URLs, or frontend
  environment variables.
- Unlock always follows an explicit user action. The browser may satisfy
  platform verification with Touch ID, Apple Watch, or the Mac login password;
  the site cannot require one biometric modality. Missing PRF support, canceled
  verification, malformed data, and decryption failures all fail closed to
  paper mode.
- A dedicated, short-expiry agent and limited funds are recommended. Decrypted
  in-memory secrets remain exposed to compromised same-origin page scripts or
  browser extensions and cannot be reliably zeroized by JavaScript.
- Disconnect clears the live adapter but retains encrypted vault data. Forget
  removes local ciphertext. Neither action revokes the API wallet.
- Nonces are monotonic per network and agent, coordinated across tabs. Only
  non-secret nonce state is persisted.
- One API wallet is held under an exclusive browser lock, so a second Trade XYZ
  tab must use a different agent instead of racing the same nonce set.
- The UI exposes only explicit supported actions; it does not expose a generic
  signed-action passthrough.
- HTTP success is not order success. Every nested per-order exchange status is
  inspected for errors.
- BTC, ETH, and SOL spot display symbols resolve to HyperCore's canonical
  UBTC, UETH, and USOL tokens and then to a current verified `@pair` id. Spot
  metadata context is aligned against either compact response order or the
  current dense pair-index response shape; ambiguous aliases fail closed.
- REST metadata, candles, and WebSocket market data follow the execution
  network. Pausing execution restores mainnet data for the mainnet-backed paper
  ledger. A market order fetches a fresh selected-network reference price and
  is submitted as a direction-aware limit with a one-percent cap.
- Account refreshes poll only the default and currently relevant HIP-3 DEXes;
  WebSocket account events discover additional active DEXes. A named-DEX
  failure retains its last good isolated snapshot instead of failing the whole
  account refresh.
- A live limit parent cannot attach TP/SL because its final filled size is not
  yet known. Position TP/SL replacement validates direction before cancelling
  only existing position-level protection, then reconciles every client order
  id if the submit response is interrupted.

Hyperliquid reports `default`, Standard (`disabled`), Unified, and Portfolio
account modes through `userAbstraction`. `agentSetAbstraction` can make a
one-time selection only from `default`. Transitions from an existing mode
require `userSetAbstraction` signed by the master wallet and therefore must be
completed in official Hyperliquid settings. This app does not ask for the
master key. In Unified and Portfolio modes the shared balance source is the
spot clearinghouse state; the Convex paper-margin formulas below are not used
for live risk or order acceptance. The interface reads each held asset's LTV
and the post-maintenance available amounts reported by Hyperliquid. LTV is
shown for transparency; executable availability remains exchange-authoritative
and is not recalculated by the client. In particular, an asset LTV is not
treated as its liquidation threshold; live liquidation state comes from the
exchange-reported account and position fields.

Automated checks can validate input boundaries, response handling, typing,
bundling, and the absence of known dependency advisories. They do not prove a
testnet or mainnet order path. Exchange verification requires a user-supplied,
approved API wallet and is reported separately from code/build verification.

## Paper Portfolio Margin (Convex Simulation)

### Overview
The Convex paper ledger includes a simulated user-level mode that adds weighted
spot holdings to a shared collateral pool for all simulated perp positions.
When enabled, supported paper spot assets can collateralize simulated perp
positions, subject to the paper model's per-asset haircuts. This section does
not describe Hyperliquid's production risk engine.

### Core fields
- `users.portfolioMarginEnabled`: user toggle for paper portfolio margin mode.
- `spotBalances`: per-user spot holdings by asset symbol.
- `perpsBalances`: perps balances by asset (`USDC`, `USDT`).
- `positions.size`: perp position size (negative for shorts, positive for longs).
- `positions.leverage`: leverage used for the position.
- `positions.collateral`: perps collateral asset (`USDC` or `USDT`).
- `COLLATERAL_WEIGHTS`: per-asset collateral haircuts for spot assets.
  HYPE currently uses a 0.65 weight in this paper model. This one paper-model
  scalar does not reproduce Hyperliquid's LTV, supply-cap, borrowing, or
  account-wide liquidation formulas.

### Derived quantities
- `weightedSpotEquity = Σ (spotBalance[asset] * spotPrice[asset] * weight[asset])`.
- `totalUnrealizedPnl = Σ ((markPrice - entryPrice) * size)` across all perps.
- `totalCollateralPool = perpsBalance(USDC/USDT) + weightedSpotEquity + totalUnrealizedPnl`
  (spot equity contributes only when portfolio margin is enabled).
- `marginUsed = Σ (abs(size) * markPrice / leverage)` across all perps.
- `positionMarginUsed = abs(size) * markPrice / leverage`.
- `otherMarginUsed = marginUsed - positionMarginUsed`.
- `crossEquityForPosition = totalCollateralPool - currentUnrealizedPnl - otherMarginUsed`.

### Rules
- Spot balances only contribute when portfolio margin is enabled.
- No symbol-scoped hedging; spot collateral is pooled across assets.
- Collateral weights (haircuts) apply per spot asset.
- Portfolio margin is independent from cross/isolated margin type. The toggle
  applies to all perps positions for the user; margin type remains per-order.
- Spot balances are not locked. Changing a spot balance immediately updates the
  collateral pool.

### Lifecycle updates
- Toggle on/off: clear any legacy `spotCollateralSize` fields on positions.
- Spot balance changes: the collateral pool updates immediately.
- Order fills: positions update; realized PnL is applied to perps balances.

### Margin checks and available balance
- Margin checks before order placement compare `nextMarginUsed` to the current
  `totalCollateralPool` when portfolio margin is enabled.
- Classic mode uses perps balances only (spot excluded).
- Backend settlement and margin checks fail closed when an authoritative market
  price is missing, stale, malformed, or from the future. Stablecoins are valued
  at exactly 1.

### Liquidation display (UI spec)
- Cross margin:
  - short liquidation: `entryPrice + equity / abs(size)`
  - long liquidation: `entryPrice - equity / abs(size)`
  - `equity = totalCollateralPool - currentUnrealizedPnl - otherMarginUsed`
- Isolated margin:
  - short liquidation: `entryPrice * (1 + 1 / leverage)`
  - long liquidation: `entryPrice * (1 - 1 / leverage)`

### Example
Cross-asset collateral:
- Perps balances: `10,000 USDC`
- Spot balances: `1 BTC`, `10 ETH`
- Weights: `BTC 0.95`, `ETH 0.9`
- Weighted spot equity (at `BTC=50,000`, `ETH=2,500`):
  - `1 * 50,000 * 0.95 + 10 * 2,500 * 0.9 = 47,500 + 22,500 = 70,000`
- Total unrealized PnL: `+2,000`
- `totalCollateralPool = 10,000 + 70,000 + 2,000 = 82,000`

## Auto-Deleveraging (ADL)

### Overview
ADL (auto-deleveraging) is an automatic position-reduction mechanism triggered
when a position breaches its liquidation threshold. It runs silently (no UI
indicator) and reduces risk via a market fill.

### Rules
- Trigger condition uses the same liquidation price logic as the UI:
  - isolated: `entryPrice * (1 ± 1 / leverage)`
  - cross: `entryPrice ± equity / abs(size)`
- Equity uses the pooled collateral model when portfolio margin is enabled.
- When triggered, reduce the position size by 25% (min `0.0001`) at the current
  mark price.
- A per-symbol cooldown (4s) prevents repeated triggers on every tick.

## Vaults (Pooled Share Accounts)

### Overview
Vaults are pooled accounts with NAV-based share pricing. Members deposit USDC,
receive vault shares, and can withdraw by redeeming shares. Vaults are not
copy-trading accounts; they track pooled equity and a single share price.

### Core fields
- `vaults`: vault metadata (`name`, `operatorUserId`, `totalShares`, `status`).
- `vaultMembers`: per-user ownership (`shares`, `costBasisUSDC`).
- `vaultMetrics`: vault equity + PnL snapshots (`equityUSDC`, `pnl`).
- `vaultFees`: performance fee ledger entries (`amountUSDC`).

### Share accounting
- `sharePrice = equityUSDC / totalShares`.
- If `totalShares == 0`, `sharePrice = 1`.
- Equity is derived from vault-owned balances (perps + spot valuation).

### Deposit (USDC only)
- Minted shares: `shares = depositAmount / sharePrice`.
- Member updates:
  - `shares += mintedShares`
  - `costBasisUSDC += depositAmount`
- Vault updates:
  - `totalShares += mintedShares`

### Withdrawal (performance fee charged at exit)
- `value = shares * sharePrice`
- `costBasisPortion = member.costBasisUSDC * (shares / memberSharesBefore)`
- `profit = max(0, value - costBasisPortion)`
- `fee = profit * 0.10`
- `payout = value - fee`
- Burn shares and reduce member cost basis by `costBasisPortion`.
- Record fee owed to the operator in `vaultFees`.
