const THRESHOLD_LABELS = {
  positiveSetupMinChange: 'Positive setup: min price change (%)',
  positiveSetupMinVolumeRatio: 'Positive setup: min volume ratio (x avg)',
  sellRiskMinChange: 'Sell-risk: max price change (%, negative)',
  sellRiskMinVolumeRatio: 'Sell-risk: min volume ratio (x avg)',
  unusualVolumeRatio: 'Unusual volume: min ratio (x avg)',
  unusualVolumePriceMove: 'Unusual volume: min price move (%)',
  cryptoVolatilityChange: 'Crypto volatility: min 24h change (%)',
  cryptoVolatilityVolumeRatio: 'Crypto volatility: min volume ratio (x avg)',
  pennyPumpChange: 'Penny share pump: min price rise (%)',
  pennyPumpVolumeRatio: 'Penny share pump: min volume ratio (x avg)',
  highVolatilityPct: 'High-risk flag: volatility threshold (%)',
  lowLiquidityVolumeShares: 'High-risk flag: low liquidity threshold (shares avg volume)',
  lowLiquidityVolumeCrypto: 'High-risk flag: low liquidity threshold (crypto $ avg volume)',
  largeMoveNoNewsPct: 'High-risk flag: large unexplained move (%)',
  pennySharePriceThresholdPence: 'Penny share classification: price below (pence)',
  pennyShareHighRiskPriceThresholdPence: 'High-risk penny share: price below (pence)',
  signalExpiryDays: 'Signal expiry (days)'
};

async function loadRefreshInfo() {
  const info = await Api.get('/api/settings/refresh-intervals');
  document.getElementById('refresh-info').innerHTML = `
    <table>
      <tr><td>Share refresh interval</td><td>${info.sharesMinutes} minutes</td></tr>
      <tr><td>Crypto refresh interval</td><td>${info.cryptoMinutes} minutes</td></tr>
      <tr><td>Email alerts</td><td>${info.emailConfigured ? 'Configured' : 'Not configured (set SMTP_* and ALERT_EMAIL_TO in .env)'}</td></tr>
    </table>
    <p class="muted">Refresh intervals are set via REFRESH_MINUTES_SHARES / REFRESH_MINUTES_CRYPTO in .env - restart the server after changing them.</p>
  `;
}

async function loadThresholds() {
  const thresholds = await Api.get('/api/settings/thresholds');
  document.getElementById('threshold-fields').innerHTML = Object.keys(THRESHOLD_LABELS).map(key => `
    <div class="field">
      <label for="t-${key}">${escapeHtml(THRESHOLD_LABELS[key])}</label>
      <input type="number" step="any" id="t-${key}" value="${thresholds[key]}">
    </div>
  `).join('');
}

document.getElementById('threshold-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const alertBox = document.getElementById('threshold-alert');
  const updates = {};
  for (const key of Object.keys(THRESHOLD_LABELS)) {
    updates[key] = document.getElementById(`t-${key}`).value;
  }
  try {
    await Api.patch('/api/settings/thresholds', updates);
    alertBox.innerHTML = '<div class="alert alert-success">Thresholds saved.</div>';
  } catch (err) {
    alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  }
});

async function loadSystemHealth() {
  const health = await Api.get('/api/settings/system-health');
  document.getElementById('system-health').innerHTML = `
    <table>
      <tr><td>Last successful refresh</td><td>${health.lastSuccessfulRefresh ? formatDateTime(health.lastSuccessfulRefresh) : 'never'}</td></tr>
      <tr><td>Failures in last 24h</td><td>${health.failuresLast24h}</td></tr>
    </table>
  `;
  document.getElementById('ingestion-log').innerHTML = health.recentLog.length
    ? health.recentLog.map(l => `
      <tr>
        <td>${formatDateTime(l.created_at)}</td>
        <td>${escapeHtml(l.source)}</td>
        <td><span class="badge" style="background:${l.status === 'ok' ? 'var(--green)' : 'var(--red)'}">${escapeHtml(l.status)}</span></td>
        <td>${escapeHtml(l.message || '')}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="4" class="empty-state">No ingestion activity yet.</td></tr>';
}

(async () => {
  const me = await initNav();
  if (!me) return;
  await Promise.all([loadRefreshInfo(), loadThresholds(), loadSystemHealth()]);
})();
