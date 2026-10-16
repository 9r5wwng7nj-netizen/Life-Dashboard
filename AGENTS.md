# Life Dashboard — guide for coding agents

This file is the shared brief for **Claude Code** (via `CLAUDE.md`) and **OpenAI Codex** (which reads `AGENTS.md`). Read it before changing anything.

## What this is

A personal, offline-first dashboard built for one person (Seth) and shareable with others, who each get their own private copy at the hosted address: Workouts, Nutrition, Scripture, Journal, Media Library, Marriage & Family, Recipes & Meals and Tasks. The application UI and roughly 7,800 lines (about 1.1 MB, many of them very long) of vanilla JavaScript remain in `index.html`; pinned runtime libraries and compiled Tailwind CSS live in `vendor/` and `assets/`. There is no framework or application server. All data lives in the user's browser (IndexedDB). Seth uses the hosted copy: the installed iPhone home-screen app and the Life Dashboard panel inside Obsidian on the Mac, kept together by Google Drive sync. Opening `index.html` from disk (`file://`) still works and is handy for tests.

## Golden rules

1. **Never break saved data.** The user keeps years of records in the browser and must never have to re-import anything after an update.
   - Changes to stored data are **additive only**. New fields are optional and read with fallbacks (`t.subtasks || []`).
   - New collections are added to `COLLECTIONS` with a default. `ensureSeeds()` and `Store.init()` fill in anything missing.
   - Never rename or delete a collection key, a localStorage key (`ld.*`), the IndexedDB name (`life-dashboard`) or a store name. Never bump the DB version without an `onupgradeneeded` path that keeps the existing data.
   - If a shape must change, migrate in place on load and keep reading the old shape.
2. **Preserve the design.** Use the existing Tailwind utility patterns and components (`card`, `btn`, `btn-primary`, `chip`, `chip-on`, `stat`, `label`, `input`, `muted`). Every new UI needs `dark:` variants and must work at 390px wide.
3. **Keep application code in `index.html`** unless the user explicitly asks for a refactor. Supporting build input, compiled CSS and vendored third-party libraries stay in their existing folders.
4. **Run the checks before you finish:** `npm test`, or at least `npm run check`.
5. **Keep the app generic.** Other people may use the hosted copy. No personal names, churches, sermon series or family details in titles, headings, placeholders, exports or seed data. Anything personal comes from Settings (for example `S.familyName`) or the user's own records.
6. **Tell users what changed.** Every change a user would notice adds an entry at the top of `RELEASES` in `index.html` (a new `id`, a short title, and a slide per change in plain language). Pictures go in `assets/whatsnew/`, use made-up sample data, and need alt text. Keep `TOUR` accurate when a section changes.
7. **No secrets in the repo.** API keys (ESV, USDA, Anthropic) are entered in Settings, live in localStorage and are excluded from backups. Never hard-code them. Never commit backup JSON files; `.gitignore` already blocks them.

## Run, check, test

```bash
npm install                 # dev tools only — the app itself has no npm dependencies
npm run build:css           # rebuild assets/app.css after changing classes or src/app.css
npm start                   # serves http://localhost:8080 (see the storage note below)
npm run check               # static check: syntax, duplicate functions, action-name collisions
npx playwright install chromium   # once
npm test                    # check + Playwright smoke tests (every view/tab, reload persistence, phone width)
npm run probe:install       # once: install Chromium used by the pinned CLI probes
npm run probe:populated     # synthetic records, common edits/searches/imports; requires npm start in another terminal
npm run probe:performance   # large task fixtures, startup reads and photo lifecycle; also requires local server
```

You can also just open `index.html` in Chrome to try a change. Seth's own copies run at the hosted address (see the roadmap below).

