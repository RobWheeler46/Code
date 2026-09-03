// Activity Approval form - fill/submit (creator) and review/approve (approvers).
let FORM, FILES, EVENTS, ACTIONS, MISSING, META, ID, DLV_PACK, DLV_SETTINGS;
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
  DLV_PACK = d.dlvPack; DLV_SETTINGS = d.dlvSettings;

  box.innerHTML = header() + returnedNote() + routeView() + (ACTIONS.canEdit ? editView() : readView()) + filesView() + approverPanel() + dlvPanel() + submitBar() + trailView();
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
      ${F('Phone', `<input id="f-leaderPhone" value="${esc(FORM.leaderPhone)}">`)}
      ${F('Email', `<input id="f-leaderEmail" type="email" value="${esc(FORM.leaderEmail)}">`)}
    </div>
    <div class="card"><h2>Activity details</h2>
      ${F('Description', `<textarea id="f-activityDescription" rows="2">${esc(FORM.activityDescription)}</textarea>`)}
      ${F('Activity type', `<select id="f-activityType">${activityTypeOptionsHtml()}</select>`, 'Adventurous / permit-requiring types need relevant qualifications recorded below.')}
      ${F('Location', `<input id="f-location" value="${esc(FORM.location)}">`)}
      <div class="cap-actions">${F('Date', `<input id="f-activityDate" type="date" value="${esc(FORM.activityDate)}">`)}${F('End date (optional)', `<input id="f-activityEndDate" type="date" value="${esc(FORM.activityEndDate)}">`)}</div>
    </div>
    <div class="card"><h2>Participants</h2>
      ${sectionsField()}
      <div class="cap-actions">${F('Young people (est.)', `<input id="f-ypCount" type="number" min="1" value="${FORM.ypCount ?? ''}" style="width:110px">`)}${F('Adults (est.)', `<input id="f-adultCount" type="number" min="1" value="${FORM.adultCount ?? ''}" style="width:110px">`)}</div>
      ${F('Relevant qualifications', `<textarea id="f-qualifications" rows="2">${esc(FORM.qualifications)}</textarea>`)}
      <div id="af-qual-req" class="field help" hidden>Required for the selected activity type — name the relevant permit(s) or qualification(s) and who holds them.</div>
    </div>
    <div class="card"><h2>Safety &amp; confirmations</h2>
      ${F('In Touch process', `<textarea id="f-inTouch" rows="2">${esc(FORM.inTouch)}</textarea>`, 'Required. How the In Touch / emergency contact arrangements will work for this activity.')}
      ${cb('f-riskAssessmentConfirmed', FORM.riskAssessmentConfirmed, 'A risk assessment has been completed for this activity.')}
      ${cb('f-externalProviderUsed', FORM.externalProviderUsed, 'This activity uses an external provider or instructor (e.g. climbing centre, activity company).')}
      <div id="af-pl-block" style="margin-left:1.5rem"${FORM.externalProviderUsed ? '' : ' hidden'}>
        ${cb('f-publicLiabilityConfirmed', FORM.publicLiabilityConfirmed, 'Public liability cover for the external provider is confirmed.')}
        <div class="field help">Attach the provider's public liability document under "Documents" below (required).</div>
      </div>
      ${cb('f-unityApprovalRequired', FORM.unityApprovalRequired, 'This activity needs Unity Insurance approval (e.g. adventurous or overseas activity).')}
      <div id="af-unity-block" style="margin-left:1.5rem"${FORM.unityApprovalRequired ? '' : ' hidden'}>
        <div class="field help">Attach the Unity Insurance approval document under "Documents" below (required).</div>
      </div>
      ${cb('f-activityRulesConfirmed', FORM.activityRulesConfirmed, 'The relevant activity rules will be followed.')}
    </div>
    <div class="card"><h2>Other</h2>
      ${cb('f-addToCalendar', FORM.addToCalendar, 'Add to the internal calendar when approved.')}
      ${F('Notes (optional)', `<textarea id="f-notes" rows="2">${esc(FORM.notes)}</textarea>`)}
    </div></div>`;
}

// Participating sections: a multi-select of the group's sections (improved-flow
// spec). Stored as a comma-joined string in section_names, so no schema change.
function sectionsField() {
  const chosen = new Set(String(FORM.sectionNames || '').split(',').map(s => s.trim()).filter(Boolean));
  const opts = (META.sections || []).map((name, i) =>
    `<label class="af-sec-opt"><input type="checkbox" class="af-section" id="f-sec-${i}" value="${esc(name)}"${chosen.has(name) ? ' checked' : ''}> ${esc(name)}</label>`).join('');
  return `<div class="field"><label>Participating section(s)</label><div class="af-sections">${opts}</div></div>`;
}

// Activity-type <option>s, marking permit-requiring types.
function activityTypeOptionsHtml() {
  const cur = FORM.activityType || '';
  const opts = (META.activityTypes || []).map(t =>
    `<option value="${esc(t.value)}"${t.value === cur ? ' selected' : ''}>${esc(t.label)}${t.requiresQualification ? ' — qualifications required' : ''}</option>`).join('');
  return `<option value=""${cur ? '' : ' selected'}>Select…</option>${opts}`;
}
function activityTypeRequiresQual(value) {
  const t = (META.activityTypes || []).find(x => x.value === value);
  return !!(t && t.requiresQualification);
}

function collect() {
  const v = id => { const el = document.getElementById(id); return el ? el.value : undefined; };
  const c = id => { const el = document.getElementById(id); return el ? el.checked : undefined; };
  const sections = Array.from(document.querySelectorAll('.af-section')).filter(x => x.checked).map(x => x.value).join(', ');
  return {
    leaderName: v('f-leaderName'), leaderPhone: v('f-leaderPhone'), leaderEmail: v('f-leaderEmail'),
    activityDescription: v('f-activityDescription'), location: v('f-location'), activityDate: v('f-activityDate'), activityEndDate: v('f-activityEndDate'),
    sectionNames: sections, ypCount: v('f-ypCount'), adultCount: v('f-adultCount'),
    activityType: v('f-activityType'), qualifications: v('f-qualifications'),
    inTouch: v('f-inTouch'), externalProviderUsed: c('f-externalProviderUsed'), unityApprovalRequired: c('f-unityApprovalRequired'),
    riskAssessmentConfirmed: c('f-riskAssessmentConfirmed'), publicLiabilityConfirmed: c('f-publicLiabilityConfirmed'),
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

// Single source of truth for required items (label + whether complete), mirroring
// the server's activityValidate. Accepts a values object so it works both from the
// live DOM (collect()) and from the loaded FORM before the DOM exists.
function requiredChecks(c) {
  const checks = [];
  const add = (ok, label) => checks.push({ ok: !!ok, label });
  const txt = v => String(v == null ? '' : v).trim();
  const hasDoc = t => (FILES || []).some(f => f.docType === t);
  add(txt(c.leaderName), 'Leader name');
  add(txt(c.leaderPhone), 'Leader phone');
  add(txt(c.leaderEmail), 'Leader email');
  add(txt(c.activityDescription), 'Activity description');
  add(txt(c.location), 'Location');
  add(txt(c.activityDate), 'Activity date');
  add(txt(c.sectionNames), 'Participating section(s)');
  add(txt(c.inTouch), 'In Touch process');
  add(parseInt(c.ypCount, 10) > 0, 'Estimated number of young people');
  add(parseInt(c.adultCount, 10) > 0, 'Estimated number of adults');
  add(c.riskAssessmentConfirmed, 'Risk assessment confirmation');
  add(c.activityRulesConfirmed, 'Activity rules confirmation');
  if (c.externalProviderUsed) {
    add(c.publicLiabilityConfirmed, 'Public liability confirmation');
    add(hasDoc('public_liability'), 'Public liability document');
  }
  if (c.unityApprovalRequired) add(hasDoc('unity_insurance'), 'Unity Insurance approval document');
  if (activityTypeRequiresQual(c.activityType)) add(txt(c.qualifications), 'Relevant qualifications');
  return checks;
}
function recomputeMissing() { return requiredChecks(collect()).filter(x => !x.ok).map(x => x.label); }

// The GLV-only approval route as a stepper, reflecting where the form is now.
function routeView() {
  const s = FORM.status;
  const steps = [{ label: 'Submitted' }, { label: 'GLV approval', sub: 'within 7 days' }, { label: 'Approved' }];
  let doneUpto = -1, currentIdx = -1;
  if (s === 'draft') currentIdx = 0;
  else if (s === 'awaiting_glv' || s === 'awaiting_section') { doneUpto = 0; currentIdx = 1; }
  else if (s === 'approved') doneUpto = 2;
  else if (s === 'more_info') { doneUpto = 0; currentIdx = 1; }
  else if (s === 'rejected') doneUpto = 0;
  const cells = steps.map((st, i) => {
    const state = i <= doneUpto ? 'done' : (i === currentIdx ? 'current' : 'todo');
    return `<li class="af-step" data-state="${state}"><span class="af-step-dot">${state === 'done' ? '✓' : (i + 1)}</span>
      <span class="af-step-label">${esc(st.label)}${st.sub ? `<span class="af-step-sub">${esc(st.sub)}</span>` : ''}</span></li>`;
  }).join('');
  const note = s === 'rejected' ? '<div class="alert alert-error" style="margin-top:.6rem">This form was rejected.</div>'
    : (s === 'more_info' ? '<p class="muted" style="margin-top:.6rem">Returned for more information — update and resubmit to continue the route.</p>' : '');
  return `<div class="card"><h2>Approval route</h2><ol class="af-route">${cells}</ol>${note}</div>`;
}

// ── Read-only summary (approvers / finished forms) ──────────────────────────────
function readView() {
  const row = (l, v) => v ? `<tr><td class="muted">${l}</td><td>${esc(v)}</td></tr>` : '';
  const yn = b => b ? 'Yes' : 'No';
  return `<div class="card"><h2>Form details</h2><table class="kv-table">
    ${row('Leader', FORM.leaderName)}${row('Phone', FORM.leaderPhone)}${row('Email', FORM.leaderEmail)}
    ${row('Activity', FORM.activityDescription)}${row('Location', FORM.location)}
    ${row('Date', FORM.activityDate ? formatDate(FORM.activityDate) + (FORM.activityEndDate ? ' – ' + formatDate(FORM.activityEndDate) : '') : '')}
    ${row('Activity type', FORM.activityTypeLabel)}
    ${row('Section(s)', FORM.sectionNames)}${row('Numbers', (FORM.ypCount ?? '?') + ' YP / ' + (FORM.adultCount ?? '?') + ' adults')}
    ${row('Qualifications', FORM.qualifications)}${row('In Touch', FORM.inTouch)}
    ${row('External provider', FORM.externalProviderUsed ? 'Yes — public liability confirmed: ' + yn(FORM.publicLiabilityConfirmed) : '')}
    ${row('Unity Insurance approval', FORM.unityApprovalRequired ? 'Required' : '')}
    <tr><td class="muted">Confirmations</td><td>Risk assessment: ${yn(FORM.riskAssessmentConfirmed)} · Activity rules: ${yn(FORM.activityRulesConfirmed)}</td></tr>
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
  return `<div class="card"><h2>Documents</h2><p class="muted">Risk assessment (recommended), public liability, Unity Insurance approval and any supporting documents. PDF, DOCX, XLSX, PNG, JPG up to 10MB.</p>${list}${uploader}</div>`;
}

