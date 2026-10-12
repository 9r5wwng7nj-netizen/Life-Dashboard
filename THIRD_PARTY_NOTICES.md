# Third-party runtime assets

Life Dashboard vendors these browser assets so application startup and spreadsheet imports do not execute code from a third-party CDN.

| Component | Version | Repository path | License | SHA-256 |
|---|---:|---|---|---|
| Lucide | 1.55.0 | `vendor/lucide/lucide-1.55.0.min.js` | ISC | `48b3b5d82216bbe1d0c49dea480ed38fca8420c275c98f20505e3f9556f6b1d1` |
| SheetJS Community Edition | 0.20.3 | `vendor/sheetjs/xlsx-0.20.3.full.min.js` | Apache-2.0 | `cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41` |

The complete license texts are stored alongside each vendored asset.

Tailwind CSS 4.3.0 is a development dependency used to produce `assets/app.css`; Tailwind code is not executed in the user's browser.
