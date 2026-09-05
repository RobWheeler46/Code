// Forms template administration (FR-FORM-004/005/006): the templates list and the
// plain-language builder. Editing always targets the working DRAFT version; publishing
// validates and supersedes the previous version (which stays immutable for its
// submissions). Admin-only — the routes enforce it too.
let TPL = null, ID = null, SCHEMA = { sections: [] }, fieldSeq = 0;
const FA_TONE = { draft: 'suspended', published: 'active', retired: 'archived' };
const FIELD_TYPES = [
  ['text', 'Short text'], ['textarea', 'Paragraph'], ['email', 'Email'], ['number', 'Number'],
  ['date', 'Date'], ['select', 'Dropdown'], ['radio', 'Choose one'], ['checkbox', 'Tickbox'], ['file', 'File upload'],
];
const faEsc = s => escapeHtml(s == null ? '' : String(s));
const roleList = [['section_leader', 'Section leaders'], ['assistant_leader', 'Assistant leaders'], ['group_leadership', 'Group leadership'], ['treasurer', 'Treasurer'], ['chair', 'Chair'], ['admin', 'Admin']];

(async () => {
  const me = await requireUserNav();
  if (!me) return;
  if (me.role !== 'admin') { renderDenied(); return; }
  ID = new URLSearchParams(location.search).get('id');
  if (ID) await renderBuilder(); else await renderList();
})();

function renderDenied() {
  renderPageHeader({ crumbs: [{ label: 'Forms', href: 'forms.html' }, { label: 'Templates' }], title: 'Templates' });
  document.getElementById('content').innerHTML = '<div class="alert alert-error">Form administration is restricted to administrators.</div>';
}
const err = e => `<div class="alert alert-error">${faEsc(e.message)}</div>`;

// ── Templates list ──────────────────────────────────────────────────────────────
async function renderList() {
  renderPageHeader({
    crumbs: [{ label: 'Forms', href: 'forms.html' }, { label: 'Templates' }],
    title: 'Templates',
    description: 'Create and manage reusable forms. Publishing a change creates a new version; existing submissions keep the version they were completed against.',
    actions: '<button class="btn" id="fa-new">New form</button>',
  });
  document.getElementById('fa-new').addEventListener('click', createTemplate);
  const box = document.getElementById('content');
  let d;
  try { d = await Api.get('/api/admin/forms/templates'); } catch (e) { box.innerHTML = err(e); return; }
  const rows = d.templates.map(t => `
    <tr class="clickable" data-open="${t.id}">
      <td class="rcard-title"><strong>${faEsc(t.title)}</strong>${t.hasDraft && t.status === 'published' ? ' <span class="badge" data-status="draft">unpublished changes</span>' : ''}</td>
      <td data-label="Category" class="muted">${faEsc(t.category || '—')}</td>
      <td data-label="Workflow" class="muted">${t.workflow === 'approval' ? 'Approval' : 'Record'}</td>
      <td data-label="Status"><span class="badge" data-status="${FA_TONE[t.status]}">${faEsc(t.status)}</span></td>
      <td data-label="Submissions">${t.submissionCount}</td>
      <td class="rcard-actions"><a class="btn btn-secondary btn-sm" href="forms-admin.html?id=${t.id}">Open</a></td>
    </tr>`).join('');
  box.innerHTML = d.templates.length
    ? `<div class="card" style="padding:0;overflow:hidden;"><table class="data-table rcards" style="margin:0;">
        <thead><tr><th>Form</th><th>Category</th><th>Workflow</th><th>Status</th><th>Submissions</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>`
    : '<div class="empty-state">No forms yet. Create one to get started.</div>';
  box.querySelectorAll('[data-open]').forEach(r => r.addEventListener('click', e => { if (!e.target.closest('a,button')) location.href = `forms-admin.html?id=${r.dataset.open}`; }));
}

async function createTemplate() {
  try { const { id } = await Api.post('/api/admin/forms/templates', { title: 'Untitled form' }); location.href = `forms-admin.html?id=${id}`; }
  catch (e) { alert(e.message); }
}

// ── Builder ─────────────────────────────────────────────────────────────────────
async function renderBuilder() {
  const box = document.getElementById('content');
  try { TPL = await Api.get(`/api/admin/forms/templates/${ID}`); } catch (e) { box.innerHTML = err(e); return; }
  SCHEMA = TPL.schema && TPL.schema.sections ? TPL.schema : { sections: [] };
  fieldSeq = maxFieldNum();

  renderPageHeader({
    crumbs: [{ label: 'Forms', href: 'forms.html' }, { label: 'Templates', href: 'forms-admin.html' }, { label: TPL.title }],
    title: TPL.title,
    status: { label: TPL.status + (TPL.hasDraft && TPL.status === 'published' ? ' (draft changes)' : ''), tone: TPL.status === 'published' ? 'ready' : (TPL.status === 'retired' ? 'neutral' : 'attention') },
    actions: `<a class="btn btn-secondary" href="forms-admin.html">Back</a>`,
  });

  box.innerHTML = metadataCard() + `<div id="fb-area"></div>` + actionCard();
  renderBuilderArea();
  wireBuilder();
}

