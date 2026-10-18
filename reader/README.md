# Life Dashboard link reader

A Cloudflare Worker that lets the app read web pages the browser may not read on its own. The app sends a link; the Worker fetches the page and returns JSON:

- `recipe`: the page's schema.org recipe (title, ingredients, steps, servings, minutes, image, category, cuisine, calories), or `null`
- `title`, `description`, `image`, `siteName`, `author`, `published`
- `text`: an article's paragraphs as plain text (empty for recipe pages and short pages)

TikTok links use TikTok's public oEmbed for the caption, author and cover. Facebook and Instagram pages require a login and cannot be read.

Some large publishers refuse automated readers (for example AllRecipes and Simply Recipes answer 402, Desiring God 403). The reader identifies itself honestly and does not try to get around that; the app falls back to pasted text. The app never asks the reader about Facebook, Instagram or Threads links.

## Rules it keeps

- Answers only requests whose `Origin` is the hosted app or `localhost:8080`; anything else gets 403.
- Fetches only public `http(s)` pages on standard ports; no local, private or numeric addresses, before or after redirects.
- HTML only, up to 3 MB, 10-second limit; answers are cached for an hour.
- It sends no cookies and stores nothing beyond Cloudflare's short-lived cache.

## Deploying

```bash
cd reader
npx wrangler@4.139.0 login     # once, opens a Cloudflare page to approve
npx wrangler@4.139.0 deploy
```

It runs on the free Workers plan at `https://life-dashboard-reader.lifedashboard-9r5w.workers.dev`, which is `READER.url` in `index.html`. `parse.js` holds the page parsing and is tested by `tests/reader.spec.js`.

## Google sign-in that lasts

The same Worker lets Drive sync and Find a video stay signed in. The app sends Google's one-time sign-in code (with a PKCE verifier) to `POST /google/token`, keeps the refresh token on the device, and later calls `POST /google/refresh`; `POST /google/revoke` signs a device out. `GET /google/ready` tells the app whether this is set up. The Worker adds the client secret, stores nothing, answers only the app's addresses, and accepts only the app's own redirect addresses.

`GOOGLE_CLIENT_ID` is in `wrangler.toml` (it is public). The client secret is a Worker secret and never goes in the repo:

```bash
cd reader
npx wrangler@4.139.0 secret put GOOGLE_CLIENT_SECRET   # paste the secret from Google Cloud → Credentials → the OAuth client
```

Without it, `/google/ready` answers `{ "ready": false }` and the app keeps using one-hour sign-ins.

## Food search

`GET /food/search?q=…` searches Open Food Facts' newer search service (`search.openfoodfacts.org`), which doesn't allow browser calls, for the app's food log. It returns `{ products: [{ code, product_name, brands, serving_size, serving_quantity, nutriments }] }` with only the per-100 g nutrients the app reads, and keeps answers for a day. The app falls back to Open Food Facts' old search address if this fails.

## Claude connector

`connector.js` makes the Worker a remote MCP server, so a person can add Life Dashboard to Claude as a custom connector at `https://life-dashboard-reader.lifedashboard-9r5w.workers.dev/mcp`. These routes don't use the address rule above; they have their own sign-in:

- `GET /.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`: where Claude learns how to sign in.
- `POST /oauth/register`: Claude registers itself. Only Claude's return address (`https://claude.ai/api/mcp/auth_callback`) and Claude Code's loopback addresses are accepted.
- `GET /oauth/authorize`: a short page saying what Claude will be able to do, then Google's sign-in (`drive.appdata` only, at `/oauth/google`).
- `POST /oauth/token`: codes (PKCE S256) and refresh tokens, which rotate. `POST /oauth/revoke` ends a connection and removes Claude's copy from Drive.
- `POST /mcp`: the tools. They read the copy the dashboard keeps in the person's Drive app folder (`claude-now.json`, `claude-{days,workouts,notes}-YYYY.jsonl`) and leave additions and two narrow task edits (`park_task`, `reschedule_task`) as `claude-inbox-<id>.json` files, which the dashboard takes in on its next sync. The Worker never edits records, and there is no delete.

It needs `GOOGLE_CLIENT_SECRET` (above), a secret for sealing codes and tokens, and a KV namespace for each connection's Google refresh token:

```bash
cd reader
npx wrangler@4.139.0 kv namespace create CONNECTOR_KV        # once; its id goes in wrangler.toml
openssl rand -base64 32 | npx wrangler@4.139.0 secret put CONNECTOR_KEY
```

In Google Cloud → Credentials → the OAuth client, `https://life-dashboard-reader.lifedashboard-9r5w.workers.dev/oauth/google` must be an authorized redirect URI. Without the secrets the connector answers that it isn't set up. Workers Free allows 10 ms of CPU per request, which is why the dashboard's copy is small files read line by line. `tests/connector.spec.js` covers the sign-in, every tool, and the app and connector agreeing on both file formats.

## Morning brief

The same module serves a short spoken brief for an iPhone Shortcut, so the dashboard's day can be read out each morning even when every computer is off.

- `GET /brief/setup`: a short page, then Google's sign-in (`drive.appdata` only, back through `/oauth/google`, whose state carries `bf`). On return the Worker makes `morning-brief.json` in the person's Drive app folder (with a random id, `mid`; an existing file's id is kept), mints a link `/brief/<43-character key>`, and shows it once with a Copy button and the Shortcut to add. Only the key's SHA-256 is kept, in the same KV namespace as `b:<hash>`, beside that sign-in's Google refresh token, sealed (kind `brief`, like the connector's grants).
- `GET /brief/<key>`: plain text. It trades the stored refresh token for an access token, reads `morning-brief.json` and speaks it with `composeBrief` (short sentences: the Big 3, what is due and overdue, the schedule, today's reading, the workout, dinner). The date and the time of day come from the dashboard's own time zone (`tz`), not the Worker's. A copy older than 36 hours says so. A missing file (the brief was turned off), a different `mid` (it was turned off and set up again) or a refused refresh token (Google access removed) answers 410 and forgets the link; an unknown key is 404. Nothing but the fields `composeBrief` names is ever read, so even a file with more in it never leaks prayers, journal, food or weight.
- The dashboard keeps the file filled in on each sync (`briefShare`, `briefCopy` in `index.html`) while it exists, and Settings & Sync → Turn off deletes it, which ends every link at once. Turning the brief off or disconnecting Claude never touches the other: this file is not matched by the connector's `claude-*` names.

`scripts/morning-brief-shortcut.py` builds the signed Shortcut (`assets/shortcuts/Morning-brief.shortcut`, served by GitHub Pages) that asks for the link when it is added, opens it, shows the answer as a notification and reads it aloud. It needs no new secrets or storage: the same `CONNECTOR_KEY` and `CONNECTOR_KV`, and the same Google redirect address. `tests/connector.spec.js` covers the setup, the text, turning off and setting up again, and the app's own file reaching the Worker; `tests/sync.spec.js` covers the dashboard keeping it up to date.
