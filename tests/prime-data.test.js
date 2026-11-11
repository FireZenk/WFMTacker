const data = require('../vault-data.json');
const { calcVaultStatus } = require('../vault-utils');

// The checked-in file is a snapshot, not an exhaustive history. These are
// positive, sourced assertions from docs/prime-data-sources.md, plus explicitly
// identified corrections; an absent window is not proof of unavailability.
const keyFor = name => `${name}_prime_set`;
const instant = value => Date.parse(value);
const active = 'Prime Resurgence active';
const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
const utcDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

function validDate(value, dateOnlyRequired = false) {
  if (typeof value !== 'string' || !(dateOnly.test(value) || (!dateOnlyRequired && utcDateTime.test(value)))) return false;
  const ms = instant(value);
  if (!Number.isFinite(ms)) return false;
  const canonical = new Date(ms).toISOString();
  return dateOnly.test(value) ? canonical.slice(0, 10) === value : canonical === value.replace('Z', '.000Z');
}

function eventFor(slug, start, end) {
  expect(data[slug]).toBeDefined();
  const matches = data[slug].events.filter(event => event.start === start && event.end === end);
  expect(matches).toHaveLength(1);
  return matches[0];
}

// Exercise the real recorded window in isolation: a separate legacy or special
// event may also be active, and historical queries predate the snapshot's _asOf.
function isolatedStatus(slug, event, now) {
  return calcVaultStatus(slug, { [slug]: { ...data[slug], events: [event] } }, now);
}

function expectClosedWindow(slug, start, end) {
  const event = eventFor(slug, start, end);
  const beforeStart = instant(start) - 1;
  const atStart = instant(start);
  const beforeEnd = instant(end) - 1;
  const atEnd = instant(end);
  expect(isolatedStatus(slug, event, beforeStart)?.label).not.toBe(active);
  expect(isolatedStatus(slug, event, atStart)?.label).toBe(active);
  expect(isolatedStatus(slug, event, beforeEnd)?.label).toBe(active);
  expect(isolatedStatus(slug, event, atEnd)?.label).not.toBe(active);
}

describe('checked-in Prime data schema', () => {
  test('snapshot date is a real UTC date', () => {
    expect(validDate(data._asOf, true)).toBe(true);
    expect(typeof data._comment).toBe('string');
  });

  test('has 141 correctly shaped set records and valid chronological windows', () => {
    const entries = Object.entries(data).filter(([key]) => !key.startsWith('_'));
    expect(entries).toHaveLength(141);
    for (const [slug, entry] of entries) {
      expect(slug).toMatch(/^[a-z0-9]+(?:_[a-z0-9]+)*_prime_(?:[a-z0-9]+_)*set$/);
      expect(entry).toEqual(expect.any(Object));
      expect(Object.keys(entry).sort()).toEqual(
        entry.availability === 'permanent' ? ['availability', 'events'] : ['events', 'vaulted'],
      );
      if (entry.availability !== 'permanent') expect(validDate(entry.vaulted, true)).toBe(true);
      expect(Array.isArray(entry.events)).toBe(true);
      const seen = new Set();
      for (const event of entry.events) {
        expect(event).toEqual(expect.any(Object));
        expect(validDate(event.start)).toBe(true);
        if (event.end === null) {
          expect(Object.keys(event).sort()).toEqual(['end', 'start', 'verifiedAt']);
          expect(validDate(event.verifiedAt, true)).toBe(true);
          expect(instant(event.verifiedAt) + 86400000).toBeGreaterThan(instant(event.start));
          expect(instant(event.verifiedAt)).toBeLessThanOrEqual(instant(data._asOf));
        } else {
          expect(Object.keys(event).sort()).toEqual(['end', 'start']);
          expect(validDate(event.end)).toBe(true);
          expect(instant(event.end)).toBeGreaterThan(instant(event.start));
        }
        const identity = `${event.start}/${event.end}`;
        expect(seen.has(identity)).toBe(false);
        seen.add(identity);
      }
      // Do not require every event to follow the first vault date: the legacy
      // data also contains pre-vault offerings and is not exhaustively audited.
    }
  });
});

const rotations = [
  ['2026-04-16T18:00:00Z', '2026-05-14T18:00:00Z', ['gauss', 'acceltra', 'akarius', 'grendel', 'masseter', 'zylok']],
  ['2026-05-14T18:00:00Z', '2026-06-11T18:00:00Z', ['rhino', 'ankyros', 'boltor', 'nyx', 'hikou', 'scindo']],
  ['2026-06-11T18:00:00Z', '2026-07-09T18:00:00Z', ['equinox', 'stradavar', 'tipedo', 'wukong', 'ninkondi', 'zhuge']],
  ['2026-07-09T18:00:00Z', '2026-08-06T18:00:00Z', ['gara', 'astilla', 'volnus', 'titania', 'corinth', 'pangolin']],
  ['2026-08-06T18:00:00Z', '2026-09-03T18:00:00Z', ['baruuk', 'afuris', 'cobra_and_crane', 'revenant', 'phantasma', 'tatsu']],
  ['2026-09-03T18:00:00Z', '2026-10-01T18:00:00Z', ['banshee', 'euphona', 'helios', 'mirage', 'akbolto', 'kogake']],
  ['2026-10-01T18:00:00Z', '2026-10-29T18:00:00Z', ['ivara', 'aksomati', 'baza', 'protea', 'okina', 'velox']],
];
const openSets = ['nidus', 'strun', 'magnus', 'saryn', 'spira', 'nikana'];

