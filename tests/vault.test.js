const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { calcVaultStatus, createVaultResolver: makeVaultResolver } = require('../vault-utils');
const createVaultResolver = fetch => makeVaultResolver(fetch, { wait: async () => {} });

const at = value => new Date(value);
const archived = vaulted => ({ vaulted, events: [] });
const dataFor = entry => ({ ash_prime_set: entry });
const status = (entry, now = '2026-11-11T12:00:00Z', slug = 'ash_prime_set') =>
  calcVaultStatus(slug, dataFor(entry), at(now));

const active = { label: 'Prime Resurgence active', icon: '🔓' };
const locked = { icon: '📜' };

describe('Prime set resolution', () => {
  const data = {
    ash_prime_set: archived('2020-01-01'),
    ash_prime_link_set: { availability: 'permanent', events: [] },
    kronen_prime_set: archived('2020-01-01'),
    venka_prime_set: archived('2020-01-01'),
    carrier_prime_set: archived('2020-01-01'),
    'metadata': { availability: 'permanent' },
  };
  test.each([
    'ash_prime_set', 'ash_prime_neuroptics_blueprint',
    'ash_prime_chain', 'carrier_prime_link_neuroptics',
    'kronen_prime_blade_blueprint', 'venka_prime_gauntlet',
    'ash_prime_a_new_unlisted_part',
  ])('resolves the set for %s without suffix lists', slug => {
    expect(calcVaultStatus(slug, data, at('2026-01-01'))).toMatchObject(locked);
  });
  test('uses the longest set base, including exact set slugs', () => {
    expect(calcVaultStatus('ash_prime_link_chain_blueprint', data, at('2026-01-01')).label).toBe('Permanently available');
    expect(calcVaultStatus('ash_prime_link_set', data, at('2026-01-01')).label).toBe('Permanently available');
    expect(calcVaultStatus('ash_prime_set', data, at('2026-01-01'))).toMatchObject(locked);
  });
  test.each(['unknown_prime_blueprint', 'ash_primeval_blueprint', 'ash_prime', 'metadata'])('does not infer a set for %s', slug => {
    expect(calcVaultStatus(slug, data, at('2026-01-01'))).toBeNull();
  });
  test('rejects missing inputs', () => {
    expect(calcVaultStatus(null, data)).toBeNull();
    expect(calcVaultStatus('ash_prime_set', null)).toBeNull();
  });
});

