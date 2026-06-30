/* ============================================================
   WFM Price History — background service worker
   Comprueba precios de la watchlist y lanza notificaciones
   ============================================================ */

// Chrome service worker needs importScripts; Firefox loads the polyfill via manifest scripts[]
if (typeof importScripts !== 'undefined') importScripts('browser-polyfill.min.js');

const API_BASE    = 'https://api.warframe.market/v1';
const ALARM_NAME  = 'wfm-price-check';
const CHECK_MINS  = 30;

// ── Setup ────────────────────────────────────────────────────────────────────

browser.runtime.onInstalled.addListener(() => {
  browser.alarms.create(ALARM_NAME, { periodInMinutes: CHECK_MINS });
});

browser.action.onClicked.addListener(() => {
  browser.tabs.create({ url: browser.runtime.getURL('panel.html') });
});

browser.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM_NAME) checkPrices();
});

// ── Storage helpers ───────────────────────────────────────────────────────────

function getWatchlist() {
  return browser.storage.local.get('watchlist').then(d => d.watchlist ?? {});
}

function saveWatchlist(watchlist) {
  return browser.storage.local.set({ watchlist });
}

// ── Price check ───────────────────────────────────────────────────────────────

// Returns 'below', 'above', or null. Only fires when price crosses the threshold
// (was on the safe side last check, now on the alert side) — prevents repeat
// notifications while price stays on the same side of the threshold.
function shouldNotify(prevPrice, newPrice, alert) {
  if (!alert) return null;
  if (alert.below && newPrice <= alert.below && (!prevPrice || prevPrice > alert.below)) {
    return 'below';
  }
  if (alert.above && newPrice >= alert.above && (!prevPrice || prevPrice < alert.above)) {
    return 'above';
  }
  return null;
}

// ── Ducat-per-platinum alert ──────────────────────────────────────────────────

const DPP_WINDOW_MS = 6 * 60 * 60 * 1000; // don't re-notify the same order within 6h

// Among live sell orders, pick the best ducats-per-platinum deal from a reachable
// seller (online/ingame). A cheaper listing of a fixed-ducat item yields a higher
// d/p, so the best deal is the highest ratio. Returns null when none qualify.
function bestDppOrder(orders, ducats, statuses = ['online', 'ingame']) {
  if (!ducats || ducats <= 0) return null;
  const allow = new Set(statuses);
  let best = null;
  for (const o of orders || []) {
    if (o?.type !== 'sell') continue;
    const u = o.user || {};
    if (!allow.has(u.status)) continue;
    if (!o.platinum || o.platinum <= 0) continue;
    const ratio = ducats / o.platinum;
    if (!best || ratio > best.ratio) {
      best = { id: o.id, platinum: o.platinum, ratio, ingameName: u.ingameName, status: u.status };
    }
  }
  return best;
}

// Decide whether to fire a d/p notification for the best order. Fires only when
// the ratio meets the threshold and the same order id hasn't been notified within
// the window — caps spam to one notification per item per qualifying order. Pure:
// returns the (pruned) seen map so the caller can persist it.
function dppShouldNotify(best, threshold, seen = {}, now = Date.now(), windowMs = DPP_WINDOW_MS) {
  if (!best || !threshold || best.ratio < threshold) return { notify: false, seen };
  const last = seen[best.id];
  if (last && now - last < windowMs) return { notify: false, seen };
  const pruned = {};
  for (const [id, ts] of Object.entries(seen)) {
    if (now - ts < windowMs) pruned[id] = ts;
  }
  pruned[best.id] = now;
  return { notify: true, seen: pruned };
}

async function fetchOrders(slug) {
  try {
    const res = await fetch('https://api.warframe.market/v2/orders/item/' + slug, {
      headers: { 'Language': 'en', 'Platform': 'pc' }
    });
    if (!res.ok) return [];
    const json = await res.json();
    return json.data ?? [];
  } catch { return []; }
}

async function fetchDucats(slug) {
  try {
    const res = await fetch('https://api.warframe.market/v2/item/' + slug, {
      headers: { 'Language': 'en', 'Platform': 'pc' }
    });
    if (!res.ok) return 0;
    const json = await res.json();
    return json.data?.ducats ?? 0;
  } catch { return 0; }
}

