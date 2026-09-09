// Patrol Points - Quick Score: a one-screen tap-to-score workspace (FRD v2.4 s13.7).
// Choose team -> tap points -> tap a reason -> submit; the screen stays put and is
// immediately ready for the next award. Reuses the standard submission pipeline.
let C, TEAMS, CATS, ACTIVITIES, ACT, ID;
let selCat = null, selActivity = null, selTeams = [], selPoints = null, selReason = null, multi = false;
const RECENT = [];
const esc = s => escapeHtml(s == null ? '' : String(s));
// Rapid Score loop state (FRD PP2.4 s6): the last award (for Correct this score) and the
// carry-forward preference, remembered per user/device.
let LAST = null, correcting = false, corr = { points: null, reason: '' };
function loadCarry() { try { return localStorage.getItem('pp_qs_carry') || 'reset'; } catch (e) { return 'reset'; } }
function saveCarry(v) { try { localStorage.setItem('pp_qs_carry', v); } catch (e) { /* private mode */ } }
let carry = loadCarry();
// After each award the team is always cleared to avoid accidental repeat awards; the
// carry mode decides whether points and reason are kept for the next entry.
function applyCarry() {
  selTeams = [];
  if (carry === 'reset') { selPoints = null; selReason = null; noteVal._v = ''; }
  else if (carry === 'activity_reason') { selPoints = null; } // keep reason, clear points
  // 'points_reason' keeps both points and reason
}

(async () => {
  const me = await requireUserNav();
  if (!me) return;
  ID = new URLSearchParams(location.search).get('id');
  if (!ID) { document.getElementById('content').innerHTML = '<div class="alert alert-error">No competition specified.</div>'; return; }
  let d;
  try { d = await Api.get(`/api/patrol-points/competitions/${ID}`); }
  catch (e) { document.getElementById('content').innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; return; }
  C = d.competition; TEAMS = d.teams; CATS = d.categories; ACTIVITIES = d.activities || []; ACT = d.myActions;
  // Canonical header: Patrol Points > <competition> > Score.
  renderPageHeader({
    crumbs: [
      { label: 'Patrol Points', href: 'patrol-points.html' },
      { label: C.name, href: `patrol-point.html?id=${encodeURIComponent(ID)}` },
      { label: 'Score' },
    ],
    title: 'Quick Score',
    actions: `<a class="btn btn-secondary" href="patrol-point.html?id=${encodeURIComponent(ID)}">Back to competition</a>`,
  });
  selCat = CATS.length ? CATS[0].id : null;
  const aParam = new URLSearchParams(location.search).get('activity');
  if (aParam) { const a = ACTIVITIES.find(x => x.id === Number(aParam)); if (a) { selActivity = a.id; selCat = a.categoryId; } }
  render();
  document.getElementById('content').addEventListener('click', onClick);
  document.getElementById('content').addEventListener('change', e => {
    if (e.target.id === 'pp-qs-carry') { carry = e.target.value; saveCarry(carry); }
  });
})();

// The effective scoring config: an activity profile if one is selected, else the
// plain category. Drives the point buttons, reason presets and team scope.
function activeProfile() {
  if (selActivity != null) return ACTIVITIES.find(a => a.id === selActivity) || null;
  const c = CATS.find(x => x.id === selCat);
  return c ? { categoryId: c.id, freeEntry: c.freeEntry, pointButtons: c.pointButtons, reasonPresets: c.reasonPresets, teamScope: null } : null;
}
function teamsInScope(p) { return p && p.teamScope ? TEAMS.filter(t => p.teamScope.includes(t.id)) : TEAMS; }

