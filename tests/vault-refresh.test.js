const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createVaultResolver } = require('../vault-utils');

const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const stats = { closed: { '90days': [{ avg_price: 10 }], '48hours': [] } };
const settings = { defaultRange: '90days', showVault: true, showArbitrage: false,
  showSignal: false, showVolatility: false, showLiquidity: false, showBestHour: false,
  showDucat: false, showForecast: false };
const root = { id: 'root', slug: 'ash_prime_set', setRoot: true, setParts: ['root', 'part'] };
const part = { id: 'part', slug: 'ash_prime_part', setRoot: false, tags: ['prime'], setParts: ['root', 'part'] };
const makeData = (event, asOf = '2026-11-11') => ({
  _asOf: asOf, ash_prime_set: { vaulted: '2020-01-01', events: [event] },
});
const fixed = { start: '2026-11-01', end: '2026-11-12T00:00:00Z' };
const open = { start: '2026-11-01', end: null, verifiedAt: '2026-11-11' };
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

function events() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    emit(type) { for (const fn of [...(listeners.get(type) || [])]) fn(); },
    count(type) { return listeners.get(type)?.size || 0; },
  };
}
function node() {
  return { innerHTML: '', dataset: {}, children: {}, classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, addEventListener() {},
    querySelector(key) { return this.children[key] ??= node(); }, querySelectorAll() { return []; } };
}

function harness(kind, data, fetchImpl = jest.fn(async () => ({ ok: true, json: async () => ({ data: root }) }))) {
  const window = events();
  const document = Object.assign(events(), { visibilityState: 'visible', readyState: 'loading' });
  const resolver = createVaultResolver(fetchImpl);
  const resolve = jest.fn((...args) => resolver(...args));
  const location = { href: 'https://warframe.market/items/ash_prime_part', pathname: '/items/ash_prime_part', search: '' };
  let mounted = null;
  const nodes = {};
  const anchor = { tagName: 'MAIN', insertBefore(el) { mounted = el; } };
  document.createElement = () => {
    const el = node();
    el.remove = () => { if (mounted === el) mounted = null; };
    return el;
  };
  document.getElementById = id => kind === 'content' ? (id === 'wfm-ph-widget' ? mounted : null) : (nodes[id] ??= node());
  document.querySelectorAll = () => [];
  const browser = { runtime: { sendMessage: async () => ({}), getManifest: () => ({ version: '1' }) },
    storage: { local: { get: async () => ({}), set: async () => {} }, sync: { get: async () => ({}) } } };
  const ctx = vm.createContext({ document, window, location, browser, console, Date, URL,
    setInterval, clearInterval, setTimeout, clearTimeout,
    history: { replaceState(_a, _b, url) { location.href = String(url); } },
    splitByRank: () => null, MarketAPI: { fetch: fetchImpl },
    VaultUtils: { createVaultResolver: () => resolve } });
  if (kind === 'content') {
    const code = source('content.js').replace(/\}\)\(\);\s*$/, `
      globalThis.hooks = { onNavigate, configure: (d, a, p, s, st) => {
        vaultData = d; renderChart = () => {}; fetchStats = async () => st;
        waitForAnchor = async () => a; fetchItemV2 = async slug => slug === p.slug ? p : null;
        loadSettings = async () => s;
      } };
    })();`);
    vm.runInContext(code, ctx);
    ctx.hooks.configure(data, anchor, part, settings, stats);
  } else {
    vm.runInContext(source('shared.js'), ctx);
    vm.runInContext(source('panel.js') + `
      globalThis.hooks = { loadItem, configure: (d, p, s, st) => {
        fetchStats = async () => st; fetchItemV2 = async slug => slug === p.slug ? p : null;
        loadVaultData = async () => d; getSettings = async () => s;
        getWatchlist = async () => ({}); trackRecentlyViewed = async () => {};
        renderSidebar = () => {}; drawChart = () => {};
      } };`, ctx);
    ctx.hooks.configure(data, part, settings, stats);
  }
  return { window, document, location, resolve, fetchImpl,
    async open(slug = part.slug) {
      if (kind === 'content') {
        location.pathname = `/items/${slug}`; location.href = `https://warframe.market${location.pathname}`;
        ctx.hooks.onNavigate(); await tick();
      } else { await ctx.hooks.loadItem(slug); await tick(); }
    },
    zone() { return kind === 'content' ? mounted?.querySelector('#wfm-ph-insights-zone') : document.getElementById('wfm-panel-insights-zone'); },
    detach() { mounted = null; },
  };
}

