# Life Dashboard

A personal, offline-first dashboard in a single HTML file:

- **Health:** workouts and nutrition
- **Faith:** Scripture with Berean study tools and Smart Search, a journal, and a media library
- **Home:** marriage and family, recipes and meals, tasks

Your data stays in your browser. There's no account, no server and no build step.

## Use it

Open `index.html` in Chrome. That's it.

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
index.html               the entire app (HTML + CSS + JS), unchanged from the working version
AGENTS.md / CLAUDE.md    briefs for Codex and Claude Code
docs/
  ARCHITECTURE.md        how the file is organized and the patterns it uses
  DATA_MODEL.md          every stored collection and where data lives
  DEPENDENCIES.md        CDN scripts, web services and browser APIs
  YOUR_DATA.md           moving your data safely; backups
scripts/check.mjs        static safety check
tests/smoke.spec.js      Playwright smoke tests
CHANGELOG.md             what was built, phase by phase
```

## Privacy

Never commit backup files (`life-dashboard-backup-*.json`). They contain your journal, prayers and family notes, and `.gitignore` already blocks them. API keys you enter in Settings stay in the browser and are never written to this repo. Keep the GitHub repository **private**.
