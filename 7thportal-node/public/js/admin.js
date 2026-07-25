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
      if (tab === 'overview') return renderOverview();
      if (tab === 'sections') return renderSections();
      if (tab === 'users') return renderUsers();
      if (tab === 'children') return renderChildren();
      if (tab === 'notices') return renderNotices();
      if (tab === 'audit') return renderAudit();
      if (tab === 'settings') return renderSettings();
    } catch (err) {
      panel.innerHTML = flash(err.message);
    }
  }

  // --- overview (FRD 6.1: operational/support view, not member data) ---
  async function renderOverview() {
    const o = await api('/api/admin/overview');
    const osm = o.osm;
    const ex = o.exceptions;
    const exceptionRows = [
      { label: 'Parents with no linked child', n: ex.parentsWithoutChildren.length, list: ex.parentsWithoutChildren.map((p) => `${esc(p.display_name)} (${esc(p.email)})`) },
      { label: 'Suspended accounts', n: ex.suspendedUsers, list: [] },
      { label: 'Documents with no file version', n: ex.documentsWithoutVersions, list: [] },
      { label: 'OSM sign-in failures (logged)', n: osm.failedLoginCount, list: [] }
    ];
    panel.innerHTML = `
      <div class="grid cols-3" style="margin-bottom:18px">
        <div class="card"><div class="muted small">People</div><div style="font-size:1.5rem;font-weight:700">${o.counts.users}</div>
          <div class="small muted">${o.counts.parents} parents · ${o.counts.leaders} leaders · ${o.counts.admins} admins</div></div>
        <div class="card"><div class="muted small">Children linked</div><div style="font-size:1.5rem;font-weight:700">${o.counts.children}</div></div>
        <div class="card"><div class="muted small">Notices</div><div style="font-size:1.5rem;font-weight:700">${o.counts.noticesPublished}</div>
          <div class="small muted">published of ${o.counts.noticesTotal}</div></div>
      </div>
      <div class="grid cols-2">
        <section class="card">
          <h3>OSM integration health</h3>
          <table>
            <tr><th>Sign-in</th><td>${osm.configured ? '<span class="pill ok">configured</span>' : '<span class="pill warn">not configured</span>'}</td></tr>
            <tr><th>Last successful OSM sign-in</th><td>${osm.lastSuccessfulLogin ? fmtDateTime(osm.lastSuccessfulLogin.at) + ' · ' + esc(osm.lastSuccessfulLogin.actor || '') : '<span class="muted">none yet</span>'}</td></tr>
            <tr><th>Scopes</th><td class="small">${esc(osm.scopes)}</td></tr>
            <tr><th>Callback URL</th><td class="small">${esc(osm.callbackUrl)}</td></tr>
          </table>
          ${osm.recentFailures.length ? `<h4 style="margin:14px 0 6px">Recent sign-in failures</h4>
            ${osm.recentFailures.map((f) => `<div class="small muted">${fmtDateTime(f.at)} · ${esc(f.event)} · ${esc(f.detail || '')}</div>`).join('')}` : ''}
        </section>
        <section class="card">
          <h3>Support exceptions</h3>
          <table>
            ${exceptionRows.map((r) => `<tr><th>${r.label}</th><td>${r.n > 0 ? `<span class="pill warn">${r.n}</span>` : '<span class="pill ok">0</span>'}</td></tr>`).join('')}
          </table>
          ${ex.parentsWithoutChildren.length ? `<h4 style="margin:14px 0 6px">Parents needing a child link</h4>
            ${ex.parentsWithoutChildren.map((p) => `<div class="small">${esc(p.display_name)} <span class="muted">${esc(p.email)}</span></div>`).join('')}` : ''}
        </section>
      </div>
      <section class="card" style="margin-top:18px">
        <h3>OSM account mapping</h3>
        <p class="hint">Users who sign in through OSM. Only a masked OSM reference is shown — raw OSM ids and tokens are never exposed (FR-OSM-ADM-009). This view is written to the audit log.</p>
        ${o.osmMappings.length ? `<table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>OSM ref (masked)</th><th>Last sign-in</th></tr></thead>
          <tbody>${o.osmMappings.map((m) => `<tr><td>${esc(m.display_name)}</td><td class="small">${esc(m.email)}</td>
            <td><span class="pill grey">${esc(m.role)}</span></td><td class="small">${esc(m.osm_user_ref || '—')}</td>
            <td class="small muted">${m.last_login_at ? fmtDateTime(m.last_login_at) : '—'}</td></tr>`).join('')}</tbody>
        </table>` : '<div class="empty">No OSM sign-ins yet. Leaders who sign in with OSM will appear here.</div>'}
      </section>`;
  }

  // --- sections: capacity tracker & movement trends (FRD 29) ---
  function statusPill(s) {
    const map = {
      good: '<span class="pill ok">Good</span>', watch: '<span class="pill warn">Watch</span>',
      full: '<span class="pill" style="background:#fbecdc;color:#b26a00">Full</span>',
      over: '<span class="pill" style="background:#fdecec;color:#c62828">Over capacity</span>',
      unset: '<span class="pill grey">No capacity set</span>'
    };
    return map[s] || map.unset;
  }
  function trendPill(t) {
    const map = { rising: '↑ Rising', falling: '↓ Falling', stable: '→ Stable', new: '—' };
    return `<span class="pill grey">${map[t] || '—'}</span>`;
  }

  async function renderSections() {
    const [dash, cfg] = await Promise.all([api('/api/admin/sections'), api('/api/admin/sections/settings')]);
    const t = dash.totals;
    const cfgBy = Object.fromEntries(cfg.configured.map((c) => [c.section, c]));

    panel.innerHTML = `
      <div class="grid cols-3" style="margin-bottom:18px">
        <div class="card"><div class="muted small">Total active children</div><div style="font-size:1.5rem;font-weight:700">${t.totalActive}</div></div>
        <div class="card"><div class="muted small">Available spaces</div><div style="font-size:1.5rem;font-weight:700">${t.availableSpaces}</div></div>
        <div class="card"><div class="muted small">Near / over capacity</div><div style="font-size:1.5rem;font-weight:700">${t.nearCapacity} ${t.nearCapacity === 1 ? 'section' : 'sections'}</div></div>
      </div>

      <section class="card" style="margin-bottom:18px">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <h3 style="margin:0">Section capacity tracker</h3>
          <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">
            ${dash.osm.configured ? '<button class="btn sm" id="syncBtn">Sync from OSM</button>' : ''}
            <a class="btn secondary sm" href="/api/admin/sections/export">Export summary (CSV)</a>
          </div>
        </div>
        <p class="hint">Counts only — no named child records. ${dash.osm.synced
          ? 'Active counts are live from OSM where a section matches; others fall back to portal records.'
          : (dash.osm.configured ? 'Active is from portal records until you sync from OSM.' : 'Active is from portal records (OSM not configured).')}
          Drill-down into named children is audited.</p>
        <div id="syncMsg"></div>
        ${dash.sections.length ? `<table>
          <thead><tr><th>Section</th><th>Active</th><th>Joining</th><th>Capacity</th><th>Use</th><th>Trend</th><th>Status</th><th>Source · last sync</th><th></th></tr></thead>
          <tbody>${dash.sections.map((s) => `
            <tr>
              <td><strong>${esc(s.section)}</strong></td>
              <td>${s.active}</td>
              <td>${s.joining ?? '—'}</td>
              <td>${s.capacity ?? '—'}</td>
              <td>${s.utilisation != null ? s.utilisation + '%' : '—'}</td>
              <td>${trendPill(s.trend)}</td>
              <td>${statusPill(s.status)}</td>
              <td class="small">${s.source === 'osm'
                ? `<span class="pill ok">OSM</span> <span class="muted">${s.lastSync ? fmtDateTime(s.lastSync) : ''}</span>`
                : `<span class="pill grey">Portal</span>${s.syncError ? ' <span class="pill" style="background:#fdecec;color:#c62828" title="' + esc(s.syncError) + '">sync error</span>' : ''}`}</td>
              <td><button class="btn ghost sm" data-drill="${esc(s.section)}">View children</button></td>
            </tr>`).join('')}</tbody>
        </table>` : '<div class="empty">No sections yet. Link children to sections (Children tab), set a capacity below, or sync from OSM.</div>'}
      </section>

      <section class="card">
        <h3>Capacity settings</h3>
        <p class="hint">Capacity is a local 7thPortal planning value and is never written back to OSM. Amber/red are utilisation warning thresholds (%).</p>
        <div id="secMsg"></div>
        <table>
          <thead><tr><th>Section</th><th>Capacity</th><th>Amber %</th><th>Red %</th><th>Joining</th><th>Owner</th><th></th></tr></thead>
          <tbody>${cfg.sections.map((name) => {
            const c = cfgBy[name] || {};
            return `<tr data-row="${esc(name)}">
              <td><strong>${esc(name)}</strong></td>
              <td><input class="cap" style="width:80px" type="number" min="0" value="${c.capacity ?? ''}"></td>
              <td><input class="amber" style="width:70px" type="number" min="0" max="100" value="${c.amber_pct ?? 85}"></td>
              <td><input class="red" style="width:70px" type="number" min="0" max="100" value="${c.red_pct ?? 95}"></td>
              <td><input class="join" style="width:70px" type="number" min="0" value="${c.joining_count ?? ''}"></td>
              <td><input class="owner" style="min-width:120px" value="${esc(c.owner || '')}"></td>
              <td><button class="btn sm" data-save="${esc(name)}">Save</button></td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </section>`;

    const syncBtn = document.getElementById('syncBtn');
    if (syncBtn) syncBtn.addEventListener('click', async () => {
      const msg = document.getElementById('syncMsg');
      syncBtn.disabled = true; syncBtn.textContent = 'Syncing…';
      try {
        const r = await api('/api/admin/sections/sync', { method: 'POST' });
        msg.innerHTML = `<div class="msg ok">Synced ${r.synced} of ${r.total} sections from OSM.</div>`;
        setTimeout(renderSections, 900);
      } catch (err) {
        msg.innerHTML = `<div class="msg error">${esc(err.message)}</div>`;
        syncBtn.disabled = false; syncBtn.textContent = 'Sync from OSM';
      }
    });

    panel.querySelectorAll('button[data-drill]').forEach((b) => b.addEventListener('click', () => openDrill(b.dataset.drill)));
    panel.querySelectorAll('button[data-save]').forEach((b) => b.addEventListener('click', async () => {
      const row = panel.querySelector(`tr[data-row="${CSS.escape(b.dataset.save)}"]`);
      try {
        await api('/api/admin/sections/settings', { method: 'POST', body: JSON.stringify({
          section: b.dataset.save,
          capacity: row.querySelector('.cap').value,
          amberPct: row.querySelector('.amber').value,
          redPct: row.querySelector('.red').value,
          joiningCount: row.querySelector('.join').value,
          owner: row.querySelector('.owner').value
        }) });
        renderSections();
      } catch (err) { document.getElementById('secMsg').innerHTML = flash(err.message); }
    }));
  }

  async function openDrill(section) {
    const back = openModal(`<h2>${esc(section)} — named children</h2>
      <p class="hint">This view reveals named child records and has been written to the audit log.</p>
      <div id="drillBody" class="empty">Loading…</div>
      <div class="modal-actions"><button class="btn ghost" id="drillClose">Close</button></div>`);
    back.querySelector('#drillClose').addEventListener('click', () => back.remove());
    try {
      const { children } = await api(`/api/admin/sections/${encodeURIComponent(section)}/children`);
      back.querySelector('#drillBody').outerHTML = children.length ? `<table>
        <thead><tr><th>Child</th><th>Parent</th></tr></thead>
        <tbody>${children.map((c) => `<tr><td>${esc(c.name)}</td><td class="small">${esc(c.parent_name)} <span class="muted">${esc(c.parent_email)}</span></td></tr>`).join('')}</tbody>
      </table>` : '<div class="empty">No children linked to this section.</div>';
    } catch (err) {
      back.querySelector('#drillBody').innerHTML = flash(err.message);
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
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Sign-in</th><th>OSM ref</th><th>Status</th><th></th></tr></thead>
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
              <td class="small muted">${u.osm_user_ref ? esc(u.osm_user_ref) : '—'}</td>
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

  render('overview');
})();
