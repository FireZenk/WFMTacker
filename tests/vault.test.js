const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { calcVaultStatus } = require('../vault-utils');

const at = value => new Date(value);
const archived = vaulted => ({ vaulted, events: [] });
const dataFor = entry => ({ ash_prime_set: entry });
const status = (entry, now = '2026-11-11T12:00:00Z', slug = 'ash_prime_set') =>
  calcVaultStatus(slug, dataFor(entry), at(now));

const active = { label: 'Prime Resurgence active', icon: '🔓' };
const locked = { icon: '🔒' };

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
    expect(context.VaultUtils.calcVaultStatus('ash_prime_set', dataFor(archived('2020-01-01')), '2026-01-01').icon).toBe('🔒');
  });
  test('loads the shared API before content and panel consumers', () => {
    const manifest = JSON.parse(read('manifest.json'));
    const scripts = manifest.content_scripts[0].js;
    expect(scripts.indexOf('vault-utils.js')).toBeGreaterThanOrEqual(0);
    expect(scripts.indexOf('vault-utils.js')).toBeLessThan(scripts.indexOf('content.js'));
    const html = read('panel.html');
    expect(html.indexOf('vault-utils.js')).toBeGreaterThanOrEqual(0);
    expect(html.indexOf('vault-utils.js')).toBeLessThan(html.indexOf('shared.js'));
    expect(read('content.js')).toContain('VaultUtils.calcVaultStatus');
    expect(read('shared.js')).toContain('VaultUtils.calcVaultStatus');
    expect(read('.github/workflows/release.yml').match(/cp background\.js content\.js rank-utils\.js vault-utils\.js/g)).toHaveLength(2);
  });
});
