/* WFM Tracker — rank utilities (shared by content script and panel) */

function splitByRank(days) {
  if (!days.some(e => e.mod_rank != null)) return null;
  return {
    r0: days.filter(e => e.mod_rank === 0),
    r5: days.filter(e => e.mod_rank === 5),
  };
}

function resolveRank(savedRank, rankSplit90) {
  return savedRank !== null ? savedRank : ((rankSplit90?.r5?.length) ? 5 : 0);
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
  module.exports = { splitByRank, resolveRank, parseCSV, csvToWatchlist };
}
