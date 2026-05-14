const DEFAULT_SETTINGS = {
  timezone:       '',
  defaultRange:   '90days',
  showForecast:   true,
  showSignal:     true,
  showVolatility: true,
  showLiquidity:  true,
  showBestHour:   true,
  showDucat:      true,
  showVault:      true,
  showArbitrage:  true,
};

const CHECKBOXES = ['showForecast','showSignal','showVolatility','showLiquidity','showBestHour','showDucat','showVault','showArbitrage'];

function getSettings() {
  return browser.storage.sync.get('settings').then(d =>
    ({ ...DEFAULT_SETTINGS, ...(d.settings ?? {}) })
  );
}

document.addEventListener('DOMContentLoaded', async () => {
  const settings = await getSettings();

  document.getElementById('defaultRange').value = settings.defaultRange;
  document.getElementById('timezone').value     = settings.timezone;
  CHECKBOXES.forEach(key => {
    document.getElementById(key).checked = settings[key];
  });

  document.getElementById('save').addEventListener('click', async () => {
    const tz  = document.getElementById('timezone').value.trim();
    const err = document.getElementById('tz-error');

    if (tz) {
      try { new Intl.DateTimeFormat('en', { timeZone: tz }); }
      catch { err.textContent = `Unknown timezone: "${tz}"`; return; }
    }
    err.textContent = '';

    const newSettings = { ...DEFAULT_SETTINGS };
    newSettings.defaultRange = document.getElementById('defaultRange').value;
    newSettings.timezone     = tz;
    CHECKBOXES.forEach(key => { newSettings[key] = document.getElementById(key).checked; });

    await browser.storage.sync.set({ settings: newSettings });

    const saved = document.getElementById('saved');
    saved.hidden = false;
    setTimeout(() => { saved.hidden = true; }, 2000);
  });
});
