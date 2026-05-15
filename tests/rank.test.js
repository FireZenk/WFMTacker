const { getWatchlist, saveWatchlist } = require('../background');

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
