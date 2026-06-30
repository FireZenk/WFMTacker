/* WFM Tracker — rank utilities (shared by content script and panel) */

/* Bucket daily/hourly entries by the exact mod_rank traded. Returns null when
   the item has no rank data (prime parts, ordinary items). Otherwise returns
   { ranks: [sorted distinct ranks], r0: [...], r3: [...], ... } — one r{n}
   bucket per rank actually present in the data, so a rank-3 arcane exposes r3
   and a rank-10 mod exposes r10 without any hardcoded assumptions. */
function splitByRank(days) {
  if (!days.some(e => e.mod_rank != null)) return null;
  const ranks = [...new Set(days.filter(e => e.mod_rank != null).map(e => e.mod_rank))]
    .sort((a, b) => a - b);
  const split = { ranks };
  for (const r of ranks) split[`r${r}`] = days.filter(e => e.mod_rank === r);
  return split;
}

// Use the saved rank when set; otherwise default to the highest rank traded
// (the maxed item — usually the one users alert on), falling back to 0.
function resolveRank(savedRank, rankSplit90) {
  if (savedRank !== null && savedRank !== undefined) return savedRank;
  const ranks = rankSplit90?.ranks;
  return (ranks && ranks.length) ? ranks[ranks.length - 1] : 0;
}

// Button label for a rank: 0 → "Unranked", the highest rank → "R{n} ★"
// (maxed), any intermediate rank → "R{n}".
function rankLabel(rank, ranks) {
  if (rank === 0) return 'Unranked';
  const max = ranks[ranks.length - 1];
  return rank === max ? `R${rank} ★` : `R${rank}`;
}

// ── Bundle deals (multi-item seller matching) ──────────────────────────────────

// Order in which seller statuses are preferred for display (most reachable first).
const STATUS_RANK = { ingame: 2, online: 1 };

function betterStatus(a, b) {
  return (STATUS_RANK[b] ?? 0) > (STATUS_RANK[a] ?? 0) ? b : a;
}

/* Cross-reference live sell orders across all watchlisted items to find sellers
   who carry 2+ of them, so the user can bundle trades.

   ordersBySlug: { [slug]: { name, orders: [v2 order objects] } }
   opts.statuses: seller statuses to include (default online + ingame).

   For each item, keeps each seller's cheapest matching order, then groups by
   seller. Returns sellers with 2+ distinct items, sorted by item count desc
   then cheapest total. Pure — no network, fully testable. */
function groupBundleDeals(ordersBySlug, opts = {}) {
  const statuses = new Set(opts.statuses || ['online', 'ingame']);
  const sellers  = new Map(); // ingameName → { ingameName, status, reputation, items: [...] }

  for (const [slug, entry] of Object.entries(ordersBySlug || {})) {
    const name   = entry?.name || slug;
    const orders = entry?.orders || [];

    // Cheapest qualifying order per seller for this item.
    const bestPerSeller = new Map();
    for (const o of orders) {
      if (o?.type !== 'sell') continue;
      const u = o.user || {};
      if (!statuses.has(u.status)) continue;
      const key = u.ingameName;
      if (!key) continue;
      const prev = bestPerSeller.get(key);
      if (!prev || o.platinum < prev.platinum) {
        bestPerSeller.set(key, { platinum: o.platinum, status: u.status, reputation: u.reputation ?? 0 });
      }
    }

    for (const [ingameName, info] of bestPerSeller) {
      let s = sellers.get(ingameName);
      if (!s) {
        s = { ingameName, status: info.status, reputation: info.reputation, items: [] };
        sellers.set(ingameName, s);
      }
      s.status = betterStatus(s.status, info.status);
      s.items.push({ slug, name, platinum: info.platinum });
    }
  }

  return [...sellers.values()]
    .filter(s => s.items.length >= 2)
    .map(s => ({ ...s, total: s.items.reduce((sum, i) => sum + i.platinum, 0) }))
    .sort((a, b) => b.items.length - a.items.length || a.total - b.total);
}

/* Build a ready-to-paste warframe.market trade-chat whisper for a bundle
   seller: lists every item with its price and the total, in WFM's quoted
   format. Items are listed cheapest first for a stable, readable message. */
function buildBundleWhisper(seller) {
  const items = [...(seller.items || [])].sort((a, b) => a.platinum - b.platinum);
  const list  = items.map(i => `"${i.name}" for ${i.platinum}p`).join(', ');
  return `/w ${seller.ingameName} Hi! I want to buy: ${list} — total ${seller.total}p. (warframe.market)`;
}

// ── CSV parsing (watchlist import) ──────────────────────────────────────────────

/* Parse CSV text into an array of row arrays. Handles quoted fields,
   escaped quotes (""), commas and newlines inside quotes, CRLF, and a
   trailing newline. */
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const s = String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  // flush last field/row unless trailing newline left them empty
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/* Convert CSV text (as produced by exportWatchlistCSV) into a watchlist
   object keyed by slug. Header-driven, so column order is irrelevant.
   Rows missing a slug are skipped. Returns {} for empty/garbage input. */
function csvToWatchlist(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return {};

  const header = rows[0].map(h => h.trim().toLowerCase());
  const idx = name => header.indexOf(name);
  const slugCol = idx('slug');
  if (slugCol === -1) return {};

  const num = v => {
    const t = String(v ?? '').trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };
  const get = (cols, name) => {
    const i = idx(name);
    return i === -1 ? '' : (cols[i] ?? '');
  };

  const list = {};
  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r];
    const slug = String(cols[slugCol] ?? '').trim();
    if (!slug) continue;

    const addedRaw = String(get(cols, 'added_at')).trim();
    const addedMs  = addedRaw ? Date.parse(addedRaw) : NaN;
    const now      = Date.now();

    list[slug] = {
      name:       String(get(cols, 'name')).trim() || slug,
      slug,
      addedAt:    Number.isNaN(addedMs) ? now : addedMs,
      priceAtAdd: num(get(cols, 'price_at_add')),
      lastPrice:  num(get(cols, 'last_price')),
      lastChecked: now,
      alert: {
        below: num(get(cols, 'alert_below')),
        above: num(get(cols, 'alert_above')),
      },
      rank: num(get(cols, 'rank')),
      note: String(get(cols, 'note') ?? ''),
    };
  }
  return list;
}

if (typeof module !== 'undefined') {
  module.exports = { splitByRank, resolveRank, rankLabel, groupBundleDeals, buildBundleWhisper, parseCSV, csvToWatchlist };
}
