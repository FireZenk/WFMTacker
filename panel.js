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

function getRecentlyViewed() {
  return browser.storage.local.get('recentlyViewed').then(r => r.recentlyViewed ?? []);
}

async function trackRecentlyViewed(slug, name) {
  const list = await getRecentlyViewed();
  const filtered = list.filter(e => e.slug !== slug);
  filtered.unshift({ slug, name });
  await browser.storage.local.set({ recentlyViewed: filtered.slice(0, 10) });
}

// ── State ─────────────────────────────────────────────────────────────────────

let currentSlug    = null;
let currentRange   = '90days';
let navHistory     = [];
let navIndex       = -1;
let sidebarTab     = 'watchlist'; // 'watchlist' | 'alerts'
let selectMode     = false;
let selectedSlugs  = new Set();

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const copy = document.getElementById('wfm-panel-copyright');
  if (copy) copy.textContent = `© ${new Date().getFullYear()} OptimusRex · v${browser.runtime.getManifest().version}`;

  setupSearch();
  setupImportButton();
  renderSidebar();

  document.getElementById('wfm-tab-watchlist')?.addEventListener('click', () => {
    sidebarTab = 'watchlist'; selectMode = false; selectedSlugs.clear(); renderSidebar();
  });
  document.getElementById('wfm-tab-alerts')?.addEventListener('click', () => {
    sidebarTab = 'alerts'; selectMode = false; selectedSlugs.clear(); renderSidebar();
  });

  document.getElementById('wfm-panel-open-settings')?.addEventListener('click', () => {
    browser.runtime.openOptionsPage();
  });

  document.getElementById('wfm-nav-back')?.addEventListener('click', () => {
    if (navIndex <= 0) return;
    navIndex--;
    loadItem(navHistory[navIndex]);
    updateNavBtns();
  });

  document.getElementById('wfm-nav-fwd')?.addEventListener('click', () => {
    if (navIndex >= navHistory.length - 1) return;
    navIndex++;
    loadItem(navHistory[navIndex]);
    updateNavBtns();
  });

  const slug = new URLSearchParams(location.search).get('item');
  if (slug) navigateTo(slug);
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
    if (slug) navigateTo(slug);
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
  });

  // Search button click (the icon acts as submit)
  document.querySelector('.wfm-panel-search-icon')
    ?.addEventListener('click', submit);
}

// ── Navigation history ────────────────────────────────────────────────────────

function navigateTo(slug) {
  navHistory = navHistory.slice(0, navIndex + 1);
  navHistory.push(slug);
  navIndex = navHistory.length - 1;
  loadItem(slug);
  updateNavBtns();
}

function updateNavBtns() {
  const back = document.getElementById('wfm-nav-back');
  const fwd  = document.getElementById('wfm-nav-fwd');
  if (back) back.disabled = navIndex <= 0;
  if (fwd)  fwd.disabled  = navIndex >= navHistory.length - 1;
}

// ── Load item ─────────────────────────────────────────────────────────────────

async function loadItem(slug) {
  currentSlug  = slug;
  currentRange = '90days'; // overridden by settings in renderItem

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
    const [statsData, v2Data, vaultData, settings, watchlist] = await Promise.all([
      fetchStats(slug),
      fetchItemV2(slug).catch(() => null),
      loadVaultData(),
      getSettings(),
      getWatchlist(),
    ]);

    if (currentSlug !== slug) return;
    renderItem(slug, statsData, v2Data, vaultData, settings, watchlist[slug]?.rank ?? null);
  } catch (e) {
    if (currentSlug !== slug) return;
    content.innerHTML = `<div class="wfm-panel-error">Failed to load data for this item.</div>`;
  }
}

// ── Render item ───────────────────────────────────────────────────────────────

