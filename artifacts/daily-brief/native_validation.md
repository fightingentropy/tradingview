# Native daily brief validation

Validated on 16 September 2026.

- `npm run check`: passed lint, TypeScript, 203 tests, 13 signing checks, and trading identity checks.
- Shared web publication/parser tests: 11 passed, including safe links and edition date validation.
- iOS Release builds: simulator and signed arm64 device builds succeeded with Xcode 27.0.
- Signed app installed and launched on the paired iPhone 17 Pro running iOS 27.0.
- Physical iPhone walkthrough through iPhone Mirroring: News opens Daily brief, the live 16 September edition loads, the section picker jumps to PM Bottom Line, the 25-source index expands, and the FOMC source opens the Federal Reserve release in the browser. Returning to TradingView and switching to the existing Pulse feed also worked.
- Simulator walkthrough: dated edition history, loading the 7 September archive, returning to the latest edition, and native section navigation.

The simulator video is separate from the physical-device observations above.
Both readers consume the same published Markdown. This update does not change the
Mac mini's daily generation service or its schedule.
