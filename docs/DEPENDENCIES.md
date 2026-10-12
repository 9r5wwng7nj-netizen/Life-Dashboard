# Dependencies

The app has **no npm runtime dependencies** and no build step. Everything it needs at runtime is loaded from a CDN or called as a web service. `package.json` lists dev tools only: Playwright for tests and http-server for a local server.

## Loaded by the page

| What | URL in `index.html` | When | Notes |
|---|---|---|---|
| Tailwind CSS (Play CDN) | `https://cdn.tailwindcss.com` | Every load | Generates styles in the browser. Config (brand palette, dark mode `class`) is the inline `tailwind.config` script right below it. Not pinned. |
| Lucide icons | `https://unpkg.com/lucide@latest/dist/umd/lucide.min.js` | Every load | **Not pinned.** Icon names occasionally change between releases (e.g. `home` became `house`). Pinning a version is a sensible future change. |
| SheetJS (xlsx) | `https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js` | On demand | Only when importing a MacroFactor export or the Berean tables spreadsheet. |

If the CDNs can't be reached and the files aren't cached, the app still runs and keeps the data safe, but it shows unstyled and warns the user (`no-tw` class + toast in `init()`).

## Web services called at runtime (all optional features)

| Feature | Service |
|---|---|
| Offline Bible downloads | `raw.githubusercontent.com/scrollmapper/bible_databases` (public-domain texts) |
| Online passages | `bible-api.com` (no key) · `api.esv.org` (ESV, user's own key in Settings) |
| Strong's lexicon | `raw.githubusercontent.com/openscriptures/strongs` |
| Berean interlinear / topical data | Downloaded manually by the user from berean.bible and imported (that site sends no CORS headers) |
| Food search & barcodes | `world.openfoodfacts.org` · `api.nal.usda.gov` (USDA FoodData Central; `DEMO_KEY` unless the user adds a key) |
| Podcast lookup | `itunes.apple.com` search/lookup (JSONP) |
| Link previews | `noembed.com` (JSONP) |
| Embedded players | `youtube-nocookie.com`, `player.vimeo.com`, `open.spotify.com`, `embed.podcasts.apple.com` |
| Smart Search “answers” (off; user opted out for now) | `api.anthropic.com` with the user's own key |
| Miyo local search (off; user opted out for now) | `http://127.0.0.1:8742` |

Links to Got Questions, Desiring God, BibleProject, TGC, Ligonier, CCEF, Bible Hub, Blue Letter Bible and Bible Gateway are plain outbound links, not API calls.

## Browser APIs used

IndexedDB, localStorage, File System Access API (Obsidian vault folder, Chrome only), Web Speech API (journal dictation), Notifications, Screen Wake Lock (cook mode), Web Audio (timer beeps), BarcodeDetector + camera (food barcodes), Clipboard, HTML5 drag and drop.