function render() {
  const box = document.getElementById('content');
  if (!ACT.canSubmit) {
    box.innerHTML = `<div class="alert alert-warning">Quick Score is available once the competition is open and has teams and a scoring category.</div>`;
    return;
  }
  const p = activeProfile();
  const teams = teamsInScope(p);
  const chip = (label, on, attrs) => `<button class="pp-qs-chip${on ? ' selected' : ''}" ${attrs}>${label}</button>`;
  const activityRow = ACTIVITIES.length
    ? `<div class="pp-qs-group"><div class="pp-qs-label">Activity</div><div class="pp-qs-chips">${chip('Free scoring', selActivity == null, 'data-act="activity" data-id="free"')}${ACTIVITIES.map(a => chip(esc(a.name), a.id === selActivity, `data-act="activity" data-id="${a.id}"`)).join('')}</div></div>`
    : '';
  const catRow = (selActivity == null && CATS.length > 1)
    ? `<div class="pp-qs-group"><div class="pp-qs-label">Category</div><div class="pp-qs-chips">${CATS.map(x => chip(esc(x.name), x.id === selCat, `data-act="cat" data-id="${x.id}"`)).join('')}</div></div>`
    : '';
  const teamRow = `<div class="pp-qs-group"><div class="pp-qs-label">Team${multi ? 's' : ''}
      <label class="pp-qs-multi"><input type="checkbox" id="pp-qs-multi"${multi ? ' checked' : ''}> multi-team</label></div>
    <div class="pp-qs-chips">${teams.map(t => chip(esc(t.name), selTeams.includes(t.id), `data-act="team" data-id="${t.id}"`)).join('') || '<span class="muted">No teams in scope.</span>'}</div></div>`;
  const buttons = (p ? p.pointButtons : []).map(n => chip((n >= 0 ? '+' : '') + n, selPoints === n, `data-act="pts" data-val="${n}"`)).join('');
  const keypad = p && p.freeEntry ? `<input type="number" id="pp-qs-num" class="pp-qs-num" placeholder="custom" value="${selPoints !== null && !(p.pointButtons || []).includes(selPoints) ? selPoints : ''}">` : '';
  const pointRow = `<div class="pp-qs-group"><div class="pp-qs-label">Points</div><div class="pp-qs-chips">${buttons}${keypad}</div></div>`;
  const reasonRow = `<div class="pp-qs-group"><div class="pp-qs-label">Reason</div><div class="pp-qs-chips">${(p ? p.reasonPresets : []).map(r => chip(esc(r), selReason === r, `data-act="reason" data-r="${esc(r)}"`)).join('')}</div>
    <input type="text" id="pp-qs-note" class="pp-qs-note" placeholder="Optional note" value="${esc(noteVal())}"></div>`;
  const ready = selTeams.length && selPoints !== null && (selReason || noteVal());
  const summary = selTeams.length && selPoints !== null
    ? `${selTeams.map(id => esc((TEAMS.find(t => t.id === id) || {}).name)).join(', ')} · ${selPoints >= 0 ? '+' : ''}${selPoints}`
    : 'Pick a team and points';
  const recent = RECENT.length ? `<div class="pp-qs-group"><div class="pp-qs-label">This session</div>
    <div class="pp-qs-recent">${RECENT.slice(0, 6).map(r => `<div>${esc(r.team)} ${r.points >= 0 ? '+' : ''}${r.points} <span class="muted">${esc(r.status)}</span></div>`).join('')}</div></div>` : '';

  const carryRow = `<div class="pp-qs-group"><div class="pp-qs-label">After each award</div>
    <select id="pp-qs-carry" class="pp-qs-carry">
      <option value="reset"${carry === 'reset' ? ' selected' : ''}>Reset all (clear team, points and reason)</option>
      <option value="points_reason"${carry === 'points_reason' ? ' selected' : ''}>Keep points and reason (clear team)</option>
      <option value="activity_reason"${carry === 'activity_reason' ? ' selected' : ''}>Keep reason only (clear team and points)</option>
    </select></div>`;
  box.innerHTML = `<p class="muted" style="margin-top:0">${esc(C.name)} · ${C.approvalMode === 'approval' ? 'scores need approval' : 'scores count immediately'}</p>
    ${successCard()}
    <div class="card pp-qs">
      ${activityRow}${catRow}${teamRow}${pointRow}${reasonRow}${carryRow}
      <div id="pp-qs-msg"></div>
      <div class="pp-qs-submit"><div class="muted">${summary}</div>
        <button class="btn" id="pp-qs-go"${ready ? '' : ' disabled'} data-act="submit">${C.approvalMode === 'approval' ? 'Send for approval' : 'Award points'}</button></div>
    </div>${recent}`;
}

