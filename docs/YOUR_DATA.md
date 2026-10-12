# Your data: moving to the repo safely

Everything you've entered lives in **Chrome's storage for the place the app is opened from**. It is not in `index.html` and not in this repo. Browsers keep storage separately for each *origin*:

| How you open the app | Origin | Sees your current data? |
|---|---|---|
| Double-clicking an `index.html` / `life-dashboard.html` on your computer, in the same Chrome profile | `file://` | **Yes.** Chrome shares one storage area for local files, so a copy in a new folder normally sees the same data. |
| `npm start` → `http://localhost:8080` | `http://localhost:8080` | No. It starts empty. |
| The hosted address (GitHub Pages) | that address | No. It starts empty. |
| A different browser, Chrome profile or computer | — | No |

## Before you switch to the repo copy

1. Open your current `life-dashboard.html`, then go to **Settings & Sync → Back up personal data + photos**. Keep the `.json` somewhere safe, **outside** the repo folder.
2. Open the repo's `index.html` in the same Chrome profile. Your data should all be there.
3. If it opens empty, go to **Settings & Sync → Import backup… → Replace everything** and pick the backup.

## What a backup includes

Version 2 backups include all personal records and the photo files stored by Life Dashboard. API keys are intentionally excluded. Legacy version 1 backups did not contain photos; importing one preserves photos already stored in the destination browser.

Imports accept Life Dashboard version 1 or 2 JSON files up to 256 MB. The app checks collection types, settings, photo payloads, duplicate identifiers and unsafe object keys before making changes. Missing older collections receive their defaults; unknown collection names are ignored.

With IndexedDB available, records and photos are saved in one transaction. If that transaction fails, the previous records and photos remain in place and the app reports the failure. Browser-local API keys are preserved during restore. The localStorage fallback cannot restore photo files.

## What a backup does *not* include

These live on the device. You redo them once on any new origin or device:

- Downloaded Bibles: Scripture → Library → download again.
- Berean tables and topical index: import the files you downloaded again.
- Strong's lexicon: it re-downloads when needed.
- The Obsidian vault connection: Smart Search → Sources → connect again.
- API keys (ESV, USDA): re-enter them in Settings.

## Keep backups out of Git

`.gitignore` blocks `*backup*.json`. Don't rename backups to get around it. They hold your private journal, prayers and family notes.

## Phone + laptop (in progress)

The plan is to host the app at an https address as an installable PWA and sync through a private Google Drive folder. The app is hosted at <https://9r5wwng7nj-netizen.github.io/Life-Dashboard/> and can be installed and opened offline; sync is not set up yet.

To start using the hosted address:

1. On the laptop, export a backup from the copy you use today, open the hosted address in Chrome and import the backup there. Use the hosted address from then on.
2. On the iPhone, open the address in Safari, tap **Share → Add to Home Screen**, then open the app from the home-screen icon and import the same backup **inside that installed app**. The installed app keeps its own data, separate from Safari.

Until sync is switched on, the phone and laptop each keep their own copy of your data.

### Sync

Sync keeps one copy of your records in a hidden app folder in your Google Drive. Only this app can read that folder; it does not appear among your Drive files.

- Turn it on per device: **Settings & Sync → Connect Google Drive**. The first device uploads its records. Each later device asks whether to combine its records with the Drive copy or use the Drive copy.
- Records and basic settings (name, units, targets, translation) sync. Photos, API keys and downloaded Bibles stay on each device for now.
- It is not instant. A device syncs when you open the app, when you come back to it, shortly after you change something, and when you tap the sync button in the header.
- Google sign-in lasts about an hour. When the header button shows a warning cloud, tap it to sign in again; your changes are kept on the device in the meantime.
- If the same item is edited on two devices before they sync, both edits are kept where they touch different fields; where they touch the same field, the most recent save wins. Deleting an item on one device removes it from the others.
- Keep exporting backups. Sync copies mistakes to every device as faithfully as it copies everything else.
