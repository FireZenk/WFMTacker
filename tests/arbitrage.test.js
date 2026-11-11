const fs = require('fs');
const vm = require('vm');
const path = require('path');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const root = { id: 'root', setRoot: true, setParts: ['root', 'a', 'a', 'a', 'b', 'otherroot'] };
const members = {
  a: { id: 'a', slug: 'blade', setRoot: false, quantityInSet: 2, ducats: 15, i18n: { en: { name: 'Blade' } } },
  b: { id: 'b', slug: 'blueprint', setRoot: false, quantityInSet: 1, ducats: 45 },
  otherroot: { id: 'otherroot', slug: 'other_set', setRoot: true },
};

function harness(route, { set = root, parts = members, prices = { blade: 10, blueprint: 20 }, errors = [], throws = [] } = {}) {
  const calls = [];
  const node = () => ({ innerHTML: '', children: [], appendChild(child) { this.children.push(child); child.parent = this; }, remove() { this.parent.children = this.parent.children.filter(c => c !== this); }, querySelectorAll() { return []; } });
  const widget = node();
  const zone = node();
  const fetch = jest.fn(async url => {
    calls.push(url);
    if (throws.some(pattern => url.includes(pattern))) throw new Error('Network error');
    if (errors.some(pattern => url.includes(pattern))) return { ok: false, status: 500 };
    if (url.includes('/v2/itemId/')) return { ok: true, json: async () => ({ data: parts[url.split('/').pop()] }) };
    if (url.includes('/v2/item/')) return { ok: true, json: async () => ({ data: set }) };
    const match = url.match(/\/items\/([^/]+)\/statistics/);
    if (match) {
      const value = prices[match[1]];
      return { ok: true, json: async () => ({ payload: { statistics_closed: { '90days': value == null ? [] : [typeof value === 'object' ? value : { wa_price: value }] } } }) };
    }
    throw new Error('Unexpected URL ' + url);
  });
  const scheduledFetch = jest.fn((...args) => fetch(...args));
  const createVaultResolver = jest.fn(() => async () => null);
  const document = {
    readyState: 'loading', addEventListener() {},
    getElementById: id => id === 'wfm-panel-arb-zone' ? zone : null,
    createElement: node,
  };
  const ctx = vm.createContext({ document, fetch, MarketAPI: { fetch: scheduledFetch }, console, VaultUtils: { createVaultResolver },
    location: { pathname: '/items/example_set', href: '' }, setInterval() {}, setTimeout() {}, browser: {} });
  if (route === 'content') {
    const source = read('content.js').replace(/\}\)\(\);\s*$/, 'globalThis.__hooks = { fetchItemParts, fetchPartPrice, loadArbitrage };\n})();');
    vm.runInContext(source, ctx);
  } else {
    vm.runInContext(read('shared.js'), ctx);
    vm.runInContext(read('panel.js') + '\ncurrentSlug = "example_set"; globalThis.__hooks = { fetchItemParts, fetchPartPrice, loadArbitrage };', ctx);
  }
  return { ...ctx.__hooks, calls, widget, zone, scheduledFetch, createVaultResolver, html: () => route === 'content' ? widget.children.map(c => c.innerHTML).join('') : zone.innerHTML };
}
const stats = price => ({ closed: { '90days': price == null ? [] : [{ wa_price: price }] } });

