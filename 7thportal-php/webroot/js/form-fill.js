// Form completion (FR-FORM-003/008/009): renders a submission against its FROZEN schema
// snapshot so the record always looks as it did when started, whatever later template
// edits happen. Editable for the owner while draft/returned; read-only once submitted;
// an approval panel appears for a permitted approver (approval-workflow templates).
let SUB = null, ID = null;
const FF_TONE = { draft: 'attention', submitted: 'pending', approved: 'ready', returned: 'attention', withdrawn: 'neutral' };
const ffEsc = s => escapeHtml(s == null ? '' : String(s));

(async () => {
  const me = await requireUserNav();
  if (!me) return;
  ID = new URLSearchParams(location.search).get('id');
  if (!ID) { document.getElementById('content').innerHTML = '<div class="alert alert-error">No form specified.</div>'; return; }
  await load();
})();

async function load() {
  const box = document.getElementById('content');
  try { SUB = await Api.get(`/api/forms/submissions/${ID}`); }
  catch (e) { box.innerHTML = `<div class="alert alert-error">${ffEsc(e.message)}</div>`; return; }

  // Canonical header: Forms > <reference>. Template title is the H1 (like Finance claims).
  renderPageHeader({
    crumbs: [{ label: 'Forms', href: 'forms.html' }, { label: SUB.reference }],
    title: SUB.templateTitle,
    status: { label: SUB.statusLabel, tone: FF_TONE[SUB.status] || 'neutral' },
    actions: '<a class="btn btn-secondary" href="forms.html">Back to forms</a>',
  });

  const A = SUB.myActions;
  box.innerHTML = onBehalfNote() + returnedNote() + descriptionCard() + sectionsView(A.canEdit)
    + (A.canApprove ? approvalPanel() : '') + actionBar(A);
  wire(A);
}

function onBehalfNote() {
  if (!SUB.onBehalfOf) return '';
  return `<div class="alert alert-info">Completed on behalf of <strong>${ffEsc(SUB.onBehalfOf)}</strong>${SUB.onBehalfReason ? ' — ' + ffEsc(SUB.onBehalfReason) : ''}.</div>`;
}
function returnedNote() {
  if (SUB.status !== 'returned') return '';
  return `<div class="alert alert-warning">Returned for changes${SUB.decisionComment ? ': ' + ffEsc(SUB.decisionComment) : ''}. Update the form and resubmit.</div>`;
}
function descriptionCard() {
  if (!SUB.templateDescription) return '';
  return `<div class="card"><p class="muted" style="margin:0">${ffEsc(SUB.templateDescription)}</p></div>`;
}

// Render each section as a card; each field editable or read-only.
function sectionsView(editable) {
  const sections = (SUB.schema && SUB.schema.sections) || [];
  return sections.map(sec => `
    <div class="card">
      ${sec.title ? `<h2>${ffEsc(sec.title)}</h2>` : ''}
      ${(sec.fields || []).map(f => field(f, SUB.data[f.id], editable)).join('')}
    </div>`).join('') || '<div class="card"><p class="muted">This form has no questions.</p></div>';
}

