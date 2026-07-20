let ME = null;
let SECTIONS_CACHE = null;

const ADMIN_TABS = [
  { tab: 'health', label: 'Integration health' },
  { tab: 'notices', label: 'Notices' },
  { tab: 'users', label: 'Users &amp; roles' },
  { tab: 'parents', label: 'Parent accounts' },
  { tab: 'gallery', label: 'Photo gallery' },
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
  document.querySelectorAll('.admin-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => selectTab(btn.dataset.tab));
  });
  const params = new URLSearchParams(location.search);
  const requested = params.get('tab');
  selectTab(requested && ADMIN_TABS.some(t => t.tab === requested) ? requested : 'health');
})();

function selectTab(tab) {
  document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  const renderers = { health: renderHealth, notices: renderNotices, users: renderUsers, parents: renderParents, gallery: renderGallery, settings: renderSettings, audit: renderAudit };
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
  const [users, roles] = await Promise.all([Api.get('/api/admin/users'), Api.get('/api/admin/roles')]);
  const roleOptions = roles.map(r => `<option value="${r.value}">${escapeHtml(r.label)}</option>`).join('');

  box.innerHTML = `<div class="card"><table>
    <thead><tr><th>Name</th><th>Login</th><th>Role</th><th>Status</th><th></th></tr></thead>
    <tbody>${users.map(u => `
      <tr>
        <td>${escapeHtml(u.firstName)} ${escapeHtml(u.lastName)}${u.isServiceAccount ? ' <span class="badge" data-status="active">service</span>' : ''}</td>
        <td>${escapeHtml(u.email || '(OSM account)')}<br><span class="muted">${u.authType === 'osm' ? 'OSM login' : 'Local login'}</span></td>
        <td><select data-role="${u.id}">${roleOptions.replace(`value="${u.role}"`, `value="${u.role}" selected`)}</select></td>
        <td><select data-status="${u.id}">
          <option value="active" ${u.status === 'active' ? 'selected' : ''}>Active</option>
          <option value="suspended" ${u.status === 'suspended' ? 'selected' : ''}>Suspended</option>
        </select></td>
        <td><button class="btn btn-secondary btn-sm" data-save="${u.id}">Save</button></td>
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
