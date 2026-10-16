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
| `study-session`, `session-preparation`, `study`, `lesson`, `bible-study`, `handout`, `class` | Studies & lessons |
| `project`, `series` | Series & projects |
| `meeting`, `meeting-review`, `meeting-source` | Meetings |
| `person` | People |
| `book` | Books |
| `work-index`, `collection` (a classic work's chapters, `historical-text`, stay off the shelves but are searchable) | Historical theology |
| `article`, `podcast`, `video`, `source` | Articles & media |
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
| 3 ✅ | **Meetings to tasks:** a meeting note's title card offers *Send action items to Tasks*; the person ticks their own items: top-level bullets (plain or unticked `- [ ]`; not ticked ones or callouts) under Action items / Follow-ups / Next steps / To-do headings, with a bullet's indented lines added to the task's notes. Follow-ups become waiting tasks; sent items are remembered in `tasks_sent`. | plugin + bridge |
| 3 ✅ | **People:** a person's note shows open follow-ups from the docked dashboard (by name, first name, aliases or note link), with complete and add. Read on demand through `window.LD_QUERY`; nothing is written to the note. | plugin + bridge |
| 3 ✅ | **@Name in tasks:** links the task to a person; inside Obsidian the plugin creates a missing profile in the People folder from the Person template (settings: *Folder for new people*, *Template for new people*). | app + plugin |
| 3 ✅ | **Taught record:** *Mark taught* on a sermon or lesson adds `taught: YYYY-MM-DD — Group` (and sets Preached/Taught). The title card lists where it was taught and when the same passage was taught before. A **Teaching record** page shows each group's history (groups in settings; `(inactive)` for one not taught right now) and finished teaching with no group yet. | plugin |
| 4 | **Scripture in notes:** hover a reference to see the verse; open it in the dashboard's reader. | plugin + bridge |
| 4 | **Weekly review** that pulls dashboard numbers into one note alongside Plan week and the family review. | plugin + bridge |
| 3 ✅ | **Library as home:** quick actions (New note, New sermon, Today's note), a section bar for every shelf plus Inbox and All folders, folder pages with a clickable path, Library pages in the tab's back and forward history, and a setting to fold the left sidebar away. | plugin |
| 4 | **Auto-filer:** notes file themselves by `type`; each series gets an index page. | plugin |

## Developing

Plain JavaScript, no build step: Obsidian loads `main.js` as it is. `main.js` has three layers: `core` (pure rules), `render` (DOM for the Library pages) and the Obsidian glue. `tests/obsidian-plugin.spec.js` runs `core` in Node with a stand-in for the `obsidian` module and draws the pages in a browser with the theme. Set `LDL_SHOTS=<folder>` to save screenshots.

Things only a real Obsidian can confirm: the title card's position in reading view, the docked dashboard's Google sign-in, and the bridge messages (Electron `did-navigate-in-page`).