describe('availability and windows', () => {
  test('permanent availability needs no vaulted date', () => {
    expect(status({ availability: 'permanent', events: [] })).toMatchObject({
      label: 'Permanently available', icon: '🔓',
    });
  });
  test('permanent item in active Resurgence shows the rotation without exclusivity', () => {
    const result = status({ availability: 'permanent', events: [{ start: '2026-11-01', end: '2026-12-01' }] });
    expect(result).toMatchObject(active);
    expect(`${result.sub} ${result.tooltip}`).not.toMatch(/only|exclusive/i);
  });
  test('finds active event when a later future event is last', () => {
    expect(status({ vaulted: '2020-01-01', events: [
      { start: '2026-11-01', end: '2026-12-01' },
      { start: '2027-01-01', end: '2027-02-01' },
    ] })).toMatchObject(active);
  });
  test('the latest ended window wins regardless of array order or future windows', () => {
    const result = status({ vaulted: '2020-01-01', events: [
      { start: '2026-09-01', end: '2026-10-01' },
      { start: '2024-01-01', end: '2024-02-01' },
      { start: '2027-01-01', end: '2027-02-01' },
    ] });
    expect(result).toMatchObject(locked);
    expect(result.tooltip).toContain('October 2026');
  });
  test('uses inclusive start and exclusive end with UTC timestamps', () => {
    const entry = { vaulted: '2020-01-01', events: [{ start: '2026-11-11T12:00:00Z', end: '2026-11-12T12:00:00Z' }] };
    expect(status(entry, '2026-11-11T11:59:59Z')).toMatchObject(locked);
    expect(status(entry, '2026-11-11T12:00:00Z')).toMatchObject(active);
    expect(status(entry, '2026-11-12T11:59:59Z')).toMatchObject(active);
    expect(status(entry, '2026-11-12T12:00:00Z')).toMatchObject(locked);
  });
  test('historical events and vaulted dates before the Unix epoch are valid', () => {
    expect(status({ vaulted: '1960-01-01', events: [{ start: '1965-01-01', end: '1966-01-01' }] }, '1967-01-01')).toMatchObject(locked);
    expect(status({ vaulted: '1960-01-01', events: [{ start: '1965-01-01', end: '1966-01-01' }] }, '1965-03-01')).toMatchObject(active);
  });
  test.each([undefined, null, '', 'bad', '2026-02-30', '2027-01-01'])('does not assert vaulted for missing, invalid or future date %s', vaulted => {
    expect(status({ vaulted, events: [] })).toBeNull();
  });
  test('a historical event is not enough to assert vaulted without a valid vaulted date', () => {
    expect(status({ events: [{ start: '2025-01-01', end: '2025-02-01' }] })).toBeNull();
  });
  test('active event is sufficient even without a vaulted date', () => {
    expect(status({ events: [{ start: '2026-11-01', end: '2026-12-01' }] })).toMatchObject(active);
  });
  test('ignores malformed windows while using other valid data', () => {
    expect(status({ vaulted: '2020-01-01', events: [
      null, { start: 'bad', end: '2027-01-01' },
      { start: '2026-02-30', end: '2027-01-01' },
      { start: '2026-11-01', end: 'bad' },
      { start: '2026-11-01', end: '2026-10-01' },
      { start: '2026-11-11T12:00:00', end: '2026-12-01' },
    ] })).toMatchObject(locked);
  });
  test('invalid injected now cannot produce a state', () => {
    expect(calcVaultStatus('ash_prime_set', dataFor(archived('2020-01-01')), new Date('bad'))).toBeNull();
    expect(calcVaultStatus('ash_prime_set', dataFor(archived('2020-01-01')), null)).toBeNull();
  });
  test('uses the real clock by default and accepts a numeric or UTC string clock', () => {
    jest.useFakeTimers().setSystemTime(at('2026-11-11T12:00:00Z'));
    try {
      const entry = dataFor(archived('2020-01-01'));
      expect(calcVaultStatus('ash_prime_set', entry)).toMatchObject(locked);
      expect(calcVaultStatus('ash_prime_set', entry, Date.now())).toMatchObject(locked);
      expect(calcVaultStatus('ash_prime_set', entry, '2026-11-11T12:00:00Z')).toMatchObject(locked);
    } finally { jest.useRealTimers(); }
  });
});

describe('open-ended verified rotations', () => {
  const entry = { vaulted: '2020-01-01', events: [{ start: '2026-11-01', end: null, verifiedAt: '2026-11-11' }] };
  test('covers the verified day and 48 hours after the entire UTC day', () => {
    expect(status(entry, '2026-11-11T00:00:00Z')).toMatchObject(active);
    expect(status(entry, '2026-11-13T23:59:59.999Z')).toMatchObject(active);
    expect(status(entry, '2026-11-14T00:00:00Z')).toBeNull();
  });
  test('stale or unverified started windows do not claim vaulted', () => {
    expect(status(entry, '2026-12-01T00:00:00Z')).toBeNull();
    expect(status({ vaulted: '2020-01-01', events: [{ start: '2026-11-01', end: null }] })).toBeNull();
    expect(status({ vaulted: '2020-01-01', events: [{ start: '2026-11-01', end: null, verifiedAt: '2026-02-30' }] })).toBeNull();
    expect(status(entry, '2026-11-10T23:59:59Z')).toBeNull();
  });
  test('future open windows do not prevent a known archived state', () => {
    expect(status(entry, '2026-10-01')).toMatchObject(locked);
  });
  test('a separate confirmed active window wins over a stale open one', () => {
    expect(status({ ...entry, events: [...entry.events, { start: '2026-12-01', end: '2026-12-15' }] }, '2026-12-04')).toMatchObject(active);
  });
  test('permanent availability remains known after a stale open window', () => {
    expect(status({ ...entry, availability: 'permanent' }, '2026-12-01').label).toBe('Permanently available');
  });
});

