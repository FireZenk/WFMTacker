const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createScheduler } = require('../market-api');
const { groupBundleDeals } = require('../rank-utils');

const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const tick = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const list = { a: { name: 'A' }, b: { name: 'B' }, c: { name: 'C' } };
const stats = { closed: { '90days': [{ avg_price: 10 }], '48hours': [] } };

function events() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    count(type) { return listeners.get(type)?.size || 0; },
  };
}

function harness(fetchImpl = jest.fn()) {
  const nodes = {};
  const node = () => ({ innerHTML: '', dataset: {}, disabled: false,
    classList: { toggle() {} }, querySelector: () => node(), querySelectorAll: () => [], addEventListener() {} });
  const window = events();
  const document = Object.assign(events(), { querySelectorAll: () => [],
    getElementById: id => nodes[id] ??= node() });
  const location = { href: 'https://example.test/panel.html', search: '' };
  const scheduler = createScheduler({ fetchImpl });
  const context = vm.createContext({ document, window, location, URL, AbortController,
    setInterval, clearInterval, setTimeout, clearTimeout, splitByRank: () => null,
    history: { replaceState(_a, _b, url) { location.href = String(url); } },
    MarketAPI: { fetch: scheduler }, VaultUtils: {}, groupBundleDeals, console });
  vm.runInContext(source('shared.js'), context);
  vm.runInContext(source('panel.js') + `
    const originalRenderItem = renderItem;
    globalThis.hooks = { showBundleDeals, loadItem, fetchOrders,
      configure: opts => {
        if (opts.watchlist) getWatchlist = opts.watchlist;
        if (opts.stats) fetchStats = opts.stats;
        if (opts.orders) fetchOrders = opts.orders;
        if (opts.render) renderItem = opts.render;
        if (opts.realRender) renderItem = originalRenderItem;
        if (opts.track) trackRecentlyViewed = opts.track;
        else trackRecentlyViewed = async () => {};
        renderSidebar = () => {};
        drawChart = () => {};
        fetchItemV2 = async () => null;
        loadVaultData = async () => ({});
        getSettings = async () => opts.settings ?? {};
      },
      setDisposer: fn => { disposeItemLifecycle = fn; },
    };`, context);
  context.hooks.configure({ watchlist: async () => list,
    render: slug => { document.getElementById('wfm-panel-content').innerHTML = `Item: ${slug}`; } });
  return { hooks: context.hooks, window, document, content: document.getElementById('wfm-panel-content') };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

test('navigating away aborts running and queued Bundle orders so the new item can load', async () => {
  let orderSignal;
  const fetchImpl = jest.fn((url, init) => {
    if (url.includes('/orders/')) {
      orderSignal = init.signal;
      return new Promise(() => {}); // The underlying fetch ignores cancellation.
    }
    return Promise.resolve({ ok: true, status: 200,
      json: async () => ({ payload: { statistics_closed: stats.closed } }) });
  });
  const h = harness(fetchImpl);
  const bundle = h.hooks.showBundleDeals();
  await jest.advanceTimersByTimeAsync(0);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(orderSignal.aborted).toBe(false);
  const item = h.hooks.loadItem('new_item');
  expect(orderSignal.aborted).toBe(true);
  await jest.advanceTimersByTimeAsync(500);
  await Promise.all([bundle, item]);
  expect(h.content.innerHTML).toBe('Item: new_item');
  expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
    expect.stringContaining('/orders/item/a'), expect.stringContaining('/items/new_item/statistics'),
  ]);
});

test('opening Bundle invalidates an in-flight item and disposes its lifecycle before reading the watchlist', async () => {
  const statsPending = deferred(), listPending = deferred();
  const disposed = jest.fn();
  const h = harness();
  let reads = 0;
  h.hooks.configure({ stats: () => statsPending.promise,
    watchlist: () => ++reads === 1 ? Promise.resolve(list) : listPending.promise,
    orders: async () => [] });
  const item = h.hooks.loadItem('old_item');
  h.hooks.setDisposer(disposed);
  const bundle = h.hooks.showBundleDeals();
  expect(disposed).toHaveBeenCalledTimes(1);
  expect(h.content.innerHTML).toContain('Loading');
  statsPending.resolve(stats);
  await item;
  expect(h.content.innerHTML).not.toContain('Item: old_item');
  listPending.resolve(list);
  await bundle;
  expect(h.content.innerHTML).toContain('Bundle deals');
});

