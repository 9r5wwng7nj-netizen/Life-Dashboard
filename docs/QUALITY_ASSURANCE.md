# Quality assurance and remaining checks

## Populated-data pass — 2026-10-12

The CLI probe uses isolated test Chromium and synthetic records only. Its fixture includes 260 workouts, 1,095 nutrition days, 730 journal entries, 100 study notes, 120 media resources, 60 recipes and 1,200 tasks, plus family records, prayers, highlights, memory cards and a photo. Synthetic verse/quotation text is explicitly labeled and is not source material.

Verified:

- All nine main views and their available top-level sections, plus Journal list/calendar/insights: 63 renders at each of 1200px and 390px. No render errors, horizontal overflow or missing rendered action bindings. This is 126 screen checks, not 126 independent unit tests.
- Task editing retains checklist data; recipe editing retains rating metadata; journal editing autosaves. Nutrition-entry editing preserves neighboring imported records.
- Journal, Media and Scripture-note search narrow the results to the expected record.
- Edited records and the saved photo survive reload.
- Hevy CSV export/parser roundtrip retains 260 workouts, exercises, sets, reps and weights within export-rounding tolerance. This is not an external Hevy-service integration test.
- MacroFactor parsed-sheet reimport is idempotent and preserves locally entered nutrition entries and existing weights when overwrite is disabled. Spreadsheet loading is separately checked by the smoke suite.
- Full populated backup merge/repeated merge and replace preserve collection counts and photos.
- Completing a recurring task twice creates one successor, not duplicates.
- Fourteen light/dark populated detail states pass accessibility scans. Journal Focus keyboard wrapping, visible focus, background isolation, Escape cleanup and return focus are verified; task-board titles have native edit buttons.
- Simulated slow headers/body, network/CORS failure, invalid JSON, USDA rate limits, Open Food Facts HTTP errors and offline mode produce recoverable errors without live credentials.

This pass found a real compatibility defect: generated MacroFactor food IDs use mf:name|unit, but backup validation previously rejected the separator. The shared validator now accepts this exact existing format without changing stored IDs or allowing arbitrary pipe-containing identifiers, quotes or markup.

## How to repeat

1. Run `npm ci`, `npm run probe:install` and `npm start`.
2. In another terminal run `npm run probe:populated` and `npm run probe:performance`.
3. Run `npm test` for the 21 existing smoke/security/accessibility regressions. CI runs all three commands against a temporary local server.

`APP_URL` supports another localhost port. `PLAYWRIGHT_CLI` optionally selects an existing CLI wrapper. Defaults use the pinned local CLI and scripts/probe-browser.json: an isolated context, with no personal browser profile. The populated probe resets/seeds only its own isolated test context; generated backups stay in memory and are never committed. Closing the context discards test storage.

## Performance observations

Local synchronous populated renders were roughly 30–70 ms for the slowest screens (often Journal list, Tasks and Nutrition Plan). Timings vary with the machine and concurrent work and are not total input latency or mobile-hardware measurements. No arbitrary threshold is used. Large lists still merit profiling/pagination as real usage grows; these results do not prove unlimited scaling.

## Outstanding checks

1. **Manual assistive technology:** VoiceOver/TalkBack reading order, announcements, dialog navigation, embedded media, and detailed WCAG 2.2 target-size review. Automated axe/keyboard checks are not certification.
2. **Live optional services:** public Bible, podcast discovery, video metadata, barcode and USDA demo checks were separately performed on 2026-10-12; see docs/LIVE_SERVICES.md. Authenticated Scripture/food keys, actual playback, generic article metadata, notifications and dictation remain unverified. Network access is blocked during deterministic probes; a passing probe does not guarantee live availability.
3. **Reference libraries and additional workflows:** downloaded full Bibles/Berean tables, workout-editor flows, photo uploads/resizing, very large media libraries, and more cross-record links. Not every collection is populated and not every action is activated.
4. **Additional browsers and failures:** Safari/Firefox, more browser-storage failures, interrupted imports, and file-origin populated interactions. The standard smoke suite checks file-origin startup/navigation/persistence, while CLI populated probes run on localhost.
5. **Mobile foundation:** hosting, offline PWA and private sync remain deferred by Seth's request. Phone-width regression checks preserve existing layout; they do not enable cross-device use.

Do not declare the entire audit or mobile-readiness work complete based on the automated checks alone. Prioritize verified data-loss/security defects, then common-workflow failures, before speculative rewrites.
