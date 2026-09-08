# Source consolidation

Imported from `fightingentropy/xyz-dex` at
`9126cbed2aefc0d9fb6820253fd2a8ec0dfcec74` on 2026-09-08.

This directory is the TradingView web application. The native Expo app remains
in the repository root. The existing Convex project, paper ledger, custom auth,
API-wallet execution and origin-bound encrypted storage are retained.

The import changes the application name, frontend hosting and build entry
points. It retains `trade-xyz` storage keys, auth audience and cryptographic
purpose strings so the migration does not redefine those protocols. The new
hostname requires signing in again and reconnecting any local API wallet.

After the consolidation was verified, the standalone GitHub repository,
retired checkout, and local migration backups were deleted at the owner's
request. Future changes belong in `tradingview/web`.