describe('2026 Resurgence rotations documented by DE and the wiki', () => {
  test('covers seven closed rotations and the six distinct sets of the eighth', () => {
    expect(rotations).toHaveLength(7);
    expect(openSets).toHaveLength(6);
    expect(new Set(openSets).size).toBe(6);
  });

  test.each(rotations)('%s to %s: six sets have inclusive start and exclusive end', (start, end, names) => {
    expect(names).toHaveLength(6);
    expect(new Set(names).size).toBe(6);
    for (const name of names) expectClosedWindow(keyFor(name), start, end);
  });

  test.each(openSets)('%s belongs to the open October rotation with a dated observation', name => {
    const slug = keyFor(name);
    const event = eventFor(slug, '2026-10-29T18:00:00Z', null);
    expect(event.verifiedAt).toBe('2026-11-11');
    expect(calcVaultStatus(slug, data, '2026-11-11T12:00:00Z')?.label).toBe(active);
    // After the verification grace period, an unknown end must not turn into
    // a confident archived/vaulted state.
    expect(calcVaultStatus(slug, data, '2026-11-14T00:00:00Z')).toBeNull();
  });
});

describe('vault dates and permanent alternatives', () => {
  test.each([
    ['sevagoth', '2026-06-17'], ['epitaph', '2026-06-17'], ['nautilus', '2026-06-17'],
    ['xaku', '2026-09-23'], ['quassus', '2026-09-23'], ['trumna', '2026-09-23'],
    ['magnus', '2023-07-27'],
  ])('%s was initially vaulted on %s', (name, date) => {
    expect(data[keyFor(name)].vaulted).toBe(date);
  });

  test('Magnus cannot have a Resurgence event before its 2021-09-08 introduction', () => {
    for (const event of data.magnus_prime_set.events) {
      expect(instant(event.start)).toBeGreaterThanOrEqual(instant('2021-09-08'));
    }
  });

  test.each(['nyx', 'hikou', 'scindo', 'valkyr', 'cernos', 'venka'])(
    '%s remains permanently available outside Resurgence', name => {
      const slug = keyFor(name);
      expect(data[slug].availability).toBe('permanent');
      expect(data[slug]).not.toHaveProperty('vaulted');
      expect(calcVaultStatus(slug, data, '2026-11-11T12:00:00Z')?.label).toBe('Permanently available');
      // Isolate the permanent source rather than claiming there are no other rotations.
      expect(calcVaultStatus(slug, { [slug]: { ...data[slug], events: [] } }, '2026-11-11T12:00:00Z')?.label)
        .toBe('Permanently available');
    },
  );

  test.each(['citrine', 'steflos', 'corufell', 'styanax', 'afentis', 'athodai'])(
    '%s is not asserted vaulted without evidence', name => {
      const slug = keyFor(name);
      expect(data[slug]?.vaulted).toBeUndefined();
      expect(calcVaultStatus(slug, data, '2026-11-11T12:00:00Z')?.label || '').not.toMatch(/^Last recorded vaulting/);
    },
  );
});

describe('February and March 2026 corrections', () => {
  test.each(['atlas', 'tekko', 'dethcube', 'vauban', 'akstiletto', 'fragor'])(
    '%s has the February–March date-precision rotation', name => {
      expectClosedWindow(keyFor(name), '2026-02-19', '2026-03-19');
    },
  );
  test.each(['nova_prime_set', 'soma_prime_set', 'vasto_prime_set', 'trinity_prime_set', 'dual_kamas_prime_set', 'kavasa_prime_kubrow_collar_set'])(
    '%s has the March–April date-precision rotation', slug => {
      expectClosedWindow(slug, '2026-03-19', '2026-04-16');
    },
  );
  test.each(['nova', 'soma', 'vasto'])('%s does not retain the mistaken February–March window', name => {
    expect(data[keyFor(name)].events.some(event =>
      event.start.slice(0, 10) === '2026-02-12' && event.end?.slice(0, 10) === '2026-03-19')).toBe(false);
  });
  test.each(openSets)('%s does not retain the mistaken March–April window', name => {
    expect(data[keyFor(name)].events.some(event =>
      event.start.slice(0, 10) === '2026-03-19' && event.end?.slice(0, 10) === '2026-04-16')).toBe(false);
  });
});
