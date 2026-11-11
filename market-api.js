/* WFM requests for one extension view. Other tabs and the background worker
   have their own execution contexts and therefore their own queues. */
(function (root) {
  'use strict';

  function createScheduler({
    fetchImpl = (...args) => fetch(...args),
    wait,
    clock = () => Date.now(),
    interval = 500,
    maxRetryDelay = 10000,
  } = {}) {
    let tail = Promise.resolve();
    let lastStart = -Infinity;
    let cooldownUntil = -Infinity;
    let cooldownResponse;

    function isMarket(input) {
      try {
        const url = new URL(typeof input === 'string' ? input : input.url || String(input));
        return url.protocol === 'https:' && (url.hostname === 'warframe.market' || url.hostname.endsWith('.warframe.market'));
      } catch { return false; }
    }

    function retryDelay(response) {
      const value = response.headers?.get?.('Retry-After');
      if (!value) return interval;
      const trimmed = value.trim();
      let delay;
      if (/^\d+(?:\.\d+)?$/.test(trimmed)) delay = Number(trimmed) * 1000;
      else {
        // Date.parse also accepts non-HTTP values like "-1" as a date.
        // Accept the standard HTTP date and the two obsolete HTTP date forms.
        const httpDate = /^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT|(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \d{2}-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{2} \d{2}:\d{2}:\d{2} GMT|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (?: \d|\d{2}) \d{2}:\d{2}:\d{2} \d{4})$/i;
        const date = httpDate.test(trimmed) ? Date.parse(trimmed) : NaN;
        delay = Number.isFinite(date) ? Math.max(0, date - clock()) : interval;
      }
      // Infinity (e.g. an enormous delta-seconds value) must not be shortened.
      return Math.max(interval, delay);
    }

    const requestTimeout = 15000;

    function abortReason(signal) {
      if (signal.reason !== undefined) return signal.reason;
      if (typeof DOMException === 'function') return new DOMException('The operation was aborted', 'AbortError');
      return Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    }

    function timeoutError() {
      const message = `WFM request timed out after ${requestTimeout} ms`;
      if (typeof DOMException === 'function') return new DOMException(message, 'TimeoutError');
      return Object.assign(new Error(message), { name: 'TimeoutError' });
    }

    function fetchWithTimeout(input, init, callerSignal) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      // Inherit the original dictionary, including any non-enumerable or inherited
      // RequestInit properties, while replacing only its signal.
      const options = controller
        ? Object.create(init == null ? null : Object(init), {
          signal: { value: controller.signal, enumerable: true, configurable: true, writable: true },
        })
        : init;
      return new Promise((resolve, reject) => {
        let timer;
        let settled = false;
        function finish(callback, value) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          callerSignal?.removeEventListener('abort', onAbort);
          callback(value);
        }
        function cancel(reason) {
          // Reject independently: fetch implementations may ignore the signal.
          finish(reject, reason);
          controller?.abort(reason);
        }
        function onAbort() { cancel(abortReason(callerSignal)); }
        if (callerSignal?.aborted) { onAbort(); return; }
        callerSignal?.addEventListener('abort', onAbort, { once: true });
        timer = setTimeout(() => cancel(timeoutError()), requestTimeout);
        try {
          Promise.resolve(fetchImpl(input, options)).then(
            value => finish(resolve, value),
            error => finish(reject, error),
          );
        } catch (error) { finish(reject, error); }
      });
    }

    function waitForDelay(delay, signal) {
      if (wait) return wait(delay, signal);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }, delay);
        function onAbort() {
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          reject(abortReason(signal));
        }
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) onAbort();
      });
    }

    function rememberRateLimit(response) {
      const delay = retryDelay(response);
      cooldownUntil = clock() + delay;
      // Keep an independent body for each caller refused during the cooldown.
      cooldownResponse = typeof response.clone === 'function' ? response.clone() : response;
      return delay;
    }

    async function start(input, init, signal, aborted, notBefore = -Infinity) {
      if (signal?.aborted) throw abortReason(signal);
      let delay = Math.max(0, lastStart + interval - clock(), notBefore - clock());
      while (delay > 0) {
        const delayPromise = waitForDelay(delay, signal);
        await (aborted ? Promise.race([delayPromise, aborted]) : delayPromise);
        if (signal?.aborted) throw abortReason(signal);
        delay = Math.max(0, lastStart + interval - clock(), notBefore - clock());
      }
      if (signal?.aborted) throw abortReason(signal);
      lastStart = clock();
      return fetchWithTimeout(input, init, signal);
    }

    function scheduledFetch(input, init) {
      if (!isMarket(input)) return fetchImpl(input, init);
      // Like fetch, an explicit null signal overrides a Request's own signal.
      const signal = init?.signal !== undefined ? init.signal : input?.signal;
      if (signal?.aborted) return Promise.reject(abortReason(signal));
      let onAbort;
      const aborted = signal ? new Promise((resolve, reject) => {
        onAbort = () => reject(abortReason(signal));
        signal.addEventListener('abort', onAbort, { once: true });
      }) : null;
      const task = tail.then(async () => {
        if (signal?.aborted) throw abortReason(signal);
        if (clock() < cooldownUntil) {
          return typeof cooldownResponse.clone === 'function' ? cooldownResponse.clone() : cooldownResponse;
        }
        cooldownResponse = undefined;
        let response = await start(input, init, signal, aborted);
        if (response.status === 429) {
          const delay = rememberRateLimit(response);
          // Never truncate Retry-After: long cooldowns fail fast and apply to the whole queue.
          if (delay > Math.min(maxRetryDelay, 10000)) return response;
          response = await start(input, init, signal, aborted, cooldownUntil);
          if (response.status === 429) rememberRateLimit(response);
          else cooldownResponse = undefined;
        }
        return response;
      });
      // A failed network request must not poison the rest of the queue.
      tail = task.catch(() => {});
      if (!aborted) return task;
      return Promise.race([task, aborted]).then(
        result => { signal.removeEventListener('abort', onAbort); return result; },
        error => { signal.removeEventListener('abort', onAbort); throw error; },
      );
    }
    return scheduledFetch;
  }

  const api = { createScheduler, fetch: createScheduler() };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MarketAPI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
