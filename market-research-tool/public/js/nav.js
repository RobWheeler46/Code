async function initNav() {
  const target = document.getElementById('app-nav');
  if (!target) return null;
  let me;
  try {
    me = await Api.get('/api/me');
  } catch (e) {
    return null;
  }

  target.innerHTML = `
    <a class="brand" href="index.html">Market Research Desk</a>
    <nav>
      <a href="index.html">Dashboard</a>
      <a href="watchlists.html">Watchlists</a>
      <a href="asset-search.html">Asset Search</a>
      <a href="signals.html">Signals</a>
      <a href="alerts.html">Alerts <span id="bell-count"></span></a>
      <a href="notes.html">Notes</a>
      <a href="settings.html">Settings</a>
      <span class="user-info">${escapeHtml(me.username)}</span>
      <a href="#" id="logout-link">Log out</a>
    </nav>
  `;

  document.getElementById('logout-link').addEventListener('click', async (e) => {
    e.preventDefault();
    await Api.post('/api/logout');
    location.href = 'login.html';
  });

  await refreshAlertCount();
  return me;
}

async function refreshAlertCount() {
  try {
    const { unreadCount } = await Api.get('/api/alerts/unread-count');
    const el = document.getElementById('bell-count');
    if (el) el.textContent = unreadCount > 0 ? `(${unreadCount})` : '';
  } catch (e) { /* ignore */ }
}
