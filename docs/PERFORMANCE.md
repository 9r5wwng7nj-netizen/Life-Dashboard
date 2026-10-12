# Performance and maintainability

## Implemented fixes

- Startup queues reads for all 51 collections in one readonly IndexedDB transaction, rather than awaiting one transaction per collection. Missing keys still receive their existing cloned defaults. An aborted read stops initialization with a recovery message; it cannot seed over unread records. Database names, version, collection keys and record formats are unchanged.
- Projects and People create ordered, per-call task groups. This replaces repeated full-list scans with a single grouping pass while keeping item identity, ordering, counts and case-insensitive person grouping. No persistent index needs invalidation.
- Photo loads share pending reads. Rendering and dialog dismissal release object URLs no longer referenced by the current page. Clearing the cache also invalidates pending loads, preventing old requests from rebuilding it after restore/reset. This only releases presentation resources: it never deletes the stored photos.
- Shared section tabs have a maximum width, keeping their horizontal scrolling contained at medium desktop widths (verified at 1200px) as well as phone widths.

## Measured on 2026-10-12

Local Chrome, synthetic fixture with 12,500 tasks, 250 projects and 500 people. Each measurement is the median of five warm runs after an initial warm-up.

| HTML generation | Before | After |
|---|---:|---:|
| Projects | 28.4 ms | 1.0 ms |
| People | 151.7 ms | 17.5 ms |

The generated HTML hashes matched exactly before and after for both views. These are HTML-generation timings, not total page render/interaction timings. The fixture is a stress test, not a measurement of Seth's real records, and results will vary by device. The startup transaction reduction was verified structurally (51 to 1); no startup wall-clock speedup is claimed.

## Repeatable verification

Install development dependencies with `npm ci` and the probe browser with `npm run probe:install`. Start the local server with `npm start`, then in a second terminal run `npm run probe:performance`. For a different local port, set `APP_URL` (for example, `APP_URL=http://127.0.0.1:8099/index.html npm run probe:performance`).

The probe uses an isolated Playwright CLI browser context, blocks non-local network requests after setup, temporarily places synthetic tasks/projects in memory, restores them afterward and removes its one temporary photo. It never accesses the user's regular Chrome profile. The pinned development CLI is invoked through npx without downloading a replacement; `PLAYWRIGHT_CLI` can point to an existing executable/wrapper. Both probes use scripts/probe-browser.json and installed test Chromium.

Besides timings, it verifies grouping identity/order, large-fixture group counts, one startup read transaction, missing-key and localStorage fallback behavior, abort rejection, concurrent photo deduplication, shared gallery/dialog hydration, URL cleanup and pending-load invalidation. Timings are diagnostic, not brittle pass/fail thresholds. `npm test` runs the 21 smoke/security/accessibility regressions; CI additionally runs the performance and populated-data probes. See docs/QUALITY_ASSURANCE.md for populated coverage and limitations.

## Remaining work, in priority order

1. **Additional populated-data interaction checks:** baseline coverage now checks all nine views/sections, common edits/searches/imports and multi-year records. Extend it to workout editing, offline Bible/reference imports, additional linked records and failure/recovery paths. It does not test every possible workflow.
2. **Bound very large lists:** several task/project details, People lists and other historical screens still generate every matching row. Profile full render/layout before deciding on accessible pagination or lazy rendering; do not silently hide records.
3. **Strengthen action checks:** the current static action checker is line-based and tracks collisions but does not resolve every dynamic action reference. Add parser-based coverage if future changes expose a need.
4. **Explicit modular refactor:** keep UI code in index.html under the current repository rule. Splitting modules or introducing a framework needs Seth's explicit approval and migration tests; it is not necessary for these fixes.
5. **Mobile foundation:** Seth resumed this phase on 2026-10-12 and the offline app shell is built. HTTPS hosting and private sync are still to do; measurements on actual mobile hardware follow once the app is hosted.
