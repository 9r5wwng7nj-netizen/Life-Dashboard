# Data model

All personal data stays in the browser. **Backward compatibility is the #1 rule.** Add fields and collections freely, but never rename or remove them. See AGENTS.md.

## Where things are stored

| Place | Key(s) | Contents | In JSON backup? |
|---|---|---|---|
| IndexedDB `life-dashboard` (v3), store `kv` | one entry per collection key below | All records | ✅ (`Settings & Sync → Export all data`) |
| IndexedDB store `photos` | photo id → Blob | Progress photos (plain uid), journal `jp_…`, family memories & date nights `fm_…`, recipes `rp_…` | ✅ (backup v2+) |
| IndexedDB store `bibles` | translation ids; `vault.docs`, `vault.handle`, `berean.tables`, `berean.topics`, `berean.lexicon` | Downloaded Bibles, Obsidian-vault index & folder handle, Berean tables, Strong's lexicon | ❌ (re-downloadable reference data) |
| localStorage | `ld.settings` | Settings object `S` (theme, units, macro targets, translation, keys…) | ✅ (keys excluded) |
| localStorage | `ld.data.<key>` | Fallback copy of collections when IndexedDB is unavailable | — |
| IndexedDB store `bibles` | `sync.base` | The last snapshot this device and Google Drive agreed on; sync compares against it | ❌ (rebuilt by the next sync) |
| localStorage | `ld.settings` → `tour`, `newsSeen` | Whether this device has been offered the tour (`new`/`done`) and the id of the newest update note it has shown | ✅ (with settings) |
| localStorage | `ld.settings` → `hiddenTabs` | Section tabs the person hid, as `{ taskTab: ['stats'], … }`; synced between devices | ✅ (with settings) |
| localStorage | `ld.settings` → `tabsV` | Which default-hidden tabs have been applied to saved settings (2 = Tasks People and Media Stats); synced | ✅ (with settings) |
| localStorage | `ld.settings` → `hiddenCards` | Dashboard cards the person hid, by id from `DASH_CARDS` (`nutrition`, `weight`, `training`, `tasks`, `faith`, `family`, `meals`); synced | ✅ (with settings) |
| localStorage | `ld.settings` → `cardOrder` | The dashboard cards' order, by id from `DASH_CARDS`; empty means the default order, and cards it doesn't list follow at the end; synced | ✅ (with settings) |
| localStorage | `ld.settings` → `bar` | The four sections in the phone's bottom bar, by view id (default `dashboard`, `tasks`, `nutrition`, `fitness`); anything that isn't four different known views falls back to the default; synced | ✅ (with settings) |
| localStorage | `ld.settings` → `ytShorts` | Whether Find a video shows Shorts (default off; device only) | ✅ (with settings) |
| localStorage | `ld.settings` → `vaultName`, `obsFolder` | The Obsidian vault's name and the folder that Send to Obsidian saves into (device only, not synced) | ✅ (with settings) |
| localStorage | `ld.youtube` | YouTube connection for Find a video: `{ on, token, exp, state, verifier, refresh, view, error }`. The token is read-only and lasts about an hour; `refresh` (with the Worker's Google step) renews it | ❌ |
| localStorage | `ld.sync` | Sync state for this device: on/off, the one-hour Google access token, `refresh` (a refresh token that renews it, when the Worker's Google step is set up) and `verifier` (PKCE, only during sign-in), last sync time, last error, `photosLeft`/`photoError` (photos still to move, and why the last photo step failed), and `copied`/`copyError` (the day this device last made or found the daily Drive copy, and why the last one failed) | ❌ |
| Google Drive app folder | `photo-<id>` | One file per photo that a record uses (`photoRefs`: `photo`/`photos` fields and `photoMeta`), uploaded and downloaded by `Sync.photos()`, never deleted | — |
| Google Drive app folder | `life-dashboard-sync.json`, `life-dashboard-copy-YYYY-MM-DD.json` | The synced records and settings (version 1 backup format with `sync: 1`), and dated daily copies of them: one per day for 7 days, then one per week for 8 weeks (`copiesToDrop`). Settings & Sync → Restore from a copy opens one | — (they are copies) |
| localStorage | `ld.phoneSeen` | Ids of the last 300 items sent from the phone that this device took in, so a repeat delivery adds nothing | ❌ |
| Google Drive app folder | `claude-connected.json` | Written by the Claude connector (`reader/connector.js`) when someone connects Claude, and again whenever it is used. While it is there, each sync keeps Claude's copy; Settings & Sync → Stop sharing with Claude removes it | — |
| Google Drive app folder | `claude-now.json`, `claude-days-YYYY.jsonl`, `claude-workouts-YYYY.jsonl`, `claude-notes-YYYY.jsonl` | Claude's copy (`claudeCopy()`): what is current (open tasks, the last 14 days of food, this week, family, meals, saved foods…), then one JSON line per food day, workout and record (journal, prayer, Scripture note, quote, media, finished task), each starting `{"d":"YYYY-MM-DD"`. Weights are in the person's unit. Rewritten on each sync, changed files only | — (a copy) |
| Google Drive app folder | `claude-inbox-<id>.json` | One request from Claude (`what`: `task`, `done`, `someday`, `reschedule`, `food`, `weight`, `prayer`, `journal` or `grocery`; `someday` and `reschedule` carry a `task` id, and `reschedule` a `due` and optional `time`), taken in by the next sync (`claudeApply`, record id `c-<id>`) and then deleted | — |
| localStorage | `ld.claude` | This device's Claude state: `on` (Claude's copy is being kept), `at` (last refreshed), `files` (a hash per copy file, so unchanged ones aren't sent again), `seen` (the last 300 inbox ids taken in), `error` | ❌ |
| localStorage | `ld.timer`, `ld.focus`, `ld.rd`, `ld.il`, `ld.votd`, `ld.bibles`, `ld.berean`, `ld.vault`, `ld.seeded`, `ld.libv`, `ld.srcv` | Small per-device state and one-time migration flags | ❌ |

`Store.init()` loads every key in `COLLECTIONS`. A missing key gets its default (`structuredClone(COLLECTIONS[k])`), which is how new modules arrive without any import.

## Collections (`COLLECTIONS` in index.html)

**Fitness**: `workouts`, `routines`, `exercises` (library names), `exMeta` (per-exercise type and notes), `programs`, `activeWorkout`

**Nutrition and body**
- `foods` (saved foods; `basis` is `100g` or `serving`, `base` holds the nutrients; optional `cupG` is what a cup weighs in grams, picked by the person when the food didn't say, which adds cup, tbsp and tsp units)
- `meals` (saved meals)
- `nutrition`: a `{ 'YYYY-MM-DD': { weight, entries[] } }` map
- `nutPlan` (adaptive plan and check-ins), `measurements`, `photoMeta` (progress-photo index), `mfImport`

**Scripture**: `highlights`, `readingPlans`, `memory` (verses: `{ id, ref, text, tr, added, box 1–5, due, reviews, lapses, last }`), `memkit` (`{ days: { 'YYYY-MM-DD': { xp, n, perfect } }, mode? }`; XP, level, streak and badges are worked out from `days`, never stored), `prayers`, `scripture` (study notes), `passageCache`, `ministries` (sources list)

**Journal**: `journal` (entries with type, mood, energy, photos `jp_…`, prayer links), `jkit` (`{ prompts, templates }`)

**Media Library**
- `media`: sermons, podcasts, videos, articles, books, courses. Optional fields: `audio`, `article.md`, `highlights`, `rating`, `colls`, `pos`…
- `mcolls` (collections/series), `quotes` (quotes and illustrations), `mkit` (`{ goals, clipHidden }`)

**Marriage & Family**
- `checkins`, `dateIdeas` (with a `log[]` of dates), `milestones`, `goals` (rhythms: `{ text, cadence, log[] }`)
- `fpeople`: people with role, birthday, `loveLang[]`, favorites, sizes, `growth[]`, `quotes[]`, `prayer`, `prayed[]`
- `gifts` (idea → bought → given)
- `fkit`: `{ covenant, principles, restoration, anniversary, nextDate }`
- `boundaries`, `repairs`, `loveLog`, `freviews` (Monday reviews, by `week`), `memories`, `dateLog`

**Recipes & Meals**
- `recipes`. Optional fields: `rating`, `fav`, `kids`, `made[]`, `cost`, `freezer`, `photo`, `img`, `macroMap`, `macroCalc`.
- `mealPlan`: a `{ 'YYYY-MM-DD': [{ id, recipeId|null, text?, slot?, portions?, left?, from?, freezerId?, made?, logged?, batch?, host? }] }` map. Items without `slot` mean dinner.
- `grocery`: `[{ id, name, qty, unit, checked, source, section?, store?, price?, note? }]`
- `pantry`, `freezer`, `hosting`
- `gkit`: `{ stores[], staples[], sectionMap{}, spend[], budget, basics[], tableShift, prayShift, planPrefs? }`; `planPrefs` holds the last Plan my week choices `{ people, budget, slots[], maxTime, library }`
- Recipes copied from the ready-made `RECIPE_LIBRARY` carry an optional `lib` key

**Tasks**
- `tasks`: `{ id, title, notes, status: todo|doing|done, priority: high|med|low, due, tags[], created, completedAt }` with optional fields:
  - `time`, `repeat {freq, n}` (`freq` is `day`, `weekday`, `week`, `month`, `monthNth`, `year`, or `days` with a `days` list of weekday numbers, 0 = Sunday), `remind` (minutes, `am` or `pm1`), `reminded`
  - `area`, `project`, `person`, `waiting`, `waitSince`, `nudged`, `someday`, `est`, `pushed`, `note` (the name of a linked Obsidian note), `personAt` (added with @Name; cleared once Obsidian has a profile)
  - `subtasks [{id,text,done}]`, `series`, `nextMade`
- `projects`: `{ id, name, area, due, status: active|paused|done, notes, created }` with optional `repeat {freq, n}`, `nextMade` (id of the next round), `series` and `note` (a linked Obsidian note). The next round and its tasks get ids of the form `<original id>.r<YYYY-MM-DD>`, so two synced devices create the same records.
- `ttemplates` (the user's own checklist templates: `items [{off, text}]`, optional `lib` when copied from the built-in `TEMPLATE_LIBRARY`)
- `tkit`: `{ weeks: { 'YYYY-MM-DD (Mon)': { big3[], notes, planned, obsReview? } }, focus[], seeded, swept?, reminded? }` (`reminded`: task id → the date and time last sent to Apple Reminders) (`obsReview`: the day the Weekly reset opened that week's Obsidian review) (`swept`: the day Tidy up last ran or was put off, so it is offered once a day)
- `tblocks`: a `{ 'YYYY-MM-DD': [{ id, start 'HH:MM', mins, taskId?, label? }] }` map

## Conventions

- Dates are local `YYYY-MM-DD` strings (`ymd()`). Weeks start on **Monday** (`startOfWeek()`). Timestamps are ISO strings.
- IDs come from `uid()`. Records keep `id`, and where practical `created`/`updated`, which a future sync will need.
- Areas for tasks come from `task.area`, then the project's area, then tags (`work`/`ministry`/`church`/`college` → Ministry, `home`, `personal`, `faith`).
