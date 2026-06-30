const { splitByRank, resolveRank, rankLabel } = require('../rank-utils');
const { fetchCurrentPrice } = require('../background');

beforeEach(() => {
  jest.clearAllMocks();
});

// ── splitByRank: now data-driven (any rank present), not hardcoded r0/r5 ──────
describe('splitByRank — data-driven rank buckets', () => {
  test('returns null when no entry has a mod_rank (prime parts / plain items)', () => {
    const days = [{ wa_price: 100 }, { wa_price: 120 }];
    expect(splitByRank(days)).toBeNull();
  });

  test('exposes every rank actually traded, sorted ascending and distinct', () => {
    const days = [
      { wa_price: 10, mod_rank: 0 },
      { wa_price: 40, mod_rank: 3 },
      { wa_price: 12, mod_rank: 0 },
      { wa_price: 45, mod_rank: 3 },
    ];
    const split = splitByRank(days);
    expect(split.ranks).toEqual([0, 3]);
    expect(split.r0).toHaveLength(2);
    expect(split.r3).toHaveLength(2);
    expect(split.r5).toBeUndefined();
  });

  test('rank-3 arcane (no R5 data) buckets r3 — old code assumed r5', () => {
    const days = [
      { wa_price: 8, mod_rank: 0 },
      { wa_price: 30, mod_rank: 3 },
    ];
    const split = splitByRank(days);
    expect(split.ranks).toEqual([0, 3]);
    expect(split.r3[0].wa_price).toBe(30);
  });

  test('rank-10 mod exposes r10', () => {
    const days = [
      { wa_price: 5, mod_rank: 0 },
      { wa_price: 50, mod_rank: 10 },
    ];
    const split = splitByRank(days);
    expect(split.ranks).toEqual([0, 10]);
    expect(split.r10[0].wa_price).toBe(50);
  });
});

// ── resolveRank: default to highest rank traded, not hardcoded 5 ──────────────
describe('resolveRank — max-rank default', () => {
  test('savedRank wins when set (including 0)', () => {
    const split = splitByRank([{ mod_rank: 0 }, { mod_rank: 3 }]);
    expect(resolveRank(0, split)).toBe(0);
    expect(resolveRank(3, split)).toBe(3);
  });

  test('null savedRank defaults to highest rank present (R3 arcane → 3)', () => {
    const split = splitByRank([{ mod_rank: 0 }, { mod_rank: 3 }]);
    expect(resolveRank(null, split)).toBe(3);
  });

  test('null savedRank defaults to R5 when 5 is the max', () => {
    const split = splitByRank([{ mod_rank: 0 }, { mod_rank: 5 }]);
    expect(resolveRank(null, split)).toBe(5);
  });

  test('null savedRank with no rank split falls back to 0', () => {
    expect(resolveRank(null, null)).toBe(0);
  });

  test('legacy item (undefined rank) falls back to API default', () => {
    const split = splitByRank([{ mod_rank: 0 }, { mod_rank: 5 }]);
    expect(resolveRank(undefined, split)).toBe(5);
  });
});

// ── rankLabel: 0 → Unranked, max → ★, intermediate → R{n} ────────────────────
describe('rankLabel', () => {
  test('rank 0 is "Unranked"', () => {
    expect(rankLabel(0, [0, 3, 5])).toBe('Unranked');
  });

  test('highest rank gets the maxed star', () => {
    expect(rankLabel(5, [0, 3, 5])).toBe('R5 ★');
    expect(rankLabel(3, [0, 3])).toBe('R3 ★');
  });

  test('intermediate rank has no star', () => {
    expect(rankLabel(3, [0, 3, 5])).toBe('R3');
  });
});

// ── fetchCurrentPrice: background must price the chosen rank for alerts ────────
describe('fetchCurrentPrice — arbitrary rank for alerts (regression: R3 arcane)', () => {
  const mockStats = {
    payload: {
      statistics_closed: {
        '90days': [
          { datetime: '2026-05-10', wa_price: 8,  mod_rank: 0 },
          { datetime: '2026-05-11', wa_price: 9,  mod_rank: 0 },
          { datetime: '2026-05-10', wa_price: 30, mod_rank: 3 },
          { datetime: '2026-05-11', wa_price: 33, mod_rank: 3 },
        ],
      },
    },
  };

  beforeEach(() => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(mockStats) })
    );
  });

  test('rank=3 returns last R3 price (the maxed arcane)', async () => {
    expect(await fetchCurrentPrice('arcane_x', 3)).toBe(33);
  });

  test('rank=0 returns last Unranked price', async () => {
    expect(await fetchCurrentPrice('arcane_x', 0)).toBe(9);
  });

  test('rank=3 does NOT return Unranked price', async () => {
    expect(await fetchCurrentPrice('arcane_x', 3)).not.toBe(9);
  });
});

// ── Watchlist collapse persistence (content.js browser.storage.local) ─────────
// Uses extension storage, NOT page localStorage — the latter throws SecurityError
// in content scripts when the site has storage blocked, which broke the panel.
describe('watchlist collapse state persists across tabs', () => {
  let stored;

  // mirrors the read/toggle logic in content.js renderWatchlistPanel
  const initialCollapsed = async () => {
    try { return (await browser.storage.local.get('wlCollapsed')).wlCollapsed === true; }
    catch { return false; }
  };
  const toggle = current => {
    const next = current ? 'false' : 'true';
    try { browser.storage.local.set({ wlCollapsed: next === 'true' }); } catch {}
    return next === 'true';
  };

  beforeEach(() => {
    stored = {};
    browser.storage.local.get.mockImplementation(k =>
      Promise.resolve(k === 'wlCollapsed' ? stored : {})
    );
    browser.storage.local.set.mockImplementation(obj => {
      Object.assign(stored, obj);
      return Promise.resolve();
    });
  });

  test('defaults to expanded when nothing stored', async () => {
    expect(await initialCollapsed()).toBe(false);
  });

  test('toggling collapsed persists true and a fresh tab reads it back', async () => {
    expect(toggle(false)).toBe(true);
    expect(stored.wlCollapsed).toBe(true);
    expect(await initialCollapsed()).toBe(true); // new tab restores collapsed
  });

  test('toggling expanded again persists false', async () => {
    toggle(false);          // -> true
    expect(toggle(true)).toBe(false);
    expect(stored.wlCollapsed).toBe(false);
    expect(await initialCollapsed()).toBe(false);
  });

  test('a storage error never throws (panel keeps working)', async () => {
    browser.storage.local.get.mockRejectedValueOnce(new Error('SecurityError'));
    expect(await initialCollapsed()).toBe(false); // falls back to expanded
  });
});
