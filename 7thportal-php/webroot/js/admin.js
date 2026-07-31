let ME = null;
let SECTIONS_CACHE = null;

const ADMIN_TABS = [
  { tab: 'health', label: 'Integration health' },
  { tab: 'capacity', label: 'Sections &amp; capacity' },
  { tab: 'notices', label: 'Notices' },
  { tab: 'users', label: 'Users &amp; roles' },
  { tab: 'parents', label: 'Parent accounts' },
  { tab: 'gallery', label: 'Photo gallery' },
  { tab: 'finance', label: 'Finance' },
  { tab: 'settings', label: 'Settings' },
  { tab: 'audit', label: 'Audit log' },
];

(async () => {
  ME = await requireUserNav();
  if (!ME) return;
  if (ME.role !== 'admin') {
    document.getElementById('tab-content').innerHTML = '<div class="alert alert-error">Portal Administrator access required.</div>';
    return;
  }
  // requireUserNav() renders the generic role sidebar (Dashboard/Gallery/etc) -
  // the admin page replaces it with its own sub-navigation (these tabs) instead,
  // since a top-level "Admin" link pointing at the page you're already on would
  // be redundant here.
  const sidebar = document.getElementById('app-sidebar');
  sidebar.innerHTML = `<div class="sidebar-role">Admin</div><nav>${ADMIN_TABS.map(t => `<button class="admin-tab-btn" data-tab="${t.tab}">${t.label}</button>`).join('')}</nav>`;
  // The sidebar is hidden on phones, so mirror the tabs as a horizontal scrolling
  // strip above the content for mobile admins (admin stays laptop-first otherwise).
  const tabContent = document.getElementById('tab-content');
  const strip = document.createElement('div');
  strip.className = 'admin-mobile-tabs';
  strip.innerHTML = ADMIN_TABS.map(t => `<button class="admin-tab-btn" data-tab="${t.tab}">${t.label}</button>`).join('');
  tabContent.parentNode.insertBefore(strip, tabContent);
  document.querySelectorAll('.admin-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => selectTab(btn.dataset.tab));
  });
  const params = new URLSearchParams(location.search);
  const requested = params.get('tab');
  selectTab(requested && ADMIN_TABS.some(t => t.tab === requested) ? requested : 'health');
})();

function selectTab(tab) {
  document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  const renderers = { health: renderHealth, capacity: renderCapacity, notices: renderNotices, users: renderUsers, parents: renderParents, gallery: renderGallery, finance: renderFinance, settings: renderSettings, audit: renderAudit };
  renderers[tab]();
}

async function getSections() {
  if (SECTIONS_CACHE) return SECTIONS_CACHE;
  SECTIONS_CACHE = await Api.get('/api/admin/osm/sections');
  return SECTIONS_CACHE;
}

// ── Integration health ────────────────────────────────────────────────────
async function renderHealth() {
  const box = document.getElementById('tab-content');
  box.innerHTML = '<p class="muted">Loading&hellip;</p>';
  const params = new URLSearchParams(location.search);
  const health = await Api.get('/api/admin/integration-health');
  box.innerHTML = `
    ${params.get('connected') ? '<div class="alert alert-success">OSM service connection updated.</div>' : ''}
    <div class="card">
      <h2>OSM connection</h2>
      <p>App credentials configured: ${health.osmConfigured ? '<span class="badge" data-status="active">yes</span>' : '<span class="badge" data-status="suspended">no</span>'}</p>
      <p>Demo mode allowed: ${health.demoModeAllowed ? 'Yes' : 'No'}</p>
      ${!health.osmConfigured ? '<p class="muted">Add OSM_CLIENT_ID, OSM_CLIENT_SECRET and OSM_REDIRECT_URI to the server .env file and restart to enable real OSM sign-in.</p>' : ''}
    </div>
    <div class="card">
      <h2>Service connection (used to read data for parent dashboards)</h2>
      <p class="muted">Parents don't have their own OSM login, so parent-facing pages read via one designated OSM connection. See the README "Integration model" section for why.</p>
      ${health.serviceAccount ? `
        <p>Connected as <strong>${escapeHtml(health.serviceAccount.name)}</strong> (${health.serviceAccount.connected === 'demo' ? 'demo data' : 'live OSM'})</p>
        <p class="muted">Last login: ${formatDateTime(health.serviceAccount.lastLoginAt)}</p>
      ` : '<p class="muted">No service connection set yet - parent dashboards will use demo data if allowed.</p>'}
      ${health.osmConfigured ? `<a class="btn btn-secondary" href="/auth/osm/login?intent=service">Connect / change service account</a>` : ''}
    </div>
    <div class="card">
      <p>OSM-connected accounts: ${health.osmUserCount}</p>
    </div>
  `;
}

// ── Sections & capacity (FRD 29 / 6.1) ─────────────────────────────────────
const CAP_STATUS_LABEL = { good: 'Good', watch: 'Watch', full: 'Full', over: 'Over capacity', unset: 'No capacity set' };
const CAP_TREND_LABEL = { rising: '↑ Rising', falling: '↓ Falling', stable: '→ Stable', new: '—' };

const CAP_SOURCE_LABEL = { manual: 'Manual', osm: 'OSM', portal: 'Portal', none: '&mdash;' };

