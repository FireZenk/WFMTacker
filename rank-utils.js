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
  module.exports = { splitByRank, resolveRank, rankLabel, parseCSV, csvToWatchlist };
}
