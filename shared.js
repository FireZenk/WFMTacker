/* ============================================================
   WFM Price History — shared utilities
   Loaded by panel.html. Not injected into content scripts.
   ============================================================ */

const API_BASE = 'https://api.warframe.market/v1';

const DUCAT_SVG = `<svg class="wfm-ph-ducat-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="8" cy="8" r="7" fill="#c8922a" stroke="#e8b84b" stroke-width="0.8"/>
  <circle cx="8" cy="8" r="4.5" fill="none" stroke="#e8d080" stroke-width="0.7" stroke-dasharray="1.4 1"/>
  <circle cx="8" cy="8" r="2" fill="#e8d080"/>
  <circle cx="8" cy="8" r="1" fill="#c8922a"/>
</svg>`;

// ── Utilities ─────────────────────────────────────────────────────────────────

function slugToName(slug) {
  return slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmt(n) {
  return n != null ? `${Math.round(n)}p` : '—';
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ── Rank split ────────────────────────────────────────────────────────────────

function splitByRank(days) {
  if (!days.some(e => e.mod_rank != null)) return null;
  return {
    r0: days.filter(e => e.mod_rank === 0),
    r5: days.filter(e => e.mod_rank === 5),
  };
}

// ── API ───────────────────────────────────────────────────────────────────────

async function fetchStats(slug) {
  const url = `${API_BASE}/items/${slug}/statistics?include=item`;
  const res = await fetch(url, {
    headers: { 'Language': 'en', 'Platform': 'pc' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return { closed: json.payload.statistics_closed };
}


async function fetchItemV2(slug) {
  try {
    const res = await fetch(`https://api.warframe.market/v2/item/${slug}`, {
      headers: { 'Language': 'en', 'Platform': 'pc' }
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data ?? null;
  } catch { return null; }
}

async function fetchPartPrice(slug) {
  try {
    const res = await fetch(`${API_BASE}/items/${slug}/statistics`, {
      headers: { 'Language': 'en', 'Platform': 'pc' }
    });
    if (!res.ok) return null;
    const json = await res.json();
    const days = json.payload.statistics_closed['90days'] ?? [];
    const last = days[days.length - 1];
    return last ? Math.round(last.wa_price ?? last.avg_price ?? 0) : null;
  } catch { return null; }
}

async function fetchItemParts(slug) {
  try {
    const res = await fetch(`https://api.warframe.market/v2/item/${slug}`, {
      headers: { 'Language': 'en', 'Platform': 'pc' }
    });
    if (!res.ok) return [];
    const json    = await res.json();
    const setData = json.data;
    const allPartIds = (setData?.setParts ?? []).filter(id => id !== setData.id);
    if (!allPartIds.length) return [];

    const idCount = {};
    allPartIds.forEach(id => { idCount[id] = (idCount[id] ?? 0) + 1; });
    const uniqueIds = Object.keys(idCount);

    const parts = await Promise.all(uniqueIds.map(async id => {
      try {
        const r = await fetch(`https://api.warframe.market/v2/itemId/${id}`, {
          headers: { 'Language': 'en', 'Platform': 'pc' }
        });
        if (!r.ok) return null;
        const j = await r.json();
        const data = j.data ?? null;
        return data ? { ...data, qty: idCount[id] } : null;
      } catch { return null; }
    }));

    return parts.filter(p => p && !p.setRoot);
  } catch (e) {
    console.warn('[WFM-PH] fetchItemParts error:', e.message);
    return [];
  }
}

// ── Vault ─────────────────────────────────────────────────────────────────────

let _vaultCache = null;

async function loadVaultData() {
  if (_vaultCache) return _vaultCache;
  try {
    const res = await fetch(browser.runtime.getURL('vault-data.json'));
    _vaultCache = await res.json();
  } catch {
    _vaultCache = {};
  }
  return _vaultCache;
}

function calcVaultStatus(slug, data) {
  if (!slug.includes('prime') || !data) return null;

  const PART_SUFFIXES = [
    '_neuroptics', '_systems', '_chassis', '_blueprint',
    '_barrel', '_receiver', '_stock', '_blade', '_handle',
    '_guard', '_grip', '_string', '_lower_limb', '_upper_limb',
    '_boot', '_carapace', '_cerebrum', '_link_neuroptics',
    '_link_systems', '_link_chassis', '_ornament',
  ];
  let setSlug = slug.endsWith('_set') ? slug : null;
  if (!setSlug) {
    for (const suf of PART_SUFFIXES) {
      if (slug.endsWith(suf)) { setSlug = slug.slice(0, -suf.length) + '_set'; break; }
    }
    if (!setSlug) setSlug = slug + '_set';
  }

  const entry = data[setSlug];
  if (!entry) return null;

  const now    = Date.now();
  const events = entry.events || [];
  const last   = events[events.length - 1];

  if (last) {
    const start = new Date(last.start).getTime();
    const end   = new Date(last.end).getTime();
    if (now >= start && now <= end) {
      return {
        cls: 'wfm-ph-ins-buy',
        icon: '🔓',
        label: 'Prime Resurgence active',
        sub: '— available now via Varzia',
        tooltip: 'This prime is currently available through Prime Resurgence. Grab relics before the rotation ends!',
      };
    }
  }

  const refDate   = last ? new Date(last.end) : new Date(entry.vaulted);
  const monthsAgo = Math.round((now - refDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
  const timeLabel = monthsAgo < 1  ? 'this month'
    : monthsAgo === 1              ? '1 month ago'
    : monthsAgo < 12              ? `${monthsAgo} months ago`
    : monthsAgo < 24              ? '~1 year ago'
    : `~${Math.round(monthsAgo / 12)} years ago`;

  const isOld    = monthsAgo >= 6;
  const hasEvent = !!last;
  const endFmt   = hasEvent
    ? new Date(last.end).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : null;

  return {
    cls:     isOld ? 'wfm-ph-ins-sell' : 'wfm-ph-ins-neutral',
    icon:    '🔒',
    label:   hasEvent ? `Last seen ${timeLabel}` : `Vaulted ${timeLabel}`,
    sub:     isOld ? '— selling sooner may be worth considering' : '— vaulted recently',
    tooltip: hasEvent
      ? `Last available in Prime Resurgence: ${endFmt}. Items absent 6+ months tend to stay vaulted for a while.`
      : `Entered the Prime Vault and has not appeared in Prime Resurgence yet.`,
  };
}

// ── Forecast ──────────────────────────────────────────────────────────────────

function calcForecast(points, forecastDays = 7) {
  const sample = points.slice(-30);
  const n = sample.length;
  if (n < 7) return null;

  const prices = sample.map(p => p.avg_price ?? p.wa_price ?? 0);

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX  += i;
    sumY  += prices[i];
    sumXY += i * prices[i];
    sumX2 += i * i;
  }
  const denom     = n * sumX2 - sumX * sumX;
  if (!denom) return null;
  const slope     = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  let sumRes2 = 0;
  for (let i = 0; i < n; i++) {
    const res = prices[i] - (intercept + slope * i);
    sumRes2 += res * res;
  }
  const stdDev = Math.sqrt(sumRes2 / n);

  const forecast = [];
  for (let i = 1; i <= forecastDays; i++) {
    const x   = n - 1 + i;
    const avg = Math.max(1, Math.round(intercept + slope * x));
    forecast.push({
      avg,
      upper: Math.max(1, Math.round(avg + stdDev)),
      lower: Math.max(1, Math.round(avg - stdDev)),
    });
  }

  return { forecast, slope, stdDev: Math.round(stdDev) };
}

// ── Chart ─────────────────────────────────────────────────────────────────────

function buildChart(points, W, H, forecastData = null) {
  if (!points || points.length < 2) {
    return '<div class="wfm-ph-empty">Not enough data to display the chart.</div>';
  }

  const forecast      = forecastData?.forecast ?? [];
  const FORECAST_DAYS = forecast.length;
  const total         = points.length + FORECAST_DAYS;

  const padL = 46, padR = 16, padT = 14, padB = 32;
  const cW = W - padL - padR;
  const cH = H - padT - padB;

  const avgs = points.map(p => p.avg_price ?? p.wa_price ?? 0);
  const mins = points.map(p => p.min_price ?? p.avg_price ?? 0);
  const maxs = points.map(p => p.max_price ?? p.avg_price ?? 0);
  const vols = points.map(p => p.volume ?? 0);

  const allPrices = [
    ...avgs, ...mins, ...maxs,
    ...forecast.map(f => f.upper),
    ...forecast.map(f => f.lower),
  ].filter(v => v > 0);
  const yMin   = Math.floor(Math.min(...allPrices) * 0.93);
  const yMax   = Math.ceil(Math.max(...allPrices)  * 1.07);
  const yRange = yMax - yMin || 1;
  const maxVol = Math.max(...vols) || 1;
  const n = points.length;

  const sx   = i => padL + (i / (total - 1)) * cW;
  const sy   = v => padT + cH - ((v - yMin) / yRange) * cH;
  const volH = cH * 0.18;

  const bandPts =
    points.map((p, i) => `${sx(i).toFixed(1)},${sy(maxs[i]).toFixed(1)}`).join(' ') + ' ' +
    points.map((p, i) => `${sx(n-1-i).toFixed(1)},${sy(mins[n-1-i]).toFixed(1)}`).join(' ');

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(avgs[i]).toFixed(1)}`)
    .join(' ');

  const fillPath = `${linePath} L${sx(n-1).toFixed(1)},${(padT+cH).toFixed(1)} L${sx(0).toFixed(1)},${(padT+cH).toFixed(1)} Z`;

  const barWidth = Math.max(1, (cW / total) - 1);
  const volBars  = vols.map((v, i) => {
    const bh = (v / maxVol) * volH;
    const bx = sx(i) - barWidth / 2;
    const by = padT + cH - bh;
    return `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${bh.toFixed(1)}" class="wfm-ph-vol-bar"/>`;
  }).join('');

  let forecastSVG = '';
  if (forecast.length) {
    const fBandPts =
      forecast.map((f, i) => `${sx(n-1+i).toFixed(1)},${sy(f.upper).toFixed(1)}`).join(' ') + ' ' +
      forecast.map((f, i) => `${sx(n-1+(forecast.length-1-i)).toFixed(1)},${sy(forecast[forecast.length-1-i].lower).toFixed(1)}`).join(' ');

    const fLine = forecast
      .map((f, i) => `${i === 0 ? `M${sx(n-1).toFixed(1)},${sy(avgs[n-1]).toFixed(1)} L` : 'L'}${sx(n+i).toFixed(1)},${sy(f.avg).toFixed(1)}`)
      .join(' ');

    const todayX = sx(n - 1).toFixed(1);

    forecastSVG = `
      <polygon points="${fBandPts}" class="wfm-ph-forecast-band"/>
      <path d="${fLine}" class="wfm-ph-forecast-line"/>
      <line x1="${todayX}" y1="${padT}" x2="${todayX}" y2="${padT + cH}" class="wfm-ph-today"/>
      <text x="${(+todayX + 3).toFixed(1)}" y="${(padT + 10).toFixed(1)}" class="wfm-ph-lbl wfm-ph-today-lbl">today</text>`;
  }

  const yTicks = 5;
  let gridLines = '', yLabels = '';
  for (let t = 0; t <= yTicks; t++) {
    const val = yMin + (t / yTicks) * yRange;
    const y   = sy(val).toFixed(1);
    gridLines += `<line x1="${padL}" y1="${y}" x2="${padL + cW}" y2="${y}" class="wfm-ph-grid"/>`;
    yLabels   += `<text x="${(padL - 6).toFixed(1)}" y="${(+y + 4).toFixed(1)}" class="wfm-ph-lbl" text-anchor="end">${Math.round(val)}</text>`;
  }

  let xLabels = '';
  const xCount = Math.min(4, n);
  for (let j = 0; j < xCount; j++) {
    const i = Math.round((j / (xCount - 1)) * (n - 1));
    const d = new Date(points[i].datetime);
    xLabels += `<text x="${sx(i).toFixed(1)}" y="${(padT + cH + 18).toFixed(1)}" class="wfm-ph-lbl" text-anchor="middle">${d.getDate()}/${d.getMonth()+1}</text>`;
  }
  if (forecast.length) {
    const lastDate = new Date(points[n - 1].datetime);
    lastDate.setDate(lastDate.getDate() + FORECAST_DAYS);
    xLabels += `<text x="${sx(total - 1).toFixed(1)}" y="${(padT + cH + 18).toFixed(1)}" class="wfm-ph-lbl wfm-ph-forecast-lbl" text-anchor="end">${lastDate.getDate()}/${lastDate.getMonth()+1}</text>`;
  }

  return `
    <svg viewBox="0 0 ${W} ${H}" class="wfm-ph-svg" preserveAspectRatio="none" role="img">
      <defs>
        <linearGradient id="wfm-grad-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="#e8538a" stop-opacity="0.2"/>
          <stop offset="100%" stop-color="#e8538a" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="wfm-grad-band" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="#5ec8d0" stop-opacity="0.15"/>
          <stop offset="100%" stop-color="#5ec8d0" stop-opacity="0.03"/>
        </linearGradient>
        <clipPath id="wfm-clip">
          <rect x="${padL}" y="${padT}" width="${cW}" height="${cH}"/>
        </clipPath>
      </defs>

      ${gridLines}

      <g clip-path="url(#wfm-clip)">
        <polygon points="${bandPts}" fill="url(#wfm-grad-band)" class="wfm-ph-band"/>
        <path d="${fillPath}" fill="url(#wfm-grad-fill)"/>
        ${volBars}
        <path d="${linePath}" class="wfm-ph-line"/>
        ${forecastSVG}
        ${points.map((p, i) => `<circle cx="${sx(i).toFixed(1)}" cy="${sy(avgs[i]).toFixed(1)}" r="8" class="wfm-ph-dot-hit" data-price="${Math.round(p.avg_price ?? p.wa_price ?? 0)}" data-date="${new Date(p.datetime).toLocaleDateString('en-US',{month:'short',day:'numeric'})}" data-vol="${p.volume ?? 0}"/>`).join('')}
      </g>

      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + cH}" class="wfm-ph-axis"/>
      <line x1="${padL}" y1="${padT + cH}" x2="${padL + cW}" y2="${padT + cH}" class="wfm-ph-axis"/>

      ${yLabels}
      ${xLabels}
    </svg>`;
}

// ── Insights ──────────────────────────────────────────────────────────────────

function calcSignal(days90) {
  const prices = days90.map(p => p.avg_price ?? p.wa_price).filter(Boolean);
  if (prices.length < 7) return null;
  const mean    = prices.reduce((a, b) => a + b, 0) / prices.length;
  const current = prices[prices.length - 1];
  const pct     = Math.round(Math.abs(current / mean - 1) * 100);
  if (current < mean * 0.90) return { type: 'buy',     pct, text: `${pct}% below avg — good time to buy` };
  if (current > mean * 1.10) return { type: 'sell',    pct, text: `${pct}% above avg — consider selling` };
  return                             { type: 'neutral', pct, text: 'Trading at fair value' };
}

function calcVolatility(days90) {
  const prices = days90.map(p => p.avg_price ?? p.wa_price).filter(Boolean);
  if (prices.length < 7) return null;
  const mean     = prices.reduce((a, b) => a + b, 0) / prices.length;
  const variance = prices.reduce((s, p) => s + (p - mean) ** 2, 0) / prices.length;
  const cv       = (Math.sqrt(variance) / mean) * 100;
  if (cv < 10) return { label: 'Stable',   level: 0, cv: Math.round(cv) };
  if (cv < 25) return { label: 'Moderate', level: 1, cv: Math.round(cv) };
  return               { label: 'Volatile', level: 2, cv: Math.round(cv) };
}

function calcLiquidity(days90) {
  const recent = days90.slice(-30);
  if (recent.length < 7) return null;

  const totalDays   = recent.length;
  const activeDays  = recent.filter(p => (p.volume ?? 0) > 0).length;
  const avgVol      = recent.reduce((s, p) => s + (p.volume ?? 0), 0) / totalDays;
  const consistency = activeDays / totalDays;

  const volScore   = Math.min(10, Math.max(1, Math.log2(avgVol + 1) * 2.5));
  const finalScore = Math.max(1, Math.round(volScore * consistency));

  let label, cls;
  if (finalScore <= 3)      { label = 'Low';    cls = 'wfm-ph-ins-volatile'; }
  else if (finalScore <= 6) { label = 'Medium'; cls = 'wfm-ph-ins-moderate'; }
  else                      { label = 'High';   cls = 'wfm-ph-ins-buy'; }

  return { score: finalScore, label, cls, avgVol: Math.round(avgVol * 10) / 10, activeDays, totalDays };
}

function calcBestHour(hours48) {
  if (hours48.length < 12) return null;
  const byHour = {};
  hours48.forEach(p => {
    const h = new Date(p.datetime).getHours();
    if (!byHour[h]) byHour[h] = [];
    byHour[h].push(p.avg_price ?? p.wa_price ?? 0);
  });
  const avgs = Object.entries(byHour).map(([h, arr]) => ({
    hour: parseInt(h),
    avg:  arr.reduce((a, b) => a + b, 0) / arr.length,
  }));
  if (!avgs.length) return null;
  const best  = avgs.reduce((a, b) => a.avg < b.avg ? a : b);
  const worst = avgs.reduce((a, b) => a.avg > b.avg ? a : b);
  const diff  = Math.round(worst.avg - best.avg);
  return { hour: best.hour, sellHour: worst.hour, diff };
}

// ── Insights HTML ─────────────────────────────────────────────────────────────

function buildInsightsHTML({ signal, volatility, bestHour, ducatData, vaultStatus, liquidity }) {
  const volLabels  = ['🟢 Stable', '🟡 Moderate', '🔴 Volatile'];
  const volClasses = ['wfm-ph-ins-stable', 'wfm-ph-ins-moderate', 'wfm-ph-ins-volatile'];
  const sigIcons   = { buy: '🟢', sell: '🔴', neutral: '🔵' };
  const sigClasses = { buy: 'wfm-ph-ins-buy', sell: 'wfm-ph-ins-sell', neutral: 'wfm-ph-ins-neutral' };

  const ducatChipHTML = (ducatData?.ducats > 0 && ducatData?.platPrice > 0) ? (() => {
    const { ducats, platPrice } = ducatData;
    const ratio = (platPrice / ducats).toFixed(1);
    const cls   = ratio >= 8 ? 'wfm-ph-ins-buy' : ratio >= 5 ? 'wfm-ph-ins-neutral' : 'wfm-ph-ins-moderate';
    const tip   = ratio >= 8
      ? 'Selling for plat is much better'
      : ratio >= 5
      ? 'Plat and ducats are roughly equivalent'
      : 'Ducats may be worth considering';
    return `
      <div class="wfm-ph-insight ${cls}">
        <span class="wfm-ph-ins-icon">${DUCAT_SVG}</span>
        <span><b>${ducats}d</b> &nbsp;·&nbsp; <span data-tooltip="Platinum per Ducat ratio: how much plat you get per ducat when selling for plat.">${ratio}p/d</span> &nbsp;<span class="wfm-ph-ins-dim">— ${tip}</span></span>
      </div>`;
  })() : '';

  const vaultChipHTML = vaultStatus ? `
    <div class="wfm-ph-insight ${vaultStatus.cls}">
      <span class="wfm-ph-ins-icon">${vaultStatus.icon}</span>
      <span><b>${vaultStatus.label}</b> <span class="wfm-ph-ins-dim" data-tooltip="${vaultStatus.tooltip}">${vaultStatus.sub}</span></span>
    </div>` : '';

  return `
    <div class="wfm-ph-insights">
      ${signal ? `
        <div class="wfm-ph-insight ${sigClasses[signal.type]}">
          <span class="wfm-ph-ins-icon">${sigIcons[signal.type]}</span>
          <span>${signal.text}</span>
        </div>` : ''}
      ${volatility ? `
        <div class="wfm-ph-insight ${volClasses[volatility.level]}">
          <span class="wfm-ph-ins-icon">📊</span>
          <span>${volLabels[volatility.level]} <span class="wfm-ph-ins-dim" data-tooltip="Coefficient of Variation: measures price stability relative to the average. Under 10% = stable, 10–25% = moderate, above 25% = volatile">(CV ${volatility.cv}%)</span></span>
        </div>` : ''}
      ${bestHour ? `
        <div class="wfm-ph-insight wfm-ph-ins-hour">
          <span class="wfm-ph-ins-icon">🕐</span>
          <span>Cheapest around <b>${String(bestHour.hour).padStart(2,'0')}:00 <span data-tooltip="Your local browser time">(local time)</span></b><span class="wfm-ph-ins-dim"> (saves ~${bestHour.diff}p vs peak)</span></span>
        </div>
        <div class="wfm-ph-insight wfm-ph-ins-sell">
          <span class="wfm-ph-ins-icon">💰</span>
          <span>Best to sell around <b>${String(bestHour.sellHour).padStart(2,'0')}:00 <span data-tooltip="Your local browser time">(local time)</span></b><span class="wfm-ph-ins-dim"> (~${bestHour.diff}p above daily low)</span></span>
        </div>` : ''}
      ${ducatChipHTML}
      ${vaultChipHTML}
      ${liquidity ? (() => {
        const dots = Array.from({ length: 10 }, (_, i) =>
          `<span class="wfm-ph-liq-dot${i < liquidity.score ? ' wfm-ph-liq-dot-on' : ''}" style="${i < liquidity.score ? `background:var(--wfm-liq-${liquidity.label.toLowerCase()})` : ''}"></span>`
        ).join('');
        return `
        <div class="wfm-ph-insight ${liquidity.cls}">
          <span class="wfm-ph-ins-icon">💧</span>
          <span>
            <b data-tooltip="Liquidity score (1 = very hard to sell, 10 = trades daily). Based on average daily volume and activity over the last ${liquidity.totalDays} days.">${liquidity.label} liquidity</b>
            <span class="wfm-ph-liq-bar">${dots}</span>
            <span class="wfm-ph-ins-dim">${liquidity.score}/10 · ~${liquidity.avgVol} trades/day · active ${liquidity.activeDays}/${liquidity.totalDays} days</span>
          </span>
        </div>`;
      })() : ''}
    </div>`;
}

// ── Chart tooltip ─────────────────────────────────────────────────────────────

function setupChartTooltips(area) {
  let tip = document.getElementById('wfm-ph-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'wfm-ph-tip';
    tip.className = 'wfm-ph-tip';
    tip.hidden = true;
    document.body.appendChild(tip);
  }
  tip.hidden = true;
  area.querySelectorAll('.wfm-ph-dot-hit').forEach(c => {
    c.addEventListener('mouseenter', () => {
      tip.innerHTML = `<div class="wfm-ph-tip-date">${c.dataset.date}</div><div class="wfm-ph-tip-price">${c.dataset.price}p</div>${+c.dataset.vol > 0 ? `<div class="wfm-ph-tip-vol">Vol: ${c.dataset.vol}</div>` : ''}`;
      tip.hidden = false;
    });
    c.addEventListener('mousemove', e => {
      tip.style.left = `${e.clientX + 14}px`;
      tip.style.top  = `${e.clientY - 52}px`;
    });
    c.addEventListener('mouseleave', () => { tip.hidden = true; });
  });
}
