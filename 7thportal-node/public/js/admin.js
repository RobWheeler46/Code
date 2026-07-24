(async function () {
  const me = await mountNav('admin');
  if (!me) return;
  const panel = document.getElementById('panel');
  const tabs = document.getElementById('tabs');

  tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]');
    if (!btn) return;
    [...tabs.children].forEach((b) => b.classList.toggle('active', b === btn));
    render(btn.dataset.tab);
  });

  const flash = (m, ok = false) => `<div class="msg ${ok ? 'ok' : 'error'}">${esc(m)}</div>`;

  async function render(tab) {
    panel.innerHTML = '<div class="empty">Loading…</div>';
    try {
      if (tab === 'users') return renderUsers();
      if (tab === 'children') return renderChildren();
      if (tab === 'notices') return renderNotices();
      if (tab === 'audit') return renderAudit();
      if (tab === 'settings') return renderSettings();
    } catch (err) {
      panel.innerHTML = flash(err.message);
    }
  }

  // --- users ---
  async function renderUsers() {
    const { users } = await api('/api/admin/users');
    panel.innerHTML = `
      <div class="card" style="margin-bottom:18px">
        <h3>Add account</h3>
        <div id="uMsg"></div>
        <div class="row">
          <div><label>Name</label><input id="nName"></div>
          <div><label>Email</label><input id="nEmail" type="email"></div>
        </div>
        <div class="row">
          <div><label>Temporary password</label><input id="nPass"></div>
          <div><label>Role</label><select id="nRole"><option value="parent">Parent</option><option value="leader">Leader</option><option value="admin">Admin</option></select></div>
        </div>
        <div style="margin-top:14px"><button class="btn" id="addUser">Create account</button></div>
        <p class="hint">Parents sign in with these details. Leaders/admins usually sign in with OSM, but a local account works too.</p>
      </div>
      <div class="card">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Sign-in</th><th>Status</th><th></th></tr></thead>
          <tbody>${users.map((u) => `
            <tr>
              <td>${esc(u.display_name)}</td>
              <td class="small">${esc(u.email)}</td>
              <td>
                <select data-role="${u.id}" ${u.id === me.id ? '' : ''}>
                  ${['parent', 'leader', 'admin'].map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}
                </select>
              </td>
              <td><span class="pill grey">${u.auth_source}</span></td>
              <td>${u.status === 'active' ? '<span class="pill ok">active</span>' : '<span class="pill warn">suspended</span>'}</td>
              <td>${u.id === me.id ? '<span class="small muted">you</span>' : `<button class="btn ghost sm" data-toggle="${u.id}" data-status="${u.status}">${u.status === 'active' ? 'Suspend' : 'Restore'}</button>`}</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>`;

    document.getElementById('addUser').addEventListener('click', async () => {
      const msg = document.getElementById('uMsg');
      try {
        await api('/api/admin/users', { method: 'POST', body: JSON.stringify({
          displayName: document.getElementById('nName').value.trim(),
          email: document.getElementById('nEmail').value.trim(),
          password: document.getElementById('nPass').value,
          role: document.getElementById('nRole').value
        }) });
        renderUsers();
      } catch (err) { msg.innerHTML = flash(err.message); }
    });
    panel.querySelectorAll('select[data-role]').forEach((sel) => sel.addEventListener('change', async () => {
      try { await api(`/api/admin/users/${sel.dataset.role}/role`, { method: 'PATCH', body: JSON.stringify({ role: sel.value }) }); }
      catch (err) { alert(err.message); renderUsers(); }
    }));
    panel.querySelectorAll('button[data-toggle]').forEach((btn) => btn.addEventListener('click', async () => {
      const status = btn.dataset.status === 'active' ? 'suspended' : 'active';
      await api(`/api/admin/users/${btn.dataset.toggle}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      renderUsers();
    }));
  }

  // --- children ---
  async function renderChildren() {
    const [{ children }, { users }] = await Promise.all([api('/api/admin/children'), api('/api/admin/users')]);
    const parents = users.filter((u) => u.role === 'parent');
    panel.innerHTML = `
      <div class="card" style="margin-bottom:18px">
        <h3>Link a child to a parent</h3>
        <div id="cMsg"></div>
        <div class="row">
          <div><label>Parent</label><select id="cParent">${parents.map((p) => `<option value="${p.id}">${esc(p.display_name)} (${esc(p.email)})</option>`).join('')}</select></div>
          <div><label>Child name</label><input id="cName"></div>
        </div>
        <div class="row">
          <div><label>Section</label><input id="cSection" placeholder="Beavers / Cubs / Scouts"></div>
          <div><label>OSM link (optional)</label><input id="cLink" placeholder="https://www.onlinescoutmanager.co.uk/…"></div>
        </div>
        <div style="margin-top:14px"><button class="btn" id="addChild" ${parents.length ? '' : 'disabled'}>Add child</button></div>
        ${parents.length ? '' : '<p class="hint">Create a parent account first.</p>'}
      </div>
      <div class="card">
        <table>
          <thead><tr><th>Child</th><th>Section</th><th>Parent</th><th></th></tr></thead>
          <tbody>${children.map((c) => `
            <tr><td>${esc(c.name)}</td><td>${esc(c.section || '—')}</td><td class="small">${esc(c.parent_name)}</td>
            <td><button class="btn ghost sm" data-del="${c.id}">Remove</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">No children linked yet.</td></tr>'}</tbody>
        </table>
      </div>`;
    const add = document.getElementById('addChild');
    if (add) add.addEventListener('click', async () => {
      const msg = document.getElementById('cMsg');
      try {
        await api('/api/admin/children', { method: 'POST', body: JSON.stringify({
          parentUserId: Number(document.getElementById('cParent').value),
          name: document.getElementById('cName').value.trim(),
          section: document.getElementById('cSection').value.trim(),
          osmLink: document.getElementById('cLink').value.trim()
        }) });
        renderChildren();
      } catch (err) { msg.innerHTML = flash(err.message); }
    });
    panel.querySelectorAll('button[data-del]').forEach((b) => b.addEventListener('click', async () => {
      await api(`/api/admin/children/${b.dataset.del}`, { method: 'DELETE' }); renderChildren();
    }));
  }

  // --- notices ---
  async function renderNotices() {
    const { notices } = await api('/api/admin/notices');
    panel.innerHTML = `
      <div class="card" style="margin-bottom:18px">
        <h3>New notice</h3>
        <div id="nMsg"></div>
        <label>Title</label><input id="ntTitle">
        <label>Body</label><textarea id="ntBody"></textarea>
        <div class="row">
          <div><label>Audience</label><select id="ntAud"><option value="all">Everyone</option><option value="parents">Parents</option><option value="leaders">Leaders</option></select></div>
          <div><label style="margin-top:12px"><input type="checkbox" id="ntPub" style="width:auto" checked> Publish now</label></div>
        </div>
        <div style="margin-top:14px"><button class="btn" id="addNotice">Create notice</button></div>
      </div>
      <div class="card">
        <table>
          <thead><tr><th>Title</th><th>Audience</th><th>Status</th><th>Updated</th><th></th></tr></thead>
          <tbody>${notices.map((n) => `
            <tr>
              <td>${esc(n.title)}</td>
              <td><span class="pill ${n.audience}">${n.audience}</span></td>
              <td>${n.published ? '<span class="pill ok">published</span>' : '<span class="pill grey">draft</span>'}</td>
              <td class="small muted">${fmtDate(n.updated_at)}</td>
              <td>
                <button class="btn ghost sm" data-pub="${n.id}" data-state="${n.published}">${n.published ? 'Unpublish' : 'Publish'}</button>
                <button class="btn ghost sm" data-del="${n.id}">Delete</button>
              </td>
            </tr>`).join('')}</tbody>
        </table>
      </div>`;
    document.getElementById('addNotice').addEventListener('click', async () => {
      const msg = document.getElementById('nMsg');
      try {
        await api('/api/admin/notices', { method: 'POST', body: JSON.stringify({
          title: document.getElementById('ntTitle').value.trim(),
          body: document.getElementById('ntBody').value.trim(),
          audience: document.getElementById('ntAud').value,
          published: document.getElementById('ntPub').checked
        }) });
        renderNotices();
      } catch (err) { msg.innerHTML = flash(err.message); }
    });
    panel.querySelectorAll('button[data-pub]').forEach((b) => b.addEventListener('click', async () => {
      await api(`/api/admin/notices/${b.dataset.pub}`, { method: 'PATCH', body: JSON.stringify({ published: b.dataset.state !== '1' }) });
      renderNotices();
    }));
    panel.querySelectorAll('button[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Delete this notice?')) return;
      await api(`/api/admin/notices/${b.dataset.del}`, { method: 'DELETE' }); renderNotices();
    }));
  }

  // --- audit ---
  async function renderAudit() {
    const { events } = await api('/api/admin/audit?limit=300');
    panel.innerHTML = `
      <div class="card">
        <table>
          <thead><tr><th>When</th><th>Actor</th><th>Event</th><th>Detail</th></tr></thead>
          <tbody>${events.map((e) => `
            <tr><td class="small muted">${fmtDateTime(e.at)}</td><td class="small">${esc(e.actor || '')}</td>
            <td><span class="pill grey">${esc(e.event)}</span></td><td class="small">${esc(e.detail || '')}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No events yet.</td></tr>'}</tbody>
        </table>
      </div>`;
  }

  // --- settings ---
  async function renderSettings() {
    const s = await api('/api/admin/settings');
    panel.innerHTML = `
      <div class="grid cols-2">
        <div class="card">
          <h3>OSM sign-in</h3>
          <p>${s.osmConfigured ? '<span class="pill ok">Configured</span>' : '<span class="pill warn">Not configured</span>'}</p>
          <table>
            <tr><th>Callback URL</th><td class="small">${esc(s.osmCallbackUrl)}</td></tr>
            <tr><th>Session idle timeout</th><td>${s.sessionIdleMinutes} minutes</td></tr>
            <tr><th>Demo accounts</th><td>${s.seedDemoUsers ? 'Enabled' : 'Disabled'}</td></tr>
          </table>
          <p class="hint">OSM credentials and the callback URL are set as server environment variables, not in the browser.</p>
        </div>
        <div class="card">
          <h3>Content</h3>
          <table>
            <tr><th>Users</th><td>${s.counts.users}</td></tr>
            <tr><th>Children linked</th><td>${s.counts.children}</td></tr>
            <tr><th>Notices</th><td>${s.counts.notices}</td></tr>
            <tr><th>Documents</th><td>${s.counts.documents}</td></tr>
          </table>
        </div>
      </div>`;
  }

  render('users');
})();