function maxFieldNum() {
  let m = 0;
  (SCHEMA.sections || []).forEach(s => (s.fields || []).forEach(f => { const n = parseInt(String(f.id || '').replace(/\D/g, ''), 10); if (n > m) m = n; }));
  return m;
}

function metadataCard() {
  const roles = TPL.audienceRoles || [];
  return `<div class="card">
    <h2>Form details</h2>
    <div class="field"><label>Title</label><input id="m-title" value="${faEsc(TPL.title)}"></div>
    <div class="field"><label>Description</label><textarea id="m-desc" rows="2">${faEsc(TPL.description)}</textarea></div>
    <div class="cap-actions">
      <div class="field"><label>Category</label><input id="m-cat" value="${faEsc(TPL.category)}" placeholder="e.g. Volunteering" style="width:180px"></div>
      <div class="field"><label>Workflow</label><select id="m-workflow"><option value="record"${TPL.workflow === 'record' ? ' selected' : ''}>Record only</option><option value="approval"${TPL.workflow === 'approval' ? ' selected' : ''}>Needs approval</option></select></div>
    </div>
    <div class="field"><label>Who can start this form</label>
      <div class="af-sections">${roleList.map(([v, l]) => `<label class="af-sec-opt"><input type="checkbox" class="m-role" value="${v}"${roles.includes(v) ? ' checked' : ''}> ${l}</label>`).join('')}</div>
      <span class="field help">Leave all unticked to offer it to every leader.</span>
    </div>
    <div class="field"><label style="font-weight:400"><input type="checkbox" id="m-onbehalf"${TPL.allowOnBehalf ? ' checked' : ''}> Allow completing on behalf of someone else</label></div>
  </div>`;
}

function renderBuilderArea() {
  const area = document.getElementById('fb-area');
  const secs = (SCHEMA.sections || []).map((sec, si) => `
    <div class="card fb-section" data-sec="${si}">
      <div class="cap-head">
        <input class="fb-sec-title" value="${faEsc(sec.title)}" placeholder="Section title (e.g. About you)" style="font-weight:700;flex:1 1 auto;min-width:12rem">
        <span class="cap-actions">
          <button class="btn btn-secondary btn-sm fb-sec-up" data-sec="${si}" title="Move up"${si === 0 ? ' disabled' : ''}>&uarr;</button>
          <button class="btn btn-secondary btn-sm fb-sec-del" data-sec="${si}">Remove section</button>
        </span>
      </div>
      ${(sec.fields || []).map((f, fi) => fieldRow(f, si, fi)).join('') || '<p class="muted">No fields yet.</p>'}
      <button class="btn btn-secondary btn-sm fb-add-field" data-sec="${si}">Add field</button>
    </div>`).join('');
  area.innerHTML = secs + `<button class="btn btn-secondary fb-add-section">Add section</button>`;
  wireBuilderArea();
}

