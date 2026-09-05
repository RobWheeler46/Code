// Forms landing (FR-FORM-003): the published forms this user can start, plus their own
// recent submissions. Not a task inbox — returned/approval items live in Actions.
const FORM_STATUS_TONE = { draft: 'suspended', submitted: 'pending_approval', approved: 'active', returned: 'suspended', withdrawn: 'archived' };

(async () => {
  const me = await requireUserNav('leader');
  if (!me) return;
  const box = document.getElementById('content');
  let data;
  try { data = await Api.get('/api/forms'); }
  catch (e) { box.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; return; }

  // Admins get template + submissions administration entry points in the header
  // (completion vs administration stays permission-separated, FR-FORM-004).
  if (data.canAdmin) {
    renderPageHeader({
      title: 'Forms',
      description: 'Start a published form and track your submissions.',
      actions: '<a class="btn btn-secondary" href="forms-admin.html">Manage templates</a><a class="btn btn-secondary" href="forms-submissions.html">All submissions</a>',
    });
  }

  box.innerHTML = availableForms(data.templates) + mySubmissions(data.mySubmissions);
  box.querySelectorAll('[data-start]').forEach(b => b.addEventListener('click', () => startForm(b.dataset.start, b)));
})();

function availableForms(templates) {
  templates = templates || [];
  const cards = templates.map(t => `
    <div class="card" style="margin:0;display:flex;flex-direction:column;gap:.4rem;">
      <div>
        ${t.category ? `<div class="muted" style="font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;font-weight:700;">${escapeHtml(t.category)}</div>` : ''}
        <strong>${escapeHtml(t.title)}</strong>
        ${t.description ? `<p class="muted" style="margin:.25rem 0 0;font-size:.9rem;">${escapeHtml(t.description)}</p>` : ''}
      </div>
      <div style="margin-top:auto;"><button class="btn" data-start="${t.id}">Start form</button></div>
    </div>`).join('');
  const body = templates.length
    ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1rem;">${cards}</div>`
    : `<div class="empty-state">No forms are available to you yet. An administrator publishes forms from Admin.</div>`;
  return `<h2 style="margin:0 0 .75rem;">Available forms</h2>${body}`;
}

function mySubmissions(subs) {
  subs = subs || [];
  if (!subs.length) return `<h2 style="margin:1.75rem 0 .75rem;">My submissions</h2><p class="muted">You have not started any forms yet.</p>`;
  const rows = subs.map(s => `
    <tr class="clickable" data-open="${s.id}">
      <td class="rcard-title"><strong>${escapeHtml(s.templateTitle)}</strong></td>
      <td data-label="Reference" class="muted">${escapeHtml(s.reference)}</td>
      <td data-label="Status"><span class="badge" data-status="${FORM_STATUS_TONE[s.status] || 'draft'}">${escapeHtml(s.statusLabel)}</span></td>
      <td data-label="Updated" class="muted">${s.updatedAt ? formatDate(s.updatedAt) : ''}</td>
      <td class="rcard-actions"><a class="btn btn-secondary btn-sm" href="form-fill.html?id=${s.id}">${s.status === 'draft' || s.status === 'returned' ? 'Continue' : 'View'}</a></td>
    </tr>`).join('');
  return `<h2 style="margin:1.75rem 0 .75rem;">My submissions</h2>
    <div class="card" style="padding:0;overflow:hidden;">
      <table class="data-table rcards" style="margin:0;">
        <thead><tr><th>Form</th><th>Reference</th><th>Status</th><th>Updated</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

async function startForm(templateId, btn) {
  btn.disabled = true; btn.textContent = 'Starting…';
  try {
    const { id } = await Api.post('/api/forms/submissions', { templateId: Number(templateId) });
    location.href = `form-fill.html?id=${id}`;
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Start form';
    alert(e.message);
  }
}

// Row click (outside the action button) opens the submission too.
document.addEventListener('click', e => {
  const row = e.target.closest('[data-open]');
  if (row && !e.target.closest('a,button')) location.href = `form-fill.html?id=${row.dataset.open}`;
});
