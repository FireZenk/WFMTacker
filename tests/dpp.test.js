const { bestDppOrder, dppShouldNotify } = require('../background');

const sell = (platinum, status = 'online', ingameName = 'Seller', id = `o${platinum}`) =>
  ({ id, type: 'sell', platinum, user: { ingameName, status } });

describe('bestDppOrder — best ducats-per-platinum deal', () => {
  test('picks the highest ratio (cheapest listing for a fixed-ducat item)', () => {
    const orders = [sell(10), sell(5), sell(20)]; // ducats 100 → ratios 10, 20, 5
    const best = bestDppOrder(orders, 100);
    expect(best.platinum).toBe(5);
    expect(best.ratio).toBe(20);
  });

  test('ignores buy orders', () => {
    const orders = [{ id: 'b', type: 'buy', platinum: 1, user: { ingameName: 'X', status: 'online' } }, sell(10)];
    expect(bestDppOrder(orders, 100).platinum).toBe(10);
  });

  test('excludes offline sellers by default', () => {
    const orders = [sell(2, 'offline'), sell(10, 'online')];
    expect(bestDppOrder(orders, 100).platinum).toBe(10); // not the cheaper offline one
  });

  test('includes ingame sellers', () => {
    const orders = [sell(4, 'ingame')];
    expect(bestDppOrder(orders, 100).ratio).toBe(25);
  });

  test('returns null when no ducats (non-prime item)', () => {
    expect(bestDppOrder([sell(10)], 0)).toBeNull();
    expect(bestDppOrder([sell(10)], null)).toBeNull();
  });

  test('skips zero/invalid platinum', () => {
    const orders = [sell(0), sell(10)];
    expect(bestDppOrder(orders, 100).platinum).toBe(10);
  });

  test('returns null when no qualifying orders', () => {
    expect(bestDppOrder([sell(10, 'offline')], 100)).toBeNull();
    expect(bestDppOrder([], 100)).toBeNull();
  });
});

describe('dppShouldNotify — threshold + 6h dedup', () => {
  const now = 1_000_000_000_000;
  const best = id => ({ id, platinum: 5, ratio: 20, ingameName: 'S', status: 'online' });

  test('notifies when ratio meets threshold and order is new', () => {
    const res = dppShouldNotify(best('o1'), 15, {}, now);
    expect(res.notify).toBe(true);
    expect(res.seen.o1).toBe(now);
  });

  test('does not notify when ratio below threshold', () => {
    const res = dppShouldNotify({ id: 'o1', ratio: 10, platinum: 10 }, 15, {}, now);
    expect(res.notify).toBe(false);
  });

  test('does not notify the same order again within the window', () => {
    const seen = { o1: now - 60 * 60 * 1000 }; // 1h ago
    const res = dppShouldNotify(best('o1'), 15, seen, now);
    expect(res.notify).toBe(false);
  });

  test('re-notifies the same order after the window expires', () => {
    const seen = { o1: now - 7 * 60 * 60 * 1000 }; // 7h ago > 6h window
    const res = dppShouldNotify(best('o1'), 15, seen, now);
    expect(res.notify).toBe(true);
    expect(res.seen.o1).toBe(now);
  });

  test('notifies a different qualifying order even if another was just seen', () => {
    const seen = { o1: now - 60 * 1000 };
    const res = dppShouldNotify(best('o2'), 15, seen, now);
    expect(res.notify).toBe(true);
    expect(res.seen.o2).toBe(now);
  });

  test('prunes expired entries from the seen map', () => {
    const seen = { old: now - 10 * 60 * 60 * 1000, recent: now - 60 * 1000 };
    const res = dppShouldNotify(best('o3'), 15, seen, now);
    expect(res.seen.old).toBeUndefined();
    expect(res.seen.recent).toBe(seen.recent);
    expect(res.seen.o3).toBe(now);
  });

  test('no-op when best is null or threshold unset', () => {
    expect(dppShouldNotify(null, 15, {}, now).notify).toBe(false);
    expect(dppShouldNotify(best('o1'), null, {}, now).notify).toBe(false);
  });
});