for (const route of ['content', 'panel']) {
  describe(`${route}: API and arbitrage integration`, () => {
    test('market operations and Vault use the same injected scheduler', async () => {
      const h = harness(route);
      expect(h.createVaultResolver).toHaveBeenCalledWith(h.scheduledFetch);
      await h.fetchItemParts('example_set');
      await h.fetchPartPrice('blade');
      expect(h.scheduledFetch).toHaveBeenCalledTimes(h.calls.length);
      expect(h.scheduledFetch).toHaveBeenCalledWith(expect.stringContaining('/v2/item/'), expect.any(Object));
      expect(h.scheduledFetch).toHaveBeenCalledWith(expect.stringContaining('/statistics'), expect.any(Object));
    });

    test('uses actual quantityInSet, deduplicates IDs, excludes roots and weights both currencies', async () => {
      const h = harness(route);
      const data = await h.fetchItemParts('example_set');
      expect(data.complete).toBe(true);
      expect(data.parts.map(p => [p.slug, p.qty]).map(v => Array.from(v))).toEqual([['blade', 2], ['blueprint', 1]]);
      expect(h.calls.filter(url => url.endsWith('/itemId/a'))).toHaveLength(1);
      h.calls.length = 0;
      await h.loadArbitrage('example_set', stats(60), h.widget);
      const html = h.html();
      expect(html).toContain('×2');
      expect(html).toContain('40p');
      expect(html).toContain('75d total');
      expect(html).toMatch(/<\/svg>30<\/span>/); // 15 ducats × 2 in the row
      expect(html).toContain('estimated savings <b>20p</b>');
      expect(html).toContain('Estimates based on historical prices, not current offers.');
      expect(html).not.toContain('other_set');
    });

    test('failed member metadata preserves partial result but prevents any definitive comparison', async () => {
      const h = harness(route, { errors: ['/itemId/b'] });
      const data = await h.fetchItemParts('example_set');
      expect(data.complete).toBe(false);
      expect(data.parts).toHaveLength(1);
      await h.loadArbitrage('example_set', stats(60), h.widget);
      expect(h.html()).toMatch(/incomplete/i);
      expect(h.html()).not.toMatch(/save |profit |Fair|\d+d total/i);
      expect(h.html()).toMatch(/Parts total <b class="wfm-ph-arb-num">—<\/b>/);
    });

    test.each([undefined, null, 0, -1, 1.5, '2'])('quantity %p is unknown rather than silently assumed as one', async quantity => {
      const h = harness(route, { parts: { ...members, a: { ...members.a, quantityInSet: quantity } } });
      const data = await h.fetchItemParts('example_set');
      expect(data.complete).toBe(false);
      expect(data.parts.find(p => p.id === 'a').qty).toBeNull();
      await h.loadArbitrage('example_set', stats(60), h.widget);
      expect(h.html()).toMatch(/incomplete/i);
      expect(h.html()).not.toMatch(/save |profit |Fair|\d+d total/i);
    });

    test.each([undefined, 0])('missing or nonpositive part price %p suppresses totals and advice', async price => {
      const h = harness(route, { prices: { blade: 10, blueprint: price } });
      await h.loadArbitrage('example_set', stats(60), h.widget);
      expect(h.html()).toMatch(/incomplete/i);
      expect(h.html()).not.toMatch(/save |profit |Fair|\d+d total/i);
      expect(h.html()).not.toContain('20p</b>');
      expect(h.html()).toContain('—');
    });

    test('missing set price shows incomplete data rather than disappearing or making a recommendation', async () => {
      const h = harness(route);
      await h.loadArbitrage('example_set', stats(null), h.widget);
      expect(h.html()).toMatch(/incomplete/i);
      expect(h.html()).not.toMatch(/save |profit |Fair|\d+d total/i);
    });


    test.each([
      ['network exception', { throws: ['/itemId/b'] }],
      ['missing response', { parts: { ...members, b: undefined } }],
      ['mismatched ID', { parts: { ...members, b: { ...members.b, id: 'different' } } }],
      ['missing slug', { parts: { ...members, b: { ...members.b, slug: undefined } } }],
      ['root failure', { errors: ['/v2/item/example_set'] }],
    ])('%s never produces a complete comparison', async (_label, options) => {
      const h = harness(route, options);
      expect((await h.fetchItemParts('example_set')).complete).toBe(false);
      await h.loadArbitrage('example_set', stats(60), h.widget);
      expect(h.html()).toMatch(/incomplete/i);
      expect(h.html()).toMatch(/Parts total <b class="wfm-ph-arb-num">—<\/b>/);
      expect(h.html()).not.toMatch(/save |profit |Fair|\d+d total/i);
    });


    test('statistics use the average fallback and reject absent or invalid values', async () => {
      const h = harness(route, { prices: { blade: { avg_price: 12 }, blueprint: {} } });
      expect(await h.fetchPartPrice('blade')).toBe(12);
      expect(await h.fetchPartPrice('blueprint')).toBeNull();
      await h.loadArbitrage('example_set', stats(60), h.widget);
      expect(h.html()).toMatch(/incomplete/i);
      expect(h.html()).not.toMatch(/save |profit |Fair|\d+d total/i);
    });

    test('unavailable price after an HTTP error is not treated as zero', async () => {
      const h = harness(route, { errors: ['/items/blueprint/statistics'] });
      expect(await h.fetchPartPrice('blueprint')).toBeNull();
      await h.loadArbitrage('example_set', stats(60), h.widget);
      expect(h.html()).toMatch(/incomplete/i);
      expect(h.html()).toMatch(/Parts total <b class="wfm-ph-arb-num">—<\/b>/);
      expect(h.html()).not.toMatch(/save |profit |Fair|\d+d total/i);
    });

    test.each([[40, 'Fair'], [30, 'estimated profit <b>+10p</b>']])('complete price comparison %ip produces valid advice', async (setPrice, expected) => {
      const h = harness(route);
      await h.loadArbitrage('example_set', stats(setPrice), h.widget);
      expect(h.html()).toContain(expected);
      expect(h.html()).toContain('historical prices');
      expect(h.html()).toContain('not current offers');
      expect(h.html()).not.toMatch(/incomplete/i);
    });

    test('a valid root without other members renders no comparison', async () => {
      const h = harness(route, { set: { id: 'root', setRoot: true, setParts: ['root'] } });
      await h.loadArbitrage('example_set', stats(60), h.widget);
      expect(h.html()).toBe('');
    });

    test('missing ducat metadata never makes a false ducat total', async () => {
      const h = harness(route, { parts: { ...members, b: { ...members.b, ducats: undefined } } });
      await h.loadArbitrage('example_set', stats(60), h.widget);
      expect(h.html()).not.toMatch(/\d+d total/);
      expect(h.html()).toContain('estimated savings <b>20p</b>');
    });

    test.each([null, { id: 'root' }, { id: 'root', setParts: ['root', null] }])('malformed set metadata %p is incomplete', async set => {
      const h = harness(route, { set });
      const data = await h.fetchItemParts('example_set');
      expect(data.complete).toBe(false);
      await h.loadArbitrage('example_set', stats(60), h.widget);
      expect(h.html()).toMatch(/incomplete/i);
      expect(h.html()).not.toMatch(/save |profit |Fair|\d+d total/i);
    });
  });
}
