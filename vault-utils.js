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
        cls: 'wfm-ph-ins-buy', icon: '🔓', label: 'Prime Resurgence active',
        sub: '— available now via Varzia',
        tooltip: entry.availability === 'permanent'
          ? 'This prime is currently available through Prime Resurgence and remains permanently available outside this rotation.'
          : 'This prime is currently available through Prime Resurgence. Grab relics before the rotation ends!',
      };
    }
    if (entry.availability === 'permanent') {
      return {
        cls: 'wfm-ph-ins-buy', icon: '🔓', label: 'Permanently available',
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
    const isOld = monthsAgo >= 6;
    const endFmt = latestEnd === null ? null : new Date(latestEnd).toLocaleDateString('en-US', {
      month: 'long', year: 'numeric', timeZone: 'UTC',
    });
    return {
      cls: isOld ? 'wfm-ph-ins-sell' : 'wfm-ph-ins-neutral',
      icon: '🔒', label: latestEnd === null ? `Vaulted ${timeLabel}` : `Last seen ${timeLabel}`,
      sub: isOld ? '— selling sooner may be worth considering' : '— vaulted recently',
      tooltip: latestEnd === null
        ? 'Entered the Prime Vault and has not appeared in Prime Resurgence yet.'
        : `Last available in Prime Resurgence: ${endFmt}. Items absent 6+ months tend to stay vaulted for a while.`,
    };
  }

  const api = { calcVaultStatus };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VaultUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
