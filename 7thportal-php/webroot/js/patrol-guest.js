// Patrol Points - Guest Quick Entry (FRD v2.4 s13.8). A no-login, one-screen
// scoring surface reached via a scoped Quick Entry link/QR. Shows no child data;
// every submission is pending approval. All values are re-validated server-side.
let INFO, TOKEN;
let selTeam = null, selPoints = null, selReason = null, guestName = '';
const esc = s => escapeHtml(s == null ? '' : String(s));

(async () => {
  TOKEN = new URLSearchParams(location.search).get('t');
  const box = document.getElementById('content');
  if (!TOKEN) { box.innerHTML = '<div class="alert alert-error">This link is missing its code.</div>'; return; }
  try { INFO = await Api.get(`/api/guest/patrol/${encodeURIComponent(TOKEN)}`); }
  catch (e) { box.innerHTML = `<div class="alert alert-warning">${escapeHtml(e.message)}</div>`; return; }
  guestName = localStorage.getItem('ppGuestName') || '';
  render();
  box.addEventListener('click', onClick);
})();

function render() {
  const box = document.getElementById('content');
  const chip = (label, on, attrs) => `<button class="pp-qs-chip${on ? ' selected' : ''}" ${attrs}>${label}</button>`;
  const teamRow = `<div class="pp-qs-group"><div class="pp-qs-label">Team</div><div class="pp-qs-chips">${INFO.teams.map(t => chip(esc(t.name), selTeam === t.id, `data-act="team" data-id="${t.id}"`)).join('')}</div></div>`;
  const pointRow = `<div class="pp-qs-group"><div class="pp-qs-label">Points</div><div class="pp-qs-chips">${INFO.pointButtons.map(n => chip((n >= 0 ? '+' : '') + n, selPoints === n, `data-act="pts" data-val="${n}"`)).join('')}</div></div>`;
  const reasonRow = `<div class="pp-qs-group"><div class="pp-qs-label">Reason</div><div class="pp-qs-chips">${INFO.reasonPresets.map(r => chip(esc(r), selReason === r, `data-act="reason" data-r="${esc(r)}"`)).join('')}</div>
    <input type="text" id="g-note" class="pp-qs-note" placeholder="Or type a short reason" value="${esc(reasonNote())}"></div>`;
  const pinRow = INFO.pinRequired ? `<div class="pp-qs-group"><div class="pp-qs-label">Access PIN</div><input id="g-pin" inputmode="numeric" class="pp-qs-num" placeholder="PIN"></div>` : '';
  const ready = selTeam && selPoints !== null && (selReason || reasonNote());
  box.innerHTML = `<h1 style="margin:.2rem 0">${esc(INFO.activity)}</h1>
    <p class="muted">${esc(INFO.competition)}</p>
    <div class="alert alert-warning">This secure link lets an authorised helper submit points. No young-person names or personal data are shown, and <strong>every submission needs approval</strong> before it counts.</div>
    <div class="card pp-qs">
      <div class="pp-qs-group"><div class="pp-qs-label">Your name</div><input id="g-name" class="pp-qs-note" placeholder="Your name (shown to approvers)" value="${esc(guestName)}"></div>
      ${pinRow}${teamRow}${pointRow}${reasonRow}
      <div id="g-msg"></div>
      <div class="pp-qs-submit"><div class="muted">${selTeam && selPoints !== null ? esc((INFO.teams.find(t => t.id === selTeam) || {}).name) + ' · ' + (selPoints >= 0 ? '+' : '') + selPoints : 'Pick a team and points'}</div>
        <button class="btn" id="g-go"${ready ? '' : ' disabled'} data-act="submit">Send for approval</button></div>
    </div>`;
}

function reasonNote() { const el = document.getElementById('g-note'); return el ? el.value : (reasonNote._v || ''); }

function onClick(e) {
  const btn = e.target.closest('[data-act]');
  const noteEl = document.getElementById('g-note'); if (noteEl) reasonNote._v = noteEl.value;
  const nameEl = document.getElementById('g-name'); if (nameEl) guestName = nameEl.value;
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === 'team') selTeam = selTeam === Number(btn.dataset.id) ? null : Number(btn.dataset.id);
  else if (act === 'pts') selPoints = Number(btn.dataset.val);
  else if (act === 'reason') selReason = btn.dataset.r;
  else if (act === 'submit') { submit(); return; }
  render();
}

async function submit() {
  const name = ((document.getElementById('g-name') || {}).value ?? guestName).trim();
  const note = reasonNote().trim();
  const reason = selReason || note;
  const pin = INFO.pinRequired ? (document.getElementById('g-pin').value || '').trim() : undefined;
  const msg = document.getElementById('g-msg');
  if (!name) { msg.innerHTML = '<div class="alert alert-error">Please enter your name.</div>'; return; }
  if (!selTeam || selPoints === null || !reason) { msg.innerHTML = '<div class="alert alert-error">Pick a team, points and a reason.</div>'; return; }
  localStorage.setItem('ppGuestName', name);
  try {
    await Api.post(`/api/guest/patrol/${encodeURIComponent(TOKEN)}/submit`, { scorerName: name, teamId: selTeam, points: selPoints, reason, pin });
    // Reset for the next award; keep the scorer name.
    selTeam = null; selPoints = null; selReason = null; reasonNote._v = '';
    render();
    document.getElementById('g-msg').innerHTML = '<div class="alert alert-success">Submitted for approval. It will count once a leader approves it. Enter another below.</div>';
  } catch (e) {
    document.getElementById('g-msg').innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`;
  }
}