async function renderItem(slug, statsData, v2Data, vaultData, settings = DEFAULT_SETTINGS, savedRank = null) {
  currentRange = settings.defaultRange;
  const allDays90  = statsData.closed['90days']  || [];
  const allHours48 = statsData.closed['48hours'] || [];
  const rankSplit90  = splitByRank(allDays90);
  const rankSplit48  = splitByRank(allHours48);
  const hasRanks     = !!rankSplit90;
  let   curRank      = hasRanks ? resolveRank(savedRank, rankSplit90) : null;

  let curDays90  = rankSplit90 ? (rankSplit90[`r${curRank}`] || []).slice(-90) : allDays90.slice(-90);
  let curHours48 = rankSplit48 ? (rankSplit48[`r${curRank}`] || []).slice(-48) : allHours48.slice(-48);

  const activeSet = curDays90.length ? curDays90 : curHours48;
  if (!activeSet.length) {
    document.getElementById('wfm-panel-content').innerHTML =
      '<div class="wfm-panel-error">No price data available for this item.</div>';
    return;
  }

  let curForecast = calcForecast(curDays90.length >= 7 ? curDays90 : curHours48);

  const last    = activeSet[activeSet.length - 1] || {};
  const trend   = activeSet.length >= 8
    ? (activeSet[activeSet.length - 1].avg_price ?? 0) - (activeSet[activeSet.length - 8].avg_price ?? 0)
    : 0;

  const isPrime     = v2Data?.tags?.includes('prime') ?? slug.includes('prime');
  const ducats      = v2Data?.ducats ?? 0;
  const platPrice   = Math.round(last.wa_price ?? last.avg_price ?? 0);
  const vaultStatus = calcVaultStatus(slug, vaultData);

  const watchlist = await getWatchlist();
  const isWatched = !!watchlist[slug];
  const itemName  = slugToName(slug);

  await trackRecentlyViewed(slug, itemName);
  renderSidebar();

  function buildPanelStatsInner(d90, d48, fd) {
    const active      = d90.length ? d90 : d48;
    const lp          = active[active.length - 1] || {};
    const predicted7d = fd?.forecast?.[6] ?? null;
    const lp_plat     = Math.round(lp.wa_price ?? lp.avg_price ?? 0);
    const predStr     = predicted7d
      ? (predicted7d.avg > lp_plat
          ? `<span class="wfm-ph-up">↑ ${fmt(predicted7d.avg)}</span>`
          : `<span class="wfm-ph-down">↓ ${fmt(predicted7d.avg)}</span>`)
      : '—';
    return `
        <div class="wfm-ph-stat">
          <span class="wfm-ph-stat-label" data-tooltip="Lowest closed price in the last 24h">Min</span>
          <span class="wfm-ph-stat-val">${fmt(lp.min_price)}</span>
        </div>
        <div class="wfm-ph-stat">
          <span class="wfm-ph-stat-label" data-tooltip="Weighted average of all closed orders in the last 24h">Average</span>
          <span class="wfm-ph-stat-val wfm-ph-avg">${fmt(lp.avg_price ?? lp.wa_price)}</span>
        </div>
        <div class="wfm-ph-stat">
          <span class="wfm-ph-stat-label" data-tooltip="Highest closed price in the last 24h">Max</span>
          <span class="wfm-ph-stat-val">${fmt(lp.max_price)}</span>
        </div>
        <div class="wfm-ph-stat">
          <span class="wfm-ph-stat-label" data-tooltip="Middle price: half of trades were cheaper, half were more expensive">Median</span>
          <span class="wfm-ph-stat-val">${fmt(lp.median)}</span>
        </div>
        <div class="wfm-ph-stat">
          <span class="wfm-ph-stat-label" data-tooltip="Number of successfully closed trades in the last 24h">Volume</span>
          <span class="wfm-ph-stat-val">${lp.volume ?? '—'}</span>
        </div>
        ${settings.showForecast ? `
        <div class="wfm-ph-stat wfm-ph-stat-forecast">
          <span class="wfm-ph-stat-label" data-tooltip="Price prediction for 7 days from now, based on linear regression of the last 30 days">Forecast 7d</span>
          <span class="wfm-ph-stat-val">${predStr}</span>
          ${predicted7d ? `<span class="wfm-ph-stat-conf" data-tooltip="Confidence interval: actual price could differ by this amount based on historical volatility">±${fd.stdDev}p</span>` : ''}
        </div>` : ''}`;
  }

  function buildPanelInsights(d90, d48) {
    const active      = d90.length ? d90 : d48;
    const lp          = active[active.length - 1] || {};
    const lp_plat     = Math.round(lp.wa_price ?? lp.avg_price ?? 0);
    return buildInsightsHTML({
      signal:     settings.showSignal     ? calcSignal(d90)                        : null,
      volatility: settings.showVolatility ? calcVolatility(d90)                    : null,
      bestHour:   settings.showBestHour   ? calcBestHour(d48, settings.timezone)   : null,
      ducatData:  (isPrime && ducats > 0) ? { ducats, platPrice: lp_plat } : null,
      vaultStatus,
      liquidity:  settings.showLiquidity  ? calcLiquidity(d90)                     : null,
      settings,
    });
  }

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
        <button class="wfm-panel-export-btn" id="wfm-panel-export-btn" data-tooltip="Export price history as CSV">↓ CSV</button>
      </div>

      <div class="wfm-ph-stats-row" id="wfm-panel-stats-row">
        ${buildPanelStatsInner(curDays90, curHours48, curForecast)}
      </div>
    </div>

    <div class="wfm-panel-tabs">
      <button class="wfm-panel-tab${settings.defaultRange === '90days'  ? ' active' : ''}" data-range="90days">90 days</button>
      <button class="wfm-panel-tab${settings.defaultRange === '48hours' ? ' active' : ''}" data-range="48hours">48 hours</button>
      ${hasRanks ? `
      <div class="wfm-ph-rank-toggle">
        ${rankSplit90.ranks.map(r => `<button class="wfm-ph-rank-btn${curRank === r ? ' active' : ''}" data-rank="${r}">${rankLabel(r, rankSplit90.ranks)}</button>`).join('')}
      </div>` : ''}
    </div>

    <div class="wfm-panel-chart-wrap" id="wfm-panel-chart-area"></div>

    <div class="wfm-panel-legend">
      <span class="wfm-ph-leg wfm-ph-leg-avg" data-tooltip="Weighted average closed price per day">— Average</span>
      <span class="wfm-ph-leg wfm-ph-leg-band" data-tooltip="Daily price range: shaded area between lowest and highest closed prices">░ Min / Max</span>
      <span class="wfm-ph-leg wfm-ph-leg-vol" data-tooltip="Daily trade volume: number of successfully closed orders">▮ Volume</span>
      <span class="wfm-ph-leg wfm-ph-leg-forecast" data-tooltip="7-day price forecast projected using linear regression on the last 30 days">╌ Forecast</span>
    </div>

    <div id="wfm-panel-insights-zone">${buildPanelInsights(curDays90, curHours48)}</div>

    <div id="wfm-panel-arb-zone"></div>

    <div id="wfm-panel-notes-zone"></div>
  `;

  const initPts = settings.defaultRange === '48hours' ? curHours48 : curDays90;
  drawChart(initPts.length ? initPts : (settings.defaultRange === '48hours' ? curDays90 : curHours48),
            settings.defaultRange === '48hours' ? null : curForecast);

  content.querySelectorAll('.wfm-panel-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      content.querySelectorAll('.wfm-panel-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentRange = btn.dataset.range;
      const pts = currentRange === '90days' ? curDays90 : curHours48;
      const fd  = currentRange === '90days' ? curForecast : null;
      drawChart(pts, fd);
    });
  });

  if (hasRanks) {
    content.querySelectorAll('.wfm-ph-rank-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        curRank = +btn.dataset.rank;
        content.querySelectorAll('.wfm-ph-rank-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const list = await getWatchlist();
        if (list[slug]) { list[slug].rank = curRank; await saveWatchlist(list); }

        curDays90   = (rankSplit90[`r${curRank}`] || []).slice(-90);
        curHours48  = (rankSplit48?.[`r${curRank}`] || []).slice(-48);
        curForecast = calcForecast(curDays90.length >= 7 ? curDays90 : curHours48);

        document.getElementById('wfm-panel-stats-row').innerHTML    = buildPanelStatsInner(curDays90, curHours48, curForecast);
        document.getElementById('wfm-panel-insights-zone').innerHTML = buildPanelInsights(curDays90, curHours48);

        const pts = currentRange === '90days' ? curDays90 : curHours48;
        const fd  = currentRange === '90days' ? curForecast : null;
        drawChart(pts, fd);
      });
    });
  }

  content.querySelector('#wfm-panel-watch-btn').addEventListener('click', async () => {
    const liveSet = curDays90.length ? curDays90 : curHours48;
    const livePrice = Math.round((liveSet.at(-1) ?? {}).wa_price ?? (liveSet.at(-1) ?? {}).avg_price ?? 0);
    await toggleWatch(slug, itemName, livePrice, hasRanks ? curRank : null);
    renderSidebar();
    const btn = content.querySelector('#wfm-panel-watch-btn');
    const list = await getWatchlist();
    const watched = !!list[slug];
    btn.classList.toggle('active', watched);
    btn.innerHTML = `
      <svg viewBox="0 0 16 16" fill="${watched ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.4">
        <polygon points="8,2 10,6 14,6.5 11,9.5 11.8,14 8,11.8 4.2,14 5,9.5 2,6.5 6,6"/>
      </svg>
      ${watched ? 'Watching' : 'Watch'}`;
    renderNotesZone(watched, list[slug]?.note ?? '');
  });

  content.querySelector('#wfm-panel-export-btn').addEventListener('click', () => {
    const rows = [['date', 'avg_price', 'wa_price', 'min_price', 'max_price', 'volume', 'mod_rank']];
    const allDays = statsData.closed['90days'] || [];
    allDays.forEach(d => rows.push([
      d.datetime ?? '', d.avg_price ?? '', d.wa_price ?? '',
      d.min_price ?? '', d.max_price ?? '', d.volume ?? '', d.mod_rank ?? '',
    ]));
    downloadCSV(rows, `wfm-${slug}-90d.csv`);
  });

  const renderNotesZone = (watched, note = '') => {
    const zone = document.getElementById('wfm-panel-notes-zone');
    if (!zone) return;
    if (!watched) { zone.innerHTML = ''; return; }
    zone.innerHTML = `
      <div class="wfm-panel-notes">
        <textarea class="wfm-panel-notes-input" placeholder="Add a note…" maxlength="500">${esc(note)}</textarea>
      </div>`;
    const ta = zone.querySelector('.wfm-panel-notes-input');
    ta.addEventListener('input', debounce(async () => {
      const list = await getWatchlist();
      if (list[slug]) { list[slug].note = ta.value; await saveWatchlist(list); }
    }, 500));
  };

  renderNotesZone(isWatched, watchlist[slug]?.note ?? '');

  window.addEventListener('resize', () => {
    const pts = currentRange === '90days' ? curDays90 : curHours48;
    const fd  = currentRange === '90days' ? curForecast : null;
    drawChart(pts, fd);
  }, { passive: true });

  if (slug.endsWith('_set') && settings.showArbitrage) {
    loadArbitrage(slug, statsData);
  }
}

// ── CSV export ────────────────────────────────────────────────────────────────

function downloadCSV(rows, filename) {
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
    download: filename,
  });
  a.click();
  URL.revokeObjectURL(a.href);
}

async function exportWatchlistCSV() {
  const list = await getWatchlist();
  const rows = [['name', 'slug', 'last_price', 'price_at_add', 'added_at', 'alert_below', 'alert_above', 'rank', 'note']];
  Object.values(list).forEach(item => rows.push([
    item.name, item.slug, item.lastPrice ?? '', item.priceAtAdd ?? '',
    item.addedAt ? new Date(item.addedAt).toISOString().slice(0, 10) : '',
    item.alert?.below ?? '', item.alert?.above ?? '',
    item.rank ?? '', item.note ?? '',
  ]));
  downloadCSV(rows, `wfm-watchlist-${new Date().toISOString().slice(0, 10)}.csv`);
}

// ── CSV import ──────────────────────────────────────────────────────────────────

async function importWatchlistCSV(file) {
  const text     = await file.text();
  const imported = csvToWatchlist(text);
  const count    = Object.keys(imported).length;
  if (!count) {
    alert('No valid items found in CSV. Make sure the file has a "slug" column.');
    return;
  }
  const current = await getWatchlist();
  // Overwrite matching slugs, keep the rest.
  await saveWatchlist({ ...current, ...imported });
  await renderSidebar();
}

function setupImportButton() {
  const importBtn  = document.getElementById('wfm-panel-wl-import');
  const importFile = document.getElementById('wfm-panel-wl-import-file');
  if (!importBtn || !importFile) return;
  importBtn.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', async () => {
    const file = importFile.files[0];
    importFile.value = '';  // allow re-importing the same file
    if (!file) return;
    try {
      await importWatchlistCSV(file);
    } catch (e) {
      console.warn('[WFM-PH] import error:', e.message);
      alert('Could not import CSV: ' + e.message);
    }
  });
}

function drawChart(points, forecastData = null) {
  const area = document.getElementById('wfm-panel-chart-area');
  if (!area) return;
  const W = area.clientWidth || 900;
  const H = Math.max(200, Math.round(W * 0.22));
  area.innerHTML = buildChart(points, W, H, forecastData);
  setupChartTooltips(area);
}

// ── Watchlist toggle ──────────────────────────────────────────────────────────

async function toggleWatch(slug, name, price, rank = null) {
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
      rank,
      note: '',
    };
  }
  await saveWatchlist(list);
  return list;
}

// ── Sidebar / Watchlist ───────────────────────────────────────────────────────

function alertProximity(price, below, above) {
  const entries = [];
  if (below != null && price > 0) {
    const dist    = price - below;
    const pct     = Math.round((dist / price) * 100);
    const fill    = Math.min(100, Math.round((below / price) * 100));
    const urgent  = pct <= 5 ? 'red' : pct <= 20 ? 'orange' : 'teal';
    entries.push({ dir: 'below', threshold: below, dist, pct, fill, urgent });
  }
  if (above != null && price > 0) {
    const dist    = above - price;
    const pct     = Math.round((dist / above) * 100);
    const fill    = Math.min(100, Math.round((price / above) * 100));
    const urgent  = pct <= 5 ? 'red' : pct <= 20 ? 'orange' : 'teal';
    entries.push({ dir: 'above', threshold: above, dist, pct, fill, urgent });
  }
  return entries;
}

async function renderSidebar() {
  const list    = await getWatchlist();
  const slugs   = Object.keys(list);
  const body    = document.getElementById('wfm-panel-wl-body');
  const count   = document.getElementById('wfm-panel-wl-count');
  const alertCount    = document.getElementById('wfm-panel-alert-count');
  const refreshBtn    = document.getElementById('wfm-panel-wl-refresh');
  const bundleBtn     = document.getElementById('wfm-panel-wl-bundle');
  const exportBtn     = document.getElementById('wfm-panel-wl-export');
  const importBtn     = document.getElementById('wfm-panel-wl-import');
  const selectBtn     = document.getElementById('wfm-panel-wl-select');
  const selectBar     = document.getElementById('wfm-panel-select-bar');
  const recentSection = document.getElementById('wfm-panel-recent-section');
  const recentBody    = document.getElementById('wfm-panel-recent-body');

  // Tab active state
  document.getElementById('wfm-tab-watchlist').classList.toggle('active', sidebarTab === 'watchlist');
  document.getElementById('wfm-tab-alerts').classList.toggle('active', sidebarTab === 'alerts');

  // Recently viewed (only in watchlist tab)
  const recent = await getRecentlyViewed();
  if (recent.length && sidebarTab === 'watchlist') {
    recentSection.style.display = '';
    recentBody.innerHTML = recent.map(e => `
      <div class="wfm-panel-recent-row ${e.slug === currentSlug ? 'wfm-panel-wl-active' : ''}" data-slug="${e.slug}">
        ${esc(e.name)}
      </div>`).join('');
    recentBody.querySelectorAll('.wfm-panel-recent-row').forEach(row =>
      row.addEventListener('click', () => navigateTo(row.dataset.slug))
    );
  } else {
    recentSection.style.display = 'none';
  }

  count.textContent = slugs.length;

  // Alert count badge
  const alertItems = slugs.filter(s => list[s].alert?.below != null || list[s].alert?.above != null || list[s].alert?.dpp != null);
  if (alertItems.length) {
    alertCount.textContent = alertItems.length;
    alertCount.style.display = '';
  } else {
    alertCount.style.display = 'none';
  }

  if (!slugs.length) {
    body.innerHTML = '<div class="wfm-panel-wl-empty">No items yet.<br>Click Watch on any item to add it.</div>';
    refreshBtn.style.display = 'none';
    bundleBtn.style.display  = 'none';
    exportBtn.style.display  = 'none';
    selectBtn.style.display  = 'none';
    selectBar.style.display  = 'none';
    selectMode = false;
    selectedSlugs.clear();
    return;
  }

  // ── Alert center tab ────────────────────────────────────────
  if (sidebarTab === 'alerts') {
    refreshBtn.style.display = 'none';
    bundleBtn.style.display  = 'none';
    exportBtn.style.display  = 'none';
    importBtn.style.display  = 'none';
    selectBtn.style.display  = 'none';
    selectBar.style.display  = 'none';

    if (!alertItems.length) {
      body.innerHTML = '<div class="wfm-panel-wl-empty">No alerts set.<br>Add Below / Above thresholds in Watchlist.</div>';
      return;
    }

    const sorted = alertItems
      .flatMap(s => alertProximity(list[s].lastPrice, list[s].alert?.below, list[s].alert?.above)
        .map(e => ({ slug: s, item: list[s], ...e })))
      .sort((a, b) => a.pct - b.pct);

    body.innerHTML = sorted.map(({ slug, item, dir, threshold, dist, pct, fill, urgent }) => `
      <div class="wfm-panel-ac-row ${slug === currentSlug ? 'wfm-panel-wl-active' : ''}" data-slug="${slug}">
        <div class="wfm-panel-ac-title">
          <span class="wfm-panel-ac-name">${esc(item.name)}</span>
          <span class="wfm-panel-ac-dir ${urgent}">${dir === 'below' ? '↓' : '↑'} ${threshold}p</span>
        </div>
        <div class="wfm-panel-ac-meta">
          <span>${item.lastPrice}p → ${threshold}p</span>
          <span class="${urgent}">${dist >= 0 ? dist + 'p away' : 'TRIGGERED'} (${pct}%)</span>
        </div>
        <div class="wfm-panel-ac-bar-wrap">
          <div class="wfm-panel-ac-bar ${urgent}" style="width:${fill}%"></div>
        </div>
      </div>`).join('');

    body.querySelectorAll('.wfm-panel-ac-row').forEach(row =>
      row.addEventListener('click', () => navigateTo(row.dataset.slug))
    );
    return;
  }

  // ── Watchlist tab ────────────────────────────────────────────
  refreshBtn.style.display = '';
  bundleBtn.style.display  = slugs.length >= 2 ? '' : 'none';
  exportBtn.style.display  = '';
  importBtn.style.display  = '';
  selectBtn.style.display  = '';
  exportBtn.onclick = () => exportWatchlistCSV();
  bundleBtn.onclick = () => showBundleDeals();

  if (selectMode) {
    selectBar.style.display = '';
    refreshBtn.style.display = 'none';
    bundleBtn.style.display  = 'none';
    exportBtn.style.display  = 'none';
    importBtn.style.display  = 'none';
    selectBtn.style.display  = 'none';

    const removeBtn = document.getElementById('wfm-panel-remove-selected');
    removeBtn.textContent = `Remove (${selectedSlugs.size})`;
    removeBtn.disabled = selectedSlugs.size === 0;

    body.innerHTML = slugs.map(slug => {
      const item    = list[slug];
      const checked = selectedSlugs.has(slug);
      return `
        <div class="wfm-panel-wl-row wfm-panel-wl-selectable ${checked ? 'wfm-panel-wl-selected' : ''}" data-slug="${slug}">
          <input type="checkbox" class="wfm-panel-wl-check" ${checked ? 'checked' : ''} data-slug="${slug}">
          <span class="wfm-panel-wl-name">${esc(item.name)}</span>
          <span class="wfm-panel-wl-price">${item.lastPrice}p</span>
        </div>`;
    }).join('');

    body.querySelectorAll('.wfm-panel-wl-row').forEach(row => {
      row.addEventListener('click', () => {
        const s = row.dataset.slug;
        if (selectedSlugs.has(s)) selectedSlugs.delete(s); else selectedSlugs.add(s);
        renderSidebar();
      });
    });

    document.getElementById('wfm-panel-select-all').onclick = () => {
      if (selectedSlugs.size === slugs.length) selectedSlugs.clear();
      else slugs.forEach(s => selectedSlugs.add(s));
      renderSidebar();
    };

    removeBtn.onclick = async () => {
      const list2 = await getWatchlist();
      selectedSlugs.forEach(s => delete list2[s]);
      await saveWatchlist(list2);
      const wasWatchingRemoved = selectedSlugs.has(currentSlug);
      selectedSlugs.clear();
      selectMode = false;
      if (wasWatchingRemoved) {
        const watchBtn = document.getElementById('wfm-panel-watch-btn');
        if (watchBtn) {
          watchBtn.classList.remove('active');
          watchBtn.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><polygon points="8,2 10,6 14,6.5 11,9.5 11.8,14 8,11.8 4.2,14 5,9.5 2,6.5 6,6"/></svg> Watch`;
        }
      }
      renderSidebar();
    };

    document.getElementById('wfm-panel-select-cancel').onclick = () => {
      selectMode = false;
      selectedSlugs.clear();
      renderSidebar();
    };
    return;
  }

  selectBar.style.display = 'none';
  selectBtn.onclick = () => { selectMode = true; renderSidebar(); };

  body.innerHTML = slugs.map(slug => {
    const item    = list[slug];
    const diff    = item.lastPrice - item.priceAtAdd;
    const diffPct = item.priceAtAdd ? Math.round((diff / item.priceAtAdd) * 100) : 0;
    const diffStr = diff === 0 ? '' : diff > 0
      ? `<span class="wfm-panel-wl-up">▲${diff}p (${diffPct}%)</span>`
      : `<span class="wfm-panel-wl-down">▼${Math.abs(diff)}p (${Math.abs(diffPct)}%)</span>`;
    const isActive    = slug === currentSlug;
    const hasAlerts   = item.alert?.below != null || item.alert?.above != null || item.alert?.dpp != null;
    const isPrime     = slug.includes('prime');

    return `
      <div class="wfm-panel-wl-row ${isActive ? 'wfm-panel-wl-active' : ''}" data-slug="${slug}">
        <div class="wfm-panel-wl-name-row">
          <span class="wfm-panel-wl-name">${esc(item.name)}</span>
          ${hasAlerts ? '<span class="wfm-panel-wl-alert-dot" title="Alert set">🔔</span>' : ''}
        </div>
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
          ${isPrime ? `
          <label class="wfm-panel-wl-alert-label wfm-panel-wl-alert-dpp" data-tooltip="Alert when an online seller lists this with at least this many ducats per platinum (good ducat value)">
            D/p
            <input class="wfm-panel-wl-alert-input" type="number" min="1" step="0.5" placeholder="—"
              value="${item.alert?.dpp ?? ''}" data-slug="${slug}" data-dir="dpp">
          </label>` : ''}
        </div>
        <div class="wfm-panel-wl-row-actions">
          <button class="wfm-panel-wl-remove" data-slug="${slug}" title="Remove from watchlist">✕</button>
        </div>
      </div>`;
  }).join('');

  body.querySelectorAll('.wfm-panel-wl-row').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('.wfm-panel-wl-alert-input, .wfm-panel-wl-remove')) return;
      const input = document.getElementById('wfm-panel-search');
      input.value = list[row.dataset.slug]?.name ?? '';
      navigateTo(row.dataset.slug);
    });
  });

  body.querySelectorAll('.wfm-panel-wl-alert-input').forEach(input => {
    input.addEventListener('change', async () => {
      const list2 = await getWatchlist();
      const { slug, dir } = input.dataset;
      if (!list2[slug]) return;
      list2[slug].alert = list2[slug].alert ?? {};
      list2[slug].alert[dir] = input.value ? Number(input.value) : null;
      await saveWatchlist(list2);
      renderSidebar();
    });
    input.addEventListener('click', e => e.stopPropagation());
  });

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
          watchBtn.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><polygon points="8,2 10,6 14,6.5 11,9.5 11.8,14 8,11.8 4.2,14 5,9.5 2,6.5 6,6"/></svg> Watch`;
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

// ── Bundle deals (multi-item seller matching) ─────────────────────────────────

async function showBundleDeals() {
  const content = document.getElementById('wfm-panel-content');
  const list    = await getWatchlist();
  const slugs   = Object.keys(list);
  if (slugs.length < 2) return;

  const head = sub => `
    <div class="wfm-panel-bundle-head">
      <h2 class="wfm-panel-bundle-title">⚖ Bundle deals</h2>
      <span class="wfm-panel-bundle-sub">${sub}</span>
    </div>`;

  content.innerHTML = `
    <div class="wfm-panel-bundle">
      ${head(`Scanning ${slugs.length} watchlist items for sellers with 2+…`)}
      <div class="wfm-panel-bundle-loading">Loading live orders…</div>
    </div>`;

  const entries = await Promise.all(slugs.map(async slug => {
    const orders = await fetchOrders(slug);
    return [slug, { name: list[slug]?.name || slug, orders }];
  }));
  const groups = groupBundleDeals(Object.fromEntries(entries), { statuses: ['online', 'ingame'] });

  if (!groups.length) {
    content.innerHTML = `
      <div class="wfm-panel-bundle">
        ${head(`Online / in-game sellers holding 2+ of your ${slugs.length} watchlist items`)}
        <div class="wfm-panel-bundle-empty">No seller currently has 2+ of your watchlist items online.<br>Try again later, or add more items to the watchlist.</div>
      </div>`;
    return;
  }

  const statusBadge = s =>
    `<span class="wfm-panel-bundle-status ${s}">${s === 'ingame' ? 'In-game' : 'Online'}</span>`;

  content.innerHTML = `
    <div class="wfm-panel-bundle">
      ${head(`${groups.length} seller${groups.length > 1 ? 's' : ''} holding 2+ of your ${slugs.length} watchlist items`)}
      <div class="wfm-panel-bundle-list">
        ${groups.map((g, gi) => `
          <div class="wfm-panel-bundle-seller">
            <div class="wfm-panel-bundle-seller-head">
              <span class="wfm-panel-bundle-seller-name">${esc(g.ingameName)}</span>
              ${statusBadge(g.status)}
              <span class="wfm-panel-bundle-rep" title="Seller reputation">★ ${g.reputation}</span>
              <span class="wfm-panel-bundle-count">${g.items.length} items · ${g.total}p</span>
              <button class="wfm-panel-bundle-copy" data-gi="${gi}" data-tooltip="Copy a ready-to-paste trade-chat whisper for all ${g.items.length} items">⧉ Copy whisper</button>
            </div>
            <div class="wfm-panel-bundle-items">
              ${[...g.items].sort((a, b) => a.platinum - b.platinum).map(i => `
                <div class="wfm-panel-bundle-item" data-slug="${i.slug}">
                  <span class="wfm-panel-bundle-item-name">${esc(i.name)}</span>
                  <span class="wfm-panel-bundle-item-price">${i.platinum}p</span>
                </div>`).join('')}
            </div>
          </div>`).join('')}
      </div>
    </div>`;

  content.querySelectorAll('.wfm-panel-bundle-item').forEach(el =>
    el.addEventListener('click', () => {
      const input = document.getElementById('wfm-panel-search');
      if (input) input.value = list[el.dataset.slug]?.name ?? '';
      navigateTo(el.dataset.slug);
    })
  );

  // Copy a full, ready-to-paste warframe.market whisper (all items + total).
  content.querySelectorAll('.wfm-panel-bundle-copy').forEach(btn =>
    btn.addEventListener('click', () => {
      const whisper = buildBundleWhisper(groups[+btn.dataset.gi]);
      navigator.clipboard?.writeText(whisper).then(() => {
        btn.textContent = 'Copied ✓';
        btn.classList.add('wfm-panel-bundle-copied');
        setTimeout(() => { btn.textContent = '⧉ Copy whisper'; btn.classList.remove('wfm-panel-bundle-copied'); }, 1400);
      }).catch(() => {});
    })
  );
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
      slug:   p.slug,
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
      <button class="wfm-ph-arb-name wfm-ph-arb-name-btn" data-slug="${p.slug}">${esc(p.name)}${p.qty > 1 ? ` <span class="wfm-ph-arb-qty">×${p.qty}</span>` : ''}</button>
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

  zone.querySelectorAll('.wfm-ph-arb-name-btn').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.slug));
  });
}
