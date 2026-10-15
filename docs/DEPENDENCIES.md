# Dependencies

The app executes its core runtime dependencies from files committed to this repository. It does not load framework, icon or spreadsheet-parser code from a CDN. `package.json` lists the pinned packages used to rebuild or refresh those committed assets, plus Playwright and the local test server.

## Local runtime assets

| What | Local path | Version | Notes |
|---|---|---|---|
| Tailwind CSS | `assets/app.css` | 4.3.0 | Precompiled from `src/app.css`; there is no Tailwind runtime in the browser. |
| Lucide icons | `vendor/lucide/lucide-1.55.0.min.js` | 1.55.0 | Pinned UMD browser bundle copied from the npm package. |
| ZXing for JavaScript | `vendor/zxing/zxing-library-0.23.0.min.js` | 0.23.0 | Pinned UMD build of `@zxing/library`; loaded only when the camera barcode scanner starts in a browser without its own `BarcodeDetector` (Safari, Firefox). |
| SheetJS Community Edition | `vendor/sheetjs/xlsx-0.20.3.full.min.js` | 0.20.3 | Pinned standalone browser build from SheetJS's authoritative distribution; loaded only for spreadsheet imports. |

Licenses and SHA-256 hashes are recorded in `THIRD_PARTY_NOTICES.md`. To change Tailwind classes or component styles, run `npm run build:css` and commit the regenerated `assets/app.css`. The app opens with its normal styles and icons without contacting a dependency CDN.

## Web services called at runtime (all optional features)

| Feature | Service |
|---|---|
| Offline Bible downloads | `raw.githubusercontent.com/scrollmapper/bible_databases` (public-domain texts) |
| Online passages | `bible-api.com` (no key) · `api.esv.org` (ESV, user's own key in Settings) |
| Strong's lexicon | `raw.githubusercontent.com/openscriptures/strongs` |
| Berean interlinear / topical data | Downloaded manually by the user from berean.bible and imported (that site sends no CORS headers) |
| Food search & barcodes | `world.openfoodfacts.org` · `api.nal.usda.gov` (USDA FoodData Central; `DEMO_KEY` unless the user adds a key) |
| Podcast lookup | `itunes.apple.com` search/lookup callbacks in a sandboxed iframe with an opaque origin; scripts cannot read dashboard storage |
| Link previews | `noembed.com` via CORS JSON fetch, with a timeout and no credentials |
| Embedded players | `youtube-nocookie.com`, `player.vimeo.com`, `open.spotify.com`, `embed.podcasts.apple.com` |
| Reading recipe pages, articles and TikTok captions (hosted app only) | The app's own Cloudflare Worker, `life-dashboard-reader.lifedashboard-9r5w.workers.dev` (source in `reader/`) |
| Device sync (only after the user connects Google Drive in Settings) | `accounts.google.com` sign-in by redirect · `www.googleapis.com` Drive API, limited to the app's own hidden folder (`drive.appdata`). No Google script is loaded. |
| Smart Search “answers” (off; user opted out for now) | `api.anthropic.com` with the user's own key |
| Miyo local search (off; user opted out for now) | `http://127.0.0.1:8742` |

Links to Got Questions, Desiring God, BibleProject, TGC, Ligonier, CCEF, Bible Hub, Blue Letter Bible and Bible Gateway are plain outbound links, not API calls.

## Browser APIs used

IndexedDB, localStorage, File System Access API (Obsidian vault folder, Chrome only), Web Speech API (journal dictation), Notifications, Screen Wake Lock (cook mode), Web Audio (timer beeps), BarcodeDetector + camera (food barcodes), Clipboard, HTML5 drag and drop.
