/* ============================================================
   WFM Tracker — Dashboard panel
   Standalone extension page. Uses shared.js for data/chart/
   insight logic. Accesses storage directly (no message passing).
   ============================================================ */

'use strict';

// ── Storage (direct, no message relay needed in extension pages) ──────────────

function getWatchlist() {
  return browser.storage.local.get('watchlist').then(r => r.watchlist ?? {});
}

function saveWatchlist(list) {
  return browser.storage.local.set({ watchlist: list });
}

// ── State ─────────────────────────────────────────────────────────────────────

let currentSlug  = null;
let currentRange = '90days';

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const copy = document.getElementById('wfm-panel-copyright');
  if (copy) copy.textContent = `© ${new Date().getFullYear()} OptimusRex · v${browser.runtime.getManifest().version}`;

  setupSearch();
  renderSidebar();

  const slug = new URLSearchParams(location.search).get('item');
  if (slug) loadItem(slug);
});

// ── Search ────────────────────────────────────────────────────────────────────

function toSlug(name) {
  return name.trim().toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_');
}

function setupSearch() {
  const input = document.getElementById('wfm-panel-search');

  function submit() {
    const slug = toSlug(input.value);
    if (slug) loadItem(slug);
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
  });

  // Search button click (the icon acts as submit)
  document.querySelector('.wfm-panel-search-icon')
    ?.addEventListener('click', submit);
}

// ── Load item ─────────────────────────────────────────────────────────────────

async function loadItem(slug) {
  currentSlug  = slug;
  currentRange = '90days';

  const url = new URL(location.href);
  url.searchParams.set('item', slug);
  history.replaceState(null, '', url);

  // Update active state in sidebar
  document.querySelectorAll('.wfm-panel-wl-row').forEach(r => {
    r.classList.toggle('wfm-panel-wl-active', r.dataset.slug === slug);
  });

  const content = document.getElementById('wfm-panel-content');
  content.innerHTML = '<div class="wfm-panel-loading">Loading…</div>';

  try {
    const [statsData, v2Data, spreadData, vaultData] = await Promise.all([
      fetchStats(slug),
      slug.includes('prime') ? fetchItemV2(slug) : Promise.resolve(null),
      fetchSpread(slug).catch(() => null),
      loadVaultData(),
    ]);

    if (currentSlug !== slug) return;
    renderItem(slug, statsData, v2Data, spreadData, vaultData);
  } catch (e) {
    if (currentSlug !== slug) return;
    content.innerHTML = `<div class="wfm-panel-error">Failed to load data for this item.</div>`;
  }
}

// ── Render item ───────────────────────────────────────────────────────────────

