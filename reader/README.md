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
