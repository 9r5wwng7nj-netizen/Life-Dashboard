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

## Phone and laptop

The app is hosted at <https://9r5wwng7nj-netizen.github.io/Life-Dashboard/>, can be installed on a phone, opens offline, and syncs through a private Google Drive folder (below).

To start using the hosted address:

1. On the laptop, export a backup from the copy you use today, open the hosted address in Chrome and import the backup there. Use the hosted address from then on.
2. On the iPhone, open the address in Safari, tap **Share → Add to Home Screen**, then open the app from the home-screen icon and import the same backup **inside that installed app**. The installed app keeps its own data, separate from Safari.

Each place keeps its own copy of your data until sync is switched on there. Inside Obsidian on the Mac, the Life Dashboard panel is one more such place: turn sync on in its Settings & Sync too.

### Sync

Sync keeps one copy of your records in a hidden app folder in your Google Drive. Only this app can read that folder; it does not appear among your Drive files.

- Turn it on per device: **Settings & Sync → Connect Google Drive**. The first device uploads its records. Each later device asks whether to combine its records with the Drive copy or use the Drive copy.
- Records, photos and basic settings (name, units, targets, translation) sync. API keys and downloaded Bibles stay on each device. Photos go a dozen at a time each way per sync, so a device with many photos catches up over a few syncs; Settings & Sync shows how many are left.
- It is not instant. A device syncs when you open the app, when you come back to it, shortly after you change something, and when you tap the sync button in the header.
- Each device stays signed in to Google: it keeps a refresh token (never in backups) and renews its one-hour access by itself. If Google ever asks again, the header button shows a warning cloud; tap it to sign in. Your changes are kept on the device in the meantime.
- If the same item is edited on two devices before they sync, both edits are kept where they touch different fields; where they touch the same field, the most recent save wins. Deleting an item on one device removes it from the others.
- If a sync would remove more than 10 records at once, it pauses and asks you first. Choose OK only if you removed them on purpose. (Clearing the grocery list never asks.)
- Each day, the first sync also keeps a dated copy of your records in the same private folder: one for each of the last 7 days, then one a week for 8 weeks. **Settings & Sync → Restore from a copy** opens one. *Add back what's missing* returns records deleted since that day and changes nothing else; *Replace everything* puts the device back to that day.
- Keep exporting backups now and then. The daily copies don't include photos (photos are kept in Drive separately and never removed from there), and sync copies mistakes to every device as faithfully as it copies everything else.

### Claude

If you use Claude, you can connect it to your dashboard (Settings & Sync shows the address to add as a custom connector in Claude). You sign in with your Google account, and Claude can only reach the dashboard that account syncs.

- Once connected, each sync also keeps a copy of your records for Claude in the same private Drive folder: tasks and projects, food, weight, workouts, Bible reading, prayer requests, journal, Scripture notes, quotes, media notes, family details, meals, groceries and saved foods. Photos and API keys are not included.
- Claude can add tasks, food, weigh-ins, prayer requests, journal entries and grocery items, and tick off tasks. These wait in the same folder until the next sync, which adds them like anything you type. Claude can't change or delete anything else.
- What Claude reads becomes part of your conversation in Claude, so Claude's own privacy settings apply to it.
- **Settings & Sync → Stop sharing with Claude** removes Claude's copy. Remove the connector in Claude's settings too, or using it shares again. Disconnecting in Claude also removes the copy.
