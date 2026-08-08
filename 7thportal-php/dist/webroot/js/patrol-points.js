// Patrol Points - competition list + create.
const PP_SKEY = { draft: 'suspended', open: 'active', paused: 'pending_approval', completed: 'active', archived: 'deleted' };

(async () => {
  const me = await requireUserNav();
  if (!me) return;
  const box = document.getElementById('content');
  let data;
  try { data = await Api.get('/api/patrol-points/competitions'); }
  catch (e) { box.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; return; }

  if (data.canManage) {
    document.getElementById('pp-head').innerHTML = '<button class="btn" id="pp-new">New competition</button>';
    document.getElementById('pp-new').addEventListener('click', () => toggleCreate(data.meta));
  }

  const row = (c) => `<tr class="pp-row clickable" data-id="${c.id}">
      <td data-label="Competition" class="rcard-title"><strong>${escapeHtml(c.name)}</strong></td>
      <td data-label="Teams" class="muted">${c.teamCount}</td>
      <td data-label="Approval" class="muted">${escapeHtml(c.approvalModeLabel)}</td>
      <td data-label="Pending">${c.pendingCount ? `<span class="badge" data-status="pending_approval">${c.pendingCount} pending</span>` : '<span class="muted">—</span>'}</td>
      <td data-label="Status"><span class="badge" data-status="${PP_SKEY[c.status] || 'suspended'}">${escapeHtml(c.statusLabel)}</span></td>
    </tr>`;
  const table = (rows) => `<table class="data-table rcards">
    <thead><tr><th>Competition</th><th>Teams</th><th>Approval</th><th>Pending</th><th>Status</th></tr></thead>
    <tbody>${rows.map(row).join('')}</tbody></table>`;

  const active = data.competitions.filter(c => c.status !== 'archived');
  const archived = data.competitions.filter(c => c.status === 'archived');
  box.innerHTML = `
    <div id="pp-create"></div>
    <div class="card"><h2>Competitions</h2>${active.length ? table(active) : '<p class="muted">No competitions yet. Create one to get started.</p>'}</div>
    ${archived.length ? `<div class="card"><h2>Archived</h2>${table(archived)}</div>` : ''}`;
  document.querySelectorAll('.pp-row').forEach(r => r.addEventListener('click', () => location.href = 'patrol-point.html?id=' + r.dataset.id));
})();

function toggleCreate(meta) {
  const host = document.getElementById('pp-create');
  if (host.innerHTML) { host.innerHTML = ''; return; }
  host.innerHTML = `<div class="card card-accent accent-yellow"><h2>New competition</h2>
    <div class="field"><label>Name</label><input id="pp-c-name" placeholder="e.g. Summer Camp 2026"></div>
    <div class="field"><label>Description (optional)</label><textarea id="pp-c-desc" rows="2"></textarea></div>
    <div class="field"><label>Scoring approval</label><select id="pp-c-mode">
      ${Object.entries(meta.approvalModes).map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`).join('')}
    </select></div>
    <div class="field"><label style="font-weight:400"><input type="checkbox" id="pp-c-deduct"> Allow deductions (negative points)</label>
      <span class="field help">Off by default to keep scoring positive; enable deliberately where deductions are governed.</span></div>
    <div class="cap-actions"><button class="btn" id="pp-c-save">Create</button><button class="btn btn-secondary" id="pp-c-cancel">Cancel</button></div>
    <div id="pp-c-msg"></div></div>`;
  document.getElementById('pp-c-cancel').addEventListener('click', () => host.innerHTML = '');
  document.getElementById('pp-c-save').addEventListener('click', async () => {
    const name = document.getElementById('pp-c-name').value.trim();
    if (!name) { document.getElementById('pp-c-msg').innerHTML = '<div class="alert alert-error">A name is required.</div>'; return; }
    try {
      const c = await Api.post('/api/patrol-points/competitions', {
        name, description: document.getElementById('pp-c-desc').value, approvalMode: document.getElementById('pp-c-mode').value,
        allowDeductions: document.getElementById('pp-c-deduct').checked,
      });
      location.href = 'patrol-point.html?id=' + c.id;
    } catch (e) { document.getElementById('pp-c-msg').innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  });
}
