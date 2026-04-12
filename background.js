/* ============================================================
   WFM Price History — background service worker
   Comprueba precios de la watchlist y lanza notificaciones
   ============================================================ */

const API_BASE    = 'https://api.warframe.market/v1';
const ALARM_NAME  = 'wfm-price-check';
const CHECK_MINS  = 30;

// ── Setup ────────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: CHECK_MINS });
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM_NAME) checkPrices();
});

// ── Storage helpers ───────────────────────────────────────────────────────────

function getWatchlist() {
  return new Promise(resolve =>
    chrome.storage.local.get('watchlist', d => resolve(d.watchlist ?? {}))
  );
}

function saveWatchlist(watchlist) {
  return new Promise(resolve => chrome.storage.local.set({ watchlist }, resolve));
}

// ── Price check ───────────────────────────────────────────────────────────────

async function fetchCurrentPrice(slug) {
  try {
    const res = await fetch(`${API_BASE}/items/${slug}/statistics`, {
      headers: { 'Language': 'en', 'Platform': 'pc' }
    });
    if (!res.ok) return null;
    const json = await res.json();
    const days = json.payload.statistics_closed['90days'] ?? [];
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
    const item  = list[slug];
    const price = await fetchCurrentPrice(slug);
    if (!price) return;

    updated[slug] = { ...item, lastPrice: price, lastChecked: Date.now() };
    changed = true;

    const { alert } = item;
    if (!alert) return;

    if (alert.below && price <= alert.below) {
      notify(slug, item.name, price, 'below', alert.below);
    } else if (alert.above && price >= alert.above) {
      notify(slug, item.name, price, 'above', alert.above);
    }
  }));

  if (changed) await saveWatchlist(updated);
}

function notify(slug, name, price, direction, threshold) {
  chrome.notifications.create(`wfm-alert-${slug}-${Date.now()}`, {
    type:    'basic',
    iconUrl: 'icon.png',
    title:   `WFM Price Alert — ${name}`,
    message: direction === 'below'
      ? `Price dropped to ${price}p — below your alert of ${threshold}p`
      : `Price rose to ${price}p — above your alert of ${threshold}p`,
  });
}

// ── Messages from content script ──────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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
});