async function renderItem(slug, statsData, v2Data, spreadData, vaultData) {
  const days90  = (statsData.closed['90days']  || []).slice(-90);
  const hours48 = (statsData.closed['48hours'] || []).slice(-48);

  const activeSet    = days90.length ? days90 : hours48;
  if (!activeSet.length) {
    document.getElementById('wfm-panel-content').innerHTML =
      '<div class="wfm-panel-error">No price data available for this item.</div>';
    return;
  }

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

  const isPrime   = v2Data?.tags?.includes('prime') ?? slug.includes('prime');
  const ducats    = v2Data?.ducats ?? 0;
  const platPrice = Math.round(last.wa_price ?? last.avg_price ?? 0);
  const vaultStatus = calcVaultStatus(slug, vaultData);

  const predStr = predicted7d
    ? (predicted7d.avg > platPrice
        ? `<span class="wfm-ph-up">↑ ${fmt(predicted7d.avg)}</span>`
        : `<span class="wfm-ph-down">↓ ${fmt(predicted7d.avg)}</span>`)
    : '—';

  const watchlist   = await getWatchlist();
  const isWatched   = !!watchlist[slug];
  const itemName    = slugToName(slug);

  const insightsHTML = buildInsightsHTML({
    signal,
    volatility,
    bestHour,
    ducatData: (isPrime && ducats > 0) ? { ducats, platPrice } : null,
    spreadData,
    vaultStatus,
    liquidity,
  });

  const content = document.getElementById('wfm-panel-content');
  content.innerHTML = `
    <div class="wfm-panel-item-header">
      <div class="wfm-panel-item-title-row">
        <span class="wfm-panel-item-name">${esc(itemName)}</span>
        ${trend !== 0 ? `<span class="wfm-panel-item-trend ${trend > 0 ? 'up' : 'down'}">${trend > 0 ? '▲' : '▼'} ${fmt(Math.abs(trend))} <span style="font-weight:400;opacity:0.6;font-size:10px">7d</span></span>` : ''}
        <button class="wfm-panel-watch-btn ${isWatched ? 'active' : ''}" id="wfm-panel-watch-btn">
          <svg viewBox="0 0 16 16" fill="${isWatched ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.4">
            <polygon points="8,2 10,6 14,6.5 11,9.5 11.8,14 8,11.8 4.2,14 5,9.5 2,6.5 6,6"/>
          </svg>
          ${isWatched ? 'Watching' : 'Watch'}
        </button>
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
          ${predicted7d ? `<span class="wfm-ph-stat-conf" data-tooltip="Confidence interval: actual price could differ by this amount based on historical volatility">±${forecastData.stdDev}p</span>` : ''}
        </div>
      </div>
    </div>

    <div class="wfm-panel-tabs">
      <button class="wfm-panel-tab active" data-range="90days">90 days</button>
      <button class="wfm-panel-tab" data-range="48hours">48 hours</button>
    </div>

    <div class="wfm-panel-chart-wrap" id="wfm-panel-chart-area"></div>

    <div class="wfm-panel-legend">
      <span class="wfm-ph-leg wfm-ph-leg-avg" data-tooltip="Weighted average closed price per day">— Average</span>
      <span class="wfm-ph-leg wfm-ph-leg-band" data-tooltip="Daily price range: shaded area between lowest and highest closed prices">░ Min / Max</span>
      <span class="wfm-ph-leg wfm-ph-leg-vol" data-tooltip="Daily trade volume: number of successfully closed orders">▮ Volume</span>
      <span class="wfm-ph-leg wfm-ph-leg-forecast" data-tooltip="7-day price forecast projected using linear regression on the last 30 days">╌ Forecast</span>
    </div>

    ${insightsHTML}

    <div id="wfm-panel-arb-zone"></div>
  `;

  // Draw initial chart
  drawChart(days90.length ? days90 : hours48, forecastData);

  // Tab switching
  content.querySelectorAll('.wfm-panel-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      content.querySelectorAll('.wfm-panel-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentRange = btn.dataset.range;
      const pts = currentRange === '90days' ? days90 : hours48;
      const fd  = currentRange === '90days' ? forecastData : null;
      drawChart(pts, fd);
    });
  });

  // Watch button
  content.querySelector('#wfm-panel-watch-btn').addEventListener('click', async () => {
    await toggleWatch(slug, itemName, platPrice);
    renderSidebar();
    // Re-render button state
    const btn = content.querySelector('#wfm-panel-watch-btn');
    const list = await getWatchlist();
    const watched = !!list[slug];
    btn.classList.toggle('active', watched);
    btn.innerHTML = `
      <svg viewBox="0 0 16 16" fill="${watched ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.4">
        <polygon points="8,2 10,6 14,6.5 11,9.5 11.8,14 8,11.8 4.2,14 5,9.5 2,6.5 6,6"/>
      </svg>
      ${watched ? 'Watching' : 'Watch'}`;
  });

  // Resize
  window.addEventListener('resize', () => {
    const pts = currentRange === '90days' ? days90 : hours48;
    const fd  = currentRange === '90days' ? forecastData : null;
    drawChart(pts, fd);
  }, { passive: true });

  // Arbitrage for set items
  if (slug.endsWith('_set')) {
    loadArbitrage(slug, statsData);
  }
}

