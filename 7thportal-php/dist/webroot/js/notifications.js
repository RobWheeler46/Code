let NME = null;

(async () => {
  NME = await requireUserNav();
  if (!NME) return;
  renderNotifications();
})();

async function renderNotifications() {
  const box = document.getElementById('content');
  box.innerHTML = '<p class="muted">Loading&hellip;</p>';
  let data, prefs;
  try { [data, prefs] = await Promise.all([Api.get('/api/notifications'), Api.get('/api/notifications/preferences')]); }
  catch (e) { box.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; return; }

  box.innerHTML = `
    <div class="card">
      <div class="cap-head">
        <h2 style="margin:0">Recent ${data.unread ? `<span class="badge" data-status="pending_approval">${data.unread} unread</span>` : ''}</h2>
        <span class="cap-actions">${data.unread ? '<button class="btn btn-secondary btn-sm" id="mark-all">Mark all read</button>' : ''}</span>
      </div>
      ${data.notifications.length ? data.notifications.map(x => `
        <div class="notice-card" style="${x.read ? 'opacity:.65' : ''}">
          <div class="date">${formatDateTime(x.createdAt)}${x.read ? '' : ' &middot; <strong>new</strong>'}</div>
          <strong>${escapeHtml(x.title)}</strong>
          ${x.body ? `<p style="margin:.3rem 0 0">${escapeHtml(x.body)}</p>` : ''}
          ${x.link ? `<p style="margin:.4rem 0 0"><a class="btn btn-secondary btn-sm" href="${escapeHtml(x.link)}" data-open="${x.id}">Open</a></p>` : ''}
        </div>`).join('') : '<p class="muted">No notifications yet.</p>'}
    </div>
    <div class="card">
      <h2>Notification preferences</h2>
      <div id="pref-msg"></div>
      <p class="muted">Choose what to be notified about. Email content is kept minimal &mdash; sign in to see detail.</p>
      ${prefs.types.map(t => `<label style="display:block;margin:.35rem 0"><input type="checkbox" class="pref-type" value="${escapeHtml(t.key)}" ${prefs.mutedTypes.includes(t.key) ? '' : 'checked'}> ${escapeHtml(t.label)}</label>`).join('')}
      <label style="display:block;margin:.7rem 0 1rem"><input type="checkbox" id="pref-digest" ${prefs.weeklyDigest ? 'checked' : ''}> Send me a weekly digest email</label>
      <button class="btn" id="pref-save">Save preferences</button>
      ${NME.role === 'admin' ? '<button class="btn btn-secondary" id="send-digest" style="margin-left:.5rem">Send digest now</button>' : ''}
    </div>`;

  const markAll = document.getElementById('mark-all');
  if (markAll) markAll.addEventListener('click', async () => { await Api.post('/api/notifications/read-all'); renderNotifications(); });

  document.querySelectorAll('[data-open]').forEach(a => a.addEventListener('click', () => {
    Api.request('POST', `/api/notifications/${a.dataset.open}/read`, {}).catch(() => {});
  }));

  document.getElementById('pref-save').addEventListener('click', async () => {
    const muted = [...document.querySelectorAll('.pref-type')].filter(c => !c.checked).map(c => c.value);
    try {
      await Api.put('/api/notifications/preferences', { mutedTypes: muted, weeklyDigest: document.getElementById('pref-digest').checked });
      document.getElementById('pref-msg').innerHTML = '<div class="alert alert-success">Preferences saved.</div>';
    } catch (e) { document.getElementById('pref-msg').innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  });

  const sd = document.getElementById('send-digest');
  if (sd) sd.addEventListener('click', async () => {
    const msg = document.getElementById('pref-msg');
    try { const r = await Api.post('/api/admin/notifications/send-digest'); msg.innerHTML = `<div class="alert alert-success">Weekly digest sent to ${r.sent} user(s).</div>`; }
    catch (e) { msg.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  });
}
