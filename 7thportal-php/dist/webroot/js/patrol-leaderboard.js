// Patrol Points - parent-safe leaderboards. Standings only (position/team/total);
// no reasons, comments, submitters or young-person names are ever loaded here.
const PP_SKEY = { open: 'active', paused: 'pending_approval', completed: 'active' };

(async () => {
  const me = await requireUserNav();
  if (!me) return;
  const box = document.getElementById('content');
  let data;
  try { data = await Api.get('/api/patrol-points/parent/leaderboards'); }
  catch (e) { box.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; return; }
  if (!data.competitions.length) {
    box.innerHTML = '<div class="card"><p class="muted">No competitions are being shared with parents right now. Check back during a camp or competition.</p></div>';
    return;
  }
  box.innerHTML = data.competitions.map(c => {
    const rows = c.leaderboard.length ? c.leaderboard.map(r => `<tr>
        <td data-label="Position"><strong>${r.position}</strong></td>
        <td data-label="Team" class="rcard-title">${escapeHtml(r.teamName)}</td>
        <td data-label="Total"><strong>${r.total}</strong></td>
      </tr>`).join('') : '<tr><td colspan="3" class="muted">No scores yet.</td></tr>';
    return `<div class="card card-accent accent-yellow">
      <div class="cap-head"><h2 style="margin:0">${escapeHtml(c.name)}</h2>
        <span class="badge" data-status="${PP_SKEY[c.status] || 'active'}">${escapeHtml(c.statusLabel)}</span></div>
      ${c.sectionName ? `<p class="muted">${escapeHtml(c.sectionName)}</p>` : ''}
      <table class="data-table rcards"><thead><tr><th>Position</th><th>Team</th><th>Total points</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
  }).join('');
})();
