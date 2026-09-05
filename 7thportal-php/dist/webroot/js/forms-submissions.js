// Forms submissions administration (FR-FORM-007): a permission-filtered list with
// search/filter/drill-down. Admin-only — the route enforces it, and because only admins
// reach it there is no restricted-record leakage to guard against here.
const FS_TONE = { draft: 'suspended', submitted: 'pending_approval', approved: 'active', returned: 'suspended', withdrawn: 'archived' };
let FS_META = null;
const fsEsc = s => escapeHtml(s == null ? '' : String(s));

(async () => {
  const me = await requireUserNav();
  if (!me) return;
  renderPageHeader({
    crumbs: [{ label: 'Forms', href: 'forms.html' }, { label: 'Submissions' }],
    title: 'Submissions',
    description: 'Every submission across all forms. Search or filter by form and status.',
  });
  if (me.role !== 'admin') { document.getElementById('content').innerHTML = '<div class="alert alert-error">Restricted to administrators.</div>'; return; }
  await refresh(true);
})();

async function refresh(first) {
  const box = document.getElementById('content');
  const params = new URLSearchParams();
  const templateId = document.getElementById('fs-template')?.value;
  const status = document.getElementById('fs-status')?.value;
  const q = document.getElementById('fs-q')?.value.trim();
  if (templateId) params.set('templateId', templateId);
  if (status) params.set('status', status);
  if (q) params.set('q', q);
  let d;
  try { d = await Api.get('/api/admin/forms/submissions?' + params.toString()); }
  catch (e) { box.innerHTML = `<div class="alert alert-error">${fsEsc(e.message)}</div>`; return; }
  if (first) { FS_META = d; box.innerHTML = controls(d) + `<div id="fs-list"></div>`; wireControls(); }
  document.getElementById('fs-list').innerHTML = listTable(d.submissions);
  document.querySelectorAll('#fs-list [data-open]').forEach(r => r.addEventListener('click', e => { if (!e.target.closest('a,button')) location.href = `form-fill.html?id=${r.dataset.open}`; }));
}

function controls(d) {
  const tplOpts = ['<option value="">All forms</option>'].concat((d.templates || []).map(t => `<option value="${t.id}">${fsEsc(t.title)}</option>`)).join('');
  const stOpts = ['<option value="">All statuses</option>'].concat(Object.entries(d.statuses || {}).map(([k, v]) => `<option value="${k}">${fsEsc(v)}</option>`)).join('');
  return `<div class="card"><div class="cap-actions" style="align-items:flex-end">
      <div class="field" style="flex:1 1 12rem"><label>Search</label><input id="fs-q" placeholder="Reference, form or person"></div>
      <div class="field"><label>Form</label><select id="fs-template">${tplOpts}</select></div>
      <div class="field"><label>Status</label><select id="fs-status">${stOpts}</select></div>
    </div></div>`;
}

function wireControls() {
  document.getElementById('fs-q').addEventListener('input', () => refresh(false));
  document.getElementById('fs-template').addEventListener('change', () => refresh(false));
  document.getElementById('fs-status').addEventListener('change', () => refresh(false));
}

function listTable(subs) {
  subs = subs || [];
  if (!subs.length) return '<div class="empty-state">No submissions match these filters.</div>';
  const rows = subs.map(s => `
    <tr class="clickable" data-open="${s.id}">
      <td data-label="Reference" class="rcard-title"><strong>${fsEsc(s.reference)}</strong></td>
      <td data-label="Form">${fsEsc(s.templateTitle)}</td>
      <td data-label="From" class="muted">${fsEsc(s.submitterName)}</td>
      <td data-label="Status"><span class="badge" data-status="${FS_TONE[s.status] || 'draft'}">${fsEsc(s.statusLabel)}</span></td>
      <td data-label="Updated" class="muted">${s.updatedAt ? formatDate(s.updatedAt) : ''}</td>
      <td class="rcard-actions"><a class="btn btn-secondary btn-sm" href="form-fill.html?id=${s.id}">Open</a></td>
    </tr>`).join('');
  return `<div class="card" style="padding:0;overflow:hidden;"><table class="data-table rcards" style="margin:0;">
    <thead><tr><th>Reference</th><th>Form</th><th>From</th><th>Status</th><th>Updated</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}
