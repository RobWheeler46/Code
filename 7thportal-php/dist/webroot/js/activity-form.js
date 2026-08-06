// Activity Approval form - fill/submit (creator) and review/approve (approvers).
let FORM, FILES, EVENTS, ACTIONS, MISSING, META, ID;
const SKEY = { draft: 'suspended', awaiting_section: 'pending_approval', awaiting_glv: 'pending_approval', approved: 'active', rejected: 'deleted', more_info: 'suspended' };

(async () => {
  const me = await requireUserNav();
  if (!me) return;
  ID = new URLSearchParams(location.search).get('id');
  document.getElementById('af-head').innerHTML = '<a class="btn btn-secondary" href="activity-forms.html">Back to forms</a>';
  if (!ID) { document.getElementById('content').innerHTML = '<div class="alert alert-error">No form specified.</div>'; return; }
  load();
})();

async function load() {
  clearTimeout(AS_timer); AS_saving = false; AS_pending = false;
  const box = document.getElementById('content');
  let d;
  try { d = await Api.get(`/api/activity/forms/${ID}`); }
  catch (e) { box.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; return; }
  FORM = d.form; FILES = d.files; EVENTS = d.events; ACTIONS = d.myActions; MISSING = d.missing; META = d.meta;

  box.innerHTML = header() + returnedNote() + (ACTIONS.canEdit ? editView() : readView()) + filesView() + approverPanel() + submitBar() + trailView();
  wire();
}

const F = (label, html, hint) => `<div class="field"><label>${label}</label>${html}${hint ? `<span class="field help">${hint}</span>` : ''}</div>`;
const esc = s => escapeHtml(s == null ? '' : s);

function header() {
  return `<div class="card"><div class="cap-head"><h2 style="margin:0">${esc(FORM.reference)}</h2>
    <span class="badge" data-status="${SKEY[FORM.status]}">${esc(FORM.statusLabel)}</span></div>
    <p class="muted">${esc(FORM.activityDescription || 'Draft activity form')}</p></div>`;
}
function returnedNote() {
  if (FORM.status !== 'more_info') return '';
  const last = [...EVENTS].reverse().find(e => e.action === 'request_info');
  return `<div class="alert alert-warning">Returned for more information${last ? ` by ${esc(last.by)}` : ''}: ${esc(last ? last.comment : '')}. Update the form and resubmit.</div>`;
}

// ── Editable form (creator, draft/more_info) ────────────────────────────────────
function editView() {
  const cb = (id, checked, label) => `<div class="field"><label style="font-weight:400"><input type="checkbox" id="${id}"${checked ? ' checked' : ''}> ${label}</label></div>`;
  return `<div id="af-edit">
    <div class="card"><h2>Leader details</h2>
      ${F('Name', `<input id="f-leaderName" value="${esc(FORM.leaderName)}">`)}
      <div class="cap-actions">${F('Phone', `<input id="f-leaderPhone" value="${esc(FORM.leaderPhone)}">`)}${F('Email', `<input id="f-leaderEmail" type="email" value="${esc(FORM.leaderEmail)}">`)}</div>
    </div>
    <div class="card"><h2>Activity details</h2>
      ${F('Description', `<textarea id="f-activityDescription" rows="2">${esc(FORM.activityDescription)}</textarea>`)}
      ${F('Location', `<input id="f-location" value="${esc(FORM.location)}">`)}
      <div class="cap-actions">${F('Date', `<input id="f-activityDate" type="date" value="${esc(FORM.activityDate)}">`)}${F('End date (optional)', `<input id="f-activityEndDate" type="date" value="${esc(FORM.activityEndDate)}">`)}</div>
    </div>
    <div class="card"><h2>Participants</h2>
      ${F('Participating section(s)', `<input id="f-sectionNames" value="${esc(FORM.sectionNames)}" placeholder="e.g. Cubs, Scouts">`)}
      <div class="cap-actions">${F('Young people (est.)', `<input id="f-ypCount" type="number" min="0" value="${FORM.ypCount ?? ''}" style="width:110px">`)}${F('Adults (est.)', `<input id="f-adultCount" type="number" min="0" value="${FORM.adultCount ?? ''}" style="width:110px">`)}</div>
      ${F('Relevant qualifications', `<textarea id="f-qualifications" rows="2">${esc(FORM.qualifications)}</textarea>`)}
    </div>
    <div class="card"><h2>Safety &amp; confirmations</h2>
      ${F('In Touch process', `<textarea id="f-inTouch" rows="2">${esc(FORM.inTouch)}</textarea>`)}
      ${cb('f-riskAssessmentConfirmed', FORM.riskAssessmentConfirmed, 'A risk assessment has been completed for this activity.')}
      ${cb('f-publicLiabilityConfirmed', FORM.publicLiabilityConfirmed, 'Public liability cover is confirmed (documents attached where needed).')}
      ${cb('f-activityRulesConfirmed', FORM.activityRulesConfirmed, 'The relevant activity rules will be followed.')}
    </div>
    <div class="card"><h2>Other</h2>
      ${cb('f-addToCalendar', FORM.addToCalendar, 'Add to the internal calendar when approved.')}
      ${F('Notes (optional)', `<textarea id="f-notes" rows="2">${esc(FORM.notes)}</textarea>`)}
      <button class="btn btn-secondary" id="f-save">Save now</button> <span id="f-saved" class="muted" style="margin-left:.4rem"></span>
      <div class="field help">Your changes save automatically as you type.</div>
    </div></div>`;
}

