const { shouldNotify } = require('../background');

describe('shouldNotify — below threshold', () => {
  test('fires when price crosses below threshold', () => {
    expect(shouldNotify(90, 15, { below: 20 })).toBe('below');
  });

  test('fires on exact threshold crossing (prev above, now equal)', () => {
    expect(shouldNotify(21, 20, { below: 20 })).toBe('below');
  });

  test('does NOT re-fire when price was already below threshold', () => {
    expect(shouldNotify(15, 10, { below: 20 })).toBeNull();
  });

  test('does NOT fire when price stays above threshold', () => {
    expect(shouldNotify(90, 80, { below: 20 })).toBeNull();
  });

  test('fires on first check (no prevPrice) when price is below threshold', () => {
    expect(shouldNotify(null, 15, { below: 20 })).toBe('below');
  });

  test('does NOT fire on first check (no prevPrice) when price is above threshold', () => {
    expect(shouldNotify(null, 90, { below: 20 })).toBeNull();
  });
});

describe('shouldNotify — above threshold', () => {
  test('fires when price crosses above threshold', () => {
    expect(shouldNotify(10, 30, { above: 20 })).toBe('above');
  });

  test('fires on exact threshold crossing (prev below, now equal)', () => {
    expect(shouldNotify(19, 20, { above: 20 })).toBe('above');
  });

  test('does NOT re-fire when price was already above threshold', () => {
    // Original bug: above=20, prevPrice=90, newPrice=90 → should NOT fire
    expect(shouldNotify(90, 90, { above: 20 })).toBeNull();
  });

  test('does NOT re-fire when price rises further above threshold', () => {
    expect(shouldNotify(30, 35, { above: 20 })).toBeNull();
  });

  test('does NOT fire when price stays below threshold', () => {
    expect(shouldNotify(10, 15, { above: 20 })).toBeNull();
  });

  test('fires on first check (no prevPrice) when price is above threshold', () => {
    expect(shouldNotify(null, 30, { above: 20 })).toBe('above');
  });

  test('does NOT fire on first check (no prevPrice) when price is below threshold', () => {
    expect(shouldNotify(null, 10, { above: 20 })).toBeNull();
  });
});

describe('shouldNotify — no alert / edge cases', () => {
  test('returns null when alert is null', () => {
    expect(shouldNotify(90, 15, null)).toBeNull();
  });

  test('returns null when alert is undefined', () => {
    expect(shouldNotify(90, 15, undefined)).toBeNull();
  });

  test('returns null when alert has no thresholds set', () => {
    expect(shouldNotify(90, 15, { below: null, above: null })).toBeNull();
  });

  test('returns null when alert.below is 0 (falsy)', () => {
    expect(shouldNotify(90, 15, { below: 0 })).toBeNull();
  });

  test('only below fires when both set and price crosses below', () => {
    expect(shouldNotify(90, 5, { below: 10, above: 100 })).toBe('below');
  });

  test('only above fires when both set and price crosses above', () => {
    expect(shouldNotify(90, 110, { below: 10, above: 100 })).toBe('above');
  });
});
