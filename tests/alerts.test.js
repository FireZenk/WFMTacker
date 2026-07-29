const { shouldNotify, orderBookPrices } = require('../background');

const sell = (platinum, status = 'online', extra = {}) =>
  ({ id: `s${platinum}`, type: 'sell', platinum, visible: true, user: { status }, ...extra });
const buy = (platinum, status = 'online', extra = {}) =>
  ({ id: `b${platinum}`, type: 'buy', platinum, visible: true, user: { status }, ...extra });

// ── orderBookPrices ───────────────────────────────────────────────────────────
// Regression: alerts used to run on the 90-day weighted average, which never
// matches a price you can actually trade at.
describe('orderBookPrices — live order-book edges', () => {
  test('picks the cheapest sell and the priciest buy', () => {
    const orders = [sell(22), sell(18), sell(25), buy(20), buy(31), buy(12)];
    expect(orderBookPrices(orders)).toEqual({ minSell: 18, maxBuy: 31 });
  });

  test('does NOT use the average of the order book', () => {
    // avg sell = 45, avg buy = 21 — neither may be reported
    const orders = [sell(10), sell(80), buy(2), buy(40)];
    const { minSell, maxBuy } = orderBookPrices(orders);
    expect(minSell).toBe(10);
    expect(maxBuy).toBe(40);
  });

  test('ignores offline traders on both sides', () => {
    const orders = [sell(5, 'offline'), sell(18), buy(99, 'offline'), buy(31)];
    expect(orderBookPrices(orders)).toEqual({ minSell: 18, maxBuy: 31 });
  });

  test('accepts ingame status', () => {
    expect(orderBookPrices([sell(7, 'ingame'), buy(4, 'ingame')]))
      .toEqual({ minSell: 7, maxBuy: 4 });
  });

  test('ignores hidden orders', () => {
    const orders = [sell(3, 'online', { visible: false }), sell(18), buy(99, 'online', { visible: false }), buy(31)];
    expect(orderBookPrices(orders)).toEqual({ minSell: 18, maxBuy: 31 });
  });

  test('ignores zero / missing platinum', () => {
    expect(orderBookPrices([sell(0), sell(18), buy(31), buy(null)]))
      .toEqual({ minSell: 18, maxBuy: 31 });
  });

  test('filters by mod rank when one is set', () => {
    const orders = [
      sell(4, 'online', { rank: 0 }), sell(40, 'online', { rank: 5 }),
      buy(3, 'online', { rank: 0 }),  buy(35, 'online', { rank: 5 }),
    ];
    expect(orderBookPrices(orders, 5)).toEqual({ minSell: 40, maxBuy: 35 });
    expect(orderBookPrices(orders, 0)).toEqual({ minSell: 4, maxBuy: 3 });
  });

  test('rank null spans every rank', () => {
    const orders = [sell(4, 'online', { rank: 0 }), sell(40, 'online', { rank: 5 })];
    expect(orderBookPrices(orders, null).minSell).toBe(4);
  });

  test('returns nulls when nothing qualifies', () => {
    expect(orderBookPrices([])).toEqual({ minSell: null, maxBuy: null });
    expect(orderBookPrices([sell(10, 'offline')])).toEqual({ minSell: null, maxBuy: null });
    expect(orderBookPrices(null)).toEqual({ minSell: null, maxBuy: null });
  });

  test('one-sided book leaves the other side null', () => {
    expect(orderBookPrices([sell(18)])).toEqual({ minSell: 18, maxBuy: null });
    expect(orderBookPrices([buy(31)])).toEqual({ minSell: null, maxBuy: 31 });
  });
});

// ── shouldNotify ──────────────────────────────────────────────────────────────
describe('shouldNotify — below watches the cheapest sell order', () => {
  test('fires when the cheapest sell crosses below the threshold', () => {
    expect(shouldNotify({ minSell: 90 }, { minSell: 15 }, { below: 20 })).toBe('below');
  });

  test('fires on exact threshold crossing (prev above, now equal)', () => {
    expect(shouldNotify({ minSell: 21 }, { minSell: 20 }, { below: 20 })).toBe('below');
  });

  test('does NOT re-fire when the cheapest sell was already below', () => {
    expect(shouldNotify({ minSell: 15 }, { minSell: 10 }, { below: 20 })).toBeNull();
  });

  test('does NOT fire when the cheapest sell stays above', () => {
    expect(shouldNotify({ minSell: 90 }, { minSell: 80 }, { below: 20 })).toBeNull();
  });

  test('fires on first check (no prev) when the cheapest sell is below', () => {
    expect(shouldNotify(null, { minSell: 15 }, { below: 20 })).toBe('below');
  });

  test('does NOT fire on first check when the cheapest sell is above', () => {
    expect(shouldNotify(null, { minSell: 90 }, { below: 20 })).toBeNull();
  });

  test('ignores buy orders entirely', () => {
    // A 5p bid must not trip a below alert — nobody sells to you at that price.
    expect(shouldNotify({ minSell: 90 }, { minSell: 90, maxBuy: 5 }, { below: 20 })).toBeNull();
  });

  test('does NOT fire when there are no live sell orders', () => {
    expect(shouldNotify({ minSell: 90 }, { minSell: null, maxBuy: 5 }, { below: 20 })).toBeNull();
  });
});