**Storage is per origin.** `file://`, `http://localhost:8080` and any hosted URL each have their own separate IndexedDB. The service worker caches only the app's own files (Cache Storage `ld-shell-*`), never personal data. For testing, use a localhost server or a fresh profile. Seth's real data lives in the iPhone home-screen app and in Obsidian's panel (the hosted origin), never in a test browser. The smoke tests use a fresh, empty browser profile every run.

CLI probes use isolated contexts and accept localhost URLs only. Never point a probe at the user's regular Chrome profile or change it to reuse a personal browser session. CI runs both probes after npm test. See docs/QUALITY_ASSURANCE.md for coverage and remaining manual checks.

## Architecture (all in `index.html`)

The `<head>` holds the theme pre-paint script, compiled `assets/app.css`, and the pinned local Lucide browser bundle. Tailwind source and component CSS live in `src/app.css`. The body holds the app shell (sidebar `#nav`, header, `#view`, `#modal`, toasts) and one large `<script>`. Sections are marked with banner comments, so search for these strings:

| Banner / marker | What's there |
|---|---|
| `CORE UTILITIES` | `$`, `$$`, `esc`, `uid`, `ymd`, `addDays`, `daysBetween`, `startOfWeek` (Monday), `fmtDate`, `fmtNum`, `sum`, `num`, `round`, `download`, `copyText`, `icon()` |
| `SETTINGS (localStorage)` | `SETTINGS_DEFAULT`, `S` (settings object), `loadSettings`/`saveSettings` |
| `STORAGE (IndexedDB primary…)` | `COLLECTIONS` (every data key plus its default) and the `Store` API |
| `UI PRIMITIVES` | `toast`, `Modal`, `modalShell`, `tabs`, `cardHead`, `emptyState`, `tagChip`, `ui` (in-memory UI state) |
| `ROUTER / SHELL` | `VIEWS` (nav + render fn per view), `render()` / `renderNow()`, `rerender()`, `go(view)` |
| `REST TIMER` | header timer (`Timer`), `beep()`, `notify()` |
| `DASHBOARD (home)` | `renderDashboard()` plus per-module cards (`dashFamily`, `dashMeals`, `dashTasks`, …) |
| `FITNESS` | workout logger, programs, exercise library, stats, Hevy CSV import/export |
| `NUTRITION` | food log, Open Food Facts / USDA search, barcode, adaptive plan and check-ins, MacroFactor import |
| `SETTINGS & SYNC` | Settings modal, `exportAll()` backup, import (merge/replace) |
| `ROUTER / SHELL` → `NAV_COUNTS` | One entry per menu item returning `{ n, what, late?, dot? }` or null. To give a section a count, fill in its entry; do not add nagging counts for things a user has never used. |
| `HOME` → `RECIPE_LIBRARY`, `mpw*` | Ready-made budget recipes and the Plan my week planner. A library recipe is copied into `recipes` (with a `lib` key) only when a planned week is accepted. |
| `HOME` → `TEMPLATE_LIBRARY` | Built-in task templates shared by every user. Copies a user adds live in their own `ttemplates` with a `lib` key. |
| Share sheet → `READER`, `readLink()` | The link reader Worker in `reader/` (deployed with wrangler). It only answers the hosted origin and localhost:8080; change `ORIGINS` in `reader/worker.js` if the app's address changes. |
| `HELP: start-here tour and what's new` | `RELEASES` (update notes shown to users), `TOUR`, `dashNotices()`, the slide `deck*` functions, `openHelp()`, `A_HELP` |
| `// --- Media: YouTube` | Find a video: `YTAPI`, `ytSignIn`/`ytFinishSignIn` (own token in `ld.youtube`, read-only scope, same OAuth client as Drive), `ytFetch`, `YT_LOAD` (search, subs, liked, lists, list, channel), `ytModal`. `ytFinishSignIn` must run before `syncFinishSignIn` in `init()`. A search costs 101 of the project's 10,000 daily YouTube units, a Subscriptions refresh about 52. |
| `DEVICE SYNC (Google Drive app folder)` | `DRIVE` config, `syncMerge()` three-way merge, Google sign-in redirect, Drive calls, the `Sync` object, `A_SYNC` |
| `FAITH` | shared note helpers; `// --- Scripture`, `// --- Smart Search`, `// --- Berean study tools`, `// --- Journal`, `// --- Media library` |
| `HOME` | `// --- Marriage & family`, `// --- Family: …`, `// --- Recipes …`, `// --- Recipes & Meals: …`, `// --- Tasks`, `// --- Tasks: …` |
| `ACTIONS (event-delegated)` | the core `A` table and `Object.assign(A, A_FIT, A_NUT, …)` |
| `EVENT WIRING & INIT` | global click/input/change/submit/drag listeners and `init()` |

