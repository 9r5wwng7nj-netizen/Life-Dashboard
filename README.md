# Life Dashboard

A personal, offline-first, single-page dashboard:

- **Health:** workouts and nutrition
- **Faith:** Scripture with Berean study tools and Smart Search, a journal, and a media library
- **Home:** marriage and family, recipes and meals, tasks

Your data stays in your browser. There's no account or application server. Runtime styles and libraries are pinned in the repo, so normal use does not depend on a CDN.

## Use it

Open `index.html` in Chrome, or use the hosted copy at <https://9r5wwng7nj-netizen.github.io/Life-Dashboard/>, which can be installed on a phone and opens offline. GitHub Pages publishes the `main` branch there after every push.

> **Your existing data:** it lives in the browser, not in this repo. Before you switch to the copy of `index.html` in this repo, read [docs/YOUR_DATA.md](docs/YOUR_DATA.md). Opening it from a different place, or from a web address instead of a file, can show an empty app until you import a backup.

## Develop it

Requires Node 18+ (for the dev tools only).

```bash
npm install
npx playwright install chromium   # once, for the tests
npm run check                     # fast static check (syntax, duplicate names, action collisions)
npm test                          # check + browser smoke tests
npm start                         # optional: serve at http://localhost:8080
```

Working with an AI coding agent:

- **Claude Code** reads `CLAUDE.md`, which imports `AGENTS.md`.
- **OpenAI Codex** reads `AGENTS.md`.

Both explain the architecture, the patterns to follow, and the one hard rule: **never break saved data**.

GitHub Actions runs `npm test` on every push (`.github/workflows/test.yml`).

## What's in the repo

```
index.html               the application UI and JavaScript
assets/app.css           compiled, local Tailwind styles
assets/icons/            home-screen icons
manifest.webmanifest     install details for the hosted copy
sw.js                    offline app shell for the hosted copy
src/app.css              Tailwind source used when styles change
vendor/                  pinned Lucide and SheetJS browser libraries
AGENTS.md / CLAUDE.md    briefs for Codex and Claude Code
docs/
  ARCHITECTURE.md        how the file is organized and the patterns it uses
  DATA_MODEL.md          every stored collection and where data lives
  DEPENDENCIES.md        local runtime libraries, web services and browser APIs
  YOUR_DATA.md           moving your data safely; backups
scripts/check.mjs        static safety check
tests/                   Playwright tests: smoke, accessibility, security, install/offline and sync
CHANGELOG.md             what was built, phase by phase
```

## Privacy

Never commit backup files (`life-dashboard-backup-*.json`). They contain your journal, prayers and family notes, and `.gitignore` already blocks them. API keys you enter in Settings stay in the browser and are never written to this repo. This repository and the hosted copy are **public**, so anything committed here is visible to everyone; your records are not, because they stay in each browser.