function fieldRow(f, si, fi) {
  const isChoice = f.type === 'select' || f.type === 'radio';
  return `<div class="fb-field" data-fid="${faEsc(f.id)}" data-sec="${si}" data-fld="${fi}" style="border:1px solid var(--border);border-radius:var(--radius);padding:.6rem;margin:.5rem 0;">
    <div class="cap-actions">
      <div class="field" style="flex:2 1 12rem"><label>Question</label><input class="fb-label" value="${faEsc(f.label)}"></div>
      <div class="field"><label>Type</label><select class="fb-type">${FIELD_TYPES.map(([v, l]) => `<option value="${v}"${f.type === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
    </div>
    <div class="field fb-opts-wrap"${isChoice ? '' : ' hidden'}><label>Options (comma separated)</label><input class="fb-opts" value="${faEsc((f.options || []).join(', '))}"></div>
    <div class="cap-actions" style="align-items:center">
      <label style="font-weight:400"><input type="checkbox" class="fb-req"${f.required ? ' checked' : ''}> Required</label>
      <input class="fb-help" value="${faEsc(f.help)}" placeholder="Help text (optional)" style="flex:1 1 12rem">
      <button class="btn btn-secondary btn-sm fb-fld-up" title="Move up"${fi === 0 ? ' disabled' : ''}>&uarr;</button>
      <button class="btn btn-secondary btn-sm fb-fld-del">Remove</button>
    </div>
  </div>`;
}

function actionCard() {
  return `<div class="card">
    <div id="fb-msg"></div>
    <div class="cap-actions">
      <button class="btn btn-secondary" id="fb-save">Save draft</button>
      <button class="btn" id="fb-publish">Publish</button>
      ${TPL.status === 'published' ? '<button class="btn btn-secondary" id="fb-retire" style="margin-left:auto">Retire form</button>' : ''}
      ${TPL.status === 'draft' && TPL.submissionCount === 0 ? '<button class="btn btn-secondary" id="fb-delete" style="margin-left:auto">Delete</button>' : ''}
    </div>
    ${TPL.versions && TPL.versions.length ? `<p class="muted" style="margin:.6rem 0 0;font-size:.85rem">Versions: ${TPL.versions.map(v => `v${v.versionNo} ${faEsc(v.status)}`).join(' · ')}</p>` : ''}
  </div>`;
}

// Rebuild SCHEMA from the DOM (DOM order is the source of truth during editing).
function collectSchema() {
  const sections = [];
  document.querySelectorAll('.fb-section').forEach(secEl => {
    const title = secEl.querySelector('.fb-sec-title').value.trim();
    const fields = [];
    secEl.querySelectorAll('.fb-field').forEach(fEl => {
      const type = fEl.querySelector('.fb-type').value;
      const f = { id: fEl.dataset.fid, label: fEl.querySelector('.fb-label').value.trim(), type, required: fEl.querySelector('.fb-req').checked };
      const help = fEl.querySelector('.fb-help').value.trim(); if (help) f.help = help;
      if (type === 'select' || type === 'radio') f.options = fEl.querySelector('.fb-opts').value.split(',').map(s => s.trim()).filter(Boolean);
      fields.push(f);
    });
    sections.push({ title, fields });
  });
  return { sections };
}
function collectMeta() {
  return {
    title: document.getElementById('m-title').value.trim() || 'Untitled form',
    description: document.getElementById('m-desc').value.trim(),
    category: document.getElementById('m-cat').value.trim(),
    workflow: document.getElementById('m-workflow').value,
    allowOnBehalf: document.getElementById('m-onbehalf').checked,
    audienceRoles: [...document.querySelectorAll('.m-role:checked')].map(c => c.value),
  };
}

function wireBuilder() {
  document.getElementById('fb-save').addEventListener('click', () => save(false));
  document.getElementById('fb-publish').addEventListener('click', () => save(true));
  document.getElementById('fb-retire')?.addEventListener('click', retire);
  document.getElementById('fb-delete')?.addEventListener('click', del);
}

function wireBuilderArea() {
  const area = document.getElementById('fb-area');
  area.querySelector('.fb-add-section').addEventListener('click', () => { SCHEMA = collectSchema(); SCHEMA.sections.push({ title: '', fields: [] }); renderBuilderArea(); });
  area.querySelectorAll('.fb-sec-del').forEach(b => b.addEventListener('click', () => { SCHEMA = collectSchema(); SCHEMA.sections.splice(+b.dataset.sec, 1); renderBuilderArea(); }));
  area.querySelectorAll('.fb-sec-up').forEach(b => b.addEventListener('click', () => { const i = +b.dataset.sec; SCHEMA = collectSchema(); if (i > 0) { [SCHEMA.sections[i - 1], SCHEMA.sections[i]] = [SCHEMA.sections[i], SCHEMA.sections[i - 1]]; } renderBuilderArea(); }));
  area.querySelectorAll('.fb-add-field').forEach(b => b.addEventListener('click', () => { SCHEMA = collectSchema(); SCHEMA.sections[+b.dataset.sec].fields.push({ id: 'f' + (++fieldSeq), label: '', type: 'text', required: false }); renderBuilderArea(); }));
  area.querySelectorAll('.fb-field').forEach(fEl => {
    const si = +fEl.dataset.sec, fi = +fEl.dataset.fld;
    fEl.querySelector('.fb-fld-del').addEventListener('click', () => { SCHEMA = collectSchema(); SCHEMA.sections[si].fields.splice(fi, 1); renderBuilderArea(); });
    fEl.querySelector('.fb-fld-up').addEventListener('click', () => { SCHEMA = collectSchema(); if (fi > 0) { const a = SCHEMA.sections[si].fields; [a[fi - 1], a[fi]] = [a[fi], a[fi - 1]]; } renderBuilderArea(); });
    fEl.querySelector('.fb-type').addEventListener('change', e => { const w = fEl.querySelector('.fb-opts-wrap'); w.hidden = !(e.target.value === 'select' || e.target.value === 'radio'); });
  });
}

async function save(publish) {
  const msg = t => { document.getElementById('fb-msg').innerHTML = t; };
  SCHEMA = collectSchema();
  try {
    await Api.put(`/api/admin/forms/templates/${ID}`, { ...collectMeta(), schema: SCHEMA });
    if (publish) await Api.post(`/api/admin/forms/templates/${ID}/publish`, {});
    await renderBuilder();
    document.getElementById('fb-msg').innerHTML = `<div class="alert alert-success">${publish ? 'Published.' : 'Draft saved.'}</div>`;
  } catch (e) {
    const list = (e.data && e.data.errors) ? `<ul style="margin:.4rem 0 0;">${e.data.errors.map(x => `<li>${faEsc(x)}</li>`).join('')}</ul>` : '';
    msg(`<div class="alert alert-error">${faEsc(e.message)}${list}</div>`);
  }
}

async function retire() {
  try { await Api.post(`/api/admin/forms/templates/${ID}/retire`, {}); await renderBuilder(); }
  catch (e) { document.getElementById('fb-msg').innerHTML = err(e); }
}
async function del() {
  try { await Api.delete(`/api/admin/forms/templates/${ID}`); location.href = 'forms-admin.html'; }
  catch (e) { document.getElementById('fb-msg').innerHTML = err(e); }
}
