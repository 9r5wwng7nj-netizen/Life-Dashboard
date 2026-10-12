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
| localStorage | `ld.sync` | Sync state for this device: on/off, the one-hour Google access token, last sync time, last error | ❌ |
| localStorage | `ld.timer`, `ld.focus`, `ld.rd`, `ld.il`, `ld.votd`, `ld.bibles`, `ld.berean`, `ld.vault`, `ld.seeded`, `ld.libv`, `ld.srcv` | Small per-device state and one-time migration flags | ❌ |

`Store.init()` loads every key in `COLLECTIONS`. A missing key gets its default (`structuredClone(COLLECTIONS[k])`), which is how new modules arrive without any import.

## Collections (`COLLECTIONS` in index.html)

**Fitness**: `workouts`, `routines`, `exercises` (library names), `exMeta` (per-exercise type and notes), `programs`, `activeWorkout`

**Nutrition and body**
- `foods` (saved foods; `basis` is `100g` or `serving`, `base` holds the nutrients)
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
- `gkit`: `{ stores[], staples[], sectionMap{}, spend[], budget, basics[], tableShift, prayShift }`

**Tasks**
- `tasks`: `{ id, title, notes, status: todo|doing|done, priority: high|med|low, due, tags[], created, completedAt }` with optional fields:
  - `time`, `repeat {freq, n}`, `remind` (minutes, `am` or `pm1`), `reminded`
  - `area`, `project`, `person`, `waiting`, `waitSince`, `nudged`, `someday`, `est`, `pushed`
  - `subtasks [{id,text,done}]`, `series`, `nextMade`
- `projects`, `ttemplates` (checklist templates: `items [{off, text}]`)
- `tkit`: `{ weeks: { 'YYYY-MM-DD (Mon)': { big3[], notes, planned } }, focus[], seeded }`
- `tblocks`: a `{ 'YYYY-MM-DD': [{ id, start 'HH:MM', mins, taskId?, label? }] }` map

## Conventions

- Dates are local `YYYY-MM-DD` strings (`ymd()`). Weeks start on **Monday** (`startOfWeek()`). Timestamps are ISO strings.
- IDs come from `uid()`. Records keep `id`, and where practical `created`/`updated`, which a future sync will need.
- Areas for tasks come from `task.area`, then the project's area, then tags (`work`/`ministry`/`church`/`college` → Ministry, `home`, `personal`, `faith`).
