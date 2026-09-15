# Calendar country selection

Verified locally on 15 September 2026. Not deployed.

## Behavior

- Country checkboxes support any combination, including United States + United Kingdom.
- Clear unchecks every country and shows a selection prompt. Select all restores all 18 economies.
- The trigger summarizes the selection (for example, US + UK).
- Country selections persist while browsing weeks. Existing category, impact, day, and search filters still combine with the selected countries.
- Done, Escape, and clicking outside dismiss the picker. Escape/Done restore focus to the trigger; Arrow Down opens the picker and focuses its first checkbox.

## Verification

- `bun run --cwd web check`: both TypeScript checks, 101 tests, and the production build passed.
- `git diff --check`: passed.
- Browser: Clear produced zero checked countries and zero rows; United States produced 27 rows; US + UK produced 40 rows containing only those countries. Select all restored 18 checked countries and 81 rows. Counts reflect the current medium/high-impact week and may change with the feed.
- Unchecking the US left only UK events. Moving to the next week retained both selected countries.
- Desktop, 768px tablet, and 390px mobile controls and popup fit without horizontal page overflow. The scrollable list reaches Türkiye.

## Evidence

- `choose_country_set.mp4`: actual browser captures of Clear → United States → United Kingdom → Done.
- `us_uk_selected.png`: desktop checkbox selection and resulting event list.
- `mobile_countries.png`: mobile picker with US and UK selected.
