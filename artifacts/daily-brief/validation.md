# Daily brief validation — 16 September 2026

- The new reader and same-origin publication feed were exercised at `https://trade.erlin.org/brief`.
- Today's edition was researched fresh against the original BRIEF.md contract: eight sections, 25 linked sources, actual source cutoffs, and 55/25/20 judgmental scenarios.
- The public dated API response exactly matches the saved Markdown. SHA-256: `931b5ac66c7e9190e94f5e48b42ffdb5deb5b3c7d498ae3940168a4a46413f07`.
- The public index contains today's edition and three dated historical editions; existing content is immutable through the publisher.
- Web validation: 112 passing tests, UI/Convex type checks, and production build. Worker/API/routing validation: 12 passing tests.
- Desktop: previous edition, archive label, return to latest, section navigation, 25-source disclosure, and Markdown download target verified.
- Mobile: 390 × 844 viewport, no horizontal overflow, section picker reaches PM Bottom Line, and the existing bottom navigation remains usable.
- The MP4 is an actual browser CDP screencast of archive navigation, return to today's edition, the catalysts section, and opening the source list. It is not a mocked app or a slide deck.
- Daily automation `publish-daily-market-brief` is active, starting research at 08:00 in the host's Europe/London timezone. Publication follows research/verification; this local automation needs the Mac and Codex available.
- Cloudflare continues to serve published editions when the local research runner is unavailable. Failed validation/research preserves the prior publication.