// ── Approver panel ──────────────────────────────────────────────────────────────
function approverPanel() {
  if (!ACTIONS.canApproveGlv) return '';
  return `<div class="card"><h2>Your decision — GLV approval</h2>
    ${F('Comment (required to return or reject)', `<textarea id="ap-comment" rows="2"></textarea>`)}
    <div class="cap-actions">
      <button class="btn" id="ap-approve">Approve</button>
      <button class="btn btn-secondary" id="ap-refer-dlv">Endorse &amp; send to DLV</button>
      <button class="btn btn-secondary" id="ap-info">Ask for more info</button>
      <button class="btn btn-secondary" id="ap-reject">Reject</button>
    </div>
    <p class="muted" style="font-size:.82rem;margin:.5rem 0 0">${DLV_SETTINGS && DLV_SETTINGS.configured ? 'Endorsing sends an evidence pack to the DLV (' + esc(DLV_SETTINGS.email) + ') for an external Approve/Reject decision.' : 'The DLV email isn’t configured yet — an admin can set it in Admin › Settings.'}</p>
    <div id="ap-msg"></div></div>`;
}

// External DLV approval status (once referred). Shows the request state, pack version,
// the DLV's decision, and a resend for an unanswered request.
function dlvPanel() {
  const p = DLV_PACK;
  if (!p) return '';
  const badge = { preparing: ['pending_approval', 'Preparing'], awaiting: ['pending_approval', 'Awaiting DLV decision'], approved: ['active', 'DLV approved'], rejected: ['deleted', 'DLV rejected'], failed: ['deleted', 'Send failed'], superseded: ['draft', 'Superseded'] }[p.status] || ['draft', p.status];
  const canResend = p.status === 'awaiting' && ACTIONS.canApproveGlv;
  return `<div class="card"><div class="cap-head"><h2 style="margin:0">District (DLV) approval</h2><span class="badge" data-status="${badge[0]}">${badge[1]}</span></div>
    <p class="muted" style="margin:.2rem 0 .5rem">Sent to <strong>${esc(p.recipientName || 'DLV')}</strong>${p.recipientEmail ? ' &lt;' + esc(p.recipientEmail) + '&gt;' : ''} · pack v${p.version}${p.expiresAt ? ' · vote link expires ' + esc(formatDate(p.expiresAt)) : ''}</p>
    ${p.referralReason ? `<p style="margin:.2rem 0"><span class="muted">Referral reason:</span> ${esc(p.referralReason)}</p>` : ''}
    <p class="muted" style="margin:.2rem 0;font-size:.85rem">${p.sentAt ? 'Email sent ' + esc(formatDateTime(p.sentAt)) : 'Email not sent yet'}</p>
    ${p.sendError ? `<div class="alert alert-warning" style="margin:.4rem 0">${esc(p.sendError)}</div>` : ''}
    ${p.decision ? `<p style="margin:.2rem 0"><span class="badge" data-status="${p.decision === 'approve' ? 'active' : 'deleted'}">${p.decision === 'approve' ? 'Approved' : 'Rejected'}</span> ${p.decidedAt ? '<span class="muted">' + esc(formatDateTime(p.decidedAt)) + '</span>' : ''}${p.decisionComment ? '<br><span class="muted">' + esc(p.decisionComment) + '</span>' : ''}</p>` : ''}
    <div class="cap-actions" style="margin-top:.5rem"><a class="btn btn-secondary btn-sm" href="/api/activity/dlv-packs/${p.id}/pack.pdf" target="_blank" rel="noopener">View pack (PDF)</a>${canResend ? '<button class="btn btn-secondary btn-sm" id="dlv-resend">Resend request</button>' : ''}</div>
    <div id="dlv-msg"></div></div>`;
}

