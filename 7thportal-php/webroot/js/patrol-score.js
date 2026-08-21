// Patrol Points - Quick Score: a one-screen tap-to-score workspace (FRD v2.4 s13.7).
// Choose team -> tap points -> tap a reason -> submit; the screen stays put and is
// immediately ready for the next award. Reuses the standard submission pipeline.
let C, TEAMS, CATS, ACTIVITIES, ACT, ID;
let selCat = null, selActivity = null, selTeams = [], selPoints = null, selReason = null, multi = false;
const RECENT = [];
const esc = s => escapeHtml(s == null ? '' : String(s));

(async () => {
  const me = await requireUserNav();
  if (!me) return;
  ID = new URLSearchParams(location.search).get('id');
  if (!ID) { document.getElementById('content').innerHTML = '<div class="alert alert-error">No competition specified.</div>'; return; }
  let d;
  try { d = await Api.get(`/api/patrol-points/competitions/${ID}`); }
  catch (e) { document.getElementById('content').innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; return; }
  C = d.competition; TEAMS = d.teams; CATS = d.categories; ACTIVITIES = d.activities || []; ACT = d.myActions;
  selCat = CATS.length ? CATS[0].id : null;
  const aParam = new URLSearchParams(location.search).get('activity');
  if (aParam) { const a = ACTIVITIES.find(x => x.id === Number(aParam)); if (a) { selActivity = a.id; selCat = a.categoryId; } }
  render();
  document.getElementById('content').addEventListener('click', onClick);
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
  const back = `<a class="btn btn-secondary" href="patrol-point.html?id=${ID}">Back to competition</a>`;
  if (!ACT.canSubmit) {
    box.innerHTML = `<div class="cap-head"><h1 style="margin:0">${esc(C.name)}</h1>${back}</div>
      <div class="alert alert-warning" style="margin-top:1rem">Quick Score is available once the competition is open and has teams and a scoring category.</div>`;
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

  box.innerHTML = `<div class="cap-head"><h1 style="margin:0">Quick Score</h1>${back}</div>
    <p class="muted">${esc(C.name)} · ${C.approvalMode === 'approval' ? 'scores need approval' : 'scores count immediately'}</p>
    <div class="card pp-qs">
      ${activityRow}${catRow}${teamRow}${pointRow}${reasonRow}
      <div id="pp-qs-msg"></div>
      <div class="pp-qs-submit"><div class="muted">${summary}</div>
        <button class="btn" id="pp-qs-go"${ready ? '' : ' disabled'} data-act="submit">${C.approvalMode === 'approval' ? 'Send for approval' : 'Award points'}</button></div>
    </div>${recent}`;
}

function noteVal() { const el = document.getElementById('pp-qs-note'); return el ? el.value : (noteVal._v || ''); }

function onClick(e) {
  const btn = e.target.closest('[data-act]');
  // capture the note field before any re-render
  const noteEl = document.getElementById('pp-qs-note'); if (noteEl) noteVal._v = noteEl.value;
  const multiEl = document.getElementById('pp-qs-multi'); if (multiEl) multi = multiEl.checked;
  const numEl = document.getElementById('pp-qs-num'); if (numEl && numEl.value.trim() !== '') selPoints = Number(numEl.value);
  if (!btn) return;
  const act = btn.dataset.act;
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
    selTeams.forEach(id => RECENT.unshift({ team: (TEAMS.find(t => t.id === id) || {}).name, points: selPoints, status: r.status === 'pending' ? 'pending' : 'awarded' }));
    selPoints = null; selReason = null; noteVal._v = '';
    render();
    const msg = document.getElementById('pp-qs-msg');
    if (msg) msg.innerHTML = `<div class="alert alert-success">${r.status === 'pending' ? 'Submitted for approval.' : 'Points awarded.'} Ready for the next.</div>`;
  } catch (e) {
    const msg = document.getElementById('pp-qs-msg');
    if (msg) msg.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`;
  }
}