describe('browser and release integration', () => {
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  test('exposes the shared browser API without CommonJS', () => {
    const context = vm.createContext({});
    vm.runInContext(read('vault-utils.js'), context);
    expect(typeof context.VaultUtils.calcVaultStatus).toBe('function');
    expect(context.VaultUtils.calcVaultStatus('ash_prime_set', dataFor(archived('2020-01-01')), '2026-01-01').icon).toBe('📜');
  });
  test('loads the shared API before content and panel consumers', () => {
    const manifest = JSON.parse(read('manifest.json'));
    const scripts = manifest.content_scripts[0].js;
    expect(scripts.indexOf('market-api.js')).toBeGreaterThanOrEqual(0);
    expect(scripts.indexOf('market-api.js')).toBeLessThan(scripts.indexOf('vault-utils.js'));
    expect(scripts.indexOf('vault-utils.js')).toBeGreaterThanOrEqual(0);
    expect(scripts.indexOf('vault-utils.js')).toBeLessThan(scripts.indexOf('content.js'));
    const html = read('panel.html');
    expect(html.indexOf('market-api.js')).toBeGreaterThanOrEqual(0);
    expect(html.indexOf('market-api.js')).toBeLessThan(html.indexOf('vault-utils.js'));
    expect(html.indexOf('vault-utils.js')).toBeGreaterThanOrEqual(0);
    expect(html.indexOf('vault-utils.js')).toBeLessThan(html.indexOf('shared.js'));
    expect(read('content.js')).toContain('VaultUtils.createVaultResolver');
    expect(read('shared.js')).toContain('VaultUtils.createVaultResolver');
    expect(read('.github/workflows/release.yml').match(/cp background\.js content\.js rank-utils\.js vault-utils\.js market-api\.js/g)).toHaveLength(2);
  });
});

describe('historical wording and data freshness', () => {
  const dated = entry => ({ _asOf: '2026-11-11', ...dataFor(entry) });
  test('historical events are explicitly incomplete and never advise trading', () => {
    const results = [
      status(archived('2020-01-01')),
      status({ vaulted: '2020-01-01', events: [{ start: '2021-01-01', end: '2021-02-01' }] }),
    ];
    for (const result of results) {
      expect(result.label).toMatch(/^Last recorded/);
      expect(result.cls).toBe('wfm-ph-ins-neutral');
      expect(result.tooltip).toMatch(/incomplete/i);
      expect(`${result.label} ${result.sub} ${result.tooltip}`).not.toMatch(/never|has not appeared|sell|buy|worth considering/i);
    }
    const current = status({ events: [{ start: '2026-11-01', end: '2026-12-01' }] });
    expect(current.cls).toBe('wfm-ph-ins-neutral');
    expect(current.tooltip).not.toMatch(/grab|buy|sell/i);
  });
  test.each([
    archived('2020-01-01'),
    { availability: 'permanent', events: [] },
    { events: [{ start: '2026-11-01', end: '2027-01-01' }] },
    { events: [{ start: '2026-11-01', end: null, verifiedAt: '2026-12-10' }] },
  ])('expires every status precisely after the full UTC day plus 30 days: %p', entry => {
    const before = calcVaultStatus('ash_prime_set', dated(entry), '2026-12-11T23:59:59.999Z');
    expect(before?.label).not.toBe('Vault data outdated');
    const result = calcVaultStatus('ash_prime_set', dated(entry), '2026-12-12T00:00:00Z');
    expect(result).toMatchObject({ label: 'Vault data outdated', cls: 'wfm-ph-ins-neutral' });
    expect(result.sub).toContain('2026-11-11');
    expect(result.tooltip).toMatch(/2026-11-11.*current availability is unknown/i);
    expect(`${result.label} ${result.sub} ${result.tooltip}`).not.toMatch(/sell|buy|available now|permanent/i);
  });
  test('missing _asOf retains fixture behavior; invalid or future _asOf is not trusted', () => {
    expect(calcVaultStatus('ash_prime_set', dataFor(archived('2020-01-01')), '2040-01-01')).toMatchObject(locked);
    for (const invalid of [null, '', 'bad', '2026-02-30', '2026-11-11T00:00:00Z', '2027-01-01']) {
      expect(calcVaultStatus('ash_prime_set', { _asOf: invalid, ...dataFor(archived('2020-01-01')) }, '2026-11-11T12:00:00Z')).toBeNull();
    }
  });
  test('end timestamps and offsets are compared to the exact instant', () => {
    const entry = { vaulted: '2020-01-01', events: [{ start: '2026-11-11T08:00:00-05:00', end: '2026-11-11T09:30:00-05:00' }] };
    expect(status(entry, '2026-11-11T12:59:59Z')).toMatchObject(locked);
    expect(status(entry, '2026-11-11T13:00:00Z')).toMatchObject(active);
    expect(status(entry, '2026-11-11T14:29:59.999Z')).toMatchObject(active);
    expect(status(entry, '2026-11-11T14:30:00Z')).toMatchObject(locked);
  });
});

