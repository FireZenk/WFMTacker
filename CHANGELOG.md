# Changelog
## [1.4.0] - 2026-05-01

### Bug Fixes

- Restore background.scripts for Firefox MV3 compatibility
- Handle extension context invalidation in sendMsg
- Route orders fetch through background script
- Use Promise-based pattern for async background handlers
- Fetch orders without custom headers to avoid CORS preflight

### Documentation

- Add store description + update README for v1.3.0

### Features

- Post release notes to Discord via webhook
- Add full-screen dashboard tab
- Add hover tooltip showing price, date and volume (#12)
- Filter price history by mod/arcane rank (#5, #11)
- Show live order prices by mod rank in insights
- Rank toggle for arcanes — Unranked vs R5 Maxed stats (#7)
- User-configurable settings page (#6)
- UX improvements — popout with item, settings gear, arb links, nav history

### Revert

- Remove rank filter UI — /statistics API ignores mod_rank

## [1.3.0] - 2026-04-27

### Bug Fixes

- Replace git-cliff Docker action with direct binary install
- Remove background.scripts from manifest (MV3 incompatible)
- Use orhun/git-cliff-action@v3 instead of manual curl install

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


