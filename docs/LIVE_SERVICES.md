# Live-service verification — 2026-10-12

These are point-in-time observations from an isolated localhost Chromium context. No personal records, user API keys, paid services or authenticated browser sessions were used. Do not treat these results as guarantees for other devices, origins or dates.

| Service/path | Observed result | Scope |
|---|---|---|
| Public WEB chapter API | Passed; John 3 returned 36 verses | Lookup/parser worked, not every translation |
| Downloaded KJV | Passed; 66 books/31,102 verse entries; John 3 remained readable with the browser offline | Test-context download/storage/offline read, not a backup of reference data |
| Apple Podcasts | Passed; search returned shows and one lookup returned 200 episode audio URLs | Discovery/metadata, not audible playback |
| Video metadata (Noembed) | Passed; a public YouTube link returned a title | Metadata, not embedded-video playback |
| Open Food Facts barcode | Passed; one public sample barcode returned a food record | Barcode endpoint, not all products |
| Open Food Facts keyword search | Failed in this run: browser CORS error; direct endpoint returned HTTP 503 | Search remained unavailable; no proxy/provider workaround was added |
| USDA DEMO_KEY search | First request exceeded the 15-second diagnostic bound; retry returned 12 foods in about one second | Intermittent response; no private key used |

Food search/barcode and online Bible requests now use fetchServiceJSON(): 12-second default timeout, including response-body reading; Bible-library downloads allow 30 seconds. Offline, unreachable and malformed-response errors include recovery guidance. HTTP status handling (such as USDA 429) remains in the callers. Local foods, manual entry and downloaded/saved Scripture remain available when a public service fails.

The deterministic populated probe simulates these failures in CI; it does not call the public services. Podcast callbacks and Noembed already have bounded waits. Miyo and Claude integration remain unchanged under the existing deferred-integration instruction.

The providers' current documentation confirms that [Open Food Facts keyword search uses the legacy endpoint](https://openfoodfacts.github.io/openfoodfacts-server/api/ref-cheatsheet/) and [USDA's demo key has lower limits than a personal key](https://fdc.nal.usda.gov/api-guide/). The observed 503/timeout is not proof of a permanent outage or a reason to replace providers without further investigation.

## Still requiring a human or additional verification

- VoiceOver/TalkBack reading order and speech: docs/MANUAL_VERIFICATION.md.
- User-supplied ESV/USDA credentials, if those optional features are wanted. Do not collect credentials in chat or commit them.
- Podcast audio playback, notifications and dictation permissions. Do not request permissions automatically during an audit.
- Embedded YouTube/Vimeo playback on the user's actual file origin remains a known limitation; the web-origin/mobile foundation is still paused.
- Full reference-table imports, other browsers and additional file-origin workflows remain test-expansion work.
