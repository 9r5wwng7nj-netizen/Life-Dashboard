# Changelog

The app was built in phases, one module at a time. Each phase was tested by upgrading from the previous version's saved data, so nothing ever needed re-importing.

## Unreleased
- Start-here tour for new users (a card on the dashboard, and under Help & what’s new in the menu), and a what’s-new message with slides after each update, driven by the `RELEASES` list.
- Menu items show a count for what needs attention today (tasks due or overdue; Scripture reading and memory verses; no food logged or weigh-in; no journal entry; no dinner planned; the weekly family review). Daily checks look at today only and stay quiet until that part of the app has been used, with a dot on the menu button on phones. Counts live in one `NAV_COUNTS` registry with an entry for every menu item.
- Tasks → Templates includes a built-in library of 25 templates that any user can use or copy into their own list. New installs no longer start with three ministry templates; existing template lists are unchanged.
- Tasks stay in the Inbox until they have both a due date and an area or project. Someday and waiting-on tasks are unaffected.
- Fields use 16px text on touch screens so iPhones no longer zoom in when one is tapped.
- Generic wording for sharing: family exports are titled “Family Rule of Life”, or “<Family name> Family Rule of Life” when the new optional Family name setting is filled in. Placeholders no longer mention a personal vault or sermon series, and two local churches were removed from the default sources list for new installs (existing lists are unchanged).
- Scripture memory practice: type the first letter of each word through three steps (Read, Recall, Master), with 90% needed to pass. Reviews are graded by typing; saying a verse aloud and grading yourself is still available. Practice earns XP, levels, a daily streak and badges, shown on the Memory tab and the dashboard. Adds one collection, `memkit`; existing memory verses are unchanged.
- Sync safeguards: every sync first reloads what is saved on the device, so a second tab left open cannot sync an out-of-date view over newer data; and a sync that would remove more than 10 records pauses until it is confirmed.
- Device sync through a private Google Drive app folder: three-way merge of records and basic settings, a header sync button and controls in Settings & Sync. Each device turns it on in Settings & Sync. Photos, API keys and downloaded libraries do not sync yet. No stored data changed; sync adds one localStorage key (`ld.sync`) and one device-local entry (`sync.base`).
- Mobile phase started (Seth, 2026-10-12): the app has a web manifest, home-screen icons, safe-area padding and a service worker (`sw.js`) so a hosted https copy installs on a phone and reopens offline. The `file://` copy never registers the worker and behaves as before. No stored data changed.
- The repository is public and GitHub Pages hosts the app at https://9r5wwng7nj-netizen.github.io/Life-Dashboard/. Sync is not set up yet.
- Journal Focus is a named keyboard-contained dialog with an inert background, visible focus, Escape cleanup and return focus. Journal/family detail controls have meaningful names; task-board titles are keyboard-editable and completed tasks retain readable contrast.
- Food lookups and Bible requests have bounded response/body waits and offline/unreachable/invalid-response recovery messages. Public-service checks and remaining manual steps are documented without claiming service availability or screen-reader certification.
- Backups containing existing MacroFactor name|unit food identifiers can be restored; unsafe identifiers are still rejected and saved IDs are not rewritten.
- CI now exercises populated views, common editing/search workflows, recurring tasks, imports/backup roundtrips and performance probes in isolated Chromium contexts.
- Startup reads the 51 saved collections in a single transaction and stops safely if that read is interrupted.
- Projects and People group tasks once per view instead of rescanning all tasks per project/person. Photo loads are deduplicated and unused object URLs are released without deleting saved photos.
- A repeatable isolated-browser performance probe checks large synthetic task lists, startup reads and photo cache lifecycle.
- Long section-tab strips remain inside the main view at medium desktop widths instead of widening the whole page.
- Shared accessibility fixes add associated form labels, dialog focus management, keyboard navigation, live announcements, visible focus indicators, reduced-motion support and improved small-text/button contrast.
- Accessibility regression checks cover the main views/sections in light/dark mode and common editing dialogs.
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
