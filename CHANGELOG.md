# Changelog
## [1.3.0] - 2026-04-27

### Bug Fixes

- Replace git-cliff Docker action with direct binary install
- Remove background.scripts from manifest (MV3 incompatible)

### Documentation

- Mention Chromium-based browsers and Firefox in README
- Add Firefox Add-ons store link
- Update privacy policy for Firefox support

### Features

- V1.3.0 — ducat thresholds, liquidity tooltip, sell hour, bid-ask spread

## [1.2.0] - 2026-04-16

### Bug Fixes

- Handle duplicate part IDs in set arbitrage (e.g. Venka Prime ×2 blade)
- Show cheapest hour in local browser time instead of UTC
- Add background.scripts for Firefox MV3 compatibility
- Add data_collection_permissions for AMO validation
- Move data_collection_permissions inside gecko object
- Set data_collection_permissions required to ["none"]
- Address AMO innerHTML safety warnings

### Documentation

- Add Chrome Web Store link to README

### Features

- Core extension — price chart, insights, arbitrage and ducat comparison
- Background service worker — watchlist and price alerts
- Add Firefox support via webextension-polyfill
- Show extension version next to copyright in footer
- Add Prime vault status chip to price widget