function drawChart(points, forecastData = null) {
  const area = document.getElementById('wfm-panel-chart-area');
  if (!area) return;
  const W = area.clientWidth || 900;
  const H = Math.max(200, Math.round(W * 0.22));
  area.innerHTML = buildChart(points, W, H, forecastData);
}

// ── Watchlist toggle ──────────────────────────────────────────────────────────

async function toggleWatch(slug, name, price) {
  const list = await getWatchlist();
  if (list[slug]) {
    delete list[slug];
  } else {
    list[slug] = {
      name,
      slug,
      addedAt: Date.now(),
      priceAtAdd: price,
      lastPrice: price,
      lastChecked: Date.now(),
      alert: { below: null, above: null },
    };
  }
  await saveWatchlist(list);
  return list;
}

// ── Sidebar / Watchlist ───────────────────────────────────────────────────────

async function renderSidebar() {
  const list  = await getWatchlist();
  const slugs = Object.keys(list);
  const body  = document.getElementById('wfm-panel-wl-body');
  const count = document.getElementById('wfm-panel-wl-count');
  const refreshBtn = document.getElementById('wfm-panel-wl-refresh');

  count.textContent = slugs.length;

  if (!slugs.length) {
    body.innerHTML = '<div class="wfm-panel-wl-empty">No items yet.<br>Click Watch on any item to add it.</div>';
    refreshBtn.style.display = 'none';
    return;
  }

  refreshBtn.style.display = '';

  body.innerHTML = slugs.map(slug => {
    const item    = list[slug];
    const diff    = item.lastPrice - item.priceAtAdd;
    const diffPct = item.priceAtAdd ? Math.round((diff / item.priceAtAdd) * 100) : 0;
    const diffStr = diff === 0 ? '' : diff > 0
      ? `<span class="wfm-panel-wl-up">▲${diff}p (${diffPct}%)</span>`
      : `<span class="wfm-panel-wl-down">▼${Math.abs(diff)}p (${Math.abs(diffPct)}%)</span>`;
    const isActive = slug === currentSlug;

    return `
      <div class="wfm-panel-wl-row ${isActive ? 'wfm-panel-wl-active' : ''}" data-slug="${slug}">
        <span class="wfm-panel-wl-name">${esc(item.name)}</span>
        <div class="wfm-panel-wl-prices">
          <span class="wfm-panel-wl-price">${item.lastPrice}p</span>
          ${diffStr}
        </div>
        <div class="wfm-panel-wl-alerts">
          <label class="wfm-panel-wl-alert-label" data-tooltip="Alert when price drops below this">
            Below
            <input class="wfm-panel-wl-alert-input" type="number" min="1" placeholder="—"
              value="${item.alert?.below ?? ''}" data-slug="${slug}" data-dir="below">
          </label>
          <label class="wfm-panel-wl-alert-label" data-tooltip="Alert when price rises above this">
            Above
            <input class="wfm-panel-wl-alert-input" type="number" min="1" placeholder="—"
              value="${item.alert?.above ?? ''}" data-slug="${slug}" data-dir="above">
          </label>
        </div>
        <div class="wfm-panel-wl-row-actions">
          <button class="wfm-panel-wl-remove" data-slug="${slug}" title="Remove from watchlist">✕</button>
        </div>
      </div>`;
  }).join('');

  // Click row → load item
  body.querySelectorAll('.wfm-panel-wl-row').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('.wfm-panel-wl-alert-input, .wfm-panel-wl-remove')) return;
      const input = document.getElementById('wfm-panel-search');
      input.value = list[row.dataset.slug]?.name ?? '';
      loadItem(row.dataset.slug);
    });
  });

  // Alert inputs
  body.querySelectorAll('.wfm-panel-wl-alert-input').forEach(input => {
    input.addEventListener('change', async () => {
      const list2 = await getWatchlist();
      const { slug, dir } = input.dataset;
      if (!list2[slug]) return;
      list2[slug].alert = list2[slug].alert ?? {};
      list2[slug].alert[dir] = input.value ? Number(input.value) : null;
      await saveWatchlist(list2);
    });
    input.addEventListener('click', e => e.stopPropagation());
  });

  // Remove buttons
  body.querySelectorAll('.wfm-panel-wl-remove').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const list2 = await getWatchlist();
      delete list2[btn.dataset.slug];
      await saveWatchlist(list2);
      if (btn.dataset.slug === currentSlug) {
        const watchBtn = document.getElementById('wfm-panel-watch-btn');
        if (watchBtn) {
          watchBtn.classList.remove('active');
          watchBtn.innerHTML = `
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
              <polygon points="8,2 10,6 14,6.5 11,9.5 11.8,14 8,11.8 4.2,14 5,9.5 2,6.5 6,6"/>
            </svg>
            Watch`;
        }
      }
      renderSidebar();
    });
  });

  refreshBtn.onclick = async () => {
    await browser.runtime.sendMessage({ type: 'CHECK_NOW' });
    setTimeout(renderSidebar, 500);
  };
}

