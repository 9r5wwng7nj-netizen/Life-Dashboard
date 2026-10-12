# Your data: moving to the repo safely

Everything you've entered lives in **Chrome's storage for the place the app is opened from**. It is not in `index.html` and not in this repo. Browsers keep storage separately for each *origin*:

| How you open the app | Origin | Sees your current data? |
|---|---|---|
| Double-clicking an `index.html` / `life-dashboard.html` on your computer, in the same Chrome profile | `file://` | **Yes.** Chrome shares one storage area for local files, so a copy in a new folder normally sees the same data. |
| `npm start` → `http://localhost:8080` | `http://localhost:8080` | No. It starts empty. |
| A hosted address (GitHub Pages, your own domain) | that address | No. It starts empty. |
| A different browser, Chrome profile or computer | — | No |

## Before you switch to the repo copy

1. Open your current `life-dashboard.html`, then go to **Settings & Sync → Back up personal data + photos**. Keep the `.json` somewhere safe, **outside** the repo folder.
2. Open the repo's `index.html` in the same Chrome profile. Your data should all be there.
3. If it opens empty, go to **Settings & Sync → Import backup… → Replace everything** and pick the backup.

## What a backup includes

Version 2 backups include all personal records and the photo files stored by Life Dashboard. API keys are intentionally excluded. Legacy version 1 backups did not contain photos; importing one preserves photos already stored in the destination browser.

## What a backup does *not* include

These live on the device. You redo them once on any new origin or device:

- Downloaded Bibles: Scripture → Library → download again.
- Berean tables and topical index: import the files you downloaded again.
- Strong's lexicon: it re-downloads when needed.
- The Obsidian vault connection: Smart Search → Sources → connect again.
- API keys (ESV, USDA): re-enter them in Settings.

## Keep backups out of Git

`.gitignore` blocks `*backup*.json`. Don't rename backups to get around it. They hold your private journal, prayers and family notes.

## Later: phone + laptop

The agreed plan is to host the app at an https address as an installable PWA and sync through a private Google Drive folder. When that happens, you'll import one backup into the hosted version and sync from then on.