function field(f, value, editable) {
  const req = f.required ? ' <span class="err" style="color:var(--red)">*</span>' : '';
  const id = `ff-${ffEsc(f.id)}`;
  if (f.type === 'file') return fileField(f, editable);
  if (!editable) return roField(f, value);
  const label = t => `<div class="field"><label>${ffEsc(f.label)}${req}</label>${t}${f.help ? `<span class="field help">${ffEsc(f.help)}</span>` : ''}</div>`;
  switch (f.type) {
    case 'textarea': return label(`<textarea id="${id}" data-fid="${ffEsc(f.id)}" rows="3">${ffEsc(value)}</textarea>`);
    case 'number': return label(`<input id="${id}" data-fid="${ffEsc(f.id)}" type="number" value="${ffEsc(value)}">`);
    case 'date': return label(`<input id="${id}" data-fid="${ffEsc(f.id)}" type="date" value="${ffEsc(value)}">`);
    case 'email': return label(`<input id="${id}" data-fid="${ffEsc(f.id)}" type="email" value="${ffEsc(value)}">`);
    case 'select': return label(`<select id="${id}" data-fid="${ffEsc(f.id)}"><option value="">Choose…</option>${(f.options || []).map(o => `<option${o === value ? ' selected' : ''}>${ffEsc(o)}</option>`).join('')}</select>`);
    case 'radio': return `<div class="field"><label>${ffEsc(f.label)}${req}</label><div class="af-sections" data-fid="${ffEsc(f.id)}" data-radio="1">${(f.options || []).map(o => `<label class="af-sec-opt"><input type="radio" name="${id}" value="${ffEsc(o)}"${o === value ? ' checked' : ''}> ${ffEsc(o)}</label>`).join('')}</div></div>`;
    case 'checkbox': return `<div class="field"><label style="font-weight:400"><input type="checkbox" id="${id}" data-fid="${ffEsc(f.id)}"${value ? ' checked' : ''}> ${ffEsc(f.label)}${req}</label></div>`;
    default: return label(`<input id="${id}" data-fid="${ffEsc(f.id)}" value="${ffEsc(value)}">`);
  }
}

// File-evidence field: existing uploads as private download links, plus an upload
// control while editable. Files live under SUB.files[fieldId], not in data.
function fileField(f, editable) {
  const req = f.required ? ' <span class="err" style="color:var(--red)">*</span>' : '';
  const files = (SUB.files && SUB.files[f.id]) || [];
  const list = files.map(x => `<div class="ff-file" style="display:flex;gap:.5rem;align-items:center;padding:.3rem 0;">
      <a href="/api/forms/submissions/${SUB.id}/files/${x.id}/download" target="_blank" rel="noopener">${ffEsc(x.filename || ('file.' + x.ext))}</a>
      ${editable ? `<button class="btn btn-secondary btn-sm ff-file-del" data-file="${x.id}">Remove</button>` : ''}
    </div>`).join('') || '<p class="muted" style="margin:.2rem 0">No file uploaded.</p>';
  const upload = editable
    ? `<div class="ff-upload" data-fid="${ffEsc(f.id)}" style="margin-top:.3rem"><input type="file" class="ff-file-input" data-fid="${ffEsc(f.id)}" accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx"><span class="field help">PDF, DOCX, XLSX, PNG or JPG, up to 10MB.</span></div>`
    : '';
  return `<div class="field"><label>${ffEsc(f.label)}${req}</label>${list}${upload}</div>`;
}

function roField(f, value) {
  let shown;
  if (f.type === 'checkbox') shown = value ? 'Yes' : 'No';
  else shown = (value === undefined || value === null || value === '') ? '—' : String(value);
  return `<div class="field"><label>${ffEsc(f.label)}</label><div>${ffEsc(shown)}</div></div>`;
}

// Collect answers from the rendered inputs, keyed by field id.
function collectData() {
  const data = {};
  document.querySelectorAll('#content [data-fid]').forEach(el => {
    if (el.type === 'file' || el.classList.contains('ff-upload')) return; // evidence lives in files, not data
    const fid = el.dataset.fid;
    if (el.type === 'checkbox') data[fid] = el.checked;
    else data[fid] = el.value;
  });
  document.querySelectorAll('#content [data-radio]').forEach(g => {
    const fid = g.dataset.fid;
    const sel = g.querySelector('input[type="radio"]:checked');
    data[fid] = sel ? sel.value : '';
  });
  return data;
}

function actionBar(A) {
  const btns = [];
  if (A.canEdit) {
    btns.push('<button class="btn btn-secondary" id="ff-save">Save draft</button>');
    btns.push('<button class="btn" id="ff-submit">Submit</button>');
  }
  if (A.canWithdraw && SUB.status !== 'draft') btns.push('<button class="btn btn-secondary" id="ff-withdraw">Withdraw</button>');
  if (!btns.length) return '';
  return `<div class="card"><div id="ff-msg"></div><div class="cap-actions">${btns.join('')}</div></div>`;
}