describe('verified v2 set membership', () => {
  const data = {
    ash_prime_set: archived('2020-01-01'),
    kavasa_prime_kubrow_collar_set: archived('2020-01-01'),
  };
  const root = { id: 'root', slug: 'ash_prime_set', setRoot: true, setParts: ['root', 'part'] };
  const part = { id: 'part', slug: 'ash_prime_neuroptics_blueprint', setRoot: false, setParts: ['part', 'root'] };
  const time = '2026-11-11T12:00:00Z';
  const response = data => ({ ok: true, json: async () => ({ data }) });
  test('exact set is unambiguous and needs no extra request even if v2 is unavailable', async () => {
    const fetch = jest.fn();
    const resolve = createVaultResolver(fetch);
    expect(await resolve('ash_prime_set', data, null, time)).toMatchObject(locked);
    expect(fetch).not.toHaveBeenCalled();
    expect(await resolve('ash_prime_set', data, { ...root, setRoot: false }, time)).toBeNull();
  });
  test('uses the current injected clock after a deferred membership lookup, preserving explicit fixture time', async () => {
    const before = Date.parse('2026-11-11T11:59:59.999Z');
    const after = Date.parse('2026-11-11T12:00:00Z');
    const windowData = { ash_prime_set: { vaulted: '2020-01-01', events: [
      { start: '2026-11-01', end: '2026-11-11T12:00:00Z' },
    ] } };
    let current = before;
    const dateNow = jest.spyOn(Date, 'now').mockImplementation(() => current);
    try {
      let finish;
      const lookup = new Promise(resolve => { finish = resolve; });
      const fetch = jest.fn(() => lookup);
      const resolve = makeVaultResolver(fetch, { clock: () => current });
      const live = resolve(part.slug, windowData, part);
      const fixture = resolve(part.slug, windowData, part, before);
      await Promise.resolve();
      expect(fetch).toHaveBeenCalledTimes(1);
      current = after;
      finish(response(root));
      expect(await live).toMatchObject(locked);
      expect(await fixture).toMatchObject(active);
    } finally { dateNow.mockRestore(); }
  });
  test('the direct and ID-fallback paths use the injected clock and honor explicit invalid now', async () => {
    let current = Date.parse('2026-12-11T23:59:59.999Z');
    const freshData = { ...data, _asOf: '2026-11-11' };
    let finish;
    const lookup = new Promise(resolve => { finish = resolve; });
    const fetch = jest.fn(() => lookup);
    const resolve = makeVaultResolver(fetch, { clock: () => current });
    expect(await resolve(root.slug, freshData, root)).toMatchObject(locked);
    expect(await resolve(root.slug, freshData, null, null)).toBeNull();
    const nonPrefix = { ...part, slug: 'other_prime_part' };
    const pending = resolve(nonPrefix.slug, freshData, nonPrefix);
    await Promise.resolve();
    expect(fetch.mock.calls[0][0]).toMatch(/\/itemId\/root$/);
    current = Date.parse('2026-12-12T00:00:00Z');
    finish(response(root));
    expect(await pending).toMatchObject({ label: 'Vault data outdated' });
    expect(await resolve(root.slug, freshData, null)).toMatchObject({ label: 'Vault data outdated' });
  });
  test('aliases returned by the item lookup use their canonical slug and reciprocal membership', async () => {
    // The caller passes the response for its requested slug. These IDs and the
    // alias/canonical slugs match the live v2 ash_prime_neuroptics response.
    const ids = ['559daa9fe779897b3263c2c7', '559daaa7e779897b35d626c6',
      '559daab7e779897b3d86cb8f', '56783f24cbfa8f0432dd898f', '559daaafe779897b399db0fd'];
    const canonicalPart = { id: ids[2], slug: 'ash_prime_neuroptics_blueprint', setRoot: false, tags: ['prime'], setParts: ids };
    const canonicalRoot = { id: ids[3], slug: 'ash_prime_set', setRoot: true, setParts: ids };
    const fetch = jest.fn(async () => response(canonicalRoot));
    const resolve = createVaultResolver(fetch);
    expect(await resolve('ash_prime_neuroptics', data, canonicalPart, time)).toMatchObject(locked);
    expect(fetch.mock.calls[0][0]).toBe('https://api.warframe.market/v2/item/ash_prime_set');
    expect(await resolve('ash_prime_neuroptics', data, { ...canonicalPart, setParts: [ids[2]] }, time)).toBeNull();
    expect(await resolve('ash_prime_neuroptics', data, { ...canonicalPart, setParts: [ids[3]] }, time)).toBeNull();
  });
  test('canonical item identity, rather than the requested alias, selects a known set root', async () => {
    const fetch = jest.fn(async () => response(root));
    const resolve = createVaultResolver(fetch);
    // Simulate an API alias in a different slug family. Only the canonical
    // component should influence candidate selection and set membership.
    expect(await resolve('legacy_alias', data, part, time)).toMatchObject(locked);
    expect(fetch.mock.calls[0][0]).toMatch(/\/item\/ash_prime_set$/);
    expect(await resolve('legacy_alias', data, root, time)).toMatchObject(locked);
    expect(await resolve('ash_prime_set', data, { ...root, id: '' }, time)).toBeNull();
    expect(await resolve('ash_prime_set', data, { ...root, setParts: [] }, time)).toBeNull();
  });
  test('candidate root must contain the actual v2 item ID; cache reuses the request', async () => {
    const fetch = jest.fn(async () => response(root));
    const resolve = createVaultResolver(fetch);
    expect(await resolve(part.slug, data, part, time)).toMatchObject(locked);
    expect(await resolve(part.slug, data, part, time)).toMatchObject(locked);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('https://api.warframe.market/v2/item/ash_prime_set');
    expect(await resolve(part.slug, data, { ...part, id: 'unrelated' }, time)).toBeNull();
    expect(await resolve(part.slug, data, { ...part, slug: 'different' }, time)).toBeNull();
    expect(await resolve(part.slug, data, null, time)).toBeNull();
  });
  test.each([
    { ...root, slug: 'other_set' }, { ...root, setRoot: false }, { ...root, id: '' },
    { ...root, setParts: ['root'] }, { ...root, setParts: ['part'] },
    { ...root, id: 'unknown-root', setParts: ['unknown-root', 'part'] },
    { ...root, setParts: null }, null,
  ])('contradictory or malformed candidate %p never maps by prefix', async rootResult => {
    const resolve = createVaultResolver(jest.fn(async () => response(rootResult)));
    expect(await resolve(part.slug, data, part, time)).toBeNull();
  });
  test('Kavasa uses a single candidate, checked against real API-shaped IDs', async () => {
    const kavasa = { id: '56153730b66f836f9488bcce', slug: 'kavasa_prime_buckle', setRoot: false,
      setParts: ['56153734b66f836f976f5501', '56153730b66f836f9488bcce', '56783f24cbfa8f0432dd89a0'] };
    const kavasaRoot = { id: '56783f24cbfa8f0432dd89a0', slug: 'kavasa_prime_kubrow_collar_set', setRoot: true, setParts: kavasa.setParts };
    const fetch = jest.fn(async () => response(kavasaRoot));
    const resolve = createVaultResolver(fetch);
    expect(await resolve(kavasa.slug, data, kavasa, time)).toMatchObject(locked);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toMatch(/\/item\/kavasa_prime_kubrow_collar_set$/);
    expect(await resolve('kavasa_prime_fake', data, { ...kavasa, slug: 'kavasa_prime_fake', id: 'fake' }, time)).toBeNull();
  });
  test('fallback discovers a non-prefix root through the item membership IDs only', async () => {
    const different = { id: 'part', slug: 'something_prime_part', setRoot: false, setParts: ['part', 'other', 'root'] };
    const fetch = jest.fn(async url => response(url.endsWith('/root') ? root : { id: 'other', setRoot: false }));
    const resolve = createVaultResolver(fetch);
    expect(await resolve(different.slug, data, different, time)).toMatchObject(locked);
    expect(fetch.mock.calls.map(call => call[0])).toEqual([
      'https://api.warframe.market/v2/itemId/other', 'https://api.warframe.market/v2/itemId/root',
    ]);
  });
  test('unknown or failed requests never produce a state and can be retried', async () => {
    const fetch = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce(response(root));
    const resolve = createVaultResolver(fetch);
    expect(await resolve(part.slug, data, part, time)).toBeNull();
    expect(await resolve(part.slug, data, part, time)).toBeNull();
    expect(await resolve(part.slug, data, part, time)).toMatchObject(locked);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  test('fallback is bounded, deduplicated and stops on a failed lookup', async () => {
    const item = { slug: 'something_prime_part', id: 'part', setRoot: false,
      setParts: ['part', ...Array.from({ length: 20 }, (_, i) => `id${i}`), 'id0'] };
    const fetch = jest.fn(async url => response({ id: url.split('/').pop(), setRoot: false }));
    const resolve = createVaultResolver(fetch);
    expect(await resolve(item.slug, data, item, time)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(8);
    const fail = jest.fn(async () => { throw new Error('network'); });
    expect(await createVaultResolver(fail)(item.slug, data, item, time)).toBeNull();
    expect(fail).toHaveBeenCalledTimes(1);
  });
  test('delegates all member lookups to the injected fetch scheduler', async () => {
    const scheduledFetch = jest.fn(async url => response({ id: url.split('/').pop(), setRoot: false }));
    const resolve = makeVaultResolver(scheduledFetch);
    const item = { slug: 'unknown_prime_part', id: 'part', setRoot: false, setParts: ['part', 'a', 'b', 'c'] };
    await resolve(item.slug, data, item, time);
    expect(scheduledFetch).toHaveBeenCalledTimes(3);
  });
  test('verified component reflects freshness of the set data', async () => {
    const resolve = createVaultResolver(jest.fn(async () => response(root)));
    expect(await resolve(part.slug, { ...data, _asOf: '2026-11-11' }, part, '2026-12-12T00:00:00Z')).toMatchObject({ label: 'Vault data outdated' });
  });
});

describe('asynchronous UI integration', () => {
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const deferred = () => {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
  };
  const makeNode = () => ({
    innerHTML: '', dataset: {}, children: {}, classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, addEventListener() {}, remove() {},
    querySelector(key) { return this.children[key] ??= makeNode(); }, querySelectorAll() { return []; },
  });
  const fakeStatus = { label: 'Verified set result', sub: '— record', tooltip: 'History may be incomplete', icon: '📜', cls: 'wfm-ph-ins-neutral' };
  const stats = { closed: { '90days': [{ avg_price: 10 }], '48hours': [] } };
  const settings = { defaultRange: '90days', showVault: true, showArbitrage: false,
    showSignal: false, showVolatility: false, showLiquidity: false, showBestHour: false, showDucat: false, showForecast: false };

  function contentHarness() {
    let mounted = null;
    const location = { pathname: '/items/ash_prime_part', href: 'https://warframe.market/items/ash_prime_part' };
    const anchor = { tagName: 'MAIN', insertBefore(node) { mounted = node; } };
    const document = { readyState: 'loading', addEventListener() {},
      createElement: makeNode, getElementById(id) { return id === 'wfm-ph-widget' ? mounted : null; } };
    const ctx = vm.createContext({ document, location, window: { addEventListener() {} },
      splitByRank: () => null, setInterval() {}, setTimeout() {}, console,
      browser: { runtime: { sendMessage: async () => ({}), getManifest: () => ({ version: '1' }) } },
      MarketAPI: { fetch: () => {} }, VaultUtils: { createVaultResolver: () => async () => fakeStatus } });
    const source = read('content.js').replace(/\}\)\(\);\s*$/, `
      globalThis.hooks = { buildWidget, injectWidget,
        setNavigation: () => { navigationId++; },
        configure: (pending, el) => { vaultData = {}; renderChart = () => {};
          fetchStats = () => pending; waitForAnchor = async () => el;
          fetchItemV2 = async () => null; loadSettings = async () => (${JSON.stringify(settings)}); }
      };
    })();`);
    vm.runInContext(source, ctx);
    return { ...ctx.hooks, anchor, location, mount: node => { mounted = node; }, mounted: () => mounted };
  }
  test('content builds before resolution, updates only the mounted matching widget', async () => {
    const h = contentHarness();
    h.configure(Promise.resolve(stats), h.anchor);
    const d = deferred();
    const widget = h.buildWidget('ash_prime_part', stats, null, settings, null, d.promise);
    h.mount(widget);
    expect(widget.innerHTML).not.toContain('Verified set result');
    d.resolve(fakeStatus);
    await d.promise; await Promise.resolve();
    expect(widget.querySelector('#wfm-ph-insights-zone').innerHTML).toContain('Verified set result');

    const late = deferred();
    const old = h.buildWidget('ash_prime_part', stats, null, settings, null, late.promise);
    h.mount(makeNode()); // including navigation away and back to the same slug
    late.resolve(fakeStatus);
    await late.promise; await Promise.resolve();
    expect(old.querySelector('#wfm-ph-insights-zone').innerHTML).toBe('');
  });
  test('content rejects an old initial load even if navigation returns to the same slug', async () => {
    const h = contentHarness();
    const pending = deferred();
    h.configure(pending.promise, h.anchor);
    const request = h.injectWidget('ash_prime_part');
    h.setNavigation();
    pending.resolve(stats);
    await request;
    expect(h.mounted()).toBeNull();
  });
  test.each([false, true])('panel renders before membership resolves; navigation=%s', async navigate => {
    const pending = deferred();
    const nodes = {};
    const get = id => nodes[id] ??= makeNode();
    const document = { addEventListener() {}, getElementById: get };
    const ctx = vm.createContext({ document, window: { addEventListener() {} }, console,
      browser: {}, splitByRank: () => null,
      MarketAPI: { fetch: () => {} }, VaultUtils: { createVaultResolver: () => () => pending.promise },
    });
    vm.runInContext(read('shared.js'), ctx);
    vm.runInContext(read('panel.js') + `
      globalThis.hooks = { renderItem,
        prepare: () => { currentSlug = 'ash_prime_part'; navigationId = 1;
          getWatchlist = async () => ({}); trackRecentlyViewed = async () => {};
          renderSidebar = () => {}; drawChart = () => {}; },
        navigate: () => { currentSlug = 'other'; navigationId++; },
      };`, ctx);
    ctx.hooks.prepare();
    await ctx.hooks.renderItem('ash_prime_part', stats, null, {}, settings, null, 1);
    expect(get('wfm-panel-content').innerHTML).toContain('wfm-panel-insights-zone');
    expect(get('wfm-panel-insights-zone').innerHTML).toBe('');
    if (navigate) ctx.hooks.navigate();
    pending.resolve(fakeStatus);
    await pending.promise; await Promise.resolve(); await Promise.resolve();
    if (navigate) expect(get('wfm-panel-insights-zone').innerHTML).toBe('');
    else expect(get('wfm-panel-insights-zone').innerHTML).toContain('Verified set result');
  });
});