function collect() {
  const v = id => { const el = document.getElementById(id); return el ? el.value : undefined; };
  const c = id => { const el = document.getElementById(id); return el ? el.checked : undefined; };
  return {
    leaderName: v('f-leaderName'), leaderPhone: v('f-leaderPhone'), leaderEmail: v('f-leaderEmail'),
    activityDescription: v('f-activityDescription'), location: v('f-location'), activityDate: v('f-activityDate'), activityEndDate: v('f-activityEndDate'),
    sectionNames: v('f-sectionNames'), ypCount: v('f-ypCount'), adultCount: v('f-adultCount'), qualifications: v('f-qualifications'),
    inTouch: v('f-inTouch'), riskAssessmentConfirmed: c('f-riskAssessmentConfirmed'), publicLiabilityConfirmed: c('f-publicLiabilityConfirmed'),
    activityRulesConfirmed: c('f-activityRulesConfirmed'), addToCalendar: c('f-addToCalendar'), notes: v('f-notes'),
  };
}
async function save(silent) {
  const r = await Api.patch(`/api/activity/forms/${ID}`, collect());
  if (!silent) setSaveStatus('Saved.');
  return r;
}

// Auto-save: coalesces rapid edits, never overlaps a request, and retries if the
// user typed again while a save was in flight.
let AS_saving = false, AS_pending = false, AS_timer = null;
function setSaveStatus(text, err) {
  const s = document.getElementById('f-saved');
  if (s) { s.textContent = text; s.style.color = err ? '#c62828' : 'var(--muted)'; }
}
function scheduleAutoSave() {
  clearTimeout(AS_timer);
  setSaveStatus('Saving…');
  AS_timer = setTimeout(autoSaveNow, 800);
}
async function autoSaveNow() {
  if (AS_saving) { AS_pending = true; return; }
  AS_saving = true;
  try {
    await Api.patch(`/api/activity/forms/${ID}`, collect());
    setSaveStatus('Saved ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
  } catch (e) {
    setSaveStatus('Not saved — will retry', true); AS_pending = true;
  } finally {
    AS_saving = false;
    if (AS_pending) { AS_pending = false; setTimeout(autoSaveNow, 500); }
  }
}

// Client-side mirror of the server's required-item check, so the submit bar
// updates live as the form is filled (server re-validates on submit anyway).
function recomputeMissing() {
  const c = collect();
  const M = [];
  const req = { leaderName: 'Leader name', leaderPhone: 'Leader phone', leaderEmail: 'Leader email', activityDescription: 'Activity description', location: 'Location', activityDate: 'Activity date', sectionNames: 'Participating section(s)' };
  for (const k in req) if (!String(c[k] || '').trim()) M.push(req[k]);
  if (!(parseInt(c.ypCount, 10) > 0)) M.push('Estimated number of young people');
  if (!c.riskAssessmentConfirmed) M.push('Risk assessment confirmation');
  if (!c.publicLiabilityConfirmed) M.push('Public liability confirmation');
  if (!c.activityRulesConfirmed) M.push('Activity rules confirmation');
  if (!(FILES || []).some(f => f.docType === 'risk_assessment')) M.push('Risk assessment document upload');
  return M;
}

// ── Read-only summary (approvers / finished forms) ──────────────────────────────
function readView() {
  const row = (l, v) => v ? `<tr><td class="muted">${l}</td><td>${esc(v)}</td></tr>` : '';
  const yn = b => b ? 'Yes' : 'No';
  return `<div class="card"><h2>Form details</h2><table class="kv-table">
    ${row('Leader', FORM.leaderName)}${row('Phone', FORM.leaderPhone)}${row('Email', FORM.leaderEmail)}
    ${row('Activity', FORM.activityDescription)}${row('Location', FORM.location)}
    ${row('Date', FORM.activityDate ? formatDate(FORM.activityDate) + (FORM.activityEndDate ? ' – ' + formatDate(FORM.activityEndDate) : '') : '')}
    ${row('Section(s)', FORM.sectionNames)}${row('Numbers', (FORM.ypCount ?? '?') + ' YP / ' + (FORM.adultCount ?? '?') + ' adults')}
    ${row('Qualifications', FORM.qualifications)}${row('In Touch', FORM.inTouch)}
    <tr><td class="muted">Confirmations</td><td>Risk assessment: ${yn(FORM.riskAssessmentConfirmed)} · Public liability: ${yn(FORM.publicLiabilityConfirmed)} · Activity rules: ${yn(FORM.activityRulesConfirmed)}</td></tr>
    ${row('Notes', FORM.notes)}
  </table></div>`;
}

// ── Files ───────────────────────────────────────────────────────────────────────
function filesView() {
  const editable = ACTIONS.canEdit;
  const list = FILES.length ? `<table class="data-table"><tbody>${FILES.map(x => `<tr>
      <td><a href="/api/activity/forms/${ID}/files/${x.id}/download" target="_blank" rel="noopener">${esc(x.filename)}</a></td>
      <td class="muted">${esc(x.docTypeLabel)}</td>
      ${editable ? `<td><button class="btn btn-secondary btn-sm af-file-del" data-id="${x.id}">Remove</button></td>` : ''}
    </tr>`).join('')}</tbody></table>` : '<p class="muted">No documents attached.</p>';
  const uploader = editable ? `
    <div class="cap-actions" style="margin-top:.6rem">
      <select id="af-doctype">${Object.entries(META.docTypes).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
      <input type="file" id="af-file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg">
      <button class="btn btn-secondary" id="af-upload">Upload</button>
    </div><div id="af-upload-msg"></div>` : '';
  return `<div class="card"><h2>Documents</h2><p class="muted">Risk assessment, public liability, Unity Insurance approval and any supporting documents. PDF, DOCX, XLSX, PNG, JPG up to 10MB.</p>${list}${uploader}</div>`;
}

// ── Approver panel ──────────────────────────────────────────────────────────────
function approverPanel() {
  if (!(ACTIONS.canApproveSection || ACTIONS.canApproveGlv)) return '';
  const stage = ACTIONS.canApproveGlv ? 'GLV (final)' : 'Section Lead';
  return `<div class="card"><h2>Your decision — ${stage}</h2>
    ${F('Comment (required to return or reject)', `<textarea id="ap-comment" rows="2"></textarea>`)}
    <div class="cap-actions">
      <button class="btn" id="ap-approve">Approve</button>
      <button class="btn btn-secondary" id="ap-info">Request more info</button>
      <button class="btn btn-secondary" id="ap-reject">Reject</button>
    </div><div id="ap-msg"></div></div>`;
}

// ── Submit bar (creator) ────────────────────────────────────────────────────────
function submitBar() {
  if (!ACTIONS.canSubmit) return '';
  return `<div class="card"><h2>Review &amp; submit</h2><div id="af-submit-bar">${submitBarInner(MISSING)}</div></div>`;
}
function submitBarInner(missing) {
  return `${missing.length
      ? `<div class="alert alert-warning">Before submitting, complete: ${missing.map(esc).join(', ')}.</div>`
      : '<div class="alert alert-success">All required items are complete.</div>'}
    <div class="cap-actions">
      <button class="btn" id="af-submit"${missing.length ? ' disabled' : ''}>${FORM.status === 'more_info' ? 'Resubmit' : 'Submit for approval'}</button>
      ${ACTIONS.canDelete ? '<button class="btn btn-secondary" id="af-delete" style="margin-left:auto">Delete draft</button>' : ''}
    </div>`;
}
// Re-render just the submit bar (called live as fields change) and re-wire it.
function refreshSubmitBar() {
  const el = document.getElementById('af-submit-bar');
  if (!el) return;
  el.innerHTML = submitBarInner(recomputeMissing());
  wireSubmitButtons();
}

// ── Approval trail ──────────────────────────────────────────────────────────────
function trailView() {
  if (!EVENTS.length) return '';
  const label = { submit: 'Submitted', resubmit: 'Resubmitted', section_approve: 'Section Lead approved', glv_approve: 'GLV approved', reject: 'Rejected', request_info: 'More info requested', calendar_created: 'Calendar entry created' };
  return `<div class="card"><h2>Approval trail</h2>${EVENTS.map(e => `<div style="padding:.4rem 0;border-bottom:1px solid var(--border)">
    <strong>${esc(label[e.action] || e.action)}</strong> <span class="muted">· ${esc(e.by)} · ${formatDateTime(e.at)}</span>
    ${e.comment ? `<br><span class="muted">${esc(e.comment)}</span>` : ''}</div>`).join('')}</div>`;
}

// ── Wiring ──────────────────────────────────────────────────────────────────────
function wire() {
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  on('f-save', async () => { try { await save(); refreshSubmitBar(); } catch (e) { alert(e.message); } });
  wireSubmitButtons();
  wireAutoSave();
  on('af-upload', async () => {
    const input = document.getElementById('af-file');
    if (!input.files.length) return;
    const fd = new FormData(); fd.append('file', input.files[0]);
    const msg = document.getElementById('af-upload-msg');
    try {
      const res = await fetch(`/api/activity/forms/${ID}/files?type=${encodeURIComponent(document.getElementById('af-doctype').value)}`, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      load();
    } catch (e) { msg.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  });
  document.querySelectorAll('.af-file-del').forEach(b => b.addEventListener('click', async () => {
    try { await Api.delete(`/api/activity/forms/${ID}/files/${b.dataset.id}`); load(); } catch (e) { alert(e.message); }
  }));
  on('ap-approve', () => decide('approve', false));
  on('ap-info', () => decide('request-info', true));
  on('ap-reject', () => decide('reject', true));
}

// Wired separately so refreshSubmitBar() can re-attach after re-rendering the bar.
function wireSubmitButtons() {
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  on('af-submit', async () => {
    try { await autoSaveFlush(); await Api.post(`/api/activity/forms/${ID}/submit`, {}); load(); }
    catch (e) { alert(e.message + (e.missing ? '\nMissing: ' + e.missing.join(', ') : '')); }
  });
  on('af-delete', async () => { if (!confirm('Delete this draft form?')) return; try { await Api.delete(`/api/activity/forms/${ID}`); location.href = 'activity-forms.html'; } catch (e) { alert(e.message); } });
}

// Attach auto-save to every editable field (only present when canEdit).
function wireAutoSave() {
  const root = document.getElementById('af-edit');
  if (!root) return;
  root.querySelectorAll('[id^="f-"]').forEach(el => {
    const evt = (el.type === 'checkbox' || el.tagName === 'SELECT' || el.type === 'date') ? 'change' : 'input';
    el.addEventListener(evt, () => { scheduleAutoSave(); refreshSubmitBar(); });
  });
}

// Ensure any pending edit is persisted before an action that depends on it (submit).
async function autoSaveFlush() {
  clearTimeout(AS_timer);
  await autoSaveNow();
  while (AS_saving || AS_pending) await new Promise(r => setTimeout(r, 100));
}
async function decide(action, needComment) {
  const comment = (document.getElementById('ap-comment') || {}).value || '';
  if (needComment && !comment.trim()) { document.getElementById('ap-msg').innerHTML = '<div class="alert alert-error">A comment is required.</div>'; return; }
  try { await Api.post(`/api/activity/forms/${ID}/${action}`, { comment }); load(); }
  catch (e) { document.getElementById('ap-msg').innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
}
