const { createScheduler } = require('../market-api');

const url = name => `https://api.warframe.market/v2/${name}`;
const response = (status = 200, retryAfter = null) => ({
  ok: status === 200, status, headers: { get: name => name.toLowerCase() === 'retry-after' ? retryAfter : null },
});
function setup(impl = async () => response()) {
  let now = 1000;
  const starts = [], waits = [];
  const fetchImpl = jest.fn((...args) => { starts.push([args[0], now]); return impl(...args); });
  const fetch = createScheduler({ fetchImpl, clock: () => now, wait: async ms => { waits.push(ms); now += ms; } });
  return { fetch, fetchImpl, starts, waits, advance: ms => { now += ms; } };
}

describe('per-view market scheduler', () => {
  test('starts WFM requests in submission order at least 500ms apart', async () => {
    const h = setup();
    await Promise.all(['a', 'b', 'c', 'd'].map(n => h.fetch(url(n))));
    expect(h.starts).toEqual([['a', 1000], ['b', 1500], ['c', 2000], ['d', 2500]].map(([s, t]) => [url(s), t]));
    expect(h.waits).toEqual([500, 500, 500]);
  });

  test('does not enqueue extension and other host requests', async () => {
    let release;
    const blocked = new Promise(resolve => { release = resolve; });
    const h = setup(input => input === url('a') ? blocked : Promise.resolve(response()));
    const first = h.fetch(url('a'));
    await Promise.resolve();
    await h.fetch('chrome-extension://id/vault-data.json');
    await h.fetch('https://warframe.market.attacker.example/test');
    expect(h.starts.map(x => x[0])).toEqual([url('a'), 'chrome-extension://id/vault-data.json', 'https://warframe.market.attacker.example/test']);
    release(response());
    await first;
  });

  test('network errors reach caller without blocking queued requests; non-429 is not retried', async () => {
    const h = setup(async input => { if (input === url('bad')) throw new Error('offline'); return response(503); });
    const bad = h.fetch(url('bad'));
    const next = h.fetch(url('next'));
    await expect(bad).rejects.toThrow('offline');
    expect((await next).status).toBe(503);
    expect(h.starts).toEqual([[url('bad'), 1000], [url('next'), 1500]]);
  });

  test.each([
    ['2', 2000], ['garbage', 500], ['-1', 500], ['', 500], ['0', 500],
    [new Date(9000).toUTCString(), 8000],
  ])('429 Retry-After %s waits %i before one retry', async (header, delay) => {
    let attempt = 0;
    const h = setup(async () => ++attempt === 1 ? response(429, header)
      : attempt === 2 ? response(429, '1') : response());
    expect((await h.fetch(url('first'))).status).toBe(429);
    expect(h.starts).toEqual([[url('first'), 1000], [url('first'), 1000 + delay]]);
    expect((await h.fetch(url('queued'))).status).toBe(429);
    expect(h.starts).toHaveLength(2);
    h.advance(1000);
    expect((await h.fetch(url('after'))).status).toBe(200);
    expect(h.starts[2][1]).toBe(2000 + delay);
  });

  test.each(['60', new Date(61000).toUTCString()])(
    'long Retry-After %s returns 429 without retry and blocks all queued requests for the full cooldown', async header => {
      let attempt = 0;
      const h = setup(async () => ++attempt === 1 ? response(429, header) : response());
      const first = h.fetch(url('first'));
      const queued1 = h.fetch(url('queued1'));
      const queued2 = h.fetch(url('queued2'));
      expect((await first).status).toBe(429);
      expect((await queued1).status).toBe(429);
      expect((await queued2).status).toBe(429);
      expect(h.starts).toEqual([[url('first'), 1000]]);
      expect(h.waits).toEqual([]);
      h.advance(59999);
      expect((await h.fetch(url('early'))).status).toBe(429);
      expect(h.starts).toHaveLength(1);
      h.advance(1);
      expect((await h.fetch(url('after'))).status).toBe(200);
      expect(h.starts).toEqual([[url('first'), 1000], [url('after'), 61000]]);
    },
  );

  test('never retries a delay over ten seconds even if the configured limit is higher', async () => {
    let now = 1000;
    const fetchImpl = jest.fn().mockResolvedValue(response(429, '60'));
    const wait = jest.fn(async ms => { now += ms; });
    const fetch = createScheduler({ fetchImpl, clock: () => now, wait, maxRetryDelay: 120000 });
    expect((await fetch(url('first'))).status).toBe(429);
    expect((await fetch(url('next'))).status).toBe(429);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  test('an enormous Retry-After is not shortened by numeric overflow', async () => {
    const h = setup(async () => response(429, '9'.repeat(400)));
    expect((await h.fetch(url('first'))).status).toBe(429);
    h.advance(1e15);
    expect((await h.fetch(url('later'))).status).toBe(429);
    expect(h.starts).toHaveLength(1);
  });

  test('a second 429 establishes its own cooldown for the rest of the queue', async () => {
    let attempt = 0;
    const h = setup(async () => ++attempt === 1 ? response(429, '1')
      : attempt === 2 ? response(429, '60') : response());
    const first = h.fetch(url('first'));
    const queued = h.fetch(url('queued'));
    expect((await first).status).toBe(429);
    expect((await queued).status).toBe(429);
    expect(h.starts).toEqual([[url('first'), 1000], [url('first'), 2000]]);
    h.advance(59999);
    expect((await h.fetch(url('early'))).status).toBe(429);
    expect(h.starts).toHaveLength(2);
    h.advance(1);
    expect((await h.fetch(url('after'))).status).toBe(200);
    expect(h.starts[2]).toEqual([url('after'), 62000]);
  });

  test('cooldown responses are independent clones with usable bodies', async () => {
    const original = new Response('rate limited', { status: 429, headers: { 'Retry-After': '60' } });
    const h = setup(async () => original);
    const first = await h.fetch(url('first'));
    expect(await first.text()).toBe('rate limited');
    const queued = await h.fetch(url('queued'));
    const next = await h.fetch(url('next'));
    expect(await queued.text()).toBe('rate limited');
    expect(await next.text()).toBe('rate limited');
    expect(queued.headers.get('Retry-After')).toBe('60');
    expect(h.starts).toHaveLength(1);
  });

  test('a failed retry propagates its error and releases the queue', async () => {
    let attempt = 0;
    const h = setup(async input => {
      if (input === url('a') && ++attempt === 1) return response(429, '1');
      if (input === url('a')) throw new Error('retry failed');
      return response();
    });
    const first = h.fetch(url('a'));
    const next = h.fetch(url('b'));
    await expect(first).rejects.toThrow('retry failed');
    expect((await next).status).toBe(200);
    expect(h.starts).toEqual([[url('a'), 1000], [url('a'), 2000], [url('b'), 2500]]);
  });

  test('a successful 429 retry preserves arguments and response', async () => {
    let attempt = 0;
    const h = setup(async () => ++attempt === 1 ? response(429, '1') : response());
    const options = { headers: { Language: 'en' } };
    expect((await h.fetch(url('a'), options)).status).toBe(200);
    expect(h.fetchImpl).toHaveBeenCalledTimes(2);
    const [retryInput, retryOptions] = h.fetchImpl.mock.calls[1];
    expect(retryInput).toBe(url('a'));
    expect(retryOptions.headers).toBe(options.headers);
    expect(retryOptions.signal).toBeInstanceOf(AbortSignal);
    expect(options).toEqual({ headers: { Language: 'en' } });
  });
});

describe('scheduled WFM fetch timeouts and cancellation', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('times out after 15 seconds, aborts the fetch and releases the queue even if fetch ignores abort', async () => {
    let firstSignal;
    const fetchImpl = jest.fn((input, init) => {
      if (input === url('hang')) {
        firstSignal = init.signal;
        return new Promise(() => {});
      }
      return Promise.resolve(response());
    });
    const fetch = createScheduler({ fetchImpl });
    const first = fetch(url('hang')).catch(error => error);
    const second = fetch(url('next'));
    await jest.advanceTimersByTimeAsync(0);
    expect(firstSignal.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(14999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(firstSignal.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(await first).toMatchObject({ name: 'TimeoutError' });
    expect(firstSignal.aborted).toBe(true);
    expect((await second).status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('forwards a caller abort, preserves its reason and cleans up even if fetch ignores it', async () => {
    const controller = new AbortController();
    const reason = new Error('cancelled by caller');
    const removeListener = jest.spyOn(controller.signal, 'removeEventListener');
    let innerSignal;
    const fetch = createScheduler({ fetchImpl: jest.fn((input, init) => {
      innerSignal = init.signal;
      return new Promise(() => {});
    }) });
    const pending = fetch(url('hang'), { signal: controller.signal }).catch(error => error);
    await jest.advanceTimersByTimeAsync(0);
    controller.abort(reason);
    expect(await pending).toBe(reason);
    expect(innerSignal.aborted).toBe(true);
    expect(innerSignal.reason).toBe(reason);
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(jest.getTimerCount()).toBe(0);
  });

  test('does not start a fetch if the caller signal was already aborted', async () => {
    const controller = new AbortController();
    const reason = new Error('already cancelled');
    controller.abort(reason);
    const fetchImpl = jest.fn();
    const fetch = createScheduler({ fetchImpl });
    await expect(fetch(url('a'), { signal: controller.signal })).rejects.toBe(reason);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('follows a signal from a Request input, unless init explicitly overrides it', async () => {
    const controller = new AbortController();
    const request = new Request(url('a'), { signal: controller.signal });
    const fetchImpl = jest.fn(() => new Promise(() => {}));
    const fetch = createScheduler({ fetchImpl });
    const pending = fetch(request).catch(error => error);
    await jest.advanceTimersByTimeAsync(0);
    const reason = new Error('request cancelled');
    controller.abort(reason);
    expect(await pending).toBe(reason);
    expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);

    const overridden = new AbortController();
    const secondRequest = new Request(url('b'), { signal: overridden.signal });
    const next = fetch(secondRequest, { signal: null }).catch(error => error);
    await jest.advanceTimersByTimeAsync(500);
    overridden.abort(reason);
    await jest.advanceTimersByTimeAsync(14999);
    expect(fetchImpl.mock.calls[1][1].signal.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(await next).toMatchObject({ name: 'TimeoutError' });
    expect(jest.getTimerCount()).toBe(0);
  });

  test('times out and releases the queue without AbortController', async () => {
    const original = global.AbortController;
    try {
      global.AbortController = undefined;
      const fetchImpl = jest.fn(input => input === url('hang') ? new Promise(() => {}) : Promise.resolve(response()));
      const fetch = createScheduler({ fetchImpl });
      const pending = fetch(url('hang')).catch(error => error);
      const next = fetch(url('next'));
      await jest.advanceTimersByTimeAsync(15000);
      expect(await pending).toMatchObject({ name: 'TimeoutError' });
      expect((await next).status).toBe(200);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      global.AbortController = original;
    }
  });

  test('clears timeout and caller listener on success and network error', async () => {
    const controller = new AbortController();
    const addListener = jest.spyOn(controller.signal, 'addEventListener');
    const removeListener = jest.spyOn(controller.signal, 'removeEventListener');
    const fetchImpl = jest.fn().mockResolvedValueOnce(response()).mockRejectedValueOnce(new Error('offline'));
    const fetch = createScheduler({ fetchImpl });
    const first = fetch(url('a'), { signal: controller.signal });
    await jest.advanceTimersByTimeAsync(0);
    await first;
    expect(jest.getTimerCount()).toBe(0);
    const second = fetch(url('b'), { signal: controller.signal }).catch(error => error);
    await jest.advanceTimersByTimeAsync(500);
    expect(await second).toEqual(new Error('offline'));
    for (const [type, listener] of addListener.mock.calls) {
      expect(removeListener).toHaveBeenCalledWith(type, listener);
    }
    expect(jest.getTimerCount()).toBe(0);
  });

  test('applies a fresh timeout to a 429 retry and then releases the queue', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response(429, '1'))
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce(response());
    const fetch = createScheduler({ fetchImpl });
    const pending = fetch(url('a')).catch(error => error);
    const next = fetch(url('b'));
    await jest.advanceTimersByTimeAsync(1000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(14999);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ name: 'TimeoutError' });
    expect((await next).status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('a caller can cancel while queued without starting the request', async () => {
    const controller = new AbortController();
    const reason = new Error('cancelled while queued');
    let release;
    const fetchImpl = jest.fn(input => input === url('first')
      ? new Promise(resolve => { release = resolve; }) : Promise.resolve(response()));
    const fetch = createScheduler({ fetchImpl });
    const first = fetch(url('first'));
    const cancelled = fetch(url('cancelled'), { signal: controller.signal }).catch(error => error);
    const last = fetch(url('last'));
    await jest.advanceTimersByTimeAsync(0);
    controller.abort(reason);
    expect(await cancelled).toBe(reason);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    release(response());
    await first;
    await jest.advanceTimersByTimeAsync(500);
    expect((await last).status).toBe(200);
    expect(fetchImpl.mock.calls.map(call => call[0])).toEqual([url('first'), url('last')]);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('cancelling during a 429 retry delay clears the wait but preserves cooldown', async () => {
    const controller = new AbortController();
    const reason = new Error('cancel retry');
    const fetchImpl = jest.fn().mockResolvedValueOnce(response(429, '10')).mockResolvedValueOnce(response());
    const fetch = createScheduler({ fetchImpl });
    const first = fetch(url('first'), { signal: controller.signal }).catch(error => error);
    const next = fetch(url('next'));
    await jest.advanceTimersByTimeAsync(500);
    controller.abort(reason);
    expect(await first).toBe(reason);
    expect((await next).status).toBe(429);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(9500);
    expect((await fetch(url('after'))).status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('preserves RequestInit properties even when signal is a read-only accessor', async () => {
    const controller = new AbortController();
    const options = Object.create({ headers: { Language: 'en' } });
    Object.defineProperty(options, 'signal', { get: () => controller.signal });
    const fetchImpl = jest.fn((input, init) => {
      const actual = new Request(input, init);
      expect(actual.headers.get('Language')).toBe('en');
      return Promise.resolve(response());
    });
    const pending = createScheduler({ fetchImpl })(url('a'), options);
    await jest.advanceTimersByTimeAsync(0);
    expect((await pending).status).toBe(200);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('does not time out non-WFM fetches or modify their options', async () => {
    const options = { headers: { Example: 'value' } };
    let release;
    const fetchImpl = jest.fn(() => new Promise(resolve => { release = resolve; }));
    const pending = createScheduler({ fetchImpl })('https://example.com/', options);
    await jest.advanceTimersByTimeAsync(20000);
    expect(fetchImpl).toHaveBeenCalledWith('https://example.com/', options);
    expect(jest.getTimerCount()).toBe(0);
    release(response());
    expect((await pending).status).toBe(200);
  });


  test('honors caller cancellation without AbortController', async () => {
    const controller = new AbortController();
    const reason = new Error('cancel without inner controller');
    const original = global.AbortController;
    try {
      global.AbortController = undefined;
      const options = { signal: controller.signal };
      const fetchImpl = jest.fn(() => new Promise(() => {}));
      const pending = createScheduler({ fetchImpl })(url('a'), options).catch(error => error);
      await jest.advanceTimersByTimeAsync(0);
      controller.abort(reason);
      expect(await pending).toBe(reason);
      expect(fetchImpl).toHaveBeenCalledWith(url('a'), options);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      global.AbortController = original;
    }
  });

  test('timeout reason wins over a fetch that rejects immediately on abort', async () => {
    const fetchImpl = jest.fn((input, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('fetch aborted')));
    }));
    const pending = createScheduler({ fetchImpl })(url('a')).catch(error => error);
    await jest.advanceTimersByTimeAsync(15000);
    expect(await pending).toMatchObject({ name: 'TimeoutError' });
    expect(jest.getTimerCount()).toBe(0);
  });

});
