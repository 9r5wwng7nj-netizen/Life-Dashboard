# CLAUDE.md

The full project brief is shared with other coding agents in AGENTS.md:

@AGENTS.md

## Claude Code specifics

- Before finishing any change, run `npm run check`. When you've touched behaviour, run `npm test` too (run `npx playwright install chromium` once first).
- The app is a single ~7,800-line, 1.1 MB file with many very long lines. Use Grep/search on the banner comments and function names listed in AGENTS.md rather than reading the whole file.
- Make surgical edits. Do not reformat or reorder untouched code; the user reviews diffs.