`obsidian/` holds an Obsidian theme and plugin (Life Dashboard Library) that sit beside the app; see `obsidian/README.md`. They never touch the app's data, and the plugin is plain CommonJS loaded by Obsidian as is.

See `docs/ARCHITECTURE.md` for the patterns and `docs/DATA_MODEL.md` for every stored collection.

### Core patterns (follow them)

- **Rendering:** views are functions that return HTML strings. `render()` rebuilds `#view` and then calls `afterRender` (photo hydration, icons). Escape every user string with `esc()`.
- **Events:** never attach listeners to elements. Put `data-action="name"` (click), `data-change`, `data-input` or `data-submit` on the element and add `name: el => { … }` to a module's action table (`A_TASKS`, `A_RECIPES`, …). The table is merged into `A` in the `Object.assign(A, …)` line, and **later tables override earlier ones**. `npm run check` flags accidental collisions. Intentional overrides are allow-listed in `scripts/check.mjs`.
- **Saving:** mutate `Store.get('key')` then call `Store.save('key')` (debounced write), or use `Store.set('key', value)`. Then call `render()`.
- **UI state** that shouldn't persist goes on `ui` (defaults come from `Object.assign(ui, {...})` near each module). Persistent preferences go on `S` plus `saveSettings()`.
- **Modals:** `Modal.open(modalShell(title, bodyHtml, footerHtml, submitActionName), { wide })`.
- **Accessibility:** use associated labels or meaningful accessible names. Shared rendering links existing label/field pairs and restores focus; Modal manages its name, focus loop, inert background and return focus. Decorative icons are hidden from assistive technology, so icon-only buttons need their own name. See `docs/ACCESSIBILITY.md`.
- **Tabs:** `tabs('uiKey', [[id, label, icon], …])` wired through the generic `setTab` action. The person can hide tabs (`S.hiddenTabs`), so a view must still work when its default tab is hidden. When tabs are merged, keep the old id working by mapping it to the new tab at the top of the section's render function. Dashboard cards are listed in `DASH_CARDS` and can be hidden (`S.hiddenCards`).
- **Icons:** `icon('lucide-name', 'w-4 h-4')`. The browser bundle is pinned under `vendor/lucide/`; confirm new icon names exist in that version.
- **Top-level names are global.** Before adding `function foo` or `const foo`, search for `foo`. Duplicate `const` names break the whole script, and duplicate `function` names silently override each other.
- **Imports and external URLs:** validate backups before planning a restore; persist records and photos through `commitBackupImport()`. Use `webUrl()` plus `esc()` for external links and image URLs. Podcast callbacks must remain in `isolatedPodcastRequest()`'s sandbox; never load service scripts in the main document.

## Known caveats

- Runtime styles, icons and spreadsheet parsing are pinned locally. Run `npm run build:css` after changing Tailwind classes and keep third-party notices and hashes current when upgrading vendored files. See `docs/DEPENDENCIES.md`.
- YouTube/Vimeo embeds refuse to play from `file://` (YouTube error 153). They need an `http(s)` origin. This is part of the planned hosted/PWA phase.
- Version 2 JSON backups include personal photos. Downloaded Bibles, Berean tables and the Obsidian-vault link remain device-local. Legacy version 1 backups contain no photos, so importing one preserves photos already on the destination device.