describe.each(['content', 'panel'])('%s live Vault refresh', kind => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-11-11T23:59:00Z')); });
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  test('rotation end is recalculated periodically using the membership cache', async () => {
    const h = harness(kind, makeData(fixed));
    await h.open();
    expect(h.zone().innerHTML).toContain('Prime Resurgence active');
    expect(h.fetchImpl).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(h.zone().innerHTML).toContain('Last recorded Resurgence');
    expect(h.zone().innerHTML).not.toContain('Prime Resurgence active');
    expect(h.fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('focus expires a snapshot immediately and ignores hidden timer ticks', async () => {
    const data = makeData({ start: '2026-11-01', end: '2026-12-13' });
    const h = harness(kind, data);
    await h.open();
    expect(h.zone().innerHTML).toContain('Prime Resurgence active');
    h.document.visibilityState = 'hidden';
    jest.setSystemTime(new Date('2026-12-12T00:00:01Z'));
    await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(h.zone().innerHTML).toContain('Prime Resurgence active');
    h.document.visibilityState = 'visible';
    h.window.emit('focus'); await tick();
    expect(h.zone().innerHTML).toContain('Vault data outdated');
  });

  test('open rotation becoming unverified removes the existing chip on visibility return', async () => {
    jest.setSystemTime(new Date('2026-11-13T23:59:00Z'));
    const h = harness(kind, makeData(open));
    await h.open();
    expect(h.zone().innerHTML).toContain('Prime Resurgence active');
    jest.setSystemTime(new Date('2026-11-14T00:00:01Z'));
    h.document.emit('visibilitychange'); await tick();
    expect(h.zone().innerHTML).not.toContain('Prime Resurgence active');
    expect(h.zone().innerHTML).not.toContain('Last recorded');
    expect(h.fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('a newer refresh wins if an older lookup completes after the rotation ended', async () => {
    let release;
    const pending = new Promise(r => { release = r; });
    const response = { ok: true, json: async () => ({ data: root }) };
    const fetch = jest.fn().mockImplementationOnce(() => pending).mockResolvedValue(response);
    const h = harness(kind, makeData(fixed), fetch);
    await h.open();
    jest.setSystemTime(new Date('2026-11-12T00:15:00Z'));
    h.window.emit('focus'); await tick();
    expect(h.zone().innerHTML).toContain('Last recorded Resurgence');
    release(response); await tick();
    expect(h.zone().innerHTML).toContain('Last recorded Resurgence');
    expect(h.zone().innerHTML).not.toContain('Prime Resurgence active');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('changing item disposes old listeners and timer; late old response cannot update the new view', async () => {
    let release;
    const pending = new Promise(r => { release = r; });
    const fetch = jest.fn(() => pending);
    const h = harness(kind, makeData(fixed), fetch);
    await h.open();
    expect(h.window.count('focus')).toBe(1);
    const oldZone = h.zone();
    await h.open('other_item');
    expect(h.window.count('focus')).toBe(1);
    expect(h.document.count('visibilitychange')).toBe(1);
    release({ ok: true, json: async () => ({ data: root }) }); await tick();
    expect(oldZone.innerHTML).not.toContain('Prime Resurgence active');
    expect(h.zone().innerHTML).not.toContain('Prime Resurgence active');
    await jest.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(h.window.count('resize')).toBe(1);
  });
});

test('content disposes widget listeners when the SPA detaches it without a URL change', async () => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-11-11T23:59:00Z'));
  try {
    const h = harness('content', makeData(fixed));
    await h.open();
    h.detach();
    await jest.advanceTimersByTimeAsync(300);
    expect(h.window.count('focus')).toBe(0);
    expect(h.window.count('resize')).toBe(0);
    expect(h.document.count('visibilitychange')).toBe(0);
    await jest.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(h.fetchImpl).toHaveBeenCalledTimes(1);
  } finally { jest.clearAllTimers(); jest.useRealTimers(); }
});
