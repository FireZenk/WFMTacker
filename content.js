/* ============================================================
   WFM Price History — content script
   Inyecta un gráfico de historial de precios en cada página
   de item de warframe.market (SPA con Vue/Nuxt).
   ============================================================ */

(function () {
  'use strict';

  const API_BASE   = 'https://api.warframe.market/v1';
  const WIDGET_ID  = 'wfm-ph-widget';
  const PANEL_ID   = 'wfm-ph-watchlist-panel';

  // ── Storage helpers ───────────────────────────────────────────────────────

  function sendMsg(msg) {
    return new Promise(resolve => chrome.runtime.sendMessage(msg, resolve));
  }
  const getWatchlist  = ()       => sendMsg({ type: 'GET_WATCHLIST' });
  const saveWatchlist = list     => sendMsg({ type: 'SAVE_WATCHLIST', watchlist: list });

  async function toggleWatch(slug, name, price) {
    const list = await getWatchlist();
    if (list[slug]) {
      delete list[slug];
    } else {
      list[slug] = { name, slug, addedAt: Date.now(), priceAtAdd: price, lastPrice: price, lastChecked: Date.now(), alert: { below: null, above: null } };
    }
    await saveWatchlist(list);
    return list;
  }

  // SVG propio inspirado en la moneda Orokin — sin copiar assets externos
  const DUCAT_SVG = `<svg class="wfm-ph-ducat-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="8" cy="8" r="7" fill="#c8922a" stroke="#e8b84b" stroke-width="0.8"/>
    <circle cx="8" cy="8" r="4.5" fill="none" stroke="#e8d080" stroke-width="0.7" stroke-dasharray="1.4 1"/>
    <circle cx="8" cy="8" r="2" fill="#e8d080"/>
    <circle cx="8" cy="8" r="1" fill="#c8922a"/>
  </svg>`;

  let currentSlug = null;

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function getItemSlug() {
    const m = location.pathname.match(/^\/items\/([^/?#]+)/);
    return m ? m[1] : null;
  }

  function slugToName(slug) {
    return slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function fmt(n) {
    return n != null ? `${Math.round(n)}p` : '—';
  }

  // ── API ──────────────────────────────────────────────────────────────────────

  async function fetchStats(slug) {
    const res = await fetch(`${API_BASE}/items/${slug}/statistics?include=item`, {
      headers: { 'Language': 'en', 'Platform': 'pc' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return {
      closed: json.payload.statistics_closed,
      parts:  [],
    };
  }

  async function fetchItemParts(slug) {
    try {
      // 1. Obtener info del set con la v2
      const res = await fetch(`https://api.warframe.market/v2/item/${slug}`, {
        headers: { 'Language': 'en', 'Platform': 'pc' }
      });
      if (!res.ok) return [];
      const json    = await res.json();
      const setData = json.data;
      const allPartIds = (setData?.setParts ?? []).filter(id => id !== setData.id);
      if (!allPartIds.length) return [];

      // Count how many times each ID appears (e.g. 2× blade in a set)
      const idCount = {};
      allPartIds.forEach(id => { idCount[id] = (idCount[id] ?? 0) + 1; });
      const uniqueIds = Object.keys(idCount);

      // 2. Resolver cada ID único a { slug, name } en paralelo
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

  // ── Linear Regression Forecast ───────────────────────────────────────────────

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
    const denom    = n * sumX2 - sumX * sumX;
    if (!denom) return null;
    const slope    = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;

    // Standard deviation of residuals → confidence band
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
        avg:   avg,
        upper: Math.max(1, Math.round(avg + stdDev)),
        lower: Math.max(1, Math.round(avg - stdDev)),
      });
    }

    return { forecast, slope, stdDev: Math.round(stdDev) };
  }

  // ── SVG Chart ────────────────────────────────────────────────────────────────

  function buildChart(points, W, H, forecastData = null) {
    if (!points || points.length < 2) {
      return '<div class="wfm-ph-empty">Not enough data to display the chart.</div>';
    }

    const forecast  = forecastData?.forecast ?? [];
    const FORECAST_DAYS = forecast.length;
    const total     = points.length + FORECAST_DAYS;   // total slots on x-axis

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
    const yMin  = Math.floor(Math.min(...allPrices) * 0.93);
    const yMax  = Math.ceil(Math.max(...allPrices)  * 1.07);
    const yRange = yMax - yMin || 1;
    const maxVol = Math.max(...vols) || 1;
    const n = points.length;

    // x-axis spans historical + forecast
    const sx  = i => padL + (i / (total - 1)) * cW;
    const sy  = v => padT + cH - ((v - yMin) / yRange) * cH;
    const volH = cH * 0.18;

    // ── Historical: banda min-max ──
    const bandPts =
      points.map((p, i) => `${sx(i).toFixed(1)},${sy(maxs[i]).toFixed(1)}`).join(' ') + ' ' +
      points.map((p, i) => `${sx(n-1-i).toFixed(1)},${sy(mins[n-1-i]).toFixed(1)}`).join(' ');

    // ── Historical: línea promedio ──
    const linePath = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(avgs[i]).toFixed(1)}`)
      .join(' ');

    // ── Historical: fill ──
    const fillPath = `${linePath} L${sx(n-1).toFixed(1)},${(padT+cH).toFixed(1)} L${sx(0).toFixed(1)},${(padT+cH).toFixed(1)} Z`;

    // ── Historical: barras de volumen ──
    const barWidth = Math.max(1, (cW / total) - 1);
    const volBars  = vols.map((v, i) => {
      const bh = (v / maxVol) * volH;
      const bx = sx(i) - barWidth / 2;
      const by = padT + cH - bh;
      return `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${bh.toFixed(1)}" class="wfm-ph-vol-bar"/>`;
    }).join('');

    // ── Forecast: banda de confianza ──
    let forecastSVG = '';
    if (forecast.length) {
      const fBandPts =
        forecast.map((f, i) => `${sx(n-1+i).toFixed(1)},${sy(f.upper).toFixed(1)}`).join(' ') + ' ' +
        forecast.map((f, i) => `${sx(n-1+(forecast.length-1-i)).toFixed(1)},${sy(forecast[forecast.length-1-i].lower).toFixed(1)}`).join(' ');

      // Línea punteada de predicción
      const fLine = forecast
        .map((f, i) => `${i === 0 ? `M${sx(n-1).toFixed(1)},${sy(avgs[n-1]).toFixed(1)} L` : 'L'}${sx(n+i).toFixed(1)},${sy(f.avg).toFixed(1)}`)
        .join(' ');

      // Separador "hoy"
      const todayX = sx(n - 1).toFixed(1);

      forecastSVG = `
        <polygon points="${fBandPts}" class="wfm-ph-forecast-band"/>
        <path d="${fLine}" class="wfm-ph-forecast-line"/>
        <line x1="${todayX}" y1="${padT}" x2="${todayX}" y2="${padT + cH}" class="wfm-ph-today"/>
        <text x="${(+todayX + 3).toFixed(1)}" y="${(padT + 10).toFixed(1)}" class="wfm-ph-lbl wfm-ph-today-lbl">today</text>`;
    }

    // ── Rejilla + etiquetas Y ──
    const yTicks = 5;
    let gridLines = '', yLabels = '';
    for (let t = 0; t <= yTicks; t++) {
      const val = yMin + (t / yTicks) * yRange;
      const y   = sy(val).toFixed(1);
      gridLines += `<line x1="${padL}" y1="${y}" x2="${padL + cW}" y2="${y}" class="wfm-ph-grid"/>`;
      yLabels   += `<text x="${(padL - 6).toFixed(1)}" y="${(+y + 4).toFixed(1)}" class="wfm-ph-lbl" text-anchor="end">${Math.round(val)}</text>`;
    }

    // ── Etiquetas X ── (4 históricas + última fecha de forecast)
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
        </g>

        <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + cH}" class="wfm-ph-axis"/>
        <line x1="${padL}" y1="${padT + cH}" x2="${padL + cW}" y2="${padT + cH}" class="wfm-ph-axis"/>

        ${yLabels}
        ${xLabels}
      </svg>`;
  }

  // ── Insights ─────────────────────────────────────────────────────────────────

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

    const totalDays  = recent.length;
    const activeDays = recent.filter(p => (p.volume ?? 0) > 0).length;
    const avgVol     = recent.reduce((s, p) => s + (p.volume ?? 0), 0) / totalDays;
    const consistency = activeDays / totalDays;

    // Log scale: vol=1→~2, vol=3→~4, vol=8→~6, vol=20→~8, vol=50→~10
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
    return { hour: best.hour, diff };
  }

  // ── Widget ───────────────────────────────────────────────────────────────────

  function buildWidget(slug, statsData, v2Data = null) {
    const days90  = (statsData.closed['90days']  || []).slice(-90);
    const hours48 = (statsData.closed['48hours'] || []).slice(-48);

    const activeSet = days90.length ? days90 : hours48;
    if (!activeSet.length) return null;

    const forecastData = calcForecast(days90.length >= 7 ? days90 : hours48);
    const predicted7d  = forecastData?.forecast?.[6] ?? null;
    const signal       = calcSignal(days90);
    const volatility   = calcVolatility(days90);
    const bestHour     = calcBestHour(hours48);
    const liquidity    = calcLiquidity(days90);

    const last = activeSet[activeSet.length - 1] || {};
    const trend = activeSet.length >= 8
      ? (activeSet[activeSet.length - 1].avg_price ?? 0) - (activeSet[activeSet.length - 8].avg_price ?? 0)
      : 0;
    const trendStr = trend > 0
      ? `<span class="wfm-ph-up">▲ ${fmt(trend)}</span>`
      : trend < 0
      ? `<span class="wfm-ph-down">▼ ${fmt(Math.abs(trend))}</span>`
      : '';

    const predStr = predicted7d
      ? (predicted7d.avg > (last.avg_price ?? 0)
          ? `<span class="wfm-ph-up">↑ ${fmt(predicted7d.avg)}</span>`
          : `<span class="wfm-ph-down">↓ ${fmt(predicted7d.avg)}</span>`)
      : '—';

    // Ducat comparison (solo prime items con ducats > 0)
    const isPrime  = v2Data?.tags?.includes('prime') ?? slug.includes('prime');
    const ducats   = v2Data?.ducats ?? 0;
    const platPrice = Math.round(last.wa_price ?? last.avg_price ?? 0);
    const ducatChipHTML = (isPrime && ducats > 0 && platPrice > 0) ? (() => {
      const ratio = (platPrice / ducats).toFixed(1);
      const cls   = ratio >= 3 ? 'wfm-ph-ins-buy' : ratio >= 2 ? 'wfm-ph-ins-neutral' : 'wfm-ph-ins-moderate';
      const tip   = ratio >= 3
        ? `Selling for plat is much better`
        : ratio >= 2
        ? `Plat and ducats are roughly equivalent`
        : `Ducats may be worth considering`;
      return `
        <div class="wfm-ph-insight ${cls}">
          <span class="wfm-ph-ins-icon">${DUCAT_SVG}</span>
          <span><b>${ducats}d</b> &nbsp;·&nbsp; <span data-tooltip="Platinum per Ducat ratio: how much platinum you get per ducat if you sell for plat instead. Compare across items to find the best value.">${ratio}p/d</span> &nbsp;<span class="wfm-ph-ins-dim">— ${tip}</span></span>
        </div>`;
    })() : '';

    const volLabels  = ['🟢 Stable', '🟡 Moderate', '🔴 Volatile'];
    const volClasses = ['wfm-ph-ins-stable', 'wfm-ph-ins-moderate', 'wfm-ph-ins-volatile'];
    const sigIcons   = { buy: '🟢', sell: '🔴', neutral: '🔵' };
    const sigClasses = { buy: 'wfm-ph-ins-buy', sell: 'wfm-ph-ins-sell', neutral: 'wfm-ph-ins-neutral' };

    const insightsHTML = `
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
          </div>` : ''}
        ${ducatChipHTML}
        ${liquidity ? (() => {
          const dots = Array.from({ length: 10 }, (_, i) =>
            `<span class="wfm-ph-liq-dot${i < liquidity.score ? ' wfm-ph-liq-dot-on' : ''}" style="${i < liquidity.score ? `background:var(--wfm-liq-${liquidity.label.toLowerCase()})` : ''}"></span>`
          ).join('');
          return `
          <div class="wfm-ph-insight ${liquidity.cls}">
            <span class="wfm-ph-ins-icon">💧</span>
            <span>
              <b data-tooltip="Liquidity score: how easy it is to trade this item. Based on average daily volume and how many of the last ${liquidity.totalDays} days had at least one trade.">${liquidity.label} liquidity</b>
              <span class="wfm-ph-liq-bar">${dots}</span>
              <span class="wfm-ph-ins-dim">${liquidity.score}/10 · ~${liquidity.avgVol} trades/day · active ${liquidity.activeDays}/${liquidity.totalDays} days</span>
            </span>
          </div>`;
        })() : ''}
      </div>`;

    const widget = document.createElement('div');
    widget.id = WIDGET_ID;
    widget.setAttribute('data-slug', slug);
    widget.innerHTML = `
      <div class="wfm-ph-header">
        <div class="wfm-ph-title-row">
          <svg class="wfm-ph-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6">
            <polyline points="2,14 7,8 11,11 18,4"/>
            <line x1="2" y1="18" x2="18" y2="18"/>
          </svg>
          <span class="wfm-ph-title">Price History</span>
          ${trendStr}
          <button class="wfm-ph-watch-btn" id="wfm-ph-watch-btn" data-tooltip="Add to watchlist — get price alerts for this item">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><polygon points="8,2 10,6 14,6.5 11,9.5 11.8,14 8,11.8 4.2,14 5,9.5 2,6.5 6,6"/></svg>
          </button>
          <div class="wfm-ph-copy-group">
            <button class="wfm-ph-copy-btn" data-copy="${Math.round(last.avg_price ?? last.wa_price ?? 0)}" data-tooltip="Copy average price to clipboard — paste it directly in the WFM trade chat">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="4" width="9" height="10" rx="1"/><path d="M3 3H2a1 1 0 00-1 1v9a1 1 0 001 1h8a1 1 0 001-1v-1"/></svg>
              avg
            </button>
            <button class="wfm-ph-copy-btn" data-copy="${Math.round(last.median ?? 0)}" data-tooltip="Copy median price to clipboard — more reliable than average as it ignores extreme outliers">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="4" width="9" height="10" rx="1"/><path d="M3 3H2a1 1 0 00-1 1v9a1 1 0 001 1h8a1 1 0 001-1v-1"/></svg>
              median
            </button>
          </div>
        </div>
        <div class="wfm-ph-stats-row">
          <div class="wfm-ph-stat">
            <span class="wfm-ph-stat-label" data-tooltip="Lowest closed price in the last 24h">Min</span>
            <span class="wfm-ph-stat-val">${fmt(last.min_price)}</span>
          </div>
          <div class="wfm-ph-stat">
            <span class="wfm-ph-stat-label" data-tooltip="Weighted average of all closed orders in the last 24h">Average</span>
            <span class="wfm-ph-stat-val wfm-ph-avg">${fmt(last.avg_price ?? last.wa_price)}</span>
          </div>
          <div class="wfm-ph-stat">
            <span class="wfm-ph-stat-label" data-tooltip="Highest closed price in the last 24h">Max</span>
            <span class="wfm-ph-stat-val">${fmt(last.max_price)}</span>
          </div>
          <div class="wfm-ph-stat">
            <span class="wfm-ph-stat-label" data-tooltip="Middle price: half of trades were cheaper, half were more expensive">Median</span>
            <span class="wfm-ph-stat-val">${fmt(last.median)}</span>
          </div>
          <div class="wfm-ph-stat">
            <span class="wfm-ph-stat-label" data-tooltip="Number of successfully closed trades in the last 24h">Volume</span>
            <span class="wfm-ph-stat-val">${last.volume ?? '—'}</span>
          </div>
          <div class="wfm-ph-stat wfm-ph-stat-forecast">
            <span class="wfm-ph-stat-label" data-tooltip="Price prediction for 7 days from now, based on linear regression of the last 30 days">Forecast 7d</span>
            <span class="wfm-ph-stat-val">${predStr}</span>
            ${predicted7d ? `<span class="wfm-ph-stat-conf" data-tooltip="Confidence interval: the actual price could be higher or lower by this amount, based on historical volatility">±${forecastData.stdDev}p</span>` : ''}
          </div>
        </div>
        <div class="wfm-ph-tabs" role="tablist">
          <button class="wfm-ph-tab active" data-range="90days"  role="tab">90 days</button>
          <button class="wfm-ph-tab"         data-range="48hours" role="tab">48 hours</button>
        </div>
      </div>
      ${insightsHTML}
      <div class="wfm-ph-chart-wrap" id="wfm-ph-chart-area"></div>
      <div class="wfm-ph-footer">
        <div class="wfm-ph-legend">
          <span class="wfm-ph-leg wfm-ph-leg-avg" data-tooltip="Weighted average closed price per day">— Average</span>
          <span class="wfm-ph-leg wfm-ph-leg-band" data-tooltip="Daily price range: shaded area between the lowest and highest closed prices">░ Min / Max</span>
          <span class="wfm-ph-leg wfm-ph-leg-vol" data-tooltip="Daily trade volume: number of successfully closed orders">▮ Volume</span>
          <span class="wfm-ph-leg wfm-ph-leg-forecast" data-tooltip="7-day price forecast projected using linear regression on the last 30 days">╌ Forecast</span>
        </div>
        <a class="wfm-ph-copyright" href="https://linktr.ee/optrx" target="_blank" rel="noopener">© ${new Date().getFullYear()} OptimusRex</a>
      </div>
    `;

    // Watch button
    const watchBtn = widget.querySelector('#wfm-ph-watch-btn');
    const currentPrice = Math.round(last.avg_price ?? last.wa_price ?? 0);
    const itemName = slugToName(slug);
    getWatchlist().then(list => {
      if (list[slug]) watchBtn.classList.add('wfm-ph-watch-active');
    });
    watchBtn.addEventListener('click', async () => {
      const list = await toggleWatch(slug, itemName, currentPrice);
      watchBtn.classList.toggle('wfm-ph-watch-active', !!list[slug]);
      renderWatchlistPanel();
    });

    // Copy buttons
    widget.querySelectorAll('.wfm-ph-copy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.copy;
        if (!val || val === '0') return;
        navigator.clipboard.writeText(val).then(() => {
          const orig = btn.innerHTML;
          btn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="2,8 6,12 14,4"/></svg> copied!';
          btn.classList.add('wfm-ph-copy-ok');
          setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('wfm-ph-copy-ok'); }, 1500);
        });
      });
    });

    renderChart(widget, days90.length ? days90 : hours48, forecastData);

    widget.querySelectorAll('.wfm-ph-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        widget.querySelectorAll('.wfm-ph-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        // Forecast solo disponible en vista de 90 días (datos diarios)
        const pts = btn.dataset.range === '90days' ? days90 : hours48;
        const fd  = btn.dataset.range === '90days' ? forecastData : null;
        renderChart(widget, pts, fd);
      });
    });

    return widget;
  }

  function renderChart(widget, points, forecastData = null) {
    const area = widget.querySelector('#wfm-ph-chart-area');
    if (!area) return;
    const W = area.clientWidth || 720;
    const H = Math.max(160, Math.round(W * 0.22));
    area.innerHTML = buildChart(points, W, H, forecastData);
  }

  // ── Injection ────────────────────────────────────────────────────────────────

  /*
   * warframe.market es una SPA Nuxt. Las clases CSS están "scoped" con hashes,
   * por lo que no son selectores fiables. En cambio buscamos elementos
   * semánticamente estables: el main, el primer div hijo sustancial, etc.
   * Insertamos el widget ANTES del contenido principal del item.
   */
  // Intenta varios selectores en orden, con MutationObserver + timeout
  function waitForAnchor(timeout = 12000) {
    const SELECTORS = [
      '.row.item_tabs',
      '[class*="item_tabs"]',
      '.item__information',
      '#wfm-itempage-zone-lg',
      'main',
    ];

    return new Promise(resolve => {
      function check() {
        for (const sel of SELECTORS) {
          const el = document.querySelector(sel);
          if (el) return el;
        }
        return null;
      }

      const found = check();
      if (found) { resolve(found); return; }

      const observer = new MutationObserver(() => {
        const el = check();
        if (el) { observer.disconnect(); resolve(el); }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });

      setTimeout(() => { observer.disconnect(); resolve(null); }, timeout);
    });
  }

  // ── Arbitrage ─────────────────────────────────────────────────────────────────

  async function loadArbitrage(slug, statsData, widget) {
    const allItems = await fetchItemParts(slug);
    const parts    = allItems.filter(p => !p.set_root);
    if (!parts.length) return;

    const setDays  = statsData.closed['90days'] ?? [];
    const setLast  = setDays[setDays.length - 1];
    const setPrice = setLast ? Math.round(setLast.wa_price ?? setLast.avg_price ?? 0) : 0;
    if (!setPrice) return;

    // Mostrar sección con skeleton mientras carga
    const section = document.createElement('div');
    section.id    = 'wfm-ph-arbitrage';
    section.className = 'wfm-ph-arb-section';
    section.innerHTML = `
      <div class="wfm-ph-arb-header">
        <span class="wfm-ph-arb-title">ARBITRAGE · SET vs PARTS</span>
        <span class="wfm-ph-arb-loading">Loading…</span>
      </div>`;
    widget.appendChild(section);

    // Fetch precios de partes en paralelo (v2 usa slug, i18n.en.name, ducats)
    const results = await Promise.all(
      parts.map(async p => ({
        name:   p.i18n?.en?.name ?? p.slug,
        qty:    p.qty ?? 1,
        price:  await fetchPartPrice(p.slug),
        ducats: p.ducats ?? 0,
      }))
    );

    if (getItemSlug() !== slug) return;

    const validParts  = results.filter(p => p.price);
    const partsTotal  = validParts.reduce((s, p) => s + p.price * p.qty, 0);
    const ducatsTotal = results.reduce((s, p) => s + (p.ducats ?? 0) * p.qty, 0);
    const diff        = partsTotal - setPrice;
    const diffPct     = Math.round(Math.abs(diff / setPrice) * 100);
    const buyParts    = diff < 0;
    const neutral     = Math.abs(diffPct) < 5;

    let recommendation = '';
    if (neutral) {
      recommendation = `<span class="wfm-ph-arb-neutral">≈ Fair — no significant arbitrage</span>`;
    } else if (buyParts) {
      recommendation = `<span class="wfm-ph-arb-buy">Buy parts separately → save <b>${Math.abs(diff)}p</b> (${diffPct}%)</span>`;
    } else {
      recommendation = `<span class="wfm-ph-arb-sell">Buy set, sell parts → profit <b>+${diff}p</b> (${diffPct}%)</span>`;
    }

    const rows = results.map(p => `
      <div class="wfm-ph-arb-row">
        <span class="wfm-ph-arb-name">${p.name}${p.qty > 1 ? ` <span class="wfm-ph-arb-qty">×${p.qty}</span>` : ''}</span>
        <span class="wfm-ph-arb-ducats">${p.ducats ? `${DUCAT_SVG}${p.ducats}` : ''}</span>
        <span class="wfm-ph-arb-price">${p.price ? `${p.price * p.qty}p` : '—'}</span>
      </div>`).join('');

    section.innerHTML = `
      <div class="wfm-ph-arb-header">
        <span class="wfm-ph-arb-title">ARBITRAGE · SET vs PARTS</span>
      </div>
      <div class="wfm-ph-arb-rows">${rows}</div>
      <div class="wfm-ph-arb-summary">
        <div class="wfm-ph-arb-totals">
          <span>Parts total <b class="wfm-ph-arb-num">${partsTotal}p</b></span>
          <span class="wfm-ph-arb-sep">vs</span>
          <span>Set price <b class="wfm-ph-arb-num">${setPrice}p</b></span>
          ${ducatsTotal > 0 ? `<span class="wfm-ph-arb-sep">·</span><span class="wfm-ph-arb-ducats-total">${DUCAT_SVG} ${ducatsTotal}d total</span>` : ''}
        </div>
        <div class="wfm-ph-arb-rec">${recommendation}</div>
      </div>`;
  }

  // ── Watchlist Panel ───────────────────────────────────────────────────────────

  async function renderWatchlistPanel() {
    const list    = await getWatchlist();
    const slugs   = Object.keys(list);
    let panel     = document.getElementById(PANEL_ID);

    if (!panel) {
      panel = document.createElement('div');
      panel.id = PANEL_ID;
      document.body.appendChild(panel);
    }

    const collapsed = panel.dataset.collapsed === 'true';

    const rows = slugs.length === 0
      ? '<div class="wfm-wl-empty">No items in watchlist yet.<br>Click ★ on any item to add it.</div>'
      : slugs.map(slug => {
          const item    = list[slug];
          const diff    = item.lastPrice - item.priceAtAdd;
          const diffPct = item.priceAtAdd ? Math.round((diff / item.priceAtAdd) * 100) : 0;
          const diffStr = diff === 0 ? '' : diff > 0
            ? `<span class="wfm-wl-up">▲${diff}p (${diffPct}%)</span>`
            : `<span class="wfm-wl-down">▼${Math.abs(diff)}p (${Math.abs(diffPct)}%)</span>`;

          return `
            <div class="wfm-wl-row" data-slug="${slug}">
              <a class="wfm-wl-name" href="/items/${slug}" target="_blank">${item.name}</a>
              <div class="wfm-wl-prices">
                <span class="wfm-wl-price">${item.lastPrice}p</span>
                ${diffStr}
              </div>
              <div class="wfm-wl-alert-row">
                <label class="wfm-wl-alert-label" data-tooltip="Send a notification when price drops below this value">
                  Below
                  <input class="wfm-wl-alert-input" type="number" min="1" placeholder="—"
                    value="${item.alert?.below ?? ''}" data-slug="${slug}" data-dir="below"/>
                </label>
                <label class="wfm-wl-alert-label" data-tooltip="Send a notification when price rises above this value">
                  Above
                  <input class="wfm-wl-alert-input" type="number" min="1" placeholder="—"
                    value="${item.alert?.above ?? ''}" data-slug="${slug}" data-dir="above"/>
                </label>
                <button class="wfm-wl-remove" data-slug="${slug}" data-tooltip="Remove from watchlist">✕</button>
              </div>
            </div>`;
        }).join('');

    panel.innerHTML = `
      <div class="wfm-wl-header" id="wfm-wl-toggle">
        <svg viewBox="0 0 16 16" fill="${collapsed ? 'none' : 'currentColor'}" stroke="currentColor" stroke-width="1.4" class="wfm-wl-star"><polygon points="8,2 10,6 14,6.5 11,9.5 11.8,14 8,11.8 4.2,14 5,9.5 2,6.5 6,6"/></svg>
        <span>Watchlist</span>
        <span class="wfm-wl-count">${slugs.length}</span>
        <span class="wfm-wl-chevron">${collapsed ? '▲' : '▼'}</span>
      </div>
      <div class="wfm-wl-body" style="display:${collapsed ? 'none' : 'block'}">
        ${rows}
        ${slugs.length > 0 ? `<button class="wfm-wl-refresh" id="wfm-wl-refresh" data-tooltip="Refresh all prices now">↻ Refresh prices</button>` : ''}
      </div>`;

    // Toggle collapse
    panel.querySelector('#wfm-wl-toggle').addEventListener('click', () => {
      panel.dataset.collapsed = panel.dataset.collapsed === 'true' ? 'false' : 'true';
      renderWatchlistPanel();
    });

    // Alert inputs
    panel.querySelectorAll('.wfm-wl-alert-input').forEach(input => {
      input.addEventListener('change', async () => {
        const list2 = await getWatchlist();
        const { slug, dir } = input.dataset;
        if (!list2[slug]) return;
        list2[slug].alert = list2[slug].alert ?? {};
        list2[slug].alert[dir] = input.value ? Number(input.value) : null;
        await saveWatchlist(list2);
      });
    });

    // Remove buttons
    panel.querySelectorAll('.wfm-wl-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        const list2 = await getWatchlist();
        delete list2[btn.dataset.slug];
        await saveWatchlist(list2);
        // Update watch star if on that item's page
        if (btn.dataset.slug === getItemSlug()) {
          document.getElementById('wfm-ph-watch-btn')?.classList.remove('wfm-ph-watch-active');
        }
        renderWatchlistPanel();
      });
    });

    // Refresh button
    panel.querySelector('#wfm-wl-refresh')?.addEventListener('click', async () => {
      await sendMsg({ type: 'CHECK_NOW' });
      renderWatchlistPanel();
    });
  }

  async function injectWidget(slug) {
    document.getElementById(WIDGET_ID)?.remove();

    const [statsData, anchorEl, v2Data] = await Promise.all([
      fetchStats(slug).catch(() => null),
      waitForAnchor(),
      slug.includes('prime') ? fetchItemV2(slug) : Promise.resolve(null),
    ]);

    if (getItemSlug() !== slug) return;
    if (!statsData || !anchorEl) return;
    if (document.getElementById(WIDGET_ID)) return;

    const widget = buildWidget(slug, statsData, v2Data);
    if (!widget) return;

    if (anchorEl.id === 'wfm-itempage-zone-lg') {
      anchorEl.insertAdjacentElement('afterend', widget);
    } else if (anchorEl.tagName === 'MAIN') {
      anchorEl.insertBefore(widget, anchorEl.firstElementChild);
    } else {
      anchorEl.parentElement.insertBefore(widget, anchorEl);
    }

    window.addEventListener('resize', () => {
      const activeTab = widget.querySelector('.wfm-ph-tab.active');
      if (!activeTab) return;
      const pts = activeTab.dataset.range === '90days'
        ? (statsData.closed['90days']  || []).slice(-90)
        : (statsData.closed['48hours'] || []).slice(-48);
      renderChart(widget, pts);
    }, { passive: true });

    // Arbitrage: solo para páginas de set
    if (slug.endsWith('_set')) {
      loadArbitrage(slug, statsData, widget);
    }
  }

  // ── SPA Navigation ───────────────────────────────────────────────────────────

  function onNavigate() {
    const slug = getItemSlug();

    if (!slug) {
      document.getElementById(WIDGET_ID)?.remove();
      currentSlug = null;
      return;
    }

    if (slug === currentSlug) return;
    currentSlug = slug;
    injectWidget(slug);
  }

  // Observar cambios de URL mediante polling — cubre pushState, replaceState,
  // popstate y cualquier mecanismo interno del router de Vue/Nuxt.
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      onNavigate();
    }
  }, 300);

  // Carga inicial
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { onNavigate(); renderWatchlistPanel(); });
  } else {
    onNavigate();
    renderWatchlistPanel();
  }

})();
