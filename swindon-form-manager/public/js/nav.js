let __currentUser = null;

async function initNav() {
  const target = document.getElementById('app-nav');
  if (!target) return null;
  let me;
  try {
    me = await Api.get('/api/me');
  } catch (e) {
    return null;
  }
  __currentUser = me;

  const links = [];
  if (me.isRequester || me.isAdmin) {
    links.push('<a href="new-request.html">New request</a>');
  }
  links.push('<a href="index.html">Dashboard</a>');
  if (me.isApprover) {
    links.push('<a href="index.html#pending">Approvals</a>');
  }
  if (me.isAdmin) {
    links.push('<a href="admin.html">Admin</a>');
  }

  target.innerHTML = `
    <a class="brand" href="index.html">7th Swindon Form Manager</a>
    <nav>
      ${links.join('')}
      <div class="bell-wrap">
        <button class="bell-btn" id="bell-btn" type="button">🔔 <span id="bell-count"></span></button>
        <div class="notif-dropdown" id="notif-dropdown"></div>
      </div>
      <span class="user-info">${escapeHtml(me.name)}</span>
      <a href="#" id="logout-link">Log out</a>
    </nav>
  `;

  document.getElementById('logout-link').addEventListener('click', async (e) => {
    e.preventDefault();
    await Api.post('/api/logout');
    location.href = 'login.html';
  });

  const bellBtn = document.getElementById('bell-btn');
  const dropdown = document.getElementById('notif-dropdown');
  bellBtn.addEventListener('click', async () => {
    const open = dropdown.classList.toggle('open');
    if (open) await loadNotifications(dropdown);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.bell-wrap')) dropdown.classList.remove('open');
  });

  await refreshNotifCount();
  return me;
}

async function refreshNotifCount() {
  try {
    const { unreadCount } = await Api.get('/api/notifications');
    const el = document.getElementById('bell-count');
    if (el) el.textContent = unreadCount > 0 ? unreadCount : '';
  } catch (e) { /* ignore */ }
}

async function loadNotifications(dropdown) {
  const { notifications } = await Api.get('/api/notifications');
  if (notifications.length === 0) {
    dropdown.innerHTML = '<div class="notif-item">No notifications yet.</div>';
    return;
  }
  dropdown.innerHTML = notifications.map(n => `
    <div class="notif-item ${n.read_at ? '' : 'unread'}" data-id="${n.id}" data-request="${n.request_id || ''}">
      ${escapeHtml(n.message)}
      <small>${formatDateTime(n.created_at)}${n.reference ? ' &middot; ' + escapeHtml(n.reference) : ''}</small>
    </div>
  `).join('');
  dropdown.querySelectorAll('.notif-item[data-id]').forEach(el => {
    el.addEventListener('click', async () => {
      const id = el.dataset.id;
      const requestId = el.dataset.request;
      await Api.post(`/api/notifications/${id}/read`);
      await refreshNotifCount();
      if (requestId) location.href = `request.html?id=${requestId}`;
    });
  });
}
