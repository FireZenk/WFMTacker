const { groupBundleDeals, buildBundleWhisper } = require('../rank-utils');

// Helper to build a v2-shaped sell order.
const sell = (ingameName, platinum, status = 'online', reputation = 0) =>
  ({ type: 'sell', platinum, user: { ingameName, status, reputation } });

describe('groupBundleDeals — multi-item seller matching', () => {
  test('returns only sellers holding 2+ distinct watchlist items', () => {
    const data = {
      ash_prime_set:    { name: 'Ash Prime Set',    orders: [sell('Alice', 45), sell('Bob', 50)] },
      ember_prime_set:  { name: 'Ember Prime Set',  orders: [sell('Alice', 8),  sell('Carol', 12)] },
      mag_prime_set:    { name: 'Mag Prime Set',    orders: [sell('Carol', 20), sell('Dave', 18)] },
    };
    const groups = groupBundleDeals(data);
    // Alice: ash+ember (2). Carol: ember+mag (2). Bob/Dave: 1 each → excluded.
    expect(groups.map(g => g.ingameName).sort()).toEqual(['Alice', 'Carol']);
  });

  test('excludes offline sellers by default (online + ingame only)', () => {
    const data = {
      a: { name: 'A', orders: [sell('Zoe', 10, 'offline')] },
      b: { name: 'B', orders: [sell('Zoe', 20, 'offline')] },
    };
    expect(groupBundleDeals(data)).toEqual([]);
  });

  test('includes ingame and online sellers', () => {
    const data = {
      a: { name: 'A', orders: [sell('Zoe', 10, 'ingame')] },
      b: { name: 'B', orders: [sell('Zoe', 20, 'online')] },
    };
    const groups = groupBundleDeals(data);
    expect(groups).toHaveLength(1);
    expect(groups[0].ingameName).toBe('Zoe');
    expect(groups[0].items).toHaveLength(2);
  });

  test('keeps the cheapest order per seller per item', () => {
    const data = {
      a: { name: 'A', orders: [sell('Zoe', 30), sell('Zoe', 12), sell('Zoe', 99)] },
      b: { name: 'B', orders: [sell('Zoe', 20), sell('Zoe', 25)] },
    };
    const [g] = groupBundleDeals(data);
    expect(g.items.find(i => i.slug === 'a').platinum).toBe(12);
    expect(g.items.find(i => i.slug === 'b').platinum).toBe(20);
    expect(g.total).toBe(32);
  });

  test('counts an item once even with multiple orders from the same seller', () => {
    const data = {
      a: { name: 'A', orders: [sell('Zoe', 10), sell('Zoe', 11)] },
      b: { name: 'B', orders: [sell('Zoe', 20)] },
    };
    const [g] = groupBundleDeals(data);
    expect(g.items).toHaveLength(2); // a + b, not 3
  });

  test('sorts by item count desc, then cheapest total', () => {
    const data = {
      a: { name: 'A', orders: [sell('Two', 100), sell('ThreeLow', 1), sell('ThreeHigh', 50)] },
      b: { name: 'B', orders: [sell('Two', 100), sell('ThreeLow', 1), sell('ThreeHigh', 50)] },
      c: { name: 'C', orders: [sell('ThreeLow', 1), sell('ThreeHigh', 50)] },
    };
    const order = groupBundleDeals(data).map(g => g.ingameName);
    // ThreeLow & ThreeHigh have 3 items each (come first); tie broken by total → ThreeLow(3) before ThreeHigh(150)
    expect(order).toEqual(['ThreeLow', 'ThreeHigh', 'Two']);
  });

  test('ignores buy orders', () => {
    const data = {
      a: { name: 'A', orders: [{ type: 'buy', platinum: 5, user: { ingameName: 'Zoe', status: 'online' } }] },
      b: { name: 'B', orders: [sell('Zoe', 20)] },
    };
    expect(groupBundleDeals(data)).toEqual([]); // only 1 sell item → excluded
  });

  test('seller status prefers ingame over online when both appear', () => {
    const data = {
      a: { name: 'A', orders: [sell('Zoe', 10, 'online')] },
      b: { name: 'B', orders: [sell('Zoe', 20, 'ingame')] },
    };
    expect(groupBundleDeals(data)[0].status).toBe('ingame');
  });

  test('custom status filter (ingame only)', () => {
    const data = {
      a: { name: 'A', orders: [sell('Zoe', 10, 'ingame'), sell('Liz', 9, 'online')] },
      b: { name: 'B', orders: [sell('Zoe', 20, 'ingame'), sell('Liz', 19, 'online')] },
    };
    const groups = groupBundleDeals(data, { statuses: ['ingame'] });
    expect(groups.map(g => g.ingameName)).toEqual(['Zoe']);
  });

  test('handles empty / missing input safely', () => {
    expect(groupBundleDeals({})).toEqual([]);
    expect(groupBundleDeals(undefined)).toEqual([]);
    expect(groupBundleDeals({ a: { name: 'A', orders: [] }, b: {} })).toEqual([]);
  });
});

describe('buildBundleWhisper', () => {
  const seller = {
    ingameName: 'TennoTrader42',
    items: [
      { name: 'Rhino Prime Set', platinum: 70 },
      { name: 'Ash Prime Set', platinum: 45 },
    ],
    total: 115,
  };

  test('lists all items cheapest-first with total and warframe.market tag', () => {
    expect(buildBundleWhisper(seller)).toBe(
      '/w TennoTrader42 Hi! I want to buy: "Ash Prime Set" for 45p, "Rhino Prime Set" for 70p — total 115p. (warframe.market)'
    );
  });

  test('starts with the /w whisper command and the seller name', () => {
    expect(buildBundleWhisper(seller).startsWith('/w TennoTrader42 ')).toBe(true);
  });

  test('quotes every item name (WFM trade format)', () => {
    const w = buildBundleWhisper(seller);
    expect(w).toContain('"Ash Prime Set"');
    expect(w).toContain('"Rhino Prime Set"');
  });
});