// ── Submit bar (creator) ────────────────────────────────────────────────────────
function submitBar() {
  if (!ACTIONS.canSubmit) return '';
  return `<div class="card"><h2>Review &amp; submit</h2><div id="af-submit-bar">${submitBarInner(requiredChecks(FORM))}</div>
    <div style="margin-top:.5rem"><span id="f-saved" class="muted"></span></div>
    <p class="field help" style="margin-top:.2rem">Your changes save automatically as you type.</p></div>`;
}
function submitBarInner(checks) {
  const missing = checks.filter(x => !x.ok).map(x => x.label);
  const done = checks.length - missing.length;
  const pct = checks.length ? Math.round(done / checks.length * 100) : 100;
  return `<div class="af-progress">
      <div class="af-progress-bar"><span style="width:${pct}%"></span></div>
      <div class="muted" style="margin-top:.3rem">${done} of ${checks.length} required items complete</div>
    </div>
    ${missing.length
      ? `<div class="alert alert-warning">Before submitting, complete: ${missing.map(esc).join(', ')}.</div>`
      : '<div class="alert alert-success">All required items are complete.</div>'}
    <div class="cap-actions">
      <button class="btn" id="af-submit"${missing.length ? ' disabled' : ''}>${FORM.status === 'more_info' ? 'Resubmit' : 'Send for approval'}</button>
      <button class="btn btn-secondary" id="f-save" style="margin-left:auto">Save now</button>
      ${ACTIONS.canDelete ? '<button class="btn btn-secondary" id="af-delete">Delete draft</button>' : ''}
    </div>`;
}
// Re-render just the submit bar (called live as fields change) and re-wire it.
function refreshSubmitBar() {
  const el = document.getElementById('af-submit-bar');
  if (!el) return;
  el.innerHTML = submitBarInner(requiredChecks(collect()));
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
  on('ap-refer-dlv', openReferModal);
  on('dlv-resend', resendDlv);
}