describe('shouldNotify — above watches the priciest buy order', () => {
  test('fires when the priciest buy crosses above the threshold', () => {
    expect(shouldNotify({ maxBuy: 10 }, { maxBuy: 30 }, { above: 20 })).toBe('above');
  });

  test('fires on exact threshold crossing (prev below, now equal)', () => {
    expect(shouldNotify({ maxBuy: 19 }, { maxBuy: 20 }, { above: 20 })).toBe('above');
  });

  test('does NOT re-fire when the priciest buy was already above', () => {
    expect(shouldNotify({ maxBuy: 90 }, { maxBuy: 90 }, { above: 20 })).toBeNull();
  });

  test('does NOT re-fire when the priciest buy rises further above', () => {
    expect(shouldNotify({ maxBuy: 30 }, { maxBuy: 35 }, { above: 20 })).toBeNull();
  });

  test('does NOT fire when the priciest buy stays below', () => {
    expect(shouldNotify({ maxBuy: 10 }, { maxBuy: 15 }, { above: 20 })).toBeNull();
  });

  test('fires on first check (no prev) when the priciest buy is above', () => {
    expect(shouldNotify(null, { maxBuy: 30 }, { above: 20 })).toBe('above');
  });

  test('does NOT fire on first check when the priciest buy is below', () => {
    expect(shouldNotify(null, { maxBuy: 10 }, { above: 20 })).toBeNull();
  });

  test('ignores sell orders entirely', () => {
    // A 99p ask must not trip an above alert — nobody buys from you at that price.
    expect(shouldNotify({ maxBuy: 10 }, { minSell: 99, maxBuy: 10 }, { above: 20 })).toBeNull();
  });

  test('does NOT fire when there are no live buy orders', () => {
    expect(shouldNotify({ maxBuy: 10 }, { minSell: 99, maxBuy: null }, { above: 20 })).toBeNull();
  });
});

describe('shouldNotify — the two sides track independently', () => {
  test('below fires off its own series even when the buy side did not move', () => {
    const prev = { minSell: 90, maxBuy: 80 };
    const next = { minSell: 5,  maxBuy: 80 };
    expect(shouldNotify(prev, next, { below: 10, above: 100 })).toBe('below');
  });

  test('above fires off its own series even when the sell side did not move', () => {
    const prev = { minSell: 90, maxBuy: 80 };
    const next = { minSell: 90, maxBuy: 110 };
    expect(shouldNotify(prev, next, { below: 10, above: 100 })).toBe('above');
  });

  test('a sell side already below does not suppress a fresh above crossing', () => {
    const prev = { minSell: 5,  maxBuy: 80 };
    const next = { minSell: 5,  maxBuy: 110 };
    expect(shouldNotify(prev, next, { below: 10, above: 100 })).toBe('above');
  });
});

describe('shouldNotify — no alert / edge cases', () => {
  test('returns null when alert is null', () => {
    expect(shouldNotify({ minSell: 90 }, { minSell: 15 }, null)).toBeNull();
  });

  test('returns null when alert is undefined', () => {
    expect(shouldNotify({ minSell: 90 }, { minSell: 15 }, undefined)).toBeNull();
  });

  test('returns null when alert has no thresholds set', () => {
    expect(shouldNotify({ minSell: 90 }, { minSell: 15 }, { below: null, above: null })).toBeNull();
  });

  test('returns null when alert.below is 0 (falsy)', () => {
    expect(shouldNotify({ minSell: 90 }, { minSell: 15 }, { below: 0 })).toBeNull();
  });

  test('returns null when the book is empty', () => {
    expect(shouldNotify({ minSell: 90 }, { minSell: null, maxBuy: null }, { below: 20, above: 100 })).toBeNull();
  });

  test('handles a missing next book', () => {
    expect(shouldNotify({ minSell: 90 }, null, { below: 20 })).toBeNull();
  });

  test('treats a 0 price as a value, not as a missing side', () => {
    expect(shouldNotify({ minSell: 90 }, { minSell: 0 }, { below: 20 })).toBe('below');
  });
});
