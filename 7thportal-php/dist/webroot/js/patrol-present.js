// Patrol Points presentation leaderboard (FRD PP2.4 s9): a full-screen, privacy-safe
// display for a projector or TV. Shows only Position, Team and Total (viewer-safe fields)
// and follows effective scores only. Controlled from this device: pause/resume the live
// refresh, hide the latest award, refresh now, switch theme, scale, and exit.
const ID = new URLSearchParams(location.search).get('id');
let paused = false, showLatest = true, scale = 1, timer = null, data = null;
const REFRESH_MS = 8000;

(async () => {
  document.body.classList.add('pp-present');
  try { await Api.get('/api/me'); } catch (e) { location.href = 'login.html'; return; }
  if (!ID) { document.getElementById('present').innerHTML = '<p class="pp-pr-empty">No competition specified.</p>'; return; }
  await tick();
  schedule();
  document.getElementById('present').addEventListener('click', onClick);
})();

function schedule() {
  if (timer) clearTimeout(timer);
  if (!paused) timer = setTimeout(async () => { await tick(); schedule(); }, REFRESH_MS);
}

async function tick() {
  try { data = await Api.get(`/api/patrol-points/competitions/${ID}/presentation`); }
  catch (e) { document.getElementById('present').innerHTML = `<div class="pp-pr"><p class="pp-pr-empty">${escapeHtml(e.message)}</p></div>`; return; }
  render();
}

function render() {
  if (!data) return;
  const board = data.leaderboard || [];
  const rows = board.length
    ? board.map(r => `<div class="pp-pr-row${r.position === 1 ? ' lead' : ''}">
        <div class="pp-pr-pos">${r.position}</div>
        <div class="pp-pr-team">${escapeHtml(r.teamName)}</div>
        <div class="pp-pr-total">${r.total}</div></div>`).join('')
    : '<div class="pp-pr-empty">No effective scores yet.</div>';
  const latest = (showLatest && data.latestAward)
    ? `<div class="pp-pr-latest">Latest award: <span class="t">${escapeHtml(data.latestAward.teamName)}</span> ${data.latestAward.points >= 0 ? '+' : ''}${data.latestAward.points}</div>`
    : '';
  document.getElementById('present').innerHTML = `
    <div class="pp-pr" style="font-size:${scale}em">
      <div class="pp-pr-head">
        <h1 class="pp-pr-title">${escapeHtml(data.name)}</h1>
        ${data.final ? '<span class="pp-pr-final">Final result</span>' : ''}
      </div>
      ${latest}
      <div class="pp-pr-board">${rows}</div>
    </div>
    <div class="pp-pr-ctrl">
      <button data-pact="pause">${paused ? 'Resume live' : 'Pause live'}</button>
      <button data-pact="latest">${showLatest ? 'Hide latest award' : 'Show latest award'}</button>
      <button data-pact="refresh">Refresh now</button>
      <button data-pact="theme">Switch theme</button>
      <button data-pact="bigger">Bigger</button>
      <button data-pact="smaller">Smaller</button>
      <button data-pact="exit">Exit</button>
    </div>`;
}

async function onClick(e) {
  const b = e.target.closest('[data-pact]');
  if (!b) return;
  const act = b.dataset.pact;
  if (act === 'pause') { paused = !paused; render(); schedule(); }
  else if (act === 'latest') { showLatest = !showLatest; render(); }
  else if (act === 'refresh') { await tick(); }
  else if (act === 'theme') { const cur = document.documentElement.getAttribute('data-theme'); document.documentElement.setAttribute('data-theme', cur === 'dark' ? 'light' : 'dark'); }
  else if (act === 'bigger') { scale = Math.min(2, Math.round((scale + 0.1) * 10) / 10); render(); }
  else if (act === 'smaller') { scale = Math.max(0.6, Math.round((scale - 0.1) * 10) / 10); render(); }
  else if (act === 'exit') { location.href = `patrol-point.html?id=${encodeURIComponent(ID)}`; }
}