function openReferModal() {
  if (!(DLV_SETTINGS && DLV_SETTINGS.configured)) { document.getElementById('ap-msg').innerHTML = '<div class="alert alert-error">The DLV email isn’t configured. Ask an admin to set it in Admin › Settings.</div>'; return; }
  const m = document.createElement('div');
  m.className = 'modal-backdrop'; m.id = 'refer-modal';
  m.innerHTML = `<div class="modal-box"><h2>Endorse &amp; send to the DLV</h2>
    <p class="muted" style="margin-top:-.3rem">This freezes an evidence pack and sends it to <strong>${esc(DLV_SETTINGS.email)}</strong> for an external Approve/Reject decision. The activity is not approved until the DLV votes.</p>
    <div id="refer-msg"></div>
    ${F('Reason for referral', `<textarea id="refer-reason" rows="3" placeholder="e.g. External activity provider — District approval required"></textarea>`)}
    <div class="cap-actions" style="margin-top:1rem"><button class="btn" id="refer-go">Generate pack &amp; refer</button><button class="btn btn-secondary" id="refer-cancel">Cancel</button></div></div>`;
  document.body.appendChild(m);
  m.addEventListener('click', e => { if (e.target === m) m.remove(); });
  m.querySelector('#refer-cancel').addEventListener('click', () => m.remove());
  m.querySelector('#refer-go').addEventListener('click', async () => {
    const reason = document.getElementById('refer-reason').value.trim();
    if (!reason) { document.getElementById('refer-msg').innerHTML = '<div class="alert alert-error">A referral reason is required.</div>'; return; }
    try { await Api.post(`/api/activity/forms/${ID}/refer-dlv`, { reason }); m.remove(); load(); }
    catch (e) { document.getElementById('refer-msg').innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  });
}

async function resendDlv() {
  try { await Api.post(`/api/activity/dlv-packs/${DLV_PACK.id}/resend`, {}); load(); }
  catch (e) { document.getElementById('dlv-msg').innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
}

// Wired separately so refreshSubmitBar() can re-attach after re-rendering the bar.
function wireSubmitButtons() {
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  on('f-save', async () => { try { await save(); } catch (e) { alert(e.message); } });
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
    el.addEventListener(evt, () => { scheduleAutoSave(); applyConditionalVisibility(); refreshSubmitBar(); });
  });
  applyConditionalVisibility();
}

// Show the public-liability / Unity blocks only when their toggle is ticked.
function applyConditionalVisibility() {
  const toggle = (cbId, blockId) => {
    const cb = document.getElementById(cbId), block = document.getElementById(blockId);
    if (cb && block) block.hidden = !cb.checked;
  };
  toggle('f-externalProviderUsed', 'af-pl-block');
  toggle('f-unityApprovalRequired', 'af-unity-block');
  const sel = document.getElementById('f-activityType'), qualHint = document.getElementById('af-qual-req');
  if (sel && qualHint) qualHint.hidden = !activityTypeRequiresQual(sel.value);
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
