// Forms landing (FR-FORM-003): the published forms this user can start, plus their own
// recent submissions. Not a task inbox — returned/approval items live in Actions.
const FORM_STATUS_TONE = { draft: 'suspended', submitted: 'pending_approval', approved: 'active', returned: 'suspended', withdrawn: 'archived' };
let CAN_ADMIN = false;
const TEMPLATES = {};

(async () => {
  const me = await requireUserNav('leader');
  if (!me) return;
  const box = document.getElementById('content');
  let data;
  try { data = await Api.get('/api/forms'); }
  catch (e) { box.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; return; }
  CAN_ADMIN = data.canAdmin;
  (data.templates || []).forEach(t => { TEMPLATES[t.id] = t; });

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

function startForm(templateId, btn) {
  const tpl = TEMPLATES[templateId];
  // On-behalf is a controlled admin capability (FR-FORM-008): offer the choice only
  // when the template allows it and the user is an administrator.
  if (tpl && tpl.allowOnBehalf && CAN_ADMIN) return openOnBehalfModal(Number(templateId));
  directStart(Number(templateId), null, btn);
}

async function directStart(templateId, onBehalf, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Starting…'; }
  try {
    const body = { templateId };
    if (onBehalf) body.onBehalf = onBehalf;
    const { id } = await Api.post('/api/forms/submissions', body);
    location.href = `form-fill.html?id=${id}`;
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Start form'; }
    const err = document.getElementById('ob-msg');
    if (err) err.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; else alert(e.message);
  }
}

async function openOnBehalfModal(templateId) {
  let people = [];
  try { people = (await Api.get('/api/forms/people')).people || []; } catch (e) { /* fall back to self only */ }
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal-box">
    <h2 style="margin-top:0">Start “${escapeHtml(TEMPLATES[templateId].title)}”</h2>
    <div class="field"><label>Who is this for?</label>
      <select id="ob-who"><option value="">Myself</option>${people.map(p => `<option value="${p.id}">${escapeHtml(p.name)} (${escapeHtml(p.role)})</option>`).join('')}</select></div>
    <div class="field" id="ob-reason-wrap" hidden><label>Reason for completing on their behalf</label><textarea id="ob-reason" rows="2" placeholder="Recorded on the submission"></textarea></div>
    <div id="ob-msg"></div>
    <div class="cap-actions"><button class="btn" id="ob-start">Start</button><button class="btn btn-secondary" id="ob-cancel">Cancel</button></div>
  </div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  document.getElementById('ob-cancel').addEventListener('click', close);
  document.getElementById('ob-who').addEventListener('change', e => { document.getElementById('ob-reason-wrap').hidden = !e.target.value; });
  document.getElementById('ob-start').addEventListener('click', () => {
    const who = document.getElementById('ob-who').value;
    if (!who) return directStart(templateId, null, null);
    const reason = document.getElementById('ob-reason').value.trim();
    if (!reason) { document.getElementById('ob-msg').innerHTML = '<div class="alert alert-error">Give a reason for completing on their behalf.</div>'; return; }
    directStart(templateId, { userId: Number(who), reason }, null);
  });
}

// Row click (outside the action button) opens the submission too.
document.addEventListener('click', e => {
  const row = e.target.closest('[data-open]');
  if (row && !e.target.closest('a,button')) location.href = `form-fill.html?id=${row.dataset.open}`;
});