// ── Arbitrage ─────────────────────────────────────────────────────────────────

async function loadArbitrage(slug, statsData) {
  const zone = document.getElementById('wfm-panel-arb-zone');
  if (!zone) return;

  zone.innerHTML = `
    <div class="wfm-ph-arb-section" style="margin:0 24px 16px">
      <div class="wfm-ph-arb-header">
        <span class="wfm-ph-arb-title">ARBITRAGE · SET vs PARTS</span>
        <span class="wfm-ph-arb-loading">Loading…</span>
      </div>
    </div>`;

  const allParts = await fetchItemParts(slug);
  const parts    = allParts.filter(p => !p.set_root);
  if (!parts.length) { zone.innerHTML = ''; return; }

  const setDays  = statsData.closed['90days'] ?? [];
  const setLast  = setDays[setDays.length - 1];
  const setPrice = setLast ? Math.round(setLast.wa_price ?? setLast.avg_price ?? 0) : 0;
  if (!setPrice) { zone.innerHTML = ''; return; }

  if (currentSlug !== slug) return;

  const results = await Promise.all(
    parts.map(async p => ({
      name:   p.i18n?.en?.name ?? p.slug,
      qty:    p.qty ?? 1,
      price:  await fetchPartPrice(p.slug),
      ducats: p.ducats ?? 0,
    }))
  );

  if (currentSlug !== slug) return;

  const validParts  = results.filter(p => p.price);
  const partsTotal  = validParts.reduce((s, p) => s + p.price * p.qty, 0);
  const ducatsTotal = results.reduce((s, p) => s + (p.ducats ?? 0) * p.qty, 0);
  const diff        = partsTotal - setPrice;
  const diffPct     = Math.round(Math.abs(diff / setPrice) * 100);

  let recommendation = '';
  if (Math.abs(diffPct) < 5) {
    recommendation = `<span class="wfm-ph-arb-neutral">≈ Fair — no significant arbitrage</span>`;
  } else if (diff < 0) {
    recommendation = `<span class="wfm-ph-arb-buy">Buy parts separately → save <b>${Math.abs(diff)}p</b> (${diffPct}%)</span>`;
  } else {
    recommendation = `<span class="wfm-ph-arb-sell">Buy set, sell parts → profit <b>+${diff}p</b> (${diffPct}%)</span>`;
  }

  const rows = results.map(p => `
    <div class="wfm-ph-arb-row">
      <span class="wfm-ph-arb-name">${esc(p.name)}${p.qty > 1 ? ` <span class="wfm-ph-arb-qty">×${p.qty}</span>` : ''}</span>
      <span class="wfm-ph-arb-ducats">${p.ducats ? `${DUCAT_SVG}${p.ducats}` : ''}</span>
      <span class="wfm-ph-arb-price">${p.price ? `${p.price * p.qty}p` : '—'}</span>
    </div>`).join('');

  zone.innerHTML = `
    <div class="wfm-ph-arb-section" style="margin:0 24px 16px">
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
      </div>
    </div>`;
}