// The success state after an award: shows what was recorded and offers Correct this
// score (FRD PP2.4 s6). Correcting an effective score creates an audited revision;
// correcting a pending score withdraws it for re-entry.
function successCard() {
  if (!LAST) return '';
  const eff = LAST.status !== 'pending';
  const teamLabel = LAST.teamNames.join(', ');
  const head = `${eff ? 'Awarded' : 'Sent for approval'}: ${LAST.points >= 0 ? '+' : ''}${LAST.points} to ${esc(teamLabel)}`;
  if (!correcting) {
    return `<div class="card card-accent accent-yellow"><div class="cap-head" style="align-items:center"><strong>${head}</strong>
      <button class="btn btn-secondary btn-sm" data-act="correct">Correct this score</button></div>
      <p class="muted" style="margin:.3rem 0 0">Ready for the next award below.</p></div>`;
  }
  const p = activeProfile();
  const btns = (p ? p.pointButtons : []).map(n => `<button class="pp-qs-chip${corr.points === n ? ' selected' : ''}" data-act="corr-pts" data-val="${n}">${n >= 0 ? '+' : ''}${n}</button>`).join('');
  const num = p && p.freeEntry ? `<input type="number" id="pp-corr-num" class="pp-qs-num" placeholder="points" value="${corr.points !== null && !(p.pointButtons || []).includes(corr.points) ? corr.points : ''}">` : '';
  return `<div class="card card-accent accent-yellow"><strong>Correct: ${esc(teamLabel)}</strong>
    <p class="muted" style="margin:.2rem 0 .5rem">${eff ? 'A correction goes to an approver; the original score stays in the audit trail.' : 'This withdraws the pending score so you can re-enter it.'}</p>
    ${eff ? `<div class="pp-qs-group"><div class="pp-qs-label">Corrected points</div><div class="pp-qs-chips">${btns}${num}</div></div>
      <div class="field"><label>Reason for the correction</label><input id="pp-corr-reason" value="${esc(corr.reason)}" placeholder="Why is this being corrected?"></div>` : ''}
    <div id="pp-corr-msg"></div>
    <div class="cap-actions"><button class="btn" data-act="corr-send">${eff ? 'Send correction' : 'Withdraw and re-enter'}</button>
      <button class="btn btn-secondary" data-act="corr-cancel">Cancel</button></div></div>`;
}

function noteVal() { const el = document.getElementById('pp-qs-note'); return el ? el.value : (noteVal._v || ''); }

function onClick(e) {
  const btn = e.target.closest('[data-act]');
  // capture the note field before any re-render
  const noteEl = document.getElementById('pp-qs-note'); if (noteEl) noteVal._v = noteEl.value;
  const multiEl = document.getElementById('pp-qs-multi'); if (multiEl) multi = multiEl.checked;
  const numEl = document.getElementById('pp-qs-num'); if (numEl && numEl.value.trim() !== '') selPoints = Number(numEl.value);
  const corrNum = document.getElementById('pp-corr-num'); if (corrNum && corrNum.value.trim() !== '') corr.points = Number(corrNum.value);
  const corrReason = document.getElementById('pp-corr-reason'); if (corrReason) corr.reason = corrReason.value;
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === 'correct') { correcting = true; corr = { points: LAST ? LAST.points : null, reason: '' }; render(); return; }
  if (act === 'corr-pts') { corr.points = Number(btn.dataset.val); render(); return; }
  if (act === 'corr-cancel') { correcting = false; render(); return; }
  if (act === 'corr-send') { sendCorrection(); return; }
  if (act === 'activity') {
    selActivity = btn.dataset.id === 'free' ? null : Number(btn.dataset.id);
    if (selActivity != null) { const a = ACTIVITIES.find(x => x.id === selActivity); if (a) selCat = a.categoryId; }
    selPoints = null; selReason = null; selTeams = [];
  } else if (act === 'cat') { selCat = Number(btn.dataset.id); selPoints = null; selReason = null; }
  else if (act === 'team') {
    const id = Number(btn.dataset.id);
    if (multi) selTeams = selTeams.includes(id) ? selTeams.filter(x => x !== id) : [...selTeams, id];
    else selTeams = selTeams.includes(id) ? [] : [id];
  } else if (act === 'pts') selPoints = Number(btn.dataset.val);
  else if (act === 'reason') selReason = btn.dataset.r;
  else if (act === 'submit') { submit(); return; }
  render();
}

