const { getWatchlist, saveWatchlist } = require('../background');

const DEFAULT_SETTINGS = {
  timezone:       '',
  defaultRange:   '90days',
  showForecast:   true,
  showSignal:     true,
  showVolatility: true,
  showLiquidity:  true,
  showBestHour:   true,
  showDucat:      true,
  showVault:      true,
  showArbitrage:  true,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('storage.sync.get — Promise-based (regression: callback form hung in Chrome MV3)', () => {
  test('returns DEFAULT_SETTINGS when storage is empty', async () => {
    browser.storage.sync.get.mockResolvedValue({});

    const result = await browser.storage.sync.get('settings').then(d =>
      ({ ...DEFAULT_SETTINGS, ...(d.settings ?? {}) })
    );

    expect(result).toEqual(DEFAULT_SETTINGS);
  });

  test('merges saved settings over defaults', async () => {
    browser.storage.sync.get.mockResolvedValue({
      settings: { defaultRange: '48hours', timezone: 'Europe/Madrid' },
    });

    const result = await browser.storage.sync.get('settings').then(d =>
      ({ ...DEFAULT_SETTINGS, ...(d.settings ?? {}) })
    );

    expect(result.defaultRange).toBe('48hours');
    expect(result.timezone).toBe('Europe/Madrid');
    expect(result.showForecast).toBe(true); // default preserved
  });

  test('partial saved settings preserve remaining defaults', async () => {
    browser.storage.sync.get.mockResolvedValue({
      settings: { showForecast: false },
    });

    const result = await browser.storage.sync.get('settings').then(d =>
      ({ ...DEFAULT_SETTINGS, ...(d.settings ?? {}) })
    );

    expect(result.showForecast).toBe(false);
    expect(result.defaultRange).toBe('90days');
    expect(result.showSignal).toBe(true);
  });

  test('resolves via .then() — not via new Promise(resolve => callback)', async () => {
    // Verifies the API is called as a Promise, not with a callback argument.
    // If called with a callback, the mock returns a Promise that resolves to {}
    // but the callback is never invoked — reproducing the original Chrome MV3 hang.
    browser.storage.sync.get.mockResolvedValue({ settings: { defaultRange: '48hours' } });

    const result = await browser.storage.sync.get('settings').then(d =>
      ({ ...DEFAULT_SETTINGS, ...(d.settings ?? {}) })
    );

    expect(browser.storage.sync.get).toHaveBeenCalledWith('settings');
    expect(browser.storage.sync.get).not.toHaveBeenCalledWith('settings', expect.any(Function));
    expect(result.defaultRange).toBe('48hours');
  });
});

describe('storage.local — watchlist (background.js)', () => {
  test('getWatchlist returns empty object when storage is empty', async () => {
    browser.storage.local.get.mockResolvedValue({});
    const result = await getWatchlist();
    expect(result).toEqual({});
  });

  test('getWatchlist returns stored watchlist', async () => {
    const mockList = { ash_prime_set: { name: 'Ash Prime Set', lastPrice: 90 } };
    browser.storage.local.get.mockResolvedValue({ watchlist: mockList });
    const result = await getWatchlist();
    expect(result).toEqual(mockList);
  });

  test('saveWatchlist calls storage.local.set with watchlist key', async () => {
    const list = { volt_prime_set: { name: 'Volt Prime Set', lastPrice: 50 } };
    await saveWatchlist(list);
    expect(browser.storage.local.set).toHaveBeenCalledWith({ watchlist: list });
  });
});