async function fetchCurrentPrice(slug, rank = null) {
  try {
    const res = await fetch(`${API_BASE}/items/${slug}/statistics`, {
      headers: { 'Language': 'en', 'Platform': 'pc' }
    });
    if (!res.ok) return null;
    const json = await res.json();
    const days = json.payload.statistics_closed['90days'] ?? [];

    if (rank !== null) {
      const filtered = days.filter(d => d.mod_rank === rank);
      const last = filtered[filtered.length - 1];
      return last ? Math.round(last.wa_price ?? last.avg_price ?? 0) : null;
    }

    // rank=null: if data is rank-split, default to R5 (matches panel default)
    const hasRankSplit = days.some(d => d.mod_rank != null);
    if (hasRankSplit) {
      const r5 = days.filter(d => d.mod_rank === 5);
      if (r5.length) {
        const last = r5[r5.length - 1];
        return last ? Math.round(last.wa_price ?? last.avg_price ?? 0) : null;
      }
    }

    const last = days[days.length - 1];
    return last ? Math.round(last.wa_price ?? last.avg_price ?? 0) : null;
  } catch { return null; }
}

async function checkPrices() {
  const list = await getWatchlist();
  const slugs = Object.keys(list);
  if (!slugs.length) return;

  const updated = { ...list };
  let changed = false;

  await Promise.all(slugs.map(async slug => {
    const item = list[slug];
    let next   = { ...item };
    let touched = false;

    // ── Plat threshold alert (below / above) ──
    const price = await fetchCurrentPrice(slug, item.rank ?? null);
    if (price) {
      const direction = shouldNotify(item.lastPrice, price, item.alert);
      if (direction) notify(slug, item.name, price, direction, item.alert[direction]);
      next.lastPrice = price;
      next.lastChecked = Date.now();
      touched = true;
    }

    // ── Ducat-per-platinum alert ──
    if (item.alert?.dpp) {
      let ducats = item.ducats;
      if (ducats == null) { ducats = await fetchDucats(slug); next.ducats = ducats; touched = true; }
      if (ducats > 0) {
        const best = bestDppOrder(await fetchOrders(slug), ducats);
        const res  = dppShouldNotify(best, item.alert.dpp, item.dppNotified || {}, Date.now());
        if (res.notify) notifyDpp(slug, item.name, best);
        next.dppNotified = res.seen;
        touched = true;
      }
    }

    if (touched) { updated[slug] = next; changed = true; }
  }));

  if (changed) await saveWatchlist(updated);
}

function notify(slug, name, price, direction, threshold) {
  browser.notifications.create(`wfm-alert-${slug}-${Date.now()}`, {
    type:    'basic',
    iconUrl: 'icon.png',
    title:   `WFM Price Alert — ${name}`,
    message: direction === 'below'
      ? `Price dropped to ${price}p — below your alert of ${threshold}p`
      : `Price rose to ${price}p — above your alert of ${threshold}p`,
  });
}

function notifyDpp(slug, name, best) {
  browser.notifications.create(`wfm-dpp-${slug}-${best.id}`, {
    type:    'basic',
    iconUrl: 'icon.png',
    title:   `WFM Ducat Deal — ${name}`,
    message: `${best.ratio.toFixed(1)} ducats/plat — ${best.platinum}p listing by ${best.ingameName}`,
  });
}

if (typeof module !== 'undefined') module.exports = { shouldNotify, getWatchlist, saveWatchlist, fetchCurrentPrice, bestDppOrder, dppShouldNotify };

// ── Messages from content script ──────────────────────────────────────────────

browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'GET_WATCHLIST') {
    getWatchlist().then(sendResponse);
    return true;
  }
  if (msg.type === 'SAVE_WATCHLIST') {
    saveWatchlist(msg.watchlist).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'CHECK_NOW') {
    checkPrices().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'OPEN_SETTINGS') {
    browser.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === 'OPEN_PANEL') {
    const url = browser.runtime.getURL('panel.html') + (msg.slug ? `?item=${encodeURIComponent(msg.slug)}` : '');
    browser.tabs.create({ url });
    sendResponse({ ok: true });
    return true;
  }
});
