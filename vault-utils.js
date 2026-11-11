/* WFM Price History — shared Prime Vault state calculation. */
(function (root) {
  'use strict';

  const DAY = 24 * 60 * 60 * 1000;

  // Reject ambiguous local times, invalid calendar dates and JS's coercion of
  // null to 1970. Date-only values represent the start of that UTC day.
  function parseDate(value) {
    if (typeof value !== 'string') return NaN;
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(value);
    if (!match) return NaN;
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const calendar = new Date(0);
    calendar.setUTCFullYear(year, month - 1, day);
    if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return NaN;
    return Date.parse(value);
  }

  // Synchronous lookup is retained for calculation/fixtures; consumers must
  // validate component membership using createVaultResolver before calling it.
  function findEntry(slug, data) {
    if (typeof slug !== 'string' || !data || typeof data !== 'object') return null;
    const keys = Object.keys(data).filter(key => key.endsWith('_set'));
    if (keys.includes(slug)) return data[slug];
    let best = null;
    for (const key of keys) {
      const base = key.slice(0, -4);
      if (slug.startsWith(base + '_') && (!best || key.length > best.length)) best = key;
    }
    return best ? data[best] : null;
  }

  function calcVaultStatus(slug, data, now = Date.now()) {
    const entry = findEntry(slug, data);
    const time = now instanceof Date ? now.getTime() : typeof now === 'string' ? parseDate(now) : now;
    if (!entry || typeof entry !== 'object' || !Number.isFinite(time)) return null;

    // The date identifies the full UTC day. Expire at its end + 30 days.
    if (Object.prototype.hasOwnProperty.call(data, '_asOf')) {
      const asOf = typeof data._asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data._asOf)
        ? parseDate(data._asOf) : NaN;
      if (!Number.isFinite(asOf) || asOf > time) return null;
      if (time >= asOf + 31 * DAY) {
        return {
          cls: 'wfm-ph-ins-neutral', icon: '⚠️', label: 'Vault data outdated',
          sub: `— last updated ${data._asOf} UTC`,
          tooltip: `Vault data is from ${data._asOf} UTC and is over 30 days old. Current availability is unknown.`,
        };
      }
    }

    let latestEnd = null;
    let active = false;
    let uncertainOpen = false;
    for (const event of Array.isArray(entry.events) ? entry.events : []) {
      if (!event || typeof event !== 'object') continue;
      const start = parseDate(event.start);
      if (!Number.isFinite(start)) continue;
      if (event.end === null) {
        if (time < start) continue;
        // verifiedAt is a whole UTC day. Its last instant plus 48 hours is
        // the exclusive beginning of the third day after verification.
        const verified = typeof event.verifiedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(event.verifiedAt)
          ? parseDate(event.verifiedAt) : NaN;
        if (Number.isFinite(verified) && verified + DAY > start && time >= verified && time < verified + 3 * DAY) {
          active = true;
        } else {
          uncertainOpen = true;
        }
        continue;
      }
      const end = parseDate(event.end);
      if (!Number.isFinite(end) || end <= start) continue;
      if (time >= start && time < end) active = true;
      if (end <= time && (latestEnd === null || end > latestEnd)) latestEnd = end;
    }

    if (active) {
      return {
        cls: 'wfm-ph-ins-neutral', icon: '🔓', label: 'Prime Resurgence active',
        sub: '— available now via Varzia',
        tooltip: entry.availability === 'permanent'
          ? 'This prime is currently available through Prime Resurgence and remains permanently available outside this rotation.'
          : 'This prime is currently available through the recorded Prime Resurgence rotation.',
      };
    }
    if (entry.availability === 'permanent') {
      return {
        cls: 'wfm-ph-ins-neutral', icon: '🔓', label: 'Permanently available',
        sub: '— available outside rotations',
        tooltip: 'This prime is permanently available and is not dependent on a Prime Resurgence rotation.',
      };
    }
    // An expired or unverified open window cannot establish when it ended.
    if (uncertainOpen) return null;

    const vaulted = parseDate(entry.vaulted);
    if (!Number.isFinite(vaulted) || vaulted > time) return null;
    const refDate = latestEnd === null ? vaulted : latestEnd;
    const monthsAgo = Math.round((time - refDate) / (DAY * 30.44));
    const timeLabel = monthsAgo < 1 ? 'this month'
      : monthsAgo === 1 ? '1 month ago'
      : monthsAgo < 12 ? `${monthsAgo} months ago`
      : monthsAgo < 24 ? '~1 year ago'
      : `~${Math.round(monthsAgo / 12)} years ago`;
    const endFmt = latestEnd === null ? null : new Date(latestEnd).toLocaleDateString('en-US', {
      month: 'long', year: 'numeric', timeZone: 'UTC',
    });
    return {
      cls: 'wfm-ph-ins-neutral', icon: '📜',
      label: latestEnd === null ? `Last recorded vaulting ${timeLabel}` : `Last recorded Resurgence ${timeLabel}`,
      sub: '— historical record',
      tooltip: latestEnd === null
        ? `Recorded vaulting: ${entry.vaulted}. Resurgence history may be incomplete; current availability is unknown.`
        : `Last recorded Resurgence ended ${endFmt}. History may be incomplete; current availability is unknown.`,
    };
  }

  // Resolve only known set roots, or components whose API membership can be
  // proven. No global set scan: one candidate request, or at most eight IDs.
  function createVaultResolver(fetchImpl = (...args) => MarketAPI.fetch(...args), {
    clock = () => Date.now(),
  } = {}) {
    const cache = new Map();
    const MAX_CACHE = 128;
    const TTL = 15 * 60 * 1000;
    function fetchItem(kind, value) {
      const key = `${kind}/${value}`;
      const hit = cache.get(key);
      if (hit && clock() - hit.at < TTL) return hit.promise;
      if (hit) cache.delete(key);
      // The injected fetch is the same scheduler used by the rest of the view.
      const promise = Promise.resolve().then(async () => {
        const response = await fetchImpl(`https://api.warframe.market/v2/${kind}/${encodeURIComponent(value)}`, {
          headers: { Language: 'en', Platform: 'pc' },
        });
        if (!response.ok) throw new Error('WFM item lookup failed');
        const item = (await response.json()).data;
        if (!item || typeof item !== 'object') throw new Error('Invalid WFM item');
        return item;
      }).catch(() => {
        if (cache.get(key)?.promise === promise) cache.delete(key);
        return null;
      });
      if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
      cache.set(key, { at: clock(), promise });
      return promise;
    }
    const validId = id => typeof id === 'string' && id.length > 0;
    const hasMember = (item, id) => Array.isArray(item.setParts) && item.setParts.includes(id);
    const knownRoot = (rootItem, data, id) => rootItem && rootItem.setRoot === true &&
      validId(rootItem.id) && typeof rootItem.slug === 'string' &&
      Object.prototype.hasOwnProperty.call(data, rootItem.slug) && rootItem.slug.endsWith('_set') &&
      hasMember(rootItem, rootItem.id) && hasMember(rootItem, id);

    // item must be the response to fetchItemV2(slug), not an unrelated item.
    // v2 may return a canonical slug different from the requested alias; the
    // resolver cannot independently prove which query produced that response.
    return async function resolveVaultStatus(slug, data, item, now) {
      if (typeof slug !== 'string' || !slug || !data || typeof data !== 'object') return null;
      const calculate = rootSlug => calcVaultStatus(rootSlug, data, now === undefined ? clock() : now);
      // An exact data set slug is unambiguous when the v2 lookup failed.
      if (item == null) {
        return slug.endsWith('_set') && Object.prototype.hasOwnProperty.call(data, slug)
          ? calculate(slug) : null;
      }
      if (typeof item !== 'object' || !validId(item.id) || typeof item.slug !== 'string' || !item.slug ||
          !hasMember(item, item.id)) return null;
      const canonicalSlug = item.slug;
      if (item.setRoot === true) {
        return knownRoot(item, data, item.id) ? calculate(canonicalSlug) : null;
      }
      if (item.setRoot !== false) return null;
      if (!(Array.isArray(item.tags) && item.tags.includes('prime')) &&
          !canonicalSlug.includes('_prime_') && !canonicalSlug.endsWith('_prime')) return null;

      // Prefix is a hint, never evidence. Kavasa's parts omit "kubrow_collar".
      const candidates = Object.keys(data).filter(key => key.endsWith('_set') &&
        canonicalSlug.startsWith(key.slice(0, -4) + '_')).sort((a, b) => b.length - a.length);
      if (canonicalSlug.startsWith('kavasa_prime_') && data.kavasa_prime_kubrow_collar_set &&
          !candidates.includes('kavasa_prime_kubrow_collar_set')) candidates.push('kavasa_prime_kubrow_collar_set');
      if (candidates.length) {
        const rootItem = await fetchItem('item', candidates[0]);
        if (rootItem?.slug === candidates[0] && knownRoot(rootItem, data, item.id) && hasMember(item, rootItem.id)) {
          return calculate(rootItem.slug);
        }
        // A failed or contradictory candidate must never become a prefix match.
        return null;
      }

      const ids = [...new Set(item.setParts.filter(id => validId(id) && id !== item.id))].slice(0, 8);
      for (const id of ids) {
        const rootItem = await fetchItem('itemId', id);
        if (!rootItem || rootItem.id !== id) return null;
        if (knownRoot(rootItem, data, item.id)) return calculate(rootItem.slug);
      }
      return null;
    };
  }

  const api = { calcVaultStatus, createVaultResolver };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VaultUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
