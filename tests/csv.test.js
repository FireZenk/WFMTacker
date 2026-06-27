const { parseCSV, csvToWatchlist } = require('../rank-utils');

describe('parseCSV — quoted fields and edge cases', () => {
  test('parses a simple two-row CSV', () => {
    expect(parseCSV('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  test('handles commas inside quoted fields', () => {
    expect(parseCSV('name,note\n"Frost Prime","cheap, buy now"')).toEqual([
      ['name', 'note'],
      ['Frost Prime', 'cheap, buy now'],
    ]);
  });

  test('handles escaped quotes ("") inside a field', () => {
    expect(parseCSV('note\n"he said ""hi"""')).toEqual([
      ['note'],
      ['he said "hi"'],
    ]);
  });

  test('handles newlines inside quoted fields', () => {
    expect(parseCSV('note\n"line1\nline2"')).toEqual([
      ['note'],
      ['line1\nline2'],
    ]);
  });

  test('normalises CRLF and ignores a trailing newline', () => {
    expect(parseCSV('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  test('returns [] for empty input', () => {
    expect(parseCSV('')).toEqual([]);
  });
});

describe('csvToWatchlist — round-trip from export format', () => {
  const header = 'name,slug,last_price,price_at_add,added_at,alert_below,alert_above,rank,note';

  test('maps every column to the watchlist item shape', () => {
    const csv = `${header}\nFrost Prime Set,frost_prime_set,120,100,2026-01-15,90,150,5,my note`;
    const list = csvToWatchlist(csv);
    expect(list.frost_prime_set).toEqual({
      name: 'Frost Prime Set',
      slug: 'frost_prime_set',
      addedAt: Date.parse('2026-01-15'),
      priceAtAdd: 100,
      lastPrice: 120,
      lastChecked: expect.any(Number),
      alert: { below: 90, above: 150 },
      rank: 5,
      note: 'my note',
    });
  });

  test('column order is irrelevant (header-driven)', () => {
    const csv = 'slug,name,rank\narcane_energize,Arcane Energize,3';
    const list = csvToWatchlist(csv);
    expect(list.arcane_energize.name).toBe('Arcane Energize');
    expect(list.arcane_energize.rank).toBe(3);
  });

  test('empty numeric cells become null, not 0', () => {
    const csv = `${header}\nMag Prime,mag_prime,,,,,,,`;
    const item = csvToWatchlist(csv).mag_prime;
    expect(item.lastPrice).toBeNull();
    expect(item.priceAtAdd).toBeNull();
    expect(item.alert).toEqual({ below: null, above: null });
    expect(item.rank).toBeNull();
    expect(item.note).toBe('');
  });

  test('rank=0 (Unranked) is preserved, not coerced to null', () => {
    const csv = `${header}\nArcane Agility,arcane_agility,10,10,2026-01-01,,,0,`;
    expect(csvToWatchlist(csv).arcane_agility.rank).toBe(0);
  });

  test('rows without a slug are skipped', () => {
    const csv = `${header}\nNo Slug,,10,10,,,,,`;
    expect(csvToWatchlist(csv)).toEqual({});
  });

  test('falls back to a valid addedAt when the date is missing/garbage', () => {
    const csv = `${header}\nLoki Prime,loki_prime,50,50,not-a-date,,,,`;
    const before = Date.now();
    const item = csvToWatchlist(csv).loki_prime;
    expect(item.addedAt).toBeGreaterThanOrEqual(before);
  });

  test('returns {} when there is no slug column', () => {
    expect(csvToWatchlist('name,price\nFoo,10')).toEqual({});
  });

  test('returns {} for header-only or empty input', () => {
    expect(csvToWatchlist(header)).toEqual({});
    expect(csvToWatchlist('')).toEqual({});
  });

  test('note containing commas survives the round-trip', () => {
    const csv = `${header}\nNova Prime,nova_prime,30,30,2026-01-01,,,,"sell high, buy low"`;
    expect(csvToWatchlist(csv).nova_prime.note).toBe('sell high, buy low');
  });
});
