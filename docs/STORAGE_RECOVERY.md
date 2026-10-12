# Storage recovery and record verification

## Fixed failure behavior

Previously, a flush cleared its pending-key list before writes completed. IndexedDB/localStorage failures could therefore leave the latest changes only in memory, with no retained key to retry. Some explicit transaction aborts also left photo/reference promises unresolved or reported deletion as success.

Flushes now run through a serialized queue. Successful collections commit normally; failed keys return to the pending set. Explicit flushes reject, while background debounce/page-hide callers handle that rejection and leave a persistent warning visible. The warning offers Retry saving and Export backup; it disappears after pending writes succeed. Backup payloads include current in-memory record values, including unsaved edits.

Reset waits for the current write queue before clearing stores, preventing a delayed pre-reset write from restoring erased test records. Corrupt localStorage fallback JSON now stops loading instead of silently substituting defaults. Database names, stores, versions, keys and saved-record formats are unchanged.

Photo/reference helpers settle only on transaction completion and reject errors/aborts. Photo URL invalidation follows successful deletion; a failed Journal photo deletion leaves its link unchanged. Resizing closes decoded ImageBitmaps and rejects failed encoding. Mixed Journal upload batches preserve successful additions, commit their links and report the number of failures.

## What a user should do when the warning appears

Keep the tab/profile open. Try Retry saving. If the warning persists, export a backup before closing and investigate storage availability/quota. Failed changes are still in memory; this is not a durable recovery journal, and closing/crashing the browser before retry/export can still lose unsaved work. Do not promise that pagehide writes always finish.

If startup reports unreadable saved data, keep that browser profile and seek help before resetting or importing. Do not assume a backup made after an incomplete load contains all records.

## Isolated verification

`npm run probe:records` uses the existing isolated localhost Chromium configuration and no personal records/keys. CI runs it after the other checks.

- Workout UI edits retain notes, import source and duration sets, convert weight correctly and survive reload.
- A generated 2600×1300 PNG becomes a 1600×800 JPEG for Journal. A mixed valid/invalid file batch preserves successful files and existing links through reload.
- Failed collection and fallback writes retain pending keys; current-memory backups contain the unsaved edit; retry persists it and clears the warning.
- Queued edits save in order and retain the latest version.
- Eight deliberately aborted collection/photo/reference/clear operations reject and preserve prior data.
- Warning controls/layout pass automated accessibility checks at 1200px/390px in light/dark mode; actual screen-reader speech remains unverified.
- Reset waits for a delayed write without resurrecting records.
- Synthetic 66-book Bible, 1,001 lexicon entries, 1,001 topical entries and 100,000 table rows exercise parsing/storage, malformed/incomplete rejection and typed arrays. These are labeled fixtures, not theological sources or proof that every production file is supported.

## Important follow-up

Photo replacement/deletion and its record-link update still use separate transactions in some existing flows. This round does **not** claim those operations are fully atomic or safe against every failure between the two writes. Prioritize a focused atomic-photo update before treating data-integrity work as complete. VoiceOver and mobile foundation remain deferred; file-origin populated tests and additional browsers also remain on the verification backlog.
