# Life Dashboard — guide for coding agents

This file is the shared brief for **Claude Code** (via `CLAUDE.md`) and **OpenAI Codex** (which reads `AGENTS.md`). Read it before changing anything.

## What this is

A personal, offline-first dashboard for one person (Seth): Workouts, Nutrition, Scripture, Journal, Media Library, Marriage & Family, Recipes & Meals and Tasks. The application UI and roughly 6,000 lines of vanilla JavaScript remain in `index.html`; pinned runtime libraries and compiled Tailwind CSS live in `vendor/` and `assets/`. There is no framework or application server. All data lives in the user's browser (IndexedDB). The app is opened directly from disk (`file://`) in Chrome.

## Golden rules

1. **Never break saved data.** The user keeps years of records in the browser and must never have to re-import anything after an update.
   - Changes to stored data are **additive only**. New fields are optional and read with fallbacks (`t.subtasks || []`).
   - New collections are added to `COLLECTIONS` with a default. `ensureSeeds()` and `Store.init()` fill in anything missing.
   - Never rename or delete a collection key, a localStorage key (`ld.*`), the IndexedDB name (`life-dashboard`) or a store name. Never bump the DB version without an `onupgradeneeded` path that keeps the existing data.
   - If a shape must change, migrate in place on load and keep reading the old shape.
2. **Preserve the design.** Use the existing Tailwind utility patterns and components (`card`, `btn`, `btn-primary`, `chip`, `chip-on`, `stat`, `label`, `input`, `muted`). Every new UI needs `dark:` variants and must work at 390px wide.
3. **Keep application code in `index.html`** unless the user explicitly asks for a refactor. Supporting build input, compiled CSS and vendored third-party libraries stay in their existing folders.
4. **Run the checks before you finish:** `npm test`, or at least `npm run check`.
5. **No secrets in the repo.** API keys (ESV, USDA, Anthropic) are entered in Settings, live in localStorage and are excluded from backups. Never hard-code them. Never commit backup JSON files; `.gitignore` already blocks them.

## Run, check, test

```bash
npm install                 # dev tools only — the app itself has no npm dependencies
npm run build:css           # rebuild assets/app.css after changing classes or src/app.css
npm start                   # serves http://localhost:8080 (see the storage note below)
npm run check               # static check: syntax, duplicate functions, action-name collisions
npx playwright install chromium   # once
npm test                    # check + Playwright smoke tests (every view/tab, reload persistence, phone width)
```

You can also just open `index.html` in Chrome; that is how the user runs it.

**Storage is per origin.** `file://`, `http://localhost:8080` and any hosted URL each have their own separate IndexedDB. For testing, use a localhost server or a fresh profile; the user's real data lives under `file://`. The smoke tests use a fresh, empty browser profile every run.

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
| `FAITH` | shared note helpers; `// --- Scripture`, `// --- Smart Search`, `// --- Berean study tools`, `// --- Journal`, `// --- Media library` |
| `HOME` | `// --- Marriage & family`, `// --- Family: …`, `// --- Recipes …`, `// --- Recipes & Meals: …`, `// --- Tasks`, `// --- Tasks: …` |
| `ACTIONS (event-delegated)` | the core `A` table and `Object.assign(A, A_FIT, A_NUT, …)` |
| `EVENT WIRING & INIT` | global click/input/change/submit/drag listeners and `init()` |

See `docs/ARCHITECTURE.md` for the patterns and `docs/DATA_MODEL.md` for every stored collection.

### Core patterns (follow them)

- **Rendering:** views are functions that return HTML strings. `render()` rebuilds `#view` and then calls `afterRender` (photo hydration, icons). Escape every user string with `esc()`.
- **Events:** never attach listeners to elements. Put `data-action="name"` (click), `data-change`, `data-input` or `data-submit` on the element and add `name: el => { … }` to a module's action table (`A_TASKS`, `A_RECIPES`, …). The table is merged into `A` in the `Object.assign(A, …)` line, and **later tables override earlier ones**. `npm run check` flags accidental collisions. Intentional overrides are allow-listed in `scripts/check.mjs`.
- **Saving:** mutate `Store.get('key')` then call `Store.save('key')` (debounced write), or use `Store.set('key', value)`. Then call `render()`.
- **UI state** that shouldn't persist goes on `ui` (defaults come from `Object.assign(ui, {...})` near each module). Persistent preferences go on `S` plus `saveSettings()`.
- **Modals:** `Modal.open(modalShell(title, bodyHtml, footerHtml, submitActionName), { wide })`.
- **Tabs:** `tabs('uiKey', [[id, label, icon], …])` wired through the generic `setTab` action.
- **Icons:** `icon('lucide-name', 'w-4 h-4')`. The browser bundle is pinned under `vendor/lucide/`; confirm new icon names exist in that version.
- **Top-level names are global.** Before adding `function foo` or `const foo`, search for `foo`. Duplicate `const` names break the whole script, and duplicate `function` names silently override each other.

## Known caveats

- Runtime styles, icons and spreadsheet parsing are pinned locally. Run `npm run build:css` after changing Tailwind classes and keep third-party notices and hashes current when upgrading vendored files. See `docs/DEPENDENCIES.md`.
- YouTube/Vimeo embeds refuse to play from `file://` (YouTube error 153). They need an `http(s)` origin. This is part of the planned hosted/PWA phase.
- Version 2 JSON backups include personal photos. Downloaded Bibles, Berean tables and the Obsidian-vault link remain device-local. Legacy version 1 backups contain no photos, so importing one preserves photos already on the destination device.

## Roadmap the user has agreed to

- **Phone + laptop:** host at an https URL as an installable offline PWA, and sync through a private Google Drive `appDataFolder`.
  - Keep `id` and `updated` on records to make merging possible.
  - Keep reference data (Bibles, lexicons) separate from personal data.
- The user has said not now to Miyo integration and Claude-powered answers in Smart Search. Leave that code as is.
