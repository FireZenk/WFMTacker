# WFM Price History

A Chrome extension that embeds price history charts and trade insights directly into every [warframe.market](https://warframe.market) item page — no popups, no tab switching.

![Chrome Web Store](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-green)

---

## Features

- **Price history chart** — 90-day and 48-hour toggleable SVG chart with min/max band and volume bars
- **7-day forecast** — linear regression projection with confidence band
- **Buy / Sell signal** — based on current price vs 90-day average
- **Volatility score** — Coefficient of Variation (CV%) with Stable / Moderate / Volatile label
- **Liquidity score** — 1–10 rating based on average daily volume and trading consistency
- **Best hour to buy** — cheapest UTC hour derived from 48h data
- **Copy to clipboard** — one-click copy of average or median price
- **Set vs Parts arbitrage** — shows whether buying parts separately is cheaper than the set (Prime sets only)
- **Ducat comparison** — platinum-per-ducat ratio to help decide whether to sell for plat or trade for ducats (Prime items only)
- **Watchlist & Price Alerts** — star any item, set below/above thresholds, receive desktop notifications when prices cross them
- **SPA-aware** — detects URL changes on warframe.market's Vue/Nuxt router without requiring a page reload

---

## Installation

### From Chrome Web Store

Install directly from the [Chrome Web Store](https://chromewebstore.google.com/detail/wfm-price-history/aejobloolfcoipjfbhflgnamhlnmhnlb).

### Manual (developer mode)
1. Clone or download this repository
2. Open `chrome://extensions/`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** and select the `wfm-price-history/` folder

---

## Project structure

```
wfm-price-history/
├── manifest.json       # Extension manifest (MV3)
├── content.js          # Main content script — injected into warframe.market pages
├── background.js       # Service worker — handles alarms, storage and notifications
├── style.css           # All widget styles (CSS variables, no external dependencies)
├── icon.png            # 128×128 icon
├── icon48.png          # 48×48 icon
├── icon16.png          # 16×16 icon
└── privacy.html        # Privacy policy (hosted on GitHub Pages)
```

---

## How it works

1. The content script detects item pages via `location.pathname` matching `/items/:slug`
2. It polls `location.href` every 300ms to detect SPA navigation
3. On each new item page it fetches data from `api.warframe.market/v1/items/:slug/statistics` and (for Prime items) `api.warframe.market/v2/item/:slug`
4. All insights are calculated client-side and injected as a widget above the item tabs
5. The background service worker checks watchlist prices every 30 minutes via `chrome.alarms` and fires `chrome.notifications` when thresholds are crossed

---

## Permissions

| Permission | Reason |
|---|---|
| `storage` | Saves watchlist and alert thresholds locally |
| `notifications` | Price alert desktop notifications |
| `alarms` | Schedules background price checks every 30 minutes |
| `host_permissions: api.warframe.market` | Fetches public price statistics |

No personal data is collected or transmitted. See [privacy policy](wfm-price-history/privacy.html).

---

## Contributing

Issues and pull requests are welcome. Please open an issue first for significant changes.

---

## License

MIT — © 2026 [OptimusRex](https://linktr.ee/optrx)
