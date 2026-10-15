# Life Dashboard for Obsidian

Two pieces that make an Obsidian vault feel like the Life Dashboard: a library you browse rather than files you open, with the dashboard docked beside your notes. Both work on the Mac and on iPhone and look the same on each.

| Piece | Folder | What it does |
|---|---|---|
| **Life Dashboard** theme | `theme/Life Dashboard/` | The dashboard's look in light and dark: cool greys, teal accent, rounded cards, serif titles, notes shown as pages, bigger rows and text on phones. |
| **Life Dashboard Library** plugin | `plugin/` | A Library home with a "Working on now" card, shelves of covers, project and series pages, title cards on notes, Set status, New sermon, and the dashboard docked in the sidebar on the Mac. |

The plugin reads the properties notes already have: `type`, `status`, `scripture` (or `passage`), `date` / `preaching_date`, `project`, `series`. It changes a note only when you ask it to (Set status, New sermon).

## How notes are sorted

| `type` | Shelf |
|---|---|
| `sermon`, `sermon-development`, `sermon-outline`; a `project` with `project_kind: sermon` | Sermons |
| `study-session`, `study`, `lesson`, `bible-study`, `handout`, `class` | Studies & lessons |
| `project`, `series` | Series & projects |
| `meeting`, `meeting-review` | Meetings |
| `person` | People |
| `book` | Books |
| `article`, `podcast`, `video`, `source`, `historical-text` | Articles & media |
| `area` | Areas |

A project note gathers the notes whose `project` links to it, plus the notes in its folder. Those notes appear on the project's page rather than on shelves, so a sermon shows as one cover, not four.

Statuses are read loosely and shown the same way everywhere: Idea (idea, planned, proposed…), Draft (draft, active, in progress…), Ready, Done (done, complete…; shown as **Preached** or **Taught** on the sermon or lesson itself), To read and Read. Unfinished teaching dated within the next 7 days shows **This week**.

## Installing (Mac; Obsidian Sync carries it to the phone)

1. Copy `plugin/` into the vault as `.obsidian/plugins/life-dashboard-library/` (only `main.js`, `manifest.json` and `styles.css` are needed).
2. Copy `theme/Life Dashboard/` into the vault as `.obsidian/themes/Life Dashboard/`.
3. Obsidian → Settings → Community plugins: turn on **Life Dashboard Library**. Settings → Appearance → Themes: choose **Life Dashboard**.
4. Settings → Sync: make sure **Active community plugin list**, **Installed community plugins** and **Appearance** sync, so the iPhone gets both.
5. In the plugin's settings, list the reference folders to leave out (for example an imported Bible), choose the shelf order and the folder for new sermons, and turn on **Open the Library when Obsidian starts** if wanted.

## Office session checklist

1. **Sign-in test.** Command palette → *Open Life Dashboard in the sidebar*, then connect Google Drive in its Settings & Sync. If Google refuses, stop here and note the message.
2. **Speed and clutter (settings only):**
   - Settings → Files and links → **Excluded files**: add the imported Bible chapter folder and any bulk reference-text folders. They stay in the vault and their links keep working, but search, the quick switcher and the graph stop listing them.
   - On the iPhone: Settings → About → **Override config folder** (for example `.obsidian-mobile`), then turn on only the plugins wanted on the phone. Leave heavy ones (drawing, AI chat) off there.
   - Settings → Sync on the iPhone: consider leaving out large attachment types.
3. **Install** the theme and plugin (above) and check the Library on both devices.
4. **Retire duplicates:** templates and projects for things the dashboard now does (fitness reviews, prayer cards, the Bible reading plan). Move them to the archive rather than deleting them.

## Phases after that

| Phase | What | Where |
|---|---|---|
| 2 ✅ | Dashboard side of the bridge: tasks and projects link to notes (`[[Note]]`), **Send to Obsidian** on Scripture notes, journal, media notes, word studies, topics and workouts. Messages travel as `#ld-obsidian=` + JSON (accepted only from the dashboard's own address); the plugin gives the dashboard the vault's note names (`window.LD_OBSIDIAN`). Outside Obsidian the same buttons use `obsidian://` links. | `index.html` |
| 2 ✅ | **New sermon** also adds the prep tasks (think, pray, write; one a day for up to 21 days before the date, then the preaching) through `window.LD_FROM_OBSIDIAN`, each linked to its note. | both |
| 3 | **Meetings to tasks:** action items in meeting notes become dashboard tasks with the person attached. | plugin + bridge |
| 3 | **People:** a person's page shows open follow-ups from the dashboard. Pastoral notes stay in the vault. | plugin |
| 3 | **Taught record:** when and to whom each sermon or lesson was given; "taught before?" on the title card. | plugin |
| 4 | **Scripture in notes:** hover a reference to see the verse; open it in the dashboard's reader. | plugin + bridge |
| 4 | **Weekly review** that pulls dashboard numbers into one note alongside Plan week and the family review. | plugin + bridge |
| 4 | **Auto-filer:** notes file themselves by `type`; each series gets an index page. | plugin |

## Developing

Plain JavaScript, no build step: Obsidian loads `main.js` as it is. `main.js` has three layers: `core` (pure rules), `render` (DOM for the Library pages) and the Obsidian glue. `tests/obsidian-plugin.spec.js` runs `core` in Node with a stand-in for the `obsidian` module and draws the pages in a browser with the theme. Set `LDL_SHOTS=<folder>` to save screenshots.

Things only a real Obsidian can confirm: the title card's position in reading view, the docked dashboard's Google sign-in, and the bridge messages (Electron `did-navigate-in-page`).