## Roadmap the user has agreed to

- **Phone + laptop** (resumed by Seth on 2026-10-12; his phone is an iPhone): host at an https URL as an installable offline PWA, and sync through a private Google Drive `appDataFolder`. Sync does not need to be real time.
  - Built: `manifest.webmanifest`, `assets/icons/`, `sw.js` (offline app shell) and safe-area padding. `index.html` registers the worker on https only; `?pwa` on localhost is for `tests/pwa.spec.js`. When a vendored file is renamed or added, update the `SHELL` list in `sw.js`.
  - Hosted on GitHub Pages at https://9r5wwng7nj-netizen.github.io/Life-Dashboard/ (repo made public by Seth on 2026-10-12). Pages publishes the `main` branch root after every push, so everything on `main` is public and live within a few minutes.
  - Drive sync is built. `DRIVE.clientId` is the OAuth client ID from Seth's `connection.church` Google Cloud project (an Internal app; the ID is public by design and is tied to the hosted address). Each device turns sync on in Settings & Sync. It syncs records and the settings listed in `SYNC_SETTINGS`; photos (`photoMeta` and the `photos` store), API keys and downloaded libraries stay on each device. Photo sync is the next step.
  - Sync rules: every write still goes through `Store.save()`/`Store.set()`, which is what marks a device as changed. Merged data is checked with `validateBackup()` and saved with `commitBackupImport()`, so a bad Drive copy changes nothing. A new collection syncs automatically; add it to `SYNC_SKIP` only if it must stay on the device. Lists of records merge by `id`, so keep giving records an `id`.
  - Sync safeguards, which must stay: before merging, `Sync.adopt()` reloads what is saved on the device, so an out-of-date second tab cannot sync its old view; a sync that would remove more than `SYNC_LOSS_LIMIT` records (outside `SYNC_CLEARED_OFTEN`) pauses until Seth confirms it; and the first sync of each day keeps a dated copy in the same app folder (`Sync.keepCopy`, thinned by `copiesToDrop` to 7 daily and 8 weekly), which Settings & Sync → Restore from a copy can add back from.
  - On iPhone the installed home-screen app has its own storage, separate from Safari. Import the backup inside the installed app.
  - Keep `id` and `updated` on records to make merging possible.
  - Keep reference data (Bibles, lexicons) separate from personal data.
- **Dashboard master plan** (Seth's audit answers, 2026-10-16):
  - Phase 1 (built): daily Drive copies with Restore from a copy; dashboard card order; Journal and Media show 50 at a time; Log food first on a phone; this docs refresh.
  - Phase 2: a phone bottom bar with **Dashboard, Tasks, Nutrition, Workouts** plus a **+** capture button; compact task rows and a morning overdue sweep; *Stay signed in* to Google through the Cloudflare worker (Seth agreed to the Google Cloud setup); a Today card; one Weekly reset (nutrition check-in, Big 3, family review, then the Obsidian weekly review); photo sync.
  - Phase 3: notes on a Bible passage and quotes/illustrations belong in Obsidian (the dashboard sends them); Google Calendar on the Today card; real push reminders only if needed; splitting `index.html` into parts is approved when it helps (a build step would also allow trimming the Lucide icon set).
  - No in-app sharing with a spouse: a shared Apple Reminders list is enough. Seth uses every section, so don't hide any by default.
  - Seth said yes to all 24 automation ideas on the plan page (Siri/Shortcuts captures through Obsidian or a worker inbox, groceries and timed tasks to Apple Reminders, birthdays to gift tasks, sermon readiness, and so on). Shortcuts cannot open or write into the home-screen web app, so phone automations go through Obsidian, Apple's own apps or the worker.
- The user has said not now to Miyo integration and Claude-powered answers in Smart Search. Leave that code as is.
