# Changelog

The app was built in phases, one module at a time. Each phase was tested by upgrading from the previous version's saved data, so nothing ever needed re-importing.

## Unreleased
- Backup import validates the file before modifying data and commits records/photos in one IndexedDB transaction, preserving existing data on failure.
- External links and media embeds reject unsafe URL schemes and lookalike service hosts; structured article/recipe clips validate their types.
- Podcast callback scripts run in an isolated sandbox, and link previews use ordinary JSON requests.
- Backup format v2 includes personal photo files as well as their metadata. API keys and re-downloadable reference libraries remain excluded.
- Legacy v1 backups still import safely and preserve photos already stored in the destination browser.
- “Erase all data” now clears records, photos, downloaded libraries, settings and API keys from the browser.
- Tailwind styles, Lucide icons and SheetJS are pinned and served locally; startup and spreadsheet imports no longer execute CDN-hosted dependency code.
- The static check and browser suite prevent remote dependency scripts or styles from being reintroduced.

## 1.0.0 — moved to Git (2026-10-12)
- The repo starts from the working `life-dashboard.html`, saved byte-for-byte as `index.html`. The app itself is unchanged.
- Added agent briefs (`AGENTS.md`, `CLAUDE.md`), docs, a static check (`scripts/check.mjs`), Playwright smoke tests and CI.

## Earlier phases (single-file builds)
- **Tasks**:
  - Natural-language quick add, recurring tasks, areas and projects, checklists.
  - Today / Inbox / Upcoming / Someday views, time blocking with "Fill my day", focus timer.
  - Weekly planning with Big 3, linked to the Monday Family Review.
  - People follow-ups and "waiting on", checklist templates, reminders, stats, dashboard card.
  - Fixes: dashboard cards were too wide at phone width; deleting a reading plan didn't work.
- **Recipes & Meals**:
  - Recipe clipper, cook mode with timers, macros from ingredients, logging to Nutrition.
  - Favorites, ratings and rotation; meal-plan slots with targets, leftovers and prep day.
  - Pantry, freezer and "what can I make".
  - Grocery list by aisle, store, staples and budget.
  - Hosting and meal trains, family table, dashboard card.
- **Marriage & Family**:
  - Monday Family Review, Rule of Life (covenant, principles, restoration, rhythms), boundary builder, repair log.
  - People profiles, gift ideas, love in action, date-night planner and log.
  - Memories with "On this day", kids' growth and quotes, prayer rotation, dashboard card.
- **Media Library**:
  - Library, up next, books, collections, quotes and illustrations, stats.
  - Podcast finder and player, article clipper, highlights, live timestamp chips.
- **Journal**: templates, prompt library, mood and energy, Scripture links, photos, dictation, focus mode, calendar and insights, weekly and monthly reviews, Obsidian export.
- **Berean study tools**: interlinear, word studies, topical index, concordance, Strong's lexicon.
- **Smart Search**: plain-language topics to Scripture, plus notes, vault and trusted resources, with crisis resources.
- **Scripture**: reader, offline Bibles, plans, highlights, memory verses, prayer list.
- **Foundations**: dashboard, workouts (Hevy-style), nutrition (MacroFactor-style adaptive plan), settings, backup/restore, dark mode.
