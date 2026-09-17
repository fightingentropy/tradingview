# Native API-key replacement — 17 September 2026

## Behavior

- Settings accepts a single API key and discovers the live Hyperliquid account.
- Saved accounts have a Replace API key action. Returning to Settings rechecks the saved key; failed verification reveals the replacement form.
- Verification completes before the existing key is replaced. Saving requires working device secure storage.
- Leaving Settings cancels an unfinished connection attempt and clears its unsaved input.
- The keyboard adjusts the scrollable screen so the connection controls remain reachable.

## Automated and build verification

- `npm run check` passed: lint, TypeScript, 208 tests, 13 signing checks, and trading-identity checks.
- Additional TypeScript and focused lint passed after adding keyboard inset handling.
- `git diff --check` passed.
- Bundled simulator Release build succeeded on Xcode 27.0.
- Signed arm64 iPhone Release build succeeded on Xcode 27.0.
- The signed update was installed on the paired iPhone 17 Pro, bundle `com.erlinhoxha.tradingview`.
- No real API key or trade was used during automated testing.

## Physical-device verification boundary

iPhone Mirroring repeatedly timed out, including after the phone was confirmed
nearby and locked and Mirroring was restarted. The alternate Device Hub link was
blocked by the browser URL policy. A remote launch attempt failed because the
device's remote process service was unavailable. Installation is confirmed;
remote visual verification is not. The user was asked to open the updated
Settings screen on the phone directly.