async function submit() {
  const note = noteVal().trim();
  const comment = [selReason, note].filter(Boolean).join(' — ');
  if (!selTeams.length || selPoints === null || !comment) return;
  const p = activeProfile();
  if (!p) return;
  const lines = selTeams.map(id => ({ teamId: id, points: selPoints }));
  try {
    const r = await Api.post(`/api/patrol-points/competitions/${ID}/submissions`, { categoryId: p.categoryId, comment, lines });
    const teamNames = selTeams.map(id => (TEAMS.find(t => t.id === id) || {}).name);
    teamNames.forEach(name => RECENT.unshift({ team: name, points: selPoints, status: r.status === 'pending' ? 'pending' : 'awarded' }));
    LAST = { subId: r.id, teamIds: [...selTeams], teamNames, points: selPoints, reason: selReason, note: noteVal().trim(), categoryId: p.categoryId, status: r.status };
    correcting = false;
    applyCarry(); // team always cleared; points/reason kept per the carry preference
    render();
  } catch (e) {
    const msg = document.getElementById('pp-qs-msg');
    if (msg) msg.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`;
  }
}

// Correct the last award. Effective score -> audited revision (needs approval);
// pending score -> withdraw and prefill for re-entry (FRD PP2.4 s6 / PP24-SCR-005).
async function sendCorrection() {
  if (!LAST) { correcting = false; render(); return; }
  const numEl = document.getElementById('pp-corr-num'); if (numEl && numEl.value.trim() !== '') corr.points = Number(numEl.value);
  const rEl = document.getElementById('pp-corr-reason'); if (rEl) corr.reason = rEl.value;
  const showErr = t => { const m = document.getElementById('pp-corr-msg'); if (m) m.innerHTML = `<div class="alert alert-error">${esc(t)}</div>`; };
  try {
    if (LAST.status === 'pending') {
      await Api.post(`/api/patrol-points/competitions/${ID}/submissions/${LAST.subId}/withdraw`, {});
      selTeams = [...LAST.teamIds]; selPoints = LAST.points; selReason = LAST.reason; noteVal._v = LAST.note || '';
      LAST = null; correcting = false; render();
      const m = document.getElementById('pp-qs-msg'); if (m) m.innerHTML = '<div class="alert alert-info">Pending score withdrawn. Adjust and submit it again.</div>';
      return;
    }
    if (corr.points === null || corr.points === '') return showErr('Choose the corrected points.');
    if (!String(corr.reason).trim()) return showErr('Give a reason for the correction.');
    const lines = LAST.teamIds.map(id => ({ teamId: id, points: corr.points }));
    await Api.post(`/api/patrol-points/competitions/${ID}/submissions/${LAST.subId}/revise`, { comment: String(corr.reason).trim(), lines });
    LAST = null; correcting = false; render();
    const m = document.getElementById('pp-qs-msg'); if (m) m.innerHTML = '<div class="alert alert-success">Correction sent for approval. The original score stays until it is approved.</div>';
  } catch (e) { showErr(e.message); }
}