async function renderCapacity() {
  const box = document.getElementById('tab-content');
  box.innerHTML = '<p class="muted">Loading&hellip;</p>';
  let dash, cfg;
  try {
    [dash, cfg] = await Promise.all([Api.get('/api/admin/sections/capacity'), Api.get('/api/admin/sections/capacity/settings')]);
  } catch (e) { box.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; return; }
  const t = dash.totals;
  const cfgBy = {}; (cfg.configured || []).forEach(c => { cfgBy[c.osm_section_id] = c; });
  const known = cfg.sections || [];

  box.innerHTML = `
    <div class="cap-stats">
      <div class="card"><div class="muted">Total active children</div><div class="cap-big">${t.totalActive}</div></div>
      <div class="card"><div class="muted">Available spaces</div><div class="cap-big">${t.availableSpaces}</div></div>
      <div class="card"><div class="muted">Near / over capacity</div><div class="cap-big">${t.nearCapacity}</div></div>
    </div>
    <div class="card">
      <div class="cap-head">
        <h2>Section capacity tracker</h2>
        <span class="cap-actions">
          ${dash.osm && dash.osm.canSync ? '<button class="btn" id="cap-sync">Sync from OSM</button>' : ''}
          <a class="btn btn-secondary" href="/api/admin/sections/capacity/export">Export CSV</a>
        </span>
      </div>
      <p class="muted">Counts only. &ldquo;Active&rdquo; is the number you enter below, or a live OSM member count from &ldquo;Sync from OSM&rdquo;, else the portal&rsquo;s own linked-children count.${dash.osm && dash.osm.lastSyncedAt ? ' Last OSM sync: ' + escapeHtml(formatDateTime(dash.osm.lastSyncedAt)) + '.' : ''} Named drill-down is audited.</p>
      <div id="cap-sync-msg"></div>
      ${dash.sections.length ? `<table class="data-table">
        <thead><tr><th>Section</th><th>Active</th><th>Source</th><th>Joining</th><th>Capacity</th><th>Use</th><th>Trend</th><th>Status</th><th></th></tr></thead>
        <tbody>${dash.sections.map(s => `
          <tr>
            <td><strong>${escapeHtml(s.sectionName)}</strong></td>
            <td>${s.active === null ? '&mdash;' : s.active}</td>
            <td class="muted">${CAP_SOURCE_LABEL[s.source] || '&mdash;'}</td>
            <td>${s.joining === null || s.joining === undefined ? '&mdash;' : s.joining}</td>
            <td>${s.capacity === null || s.capacity === undefined ? '&mdash;' : s.capacity}</td>
            <td>${s.utilisation === null || s.utilisation === undefined ? '&mdash;' : s.utilisation + '%'}</td>
            <td>${CAP_TREND_LABEL[s.trend] || '&mdash;'}</td>
            <td><span class="badge" data-status="${s.status}">${CAP_STATUS_LABEL[s.status] || s.status}</span></td>
            <td><button class="btn btn-secondary btn-sm" data-drill="${escapeHtml(s.sectionId)}" data-name="${escapeHtml(s.sectionName)}">View children</button></td>
          </tr>`).join('')}</tbody>
      </table>` : '<p class="muted">No sections yet. Your OSM sections appear here after you sign in; you can also add capacity for a section below.</p>'}
    </div>
    <div class="card">
      <h2>Capacity settings</h2>
      <p class="muted">All local planning values, never written back to OSM. &ldquo;Active&rdquo; overrides the portal&rsquo;s linked-children count; amber/red are utilisation warning thresholds (%).</p>
      <div id="cap-set-msg"></div>
      ${known.length ? `<table class="data-table">
        <thead><tr><th>Section</th><th>Active</th><th>Capacity</th><th>Amber %</th><th>Red %</th><th>Joining</th><th>Owner</th><th></th></tr></thead>
        <tbody>${known.map(k => {
          const c = cfgBy[k.sectionId] || {};
          return `<tr data-row="${escapeHtml(k.sectionId)}" data-name="${escapeHtml(k.sectionName)}">
            <td><strong>${escapeHtml(k.sectionName)}</strong></td>
            <td><input class="cap-active" type="number" min="0" value="${c.active_count ?? ''}" style="width:70px" placeholder="auto"></td>
            <td><input class="cap-capacity" type="number" min="0" value="${c.capacity ?? ''}" style="width:80px"></td>
            <td><input class="cap-amber" type="number" min="0" max="100" value="${c.amber_pct ?? 85}" style="width:70px"></td>
            <td><input class="cap-red" type="number" min="0" max="100" value="${c.red_pct ?? 95}" style="width:70px"></td>
            <td><input class="cap-joining" type="number" min="0" value="${c.joining_count ?? ''}" style="width:70px"></td>
            <td><input class="cap-owner" value="${escapeHtml(c.owner || '')}" style="min-width:120px"></td>
            <td><button class="btn btn-sm cap-save">Save</button></td>
          </tr>`;
        }).join('')}</tbody>
      </table>` : '<p class="muted">Sign in with an OSM leader account to list your sections here.</p>'}
    </div>
  `;

  box.querySelectorAll('.cap-save').forEach(btn => btn.addEventListener('click', async () => {
    const row = btn.closest('tr');
    try {
      await Api.put('/api/admin/sections/capacity/settings', {
        sectionId: row.dataset.row, sectionName: row.dataset.name,
        activeCount: row.querySelector('.cap-active').value,
        capacity: row.querySelector('.cap-capacity').value,
        amberPct: row.querySelector('.cap-amber').value,
        redPct: row.querySelector('.cap-red').value,
        joiningCount: row.querySelector('.cap-joining').value,
        owner: row.querySelector('.cap-owner').value,
      });
      renderCapacity();
    } catch (e) { document.getElementById('cap-set-msg').innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  }));

  const syncBtn = document.getElementById('cap-sync');
  if (syncBtn) syncBtn.addEventListener('click', async () => {
    const msg = document.getElementById('cap-sync-msg');
    syncBtn.disabled = true; syncBtn.textContent = 'Syncing…';
    try {
      const r = await Api.post('/api/admin/sections/sync');
      const fails = (r.sections || []).filter(s => s.error);
      msg.innerHTML = `<div class="alert ${fails.length ? 'alert-warning' : 'alert-success'}">Synced ${r.synced} of ${r.total} sections from OSM.${fails.length ? ' Some sections did not return data: ' + escapeHtml(fails.map(f => f.section).join(', ')) + '.' : ''}</div>`;
      setTimeout(renderCapacity, 1200);
    } catch (e) {
      msg.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`;
      syncBtn.disabled = false; syncBtn.textContent = 'Sync from OSM';
    }
  });

  box.querySelectorAll('[data-drill]').forEach(btn => btn.addEventListener('click', () => capacityDrill(btn.dataset.drill, btn.dataset.name)));
}

async function capacityDrill(sectionId, sectionName) {
  const existing = document.getElementById('cap-modal'); if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'cap-modal'; modal.className = 'modal-backdrop';
  modal.innerHTML = `<div class="modal-box"><h2>${escapeHtml(sectionName)} &mdash; children</h2>
    <p class="muted">The portal&rsquo;s own linked children for this section. This view is written to the audit log.</p>
    <div id="cap-drill-body"><p class="muted">Loading&hellip;</p></div>
    <div class="cap-actions" style="margin-top:12px"><button class="btn btn-secondary" id="cap-drill-close">Close</button></div></div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.getElementById('cap-drill-close').addEventListener('click', () => modal.remove());
  try {
    const r = await Api.get(`/api/admin/sections/${encodeURIComponent(sectionId)}/children`);
    const body = document.getElementById('cap-drill-body');
    const children = r.children || [];
    body.innerHTML = children.length ? `<table class="data-table"><thead><tr><th>Child</th><th>Parent</th></tr></thead>
      <tbody>${children.map(c => `<tr><td>${escapeHtml(c.name)}</td><td class="muted">${escapeHtml(c.parentName || '')}${c.parentEmail ? ' &middot; ' + escapeHtml(c.parentEmail) : ''}</td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">No children are linked to this section in the portal yet.</p>';
  } catch (e) {
    document.getElementById('cap-drill-body').innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`;
  }
}

// ── Notices ────────────────────────────────────────────────────────────────
async function renderNotices() {
  const box = document.getElementById('tab-content');
  box.innerHTML = '<p class="muted">Loading&hellip;</p>';
  const [notices, sectionsResp] = await Promise.all([Api.get('/api/admin/notices'), getSections()]);
  const sectionOptions = (sectionsResp.sections || []).map(s => `<option value="${escapeHtml(s.sectionId)}" data-name="${escapeHtml(s.sectionName)}">${escapeHtml(s.sectionName)}</option>`).join('');

  box.innerHTML = `
    <div class="card">
      <h2>New notice</h2>
      <form id="notice-form">
        <div class="field"><label>Title</label><input type="text" id="n-title" required></div>
        <div class="field"><label>Body</label><textarea id="n-body" required></textarea></div>
        <div class="grid cols-3">
          <div class="field"><label>Audience</label>
            <select id="n-audience">
              <option value="all">Everyone</option>
              <option value="parents">Parents/carers only</option>
              <option value="leaders">Leaders only</option>
              <option value="section">Specific section</option>
            </select>
          </div>
          <div class="field" id="n-section-field" style="display:none;"><label>Section</label><select id="n-section">${sectionOptions}</select></div>
          <div class="field"><label>Start date</label><input type="date" id="n-start" required value="${new Date().toISOString().slice(0,10)}"></div>
        </div>
        <div class="field" style="max-width:220px;"><label>End date (optional)</label><input type="date" id="n-end"></div>
        <div id="notice-error"></div>
        <div class="actions-row">
          <button class="btn btn-primary" type="submit">Save as draft</button>
        </div>
      </form>
    </div>
    <div id="notice-list"></div>
  `;
  document.getElementById('n-audience').addEventListener('change', e => {
    document.getElementById('n-section-field').style.display = e.target.value === 'section' ? 'block' : 'none';
  });
  document.getElementById('notice-form').addEventListener('submit', async e => {
    e.preventDefault();
    const audience = document.getElementById('n-audience').value;
    const sectionSelect = document.getElementById('n-section');
    try {
      await Api.post('/api/admin/notices', {
        title: document.getElementById('n-title').value,
        body: document.getElementById('n-body').value,
        audience,
        sectionId: audience === 'section' ? sectionSelect.value : null,
        sectionName: audience === 'section' ? sectionSelect.selectedOptions[0]?.dataset.name : null,
        startDate: document.getElementById('n-start').value,
        endDate: document.getElementById('n-end').value || null,
      });
      renderNotices();
    } catch (err) {
      document.getElementById('notice-error').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });

  document.getElementById('notice-list').innerHTML = notices.length === 0 ? '<p class="muted">No notices yet.</p>' : `
    <table><thead><tr><th>Title</th><th>Audience</th><th>Dates</th><th>Status</th><th></th></tr></thead>
    <tbody>${notices.map(n => `
      <tr>
        <td>${escapeHtml(n.title)}</td>
        <td>${escapeHtml(n.audience)}${n.sectionName ? ' (' + escapeHtml(n.sectionName) + ')' : ''}</td>
        <td>${formatDate(n.startDate)}${n.endDate ? ' - ' + formatDate(n.endDate) : ''}</td>
        <td>${statusBadge(n.status)}</td>
        <td>
          ${n.status === 'draft' ? `<button class="btn btn-success btn-sm" data-publish="${n.id}">Publish</button>` : ''}
          <button class="btn btn-danger btn-sm" data-delete="${n.id}">Delete</button>
        </td>
      </tr>`).join('')}</tbody></table>
  `;
  document.querySelectorAll('[data-publish]').forEach(btn => btn.addEventListener('click', async () => {
    await Api.patch(`/api/admin/notices/${btn.dataset.publish}`, { status: 'published' });
    renderNotices();
  }));
  document.querySelectorAll('[data-delete]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('Delete this notice?')) return;
    await Api.delete(`/api/admin/notices/${btn.dataset.delete}`);
    renderNotices();
  }));
}

// ── Users & roles ─────────────────────────────────────────────────────────
async function renderUsers() {
  const box = document.getElementById('tab-content');
  box.innerHTML = '<p class="muted">Loading&hellip;</p>';
  const [users, roles, sectionsResp] = await Promise.all([Api.get('/api/admin/users'), Api.get('/api/admin/roles'), getSections()]);
  const sections = sectionsResp.sections || [];
  const roleOptions = roles.map(r => `<option value="${r.value}">${escapeHtml(r.label)}</option>`).join('');

  // "Access" makes dual-role obvious: a leader who also has linked children.
  const accessCell = (u) => {
    const parts = [];
    if (u.dualRole) parts.push('<span class="badge" data-status="active">Dual role</span>');
    else if (u.isLeader) parts.push('<span class="badge" data-status="pending_approval">Leader</span>');
    else if (u.role === 'parent') parts.push('<span class="badge" data-status="pending_approval">Parent</span>');
    if (u.children.length) parts.push(`<span class="muted" style="font-size:.8rem">${u.children.length} child${u.children.length === 1 ? '' : 'ren'}: ${u.children.map(c => escapeHtml(c.name)).join(', ')}</span>`);
    return parts.join('<br>') || '<span class="muted">&mdash;</span>';
  };

  box.innerHTML = `<div class="card">
    <p class="muted">Link a child to a <strong>leader</strong> to make them dual-role - they gain a Parent View of only their own children. Use “Children” below.</p>
    <table>
    <thead><tr><th>Name</th><th>Login</th><th>Role</th><th>Access</th><th>Status</th><th></th></tr></thead>
    <tbody>${users.map(u => `
      <tr>
        <td>${escapeHtml(u.firstName)} ${escapeHtml(u.lastName)}${u.isServiceAccount ? ' <span class="badge" data-status="active">service</span>' : ''}</td>
        <td>${escapeHtml(u.email || '(OSM account)')}<br><span class="muted">${u.authType === 'osm' ? 'OSM login' : 'Local login'}</span></td>
        <td><select data-role="${u.id}">${roleOptions.replace(`value="${u.role}"`, `value="${u.role}" selected`)}</select></td>
        <td>${accessCell(u)}</td>
        <td><select data-status="${u.id}">
          <option value="active" ${u.status === 'active' ? 'selected' : ''}>Active</option>
          <option value="suspended" ${u.status === 'suspended' ? 'selected' : ''}>Suspended</option>
        </select></td>
        <td style="white-space:nowrap"><button class="btn btn-secondary btn-sm" data-save="${u.id}">Save</button>
          <button class="btn btn-secondary btn-sm" data-kids="${u.id}">Children</button></td>
      </tr>`).join('')}</tbody>
  </table></div><div id="users-error"></div>`;

  document.querySelectorAll('[data-save]').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.dataset.save;
    try {
      await Api.patch(`/api/admin/users/${id}`, {
        role: document.querySelector(`[data-role="${id}"]`).value,
        status: document.querySelector(`[data-status="${id}"]`).value,
      });
      renderUsers();
    } catch (err) {
      document.getElementById('users-error').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  }));
  document.querySelectorAll('[data-kids]').forEach(btn => btn.addEventListener('click', () => {
    openChildrenModal(users.find(u => String(u.id) === btn.dataset.kids), sections);
  }));
}

// Link/unlink a user's children (works for any account - a leader with linked
// children becomes dual-role). Reused member picker via the OSM section members API.
function openChildrenModal(user, sections) {
  const kids = [...(user.children || [])];
  const existing = document.getElementById('kids-modal'); if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'kids-modal'; modal.className = 'modal-backdrop';
  const field = (label, html) => `<div class="field" style="max-width:280px"><label>${label}</label>${html}</div>`;
  modal.innerHTML = `<div class="modal-box">
    <h2>Children &mdash; ${escapeHtml(user.firstName)} ${escapeHtml(user.lastName)}</h2>
    <p class="muted">Linking a child gives this account a <strong>Parent View</strong> of that child. For a leader (${escapeHtml(user.roleLabel)}), this makes them dual-role.</p>
    <div id="kids-list"></div>
    <h3>Link a child</h3>
    ${sections.length ? `${field('Section', `<select id="kids-section">${sections.map(s => `<option value="${escapeHtml(s.sectionId)}" data-name="${escapeHtml(s.sectionName)}" data-type="${escapeHtml(s.sectionType)}">${escapeHtml(s.sectionName)}</option>`).join('')}</select>`)}
    ${field('Member', `<select id="kids-member"><option>Loading&hellip;</option></select>`)}
    <div id="kids-error"></div>
    <button class="btn btn-secondary btn-sm" id="kids-link">Link child</button>` : '<p class="muted">Sign in with an OSM leader account to list section members to link.</p>'}
    <div class="modal-actions" style="display:flex;gap:.5rem;margin-top:1rem"><button class="btn" id="kids-close">Done</button></div>
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) closeKids(); });

  const renderList = () => {
    document.getElementById('kids-list').innerHTML = kids.length === 0
      ? '<p class="muted">No children linked.</p>'
      : `<ul>${kids.map(c => `<li>${escapeHtml(c.name)} <span class="muted">(${escapeHtml(c.sectionName || '')})</span> <button class="btn btn-danger btn-sm" data-unlink="${c.linkId}">Unlink</button></li>`).join('')}</ul>`;
    document.querySelectorAll('#kids-list [data-unlink]').forEach(b => b.addEventListener('click', async () => {
      try {
        await Api.delete(`/api/admin/parents/${user.id}/children/${b.dataset.unlink}`);
        const i = kids.findIndex(c => String(c.linkId) === b.dataset.unlink);
        if (i >= 0) kids.splice(i, 1);
        renderList();
      } catch (e) { document.getElementById('kids-error').innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
    }));
  };
  renderList();

  const closeKids = () => { modal.remove(); renderUsers(); };
  document.getElementById('kids-close').addEventListener('click', closeKids);

  const sectionSel = document.getElementById('kids-section');
  if (sectionSel) {
    const loadMembers = async () => {
      const memberSel = document.getElementById('kids-member');
      memberSel.innerHTML = '<option>Loading&hellip;</option>';
      try {
        const data = await Api.get(`/api/admin/osm/sections/${encodeURIComponent(sectionSel.value)}/members`);
        memberSel.innerHTML = (data.members || []).map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.firstName)} ${escapeHtml(m.lastName)}</option>`).join('') || '<option value="">No members found</option>';
      } catch (e) { memberSel.innerHTML = '<option value="">Could not load members</option>'; }
    };
    sectionSel.addEventListener('change', loadMembers);
    loadMembers();
    document.getElementById('kids-link').addEventListener('click', async () => {
      const opt = sectionSel.selectedOptions[0];
      const memberOpt = document.getElementById('kids-member').selectedOptions[0];
      if (!opt || !memberOpt || !memberOpt.value) return;
      try {
        const res = await Api.post(`/api/admin/parents/${user.id}/children`, {
          osmMemberId: memberOpt.value, osmSectionId: opt.value, osmSectionName: opt.dataset.name,
          osmSectionType: opt.dataset.type, childDisplayName: memberOpt.textContent,
        });
        kids.push({ linkId: res.linkId, name: memberOpt.textContent, sectionName: opt.dataset.name });
        renderList();
      } catch (e) { document.getElementById('kids-error').innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
    });
  }
}

// ── Parent accounts ───────────────────────────────────────────────────────
async function renderParents() {
  const box = document.getElementById('tab-content');
  box.innerHTML = '<p class="muted">Loading&hellip;</p>';
  const [parents, sectionsResp] = await Promise.all([Api.get('/api/admin/parents'), getSections()]);
  const sections = sectionsResp.sections || [];

  box.innerHTML = `
    <div class="card">
      <h2>Add a parent/carer account</h2>
      <form id="parent-form">
        <div class="grid cols-3">
          <div class="field"><label>First name</label><input type="text" id="p-first" required></div>
          <div class="field"><label>Last name</label><input type="text" id="p-last" required></div>
          <div class="field"><label>Email</label><input type="email" id="p-email" required></div>
        </div>
        <div id="parent-error"></div>
        <div id="parent-success"></div>
        <button class="btn btn-primary" type="submit">Create account</button>
      </form>
    </div>
    <div id="parent-list"></div>
  `;
  document.getElementById('parent-form').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const result = await Api.post('/api/admin/parents', {
        firstName: document.getElementById('p-first').value,
        lastName: document.getElementById('p-last').value,
        email: document.getElementById('p-email').value,
      });
      document.getElementById('parent-success').innerHTML = result.emailed
        ? `<div class="alert alert-success">Invite emailed.</div>`
        : `<div class="alert alert-success">Account created. Share this setup link with the parent: <br><code>${escapeHtml(result.setupUrl)}</code></div>`;
      e.target.reset();
      renderParents();
    } catch (err) {
      document.getElementById('parent-error').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });

  document.getElementById('parent-list').innerHTML = parents.length === 0 ? '<p class="muted">No parent accounts yet.</p>' : parents.map(p => `
    <div class="card">
      <strong>${escapeHtml(p.firstName)} ${escapeHtml(p.lastName)}</strong> &middot; ${escapeHtml(p.email)}
      ${statusBadge(p.status)} ${p.hasSetPassword ? '' : '<span class="badge" data-status="draft">invite pending</span>'}
      <h3>Linked children</h3>
      ${p.children.length === 0 ? '<p class="muted">None linked yet.</p>' : `<ul>${p.children.map(c => `<li>${escapeHtml(c.name)} (${escapeHtml(c.sectionName || '')}) <button class="btn btn-danger btn-sm" data-unlink="${p.id}:${c.linkId}">Unlink</button></li>`).join('')}</ul>`}
      <details>
        <summary>Link a child</summary>
        <div class="field" style="max-width:260px;"><label>Section</label>
          <select data-link-section="${p.id}">${sections.map(s => `<option value="${escapeHtml(s.sectionId)}" data-name="${escapeHtml(s.sectionName)}" data-type="${escapeHtml(s.sectionType)}">${escapeHtml(s.sectionName)}</option>`).join('')}</select>
        </div>
        <div class="field" style="max-width:260px;"><label>Member</label><select data-link-member="${p.id}"><option>Loading&hellip;</option></select></div>
        <button class="btn btn-secondary btn-sm" data-link-save="${p.id}">Link child</button>
        <div data-link-error="${p.id}"></div>
      </details>
    </div>
  `).join('');

  document.querySelectorAll('[data-unlink]').forEach(btn => btn.addEventListener('click', async () => {
    const [parentId, linkId] = btn.dataset.unlink.split(':');
    await Api.delete(`/api/admin/parents/${parentId}/children/${linkId}`);
    renderParents();
  }));

  for (const p of parents) {
    const sectionSelect = document.querySelector(`[data-link-section="${p.id}"]`);
    if (!sectionSelect) continue;
    const loadMembers = async () => {
      const memberSelect = document.querySelector(`[data-link-member="${p.id}"]`);
      memberSelect.innerHTML = '<option>Loading&hellip;</option>';
      const sectionId = sectionSelect.value;
      if (!sectionId) { memberSelect.innerHTML = '<option value="">No sections available</option>'; return; }
      const data = await Api.get(`/api/admin/osm/sections/${encodeURIComponent(sectionId)}/members`);
      memberSelect.innerHTML = (data.members || []).map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.firstName)} ${escapeHtml(m.lastName)}</option>`).join('') || '<option value="">No members found</option>';
    };
    sectionSelect.addEventListener('change', loadMembers);
    if (sectionSelect.options.length) loadMembers();
  }
  document.querySelectorAll('[data-link-save]').forEach(btn => btn.addEventListener('click', async () => {
    const parentId = btn.dataset.linkSave;
    const sectionSelect = document.querySelector(`[data-link-section="${parentId}"]`);
    const memberSelect = document.querySelector(`[data-link-member="${parentId}"]`);
    const opt = sectionSelect.selectedOptions[0];
    const memberOpt = memberSelect.selectedOptions[0];
    if (!opt || !memberOpt || !memberOpt.value) return;
    try {
      await Api.post(`/api/admin/parents/${parentId}/children`, {
        osmMemberId: memberOpt.value,
        osmSectionId: opt.value,
        osmSectionName: opt.dataset.name,
        osmSectionType: opt.dataset.type,
        childDisplayName: memberOpt.textContent,
      });
      renderParents();
    } catch (err) {
      document.querySelector(`[data-link-error="${parentId}"]`).innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  }));
}

// ── Settings ───────────────────────────────────────────────────────────────
async function renderSettings() {
  const box = document.getElementById('tab-content');
  box.innerHTML = '<p class="muted">Loading&hellip;</p>';
  const [settings, sectionsResp] = await Promise.all([Api.get('/api/admin/settings'), getSections()]);
  const sections = sectionsResp.sections || [];
  const visible = settings.visibleSectionIds;

  box.innerHTML = `
    <div class="card">
      <h2>Session and audit</h2>
      <form id="settings-form">
        <div class="grid cols-2">
          <div class="field"><label>Inactive session timeout (minutes)</label><input type="number" id="s-timeout" min="5" value="${settings.sessionTimeoutMinutes}"></div>
          <div class="field"><label>Audit log retention (days)</label><input type="number" id="s-retention" min="30" value="${settings.auditRetentionDays}"></div>
        </div>
        <p class="help">Session timeout changes take effect after the server restarts.</p>
        <button class="btn btn-primary" type="submit">Save</button>
        <span id="settings-saved"></span>
      </form>
    </div>
    <div class="card">
      <h2>Visible sections</h2>
      <p class="muted">Limit which sections appear on leader dashboards - useful for a phased rollout (FRD FR-057). Leave everything unticked to show all sections a leader is permitted to see in OSM.</p>
      ${sections.map(s => `
        <label style="font-weight:400;"><input type="checkbox" data-section-visible value="${escapeHtml(s.sectionId)}" ${visible && visible.includes(s.sectionId) ? 'checked' : ''}> ${escapeHtml(s.sectionName)}</label>
      `).join('<br>')}
      <div class="actions-row"><button class="btn btn-secondary" id="save-visible-sections">Save visible sections</button></div>
    </div>
    <div class="card">
      <h2>Photo gallery</h2>
      <p class="muted">The FRD recommends treating the photo gallery as a Phase 2/3 feature rather than part of the initial rollout, until safeguarding, consent and retention decisions are confirmed (FRD 12.1). It ships off by default.</p>
      <form id="gallery-settings-form">
        <div class="field"><label style="font-weight:400;"><input type="checkbox" id="g-enabled" ${settings.galleryEnabled ? 'checked' : ''}> Enable the photo gallery</label></div>
        <div class="field"><label style="font-weight:400;"><input type="checkbox" id="g-watermark" ${settings.galleryWatermarkDefault ? 'checked' : ''}> Default new albums to watermarked photos</label></div>
        <div class="field" style="max-width:220px;"><label>Archived album retention (days)</label><input type="number" id="g-retention" min="30" value="${settings.galleryRetentionDays}"></div>
        <button class="btn btn-primary" type="submit">Save</button>
        <span id="gallery-settings-saved"></span>
      </form>
    </div>
    <div class="card">
      <h2>Expenses &amp; mileage</h2>
      <p class="muted">Ships off by default until the accounts, approvers and thresholds in the "Finance" tab are set up for your pilot (see DECISIONS-finance-module.md).</p>
      <form id="finance-settings-form">
        <div class="field"><label style="font-weight:400;"><input type="checkbox" id="f-enabled" ${settings.financeEnabled ? 'checked' : ''}> Enable expenses and mileage claims</label></div>
        <div class="grid cols-3">
          <div class="field"><label>Single-approver threshold (&pound;)</label><input type="number" id="f-tier1" min="0" step="0.01" value="${settings.financeThresholdTier1}"></div>
          <div class="field"><label>Second-approval threshold (&pound;)</label><input type="number" id="f-tier2" min="0" step="0.01" value="${settings.financeThresholdTier2}"></div>
          <div class="field"><label>Claim/receipt retention (days)</label><input type="number" id="f-retention" min="30" value="${settings.financeRetentionDays}"></div>
        </div>
        <p class="help">Claims up to the first threshold need one account approver. Above the second threshold, a Treasurer or Chair must also approve before it counts as approved (FRD section 19).</p>
        <button class="btn btn-primary" type="submit">Save</button>
        <span id="finance-settings-saved"></span>
      </form>
    </div>
    <div class="card">
      <h2>Leader document library</h2>
      <p class="muted">Store, version and track acknowledgement of leader-only policies, process documents, templates and guidance. Ships off by default until real content is ready to load.</p>
      <form id="doclib-settings-form">
        <div class="field"><label style="font-weight:400;"><input type="checkbox" id="d-enabled" ${settings.documentLibraryEnabled ? 'checked' : ''}> Enable the document library</label></div>
        <button class="btn btn-primary" type="submit">Save</button>
        <span id="doclib-settings-saved"></span>
      </form>
    </div>
    <div class="card">
      <h2>Equipment &amp; asset register</h2>
      <p class="muted">Track kit, condition, location, owners and inspection/replacement due dates. Overdue checks surface in the Action Centre. Ships off by default.</p>
      <form id="equipment-settings-form">
        <div class="field"><label style="font-weight:400;"><input type="checkbox" id="e-enabled" ${settings.equipmentRegisterEnabled ? 'checked' : ''}> Enable the equipment register</label></div>
        <button class="btn btn-primary" type="submit">Save</button>
        <span id="equipment-settings-saved"></span>
      </form>
    </div>
    <div class="card">
      <h2>Quartermaster booking</h2>
      <p class="muted">Leaders request equipment from the stores; Quartermasters (Group Leadership Team &amp; admins) approve at item level and run the collection/return workflow. Builds on the equipment register - nothing is reserved until a QM approves. Ships off by default.</p>
      <form id="qm-settings-form">
        <div class="field"><label style="font-weight:400;"><input type="checkbox" id="qm-enabled" ${settings.qmBookingEnabled ? 'checked' : ''}> Enable Quartermaster booking</label></div>
        <button class="btn btn-primary" type="submit">Save</button>
        <span id="qm-settings-saved"></span>
      </form>
    </div>
    <div class="card">
      <h2>Incident &amp; near-miss logging</h2>
      <p class="muted">Record local operational incidents, near misses and follow-up actions. <strong>This does not replace formal Scouts safeguarding or accident reporting</strong> - the module signposts to those and restricts sensitive records to admins, GLV, the reporter and the assigned owner, with full audit. Ships off by default.</p>
      <form id="incident-settings-form">
        <div class="field"><label style="font-weight:400;"><input type="checkbox" id="i-enabled" ${settings.incidentLoggingEnabled ? 'checked' : ''}> Enable incident &amp; near-miss logging</label></div>
        <button class="btn btn-primary" type="submit">Save</button>
        <span id="incident-settings-saved"></span>
      </form>
    </div>
    <div class="card">
      <h2>Event &amp; camp hub</h2>
      <p class="muted">A local information page per event or camp - parent-facing details plus leader-only documents (risk assessments etc.), linked to OSM for sign-up and payment. Leader-only items are never shown to parents. Ships off by default.</p>
      <form id="eventhub-settings-form">
        <div class="field"><label style="font-weight:400;"><input type="checkbox" id="ev-enabled" ${settings.eventHubEnabled ? 'checked' : ''}> Enable the event &amp; camp hub</label></div>
        <button class="btn btn-primary" type="submit">Save</button>
        <span id="eventhub-settings-saved"></span>
      </form>
    </div>
    <div class="card">
      <h2>Internal calendar</h2>
      <p class="muted">A single planning calendar for leaders and QMs that overlays Event &amp; Camp Hub dates and Quartermaster booking resource blocks with local planning placeholders. Entries stay leader-only until published parent-safe. OSM stays the source of truth for OSM programme data. Ships off by default.</p>
      <form id="calendar-settings-form">
        <div class="field"><label style="font-weight:400;"><input type="checkbox" id="cal-enabled" ${settings.calendarEnabled ? 'checked' : ''}> Enable the internal calendar</label></div>
        <button class="btn btn-primary" type="submit">Save</button>
        <span id="calendar-settings-saved"></span>
      </form>
    </div>
    <div class="card">
      <h2>Section attendance</h2>
      <p class="muted">Lets section leaders take attendance registers for their own section, pre-filled from the live OSM roster and grouped by Six/Patrol, with parent-safe printable registers. <strong>Unlike the rest of the OSM integration, attendance records are stored</strong> (name + present/absent per session) so they survive OSM membership changes. Emergency contact details are not part of this. Ships off by default.</p>
      <form id="attendance-settings-form">
        <div class="field"><label style="font-weight:400;"><input type="checkbox" id="att-enabled" ${settings.attendanceEnabled ? 'checked' : ''}> Enable section attendance</label></div>
        <button class="btn btn-primary" type="submit">Save</button>
        <span id="attendance-settings-saved"></span>
      </form>
    </div>
  `;
  document.getElementById('gallery-settings-form').addEventListener('submit', async e => {
    e.preventDefault();
    await Api.put('/api/admin/settings', {
      galleryEnabled: document.getElementById('g-enabled').checked,
      galleryWatermarkDefault: document.getElementById('g-watermark').checked,
      galleryRetentionDays: Number(document.getElementById('g-retention').value),
    });
    document.getElementById('gallery-settings-saved').textContent = 'Saved.';
  });
  document.getElementById('finance-settings-form').addEventListener('submit', async e => {
    e.preventDefault();
    await Api.put('/api/admin/settings', {
      financeEnabled: document.getElementById('f-enabled').checked,
      financeThresholdTier1: Number(document.getElementById('f-tier1').value),
      financeThresholdTier2: Number(document.getElementById('f-tier2').value),
      financeRetentionDays: Number(document.getElementById('f-retention').value),
    });
    document.getElementById('finance-settings-saved').textContent = 'Saved.';
  });
  document.getElementById('doclib-settings-form').addEventListener('submit', async e => {
    e.preventDefault();
    await Api.put('/api/admin/settings', { documentLibraryEnabled: document.getElementById('d-enabled').checked });
    document.getElementById('doclib-settings-saved').textContent = 'Saved.';
  });
  document.getElementById('equipment-settings-form').addEventListener('submit', async e => {
    e.preventDefault();
    await Api.put('/api/admin/settings', { equipmentRegisterEnabled: document.getElementById('e-enabled').checked });
    document.getElementById('equipment-settings-saved').textContent = 'Saved.';
  });
  document.getElementById('qm-settings-form').addEventListener('submit', async e => {
    e.preventDefault();
    await Api.put('/api/admin/settings', { qmBookingEnabled: document.getElementById('qm-enabled').checked });
    document.getElementById('qm-settings-saved').textContent = 'Saved.';
  });
  document.getElementById('incident-settings-form').addEventListener('submit', async e => {
    e.preventDefault();
    await Api.put('/api/admin/settings', { incidentLoggingEnabled: document.getElementById('i-enabled').checked });
    document.getElementById('incident-settings-saved').textContent = 'Saved.';
  });
  document.getElementById('eventhub-settings-form').addEventListener('submit', async e => {
    e.preventDefault();
    await Api.put('/api/admin/settings', { eventHubEnabled: document.getElementById('ev-enabled').checked });
    document.getElementById('eventhub-settings-saved').textContent = 'Saved.';
  });
  document.getElementById('calendar-settings-form').addEventListener('submit', async e => {
    e.preventDefault();
    await Api.put('/api/admin/settings', { calendarEnabled: document.getElementById('cal-enabled').checked });
    document.getElementById('calendar-settings-saved').textContent = 'Saved.';
  });
  document.getElementById('attendance-settings-form').addEventListener('submit', async e => {
    e.preventDefault();
    await Api.put('/api/admin/settings', { attendanceEnabled: document.getElementById('att-enabled').checked });
    document.getElementById('attendance-settings-saved').textContent = 'Saved.';
  });
  document.getElementById('settings-form').addEventListener('submit', async e => {
    e.preventDefault();
    await Api.put('/api/admin/settings', {
      sessionTimeoutMinutes: Number(document.getElementById('s-timeout').value),
      auditRetentionDays: Number(document.getElementById('s-retention').value),
    });
    document.getElementById('settings-saved').textContent = 'Saved.';
  });
  document.getElementById('save-visible-sections').addEventListener('click', async () => {
    const checked = [...document.querySelectorAll('[data-section-visible]:checked')].map(c => c.value);
    await Api.put('/api/admin/settings', { visibleSectionIds: checked.length ? checked : null });
    renderSettings();
  });
}

// ── Photo gallery ──────────────────────────────────────────────────────────
async function renderGallery() {
  const box = document.getElementById('tab-content');
  box.innerHTML = '<p class="muted">Loading&hellip;</p>';
  const cfg = await Api.get('/api/config');
  if (!cfg.galleryEnabled) {
    box.innerHTML = `<div class="alert alert-warning">The photo gallery is currently off. Turn it on in the Settings tab when you're ready (see FRD 12.1 phasing note).</div>`;
    return;
  }
  const albums = await Api.get('/api/admin/gallery/albums');
  const pending = albums.filter(a => a.status === 'pending_approval');

  box.innerHTML = `
    ${pending.length ? `<div class="card">
      <h2>Awaiting approval (${pending.length})</h2>
      <table><thead><tr><th>Title</th><th>Section</th><th>Photos</th><th></th></tr></thead>
      <tbody>${pending.map(a => `
        <tr><td>${escapeHtml(a.title)}</td><td>${escapeHtml(a.sectionName || '')}</td><td>${a.photoCount}</td>
        <td><a class="btn btn-secondary btn-sm" href="album-edit.html?id=${a.id}">Review</a></td></tr>
      `).join('')}</tbody></table>
    </div>` : ''}
    <div class="card">
      <h2>All albums</h2>
      ${albums.length === 0 ? '<p class="muted">No albums yet.</p>' : `
      <table><thead><tr><th>Title</th><th>Section</th><th>Status</th><th>Photos</th><th></th></tr></thead>
      <tbody>${albums.map(a => `
        <tr><td>${escapeHtml(a.title)}</td><td>${escapeHtml(a.sectionName || '')}</td><td>${statusBadge(a.status)}</td><td>${a.photoCount}</td>
        <td><a class="btn btn-secondary btn-sm" href="album-edit.html?id=${a.id}">Open</a></td></tr>
      `).join('')}</tbody></table>`}
    </div>
  `;
}

// ── Finance (expense accounts + mileage rates) ──────────────────────────────
async function renderFinance() {
  const box = document.getElementById('tab-content');
  box.innerHTML = '<p class="muted">Loading&hellip;</p>';
  const [accounts, candidates, categories, rates] = await Promise.all([
    Api.get('/api/admin/finance/accounts'),
    Api.get('/api/admin/finance/approver-candidates'),
    Api.get('/api/admin/finance/categories'),
    Api.get('/api/admin/finance/mileage-rates'),
  ]);
  const candidateOptions = (selectedId) => `<option value="">(none)</option>` + candidates.map(c => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${escapeHtml(c.name)} (${escapeHtml(c.roleLabel)})</option>`).join('');

  box.innerHTML = `
    <div class="card">
      <h2>Add an expense account</h2>
      <p class="muted">One row per budget account (e.g. Cubs, Scouts, Group). Claims route to whichever leader/admin user is set as the approver here.</p>
      <form id="account-form">
        <div class="grid cols-3">
          <div class="field"><label>Name</label><input type="text" id="a-name" required placeholder="e.g. Cubs"></div>
          <div class="field"><label>Approver</label><select id="a-approver">${candidateOptions(null)}</select></div>
          <div class="field"><label>Deputy approver</label><select id="a-deputy">${candidateOptions(null)}</select></div>
        </div>
        <div id="account-error"></div>
        <button class="btn btn-primary" type="submit">Add account</button>
      </form>
    </div>
    <div class="card">
      <h2>Accounts</h2>
      ${accounts.length === 0 ? '<p class="muted">No accounts yet.</p>' : `
      <table><thead><tr><th>Name</th><th>Approver</th><th>Deputy</th><th>Active</th><th></th></tr></thead>
      <tbody>${accounts.map(a => `
        <tr>
          <td>${escapeHtml(a.name)}</td>
          <td><select data-acc-approver="${a.id}">${candidateOptions(a.approver ? a.approver.id : null)}</select></td>
          <td><select data-acc-deputy="${a.id}">${candidateOptions(a.deputyApprover ? a.deputyApprover.id : null)}</select></td>
          <td><input type="checkbox" data-acc-active="${a.id}" ${a.active ? 'checked' : ''}></td>
          <td><button class="btn btn-secondary btn-sm" data-acc-save="${a.id}">Save</button></td>
        </tr>`).join('')}</tbody></table>`}
      <div id="accounts-error"></div>
    </div>
    <div class="card">
      <h2>Add an expense category</h2>
      <p class="muted">Reporting categories for claim items (e.g. Equipment, Travel &amp; mileage).</p>
      <form id="category-form">
        <div class="grid cols-2">
          <div class="field"><label>Name</label><input type="text" id="cat-name" required placeholder="e.g. Equipment"></div>
          <div class="field"><label>Code (optional)</label><input type="text" id="cat-code"></div>
        </div>
        <div id="category-error"></div>
        <button class="btn btn-primary" type="submit">Add category</button>
      </form>
      ${categories.length === 0 ? '<p class="muted">No categories yet.</p>' : `
      <table><thead><tr><th>Name</th><th>Active</th><th></th></tr></thead>
      <tbody>${categories.map(c => `
        <tr>
          <td>${escapeHtml(c.name)}</td>
          <td><input type="checkbox" data-cat-active="${c.id}" ${c.active ? 'checked' : ''}></td>
          <td><button class="btn btn-secondary btn-sm" data-cat-save="${c.id}">Save</button></td>
        </tr>`).join('')}</tbody></table>`}
    </div>
    <div class="card">
      <h2>Mileage rates</h2>
      <p class="muted">Annual threshold/rate after threshold implement the HMRC AMAP tiering for car/van (e.g. 10,000 miles/tax year) - leave both blank for a flat per-mile rate (motorcycle, bicycle).</p>
      <form id="rate-form">
        <div class="grid cols-3">
          <div class="field"><label>Vehicle type</label><select id="r-vehicle">
            <option value="car">Car/van</option><option value="motorcycle">Motorcycle</option>
            <option value="bicycle">Bicycle</option><option value="other">Other</option>
          </select></div>
          <div class="field"><label>Rate per mile (&pound;)</label><input type="number" id="r-rate" step="0.01" min="0" required></div>
          <div class="field"><label>Effective from</label><input type="date" id="r-from" required value="${new Date().toISOString().slice(0, 10)}"></div>
        </div>
        <div class="grid cols-2">
          <div class="field"><label>Annual threshold miles (optional)</label><input type="number" id="r-threshold" min="0"></div>
          <div class="field"><label>Rate after threshold (&pound;, optional)</label><input type="number" id="r-after-rate" step="0.01" min="0"></div>
        </div>
        <div id="rate-error"></div>
        <button class="btn btn-primary" type="submit">Add rate</button>
      </form>
      ${rates.length === 0 ? '<p class="muted">No rates yet.</p>' : `
      <table><thead><tr><th>Vehicle</th><th>Rate/mile</th><th>Annual threshold</th><th>Rate after threshold</th><th>Effective from</th><th></th></tr></thead>
      <tbody>${rates.map(r => `<tr><td>${escapeHtml(r.vehicleType)}</td><td>&pound;${r.ratePerMile.toFixed(2)}</td><td>${r.annualThresholdMiles ? r.annualThresholdMiles + ' miles' : '&mdash;'}</td><td>${r.rateAfterThreshold ? '£' + r.rateAfterThreshold.toFixed(2) : '&mdash;'}</td><td>${formatDate(r.effectiveFrom)}</td><td><button class="btn btn-danger btn-sm" data-rate-delete="${r.id}">Delete</button></td></tr>`).join('')}</tbody></table>`}
    </div>
  `;

  document.getElementById('account-form').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await Api.post('/api/admin/finance/accounts', {
        name: document.getElementById('a-name').value,
        approverUserId: document.getElementById('a-approver').value || null,
        deputyApproverUserId: document.getElementById('a-deputy').value || null,
      });
      renderFinance();
    } catch (err) {
      document.getElementById('account-error').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });
  document.querySelectorAll('[data-acc-save]').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.dataset.accSave;
    try {
      await Api.patch(`/api/admin/finance/accounts/${id}`, {
        approverUserId: document.querySelector(`[data-acc-approver="${id}"]`).value || null,
        deputyApproverUserId: document.querySelector(`[data-acc-deputy="${id}"]`).value || null,
        active: document.querySelector(`[data-acc-active="${id}"]`).checked,
      });
      renderFinance();
    } catch (err) {
      document.getElementById('accounts-error').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  }));

  document.getElementById('category-form').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await Api.post('/api/admin/finance/categories', {
        name: document.getElementById('cat-name').value,
        code: document.getElementById('cat-code').value || null,
      });
      renderFinance();
    } catch (err) {
      document.getElementById('category-error').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });
  document.querySelectorAll('[data-cat-save]').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.dataset.catSave;
    await Api.patch(`/api/admin/finance/categories/${id}`, { active: document.querySelector(`[data-cat-active="${id}"]`).checked });
    renderFinance();
  }));

  document.getElementById('rate-form').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await Api.post('/api/admin/finance/mileage-rates', {
        vehicleType: document.getElementById('r-vehicle').value,
        ratePerMile: Number(document.getElementById('r-rate').value),
        effectiveFrom: document.getElementById('r-from').value,
        annualThresholdMiles: document.getElementById('r-threshold').value ? Number(document.getElementById('r-threshold').value) : null,
        rateAfterThreshold: document.getElementById('r-after-rate').value ? Number(document.getElementById('r-after-rate').value) : null,
      });
      renderFinance();
    } catch (err) {
      document.getElementById('rate-error').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });
  document.querySelectorAll('[data-rate-delete]').forEach(btn => btn.addEventListener('click', async () => {
    await Api.delete(`/api/admin/finance/mileage-rates/${btn.dataset.rateDelete}`);
    renderFinance();
  }));
}

// ── Audit log ──────────────────────────────────────────────────────────────
async function renderAudit() {
  const box = document.getElementById('tab-content');
  box.innerHTML = '<p class="muted">Loading&hellip;</p>';
  const entries = await Api.get('/api/admin/audit-log');
  box.innerHTML = `<div class="card"><table>
    <thead><tr><th>When</th><th>User</th><th>Action</th><th>Entity</th><th>IP</th></tr></thead>
    <tbody>${entries.map(e => `
      <tr>
        <td>${formatDateTime(e.createdAt)}</td>
        <td>${escapeHtml(e.userName)}</td>
        <td>${escapeHtml(e.action)}</td>
        <td>${escapeHtml(e.entityType || '')} ${escapeHtml(e.entityId || '')}</td>
        <td>${escapeHtml(e.ipAddress || '')}</td>
      </tr>`).join('')}</tbody>
  </table></div>`;
}
