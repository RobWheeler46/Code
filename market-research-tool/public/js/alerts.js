function alertRow(alert) {
  return `
    <div class="notif-item ${alert.readAt ? '' : 'unread'}" style="cursor:pointer" onclick="openAlert(${alert.id}, ${alert.assetId || 'null'})">
      <span class="badge" style="background:${alert.severity === 'critical' ? 'var(--red)' : alert.severity === 'high' ? 'var(--amber)' : 'var(--muted)'}">${escapeHtml(alert.severity)}</span>
      ${escapeHtml(alert.message)}
      <small>${formatDateTime(alert.createdAt)} ${alert.emailed ? '&middot; emailed' : ''}</small>
    </div>
  `;
}

async function openAlert(id, assetId) {
  await Api.post(`/api/alerts/${id}/read`);
  if (assetId) location.href = `asset.html?id=${assetId}`;
}

async function loadAlerts() {
  const { alerts } = await Api.get('/api/alerts?limit=100');
  document.getElementById('alerts-list').innerHTML = alerts.length
    ? alerts.map(alertRow).join('')
    : '<div class="empty-state">No alerts yet.</div>';
}

document.getElementById('mark-all-read').addEventListener('click', async () => {
  await Api.post('/api/alerts/read-all');
  await loadAlerts();
  await refreshAlertCount();
});

(async () => {
  const me = await initNav();
  if (!me) return;
  await loadAlerts();
})();
