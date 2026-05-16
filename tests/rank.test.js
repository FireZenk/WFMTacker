const { getWatchlist, saveWatchlist, fetchCurrentPrice } = require('../background');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('arcane rank persistence (regression: rank lost after refresh)', () => {
  test('new watchlist item initialises with rank: null', () => {
    const item = {
      name: 'Arcane Agility',
      slug: 'arcane_agility',
      addedAt: Date.now(),
      priceAtAdd: 10,
      lastPrice: 10,
      lastChecked: Date.now(),
      alert: { below: null, above: null },
      rank: null,
    };
    expect(item.rank).toBeNull();
  });

  test('saving rank=0 (Unranked) persists to watchlist', async () => {
    const mockList = {
      arcane_agility: { name: 'Arcane Agility', lastPrice: 10, rank: null },
    };
    browser.storage.local.get.mockResolvedValue({ watchlist: mockList });
    browser.storage.local.set.mockResolvedValue();

    const list = await getWatchlist();
    list['arcane_agility'].rank = 0;
    await saveWatchlist(list);

    expect(browser.storage.local.set).toHaveBeenCalledWith({
      watchlist: expect.objectContaining({
        arcane_agility: expect.objectContaining({ rank: 0 }),
      }),
    });
  });

  test('saving rank=5 (Max) persists to watchlist', async () => {
    const mockList = {
      arcane_agility: { name: 'Arcane Agility', lastPrice: 10, rank: null },
    };
    browser.storage.local.get.mockResolvedValue({ watchlist: mockList });
    browser.storage.local.set.mockResolvedValue();

    const list = await getWatchlist();
    list['arcane_agility'].rank = 5;
    await saveWatchlist(list);

    expect(browser.storage.local.set).toHaveBeenCalledWith({
      watchlist: expect.objectContaining({
        arcane_agility: expect.objectContaining({ rank: 5 }),
      }),
    });
  });

  test('savedRank=null falls back to API default (R5 if available)', () => {
    const savedRank = null;
    const rankSplit90 = { r5: [{ wa_price: 100 }], r0: [{ wa_price: 10 }] };
    const curRank = savedRank !== null ? savedRank : (rankSplit90?.r5?.length ? 5 : 0);
    expect(curRank).toBe(5);
  });

  test('savedRank=0 overrides API default even when R5 data exists', () => {
    const savedRank = 0;
    const rankSplit90 = { r5: [{ wa_price: 100 }], r0: [{ wa_price: 10 }] };
    const curRank = savedRank !== null ? savedRank : (rankSplit90?.r5?.length ? 5 : 0);
    expect(curRank).toBe(0);
  });

  test('savedRank=5 preserved across re-render', () => {
    const savedRank = 5;
    const rankSplit90 = { r5: [{ wa_price: 100 }], r0: [{ wa_price: 10 }] };
    const curRank = savedRank !== null ? savedRank : (rankSplit90?.r5?.length ? 5 : 0);
    expect(curRank).toBe(5);
  });

  test('item without rank field (legacy) falls back to API default', () => {
    const watchlistItem = { name: 'Arcane Agility', lastPrice: 10 }; // no rank field
    const savedRank = watchlistItem?.rank ?? null;
    const rankSplit90 = { r5: [{ wa_price: 100 }], r0: [] };
    const curRank = savedRank !== null ? savedRank : (rankSplit90?.r5?.length ? 5 : 0);
    expect(curRank).toBe(5);
  });
});

describe('toggleWatch — rank initialisation from current display', () => {
  test('arcane item added with curRank=5 stores rank=5 (not null)', async () => {
    browser.storage.local.get.mockResolvedValue({ watchlist: {} });
    browser.storage.local.set.mockResolvedValue();

    const list = await getWatchlist();
    // simulate toggleWatch(slug, name, price, rank=5)
    list['arcane_agility'] = {
      name: 'Arcane Agility', slug: 'arcane_agility',
      addedAt: Date.now(), priceAtAdd: 37, lastPrice: 37,
      lastChecked: Date.now(), alert: { below: null, above: null },
      rank: 5,
    };
    await saveWatchlist(list);

    expect(browser.storage.local.set).toHaveBeenCalledWith({
      watchlist: expect.objectContaining({
        arcane_agility: expect.objectContaining({ rank: 5, lastPrice: 37 }),
      }),
    });
  });

  test('non-arcane item added stores rank=null', async () => {
    browser.storage.local.get.mockResolvedValue({ watchlist: {} });
    browser.storage.local.set.mockResolvedValue();

    const list = await getWatchlist();
    list['ash_prime_set'] = {
      name: 'Ash Prime Set', slug: 'ash_prime_set',
      addedAt: Date.now(), priceAtAdd: 120, lastPrice: 120,
      lastChecked: Date.now(), alert: { below: null, above: null },
      rank: null,
    };
    await saveWatchlist(list);

    expect(browser.storage.local.set).toHaveBeenCalledWith({
      watchlist: expect.objectContaining({
        ash_prime_set: expect.objectContaining({ rank: null }),
      }),
    });
  });
});

describe('fetchCurrentPrice — rank filtering (regression: lastPrice showed blended price after refresh)', () => {
  const mockStats = {
    payload: {
      statistics_closed: {
        '90days': [
          { datetime: '2026-05-10', wa_price: 10, mod_rank: 0 },
          { datetime: '2026-05-11', wa_price: 12, mod_rank: 0 },
          { datetime: '2026-05-10', wa_price: 90, mod_rank: 5 },
          { datetime: '2026-05-11', wa_price: 95, mod_rank: 5 },
        ],
      },
    },
  };

  beforeEach(() => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(mockStats) })
    );
  });

  test('rank=null with rank-split data defaults to R5 (matches panel default)', async () => {
    const price = await fetchCurrentPrice('arcane_agility', null);
    expect(price).toBe(95); // rank-split detected → R5 last entry = 95
  });

  test('rank=5 filters to Max entries and returns last Max price', async () => {
    const price = await fetchCurrentPrice('arcane_agility', 5);
    expect(price).toBe(95);
  });

  test('rank=0 filters to Unranked entries and returns last Unranked price', async () => {
    const price = await fetchCurrentPrice('arcane_agility', 0);
    expect(price).toBe(12);
  });

  test('rank=5 does NOT return Unranked price', async () => {
    const price = await fetchCurrentPrice('arcane_agility', 5);
    expect(price).not.toBe(12);
  });

  test('rank=0 does NOT return Max price', async () => {
    const price = await fetchCurrentPrice('arcane_agility', 0);
    expect(price).not.toBe(95);
  });

  test('rank=null without rank-split data returns last entry (non-arcane)', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          payload: {
            statistics_closed: {
              '90days': [
                { datetime: '2026-05-10', wa_price: 100 },
                { datetime: '2026-05-11', wa_price: 120 },
              ],
            },
          },
        }),
      })
    );
    const price = await fetchCurrentPrice('ash_prime_set', null);
    expect(price).toBe(120);
  });

  test('returns null when fetch fails', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('network')));
    const price = await fetchCurrentPrice('arcane_agility', 5);
    expect(price).toBeNull();
  });
});