test('a delayed watchlist lookup cannot launch Bundle requests or overwrite a newer item', async () => {
  const pending = deferred();
  const orders = jest.fn(async () => []);
  const h = harness();
  let reads = 0;
  h.hooks.configure({ watchlist: () => ++reads === 1 ? pending.promise : Promise.resolve(list),
    stats: async () => stats, orders });
  const bundle = h.hooks.showBundleDeals();
  await h.hooks.loadItem('new_item');
  pending.resolve(list);
  await bundle;
  expect(orders).not.toHaveBeenCalled();
  expect(h.content.innerHTML).toBe('Item: new_item');
});

test('late Bundle results cannot overwrite a newer item even when orders ignore cancellation', async () => {
  const pending = deferred();
  const h = harness();
  h.hooks.configure({ orders: () => pending.promise, stats: async () => stats });
  const bundle = h.hooks.showBundleDeals();
  await tick();
  await h.hooks.loadItem('new_item');
  pending.resolve([]);
  await bundle;
  expect(h.content.innerHTML).toBe('Item: new_item');
});

test('fetchOrders forwards optional cancellation and keeps failure fallback', async () => {
  const response = { ok: true, status: 200, json: async () => ({ data: [{ id: 1 }] }) };
  let signal;
  const h = harness(jest.fn(async (_url, init) => { signal = init.signal; return response; }));
  const controller = new AbortController();
  const result = h.hooks.fetchOrders('a', controller.signal);
  await jest.advanceTimersByTimeAsync(0);
  expect(await result).toEqual([{ id: 1 }]);
  expect(signal).toBeDefined();
  controller.abort();
  expect(await h.hooks.fetchOrders('b', controller.signal)).toEqual([]);
});


test('opening Bundle disposes real item listeners and refresh timer', async () => {
  const h = harness();
  h.hooks.configure({ realRender: true, stats: async () => stats, watchlist: async () => list,
    orders: async () => [], settings: { defaultRange: '90days', showVault: true } });
  await h.hooks.loadItem('old_item');
  expect(h.content.innerHTML).toContain('Old Item');
  expect(h.window.count('focus')).toBe(1);
  expect(h.window.count('resize')).toBe(1);
  expect(h.document.count('visibilitychange')).toBe(1);
  expect(jest.getTimerCount()).toBe(1);
  await h.hooks.showBundleDeals();
  expect(h.content.innerHTML).toContain('Bundle deals');
  expect(h.window.count('focus')).toBe(0);
  expect(h.window.count('resize')).toBe(0);
  expect(h.document.count('visibilitychange')).toBe(0);
  expect(jest.getTimerCount()).toBe(0);
});

test('opening Bundle prevents a real item render already awaiting recently viewed storage', async () => {
  const tracking = deferred();
  const track = jest.fn(() => tracking.promise);
  const h = harness();
  h.hooks.configure({ realRender: true, stats: async () => stats, watchlist: async () => list,
    orders: async () => [], track, settings: { defaultRange: '90days' } });
  const item = h.hooks.loadItem('old_item');
  await tick();
  expect(track).toHaveBeenCalledTimes(1);
  await h.hooks.showBundleDeals();
  const bundleHTML = h.content.innerHTML;
  tracking.resolve();
  await item;
  expect(h.content.innerHTML).toBe(bundleHTML);
  expect(h.window.count('resize')).toBe(0);
});

test('a newer Bundle supersedes a delayed previous scan', async () => {
  const oldOrders = deferred();
  const h = harness();
  let calls = 0;
  let oldSignal;
  h.hooks.configure({ orders: (_slug, signal) => {
    if (++calls <= 3) { oldSignal = signal; return oldOrders.promise; }
    return Promise.resolve([{ type: 'sell', platinum: 10, user: { ingameName: 'Alice', status: 'online' } }]);
  } });
  const first = h.hooks.showBundleDeals();
  await tick();
  await h.hooks.showBundleDeals();
  expect(oldSignal.aborted).toBe(true);
  expect(h.content.innerHTML).toContain('Alice');
  const html = h.content.innerHTML;
  oldOrders.resolve([]);
  await first;
  expect(h.content.innerHTML).toBe(html);
});

test('watchlist errors and too few items replace the initial loading message', async () => {
  const h = harness();
  h.hooks.configure({ watchlist: async () => { throw new Error('storage failed'); } });
  await h.hooks.showBundleDeals();
  expect(h.content.innerHTML).toContain('Failed to load Bundle deals');
  h.hooks.configure({ watchlist: async () => ({ a: {} }) });
  await h.hooks.showBundleDeals();
  expect(h.content.innerHTML).toContain('at least 2 items');
});