function approvalPanel() {
  return `<div class="card">
    <h2>Review</h2>
    <p class="muted">Approve this submission, or return it to the submitter with a reason.</p>
    <div class="field"><label>Comment</label><textarea id="ff-decision-comment" rows="2" placeholder="Required when returning"></textarea></div>
    <div id="ff-decision-msg"></div>
    <div class="cap-actions"><button class="btn" id="ff-approve">Approve</button><button class="btn btn-secondary" id="ff-return">Return for changes</button></div>
  </div>`;
}

function wire(A) {
  const msg = t => { const m = document.getElementById('ff-msg'); if (m) m.innerHTML = t; };
  const save = async (submit) => {
    const data = collectData();
    try {
      if (submit) { await Api.post(`/api/forms/submissions/${ID}/submit`, { data }); }
      else { await Api.put(`/api/forms/submissions/${ID}`, { data }); }
      await load();
    } catch (e) {
      msg(`<div class="alert alert-error">${ffEsc(e.message)}</div>`);
    }
  };
  document.getElementById('ff-save')?.addEventListener('click', () => save(false));
  document.getElementById('ff-submit')?.addEventListener('click', () => save(true));
  document.querySelectorAll('.ff-file-input').forEach(inp => inp.addEventListener('change', () => uploadFile(inp)));
  document.querySelectorAll('.ff-file-del').forEach(b => b.addEventListener('click', () => removeFile(b.dataset.file)));
  document.getElementById('ff-withdraw')?.addEventListener('click', async () => {
    if (!confirmInline()) return;
    try { await Api.post(`/api/forms/submissions/${ID}/withdraw`, {}); await load(); }
    catch (e) { msg(`<div class="alert alert-error">${ffEsc(e.message)}</div>`); }
  });
  if (A.canApprove) {
    const dmsg = t => { document.getElementById('ff-decision-msg').innerHTML = t; };
    const decide = async (decision) => {
      const comment = document.getElementById('ff-decision-comment').value.trim();
      try { await Api.post(`/api/forms/submissions/${ID}/decision`, { decision, comment }); await load(); }
      catch (e) { dmsg(`<div class="alert alert-error">${ffEsc(e.message)}</div>`); }
    };
    document.getElementById('ff-approve').addEventListener('click', () => decide('approve'));
    document.getElementById('ff-return').addEventListener('click', () => decide('return'));
  }
}

// Persist typed answers before a file op, so the reload doesn't drop them.
async function preserveAnswers() {
  if (!SUB.myActions.canEdit) return;
  try { await Api.put(`/api/forms/submissions/${ID}`, { data: collectData() }); } catch (e) { /* best effort */ }
}
async function uploadFile(inp) {
  const file = inp.files && inp.files[0];
  if (!file) return;
  const msg = t => { const m = document.getElementById('ff-msg'); if (m) m.innerHTML = t; };
  await preserveAnswers();
  const fd = new FormData();
  fd.append('file', file);
  fd.append('fieldId', inp.dataset.fid);
  try {
    const res = await fetch(`/api/forms/submissions/${ID}/files`, { method: 'POST', body: fd });
    const d = await res.json().catch(() => null);
    if (!res.ok) { msg(`<div class="alert alert-error">${ffEsc((d && d.error) || 'Upload failed.')}</div>`); return; }
    await load();
  } catch (e) { msg(`<div class="alert alert-error">${ffEsc(e.message)}</div>`); }
}
async function removeFile(fileId) {
  await preserveAnswers();
  try { await Api.delete(`/api/forms/submissions/${ID}/files/${fileId}`); await load(); }
  catch (e) { const m = document.getElementById('ff-msg'); if (m) m.innerHTML = `<div class="alert alert-error">${ffEsc(e.message)}</div>`; }
}

// Lightweight inline confirm without a native dialog (native dialogs hang under preview).
let _confirmed = false;
function confirmInline() {
  const m = document.getElementById('ff-msg');
  if (_confirmed) return true;
  if (m) m.innerHTML = '<div class="alert alert-warning">Click Withdraw again to confirm.</div>';
  _confirmed = true;
  setTimeout(() => { _confirmed = false; }, 4000);
  return false;
}
