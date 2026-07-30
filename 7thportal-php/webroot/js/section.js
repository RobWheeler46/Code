(async () => {
  const me = await requireUserNav();
  if (!me) return;
  const sectionId = new URLSearchParams(location.search).get('id');
  const content = document.getElementById('content');
  if (!sectionId) { content.innerHTML = '<div class="alert alert-error">No section specified.</div>'; return; }

  try {
    const data = await Api.get(`/api/sections/${encodeURIComponent(sectionId)}/members`);
    const osmUrl = data.osmUrl || 'https://www.onlinescoutmanager.co.uk/';
    content.innerHTML = `
      <div class="card">
        <p class="muted">The live section roster, attendance and badges are held in OSM. 7thPortal shows the children linked to this section here, and links to OSM for the rest.</p>
        <a class="btn btn-secondary" href="${escapeHtml(osmUrl)}" target="_blank" rel="noopener">Open this section in OSM &rarr;</a>
      </div>
      <div class="card">
        <h2>Linked children (${data.members.length})</h2>
        ${data.members.length ? `<table class="data-table">
          <thead><tr><th>Child</th></tr></thead>
          <tbody>${data.members.map(m => `<tr><td>${escapeHtml(m.name || 'Child')}</td></tr>`).join('')}</tbody>
        </table>` : '<p class="muted">No children are linked to this section in the portal yet. An admin can link them under Admin &rarr; Parent accounts.</p>'}
      </div>
      <div class="card">
        <h2>Section members (live from OSM)</h2>
        <p class="muted">Fetches the current member list for this section straight from OSM. Nothing is stored in the portal - it is shown to you now and not kept.</p>
        <button class="btn" id="roster-btn">View members from OSM</button>
        <div id="roster-box" style="margin-top:0.8rem"></div>
      </div>`;

    document.getElementById('roster-btn').addEventListener('click', () => loadRoster(sectionId));
  } catch (err) {
    content.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  }
})();

async function loadRoster(sectionId) {
  const btn = document.getElementById('roster-btn');
  const box = document.getElementById('roster-box');
  btn.disabled = true; btn.textContent = 'Fetching from OSM…';
  box.innerHTML = '';
  try {
    const data = await Api.get(`/api/sections/${encodeURIComponent(sectionId)}/roster`);
    const when = data.fetchedAt ? new Date(data.fetchedAt) : new Date();
    box.innerHTML = `
      <p class="muted">${data.count} member${data.count === 1 ? '' : 's'} &middot; fetched ${when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}${data.source === 'demo' ? ' (demo data)' : ' from OSM'} &middot; not stored</p>
      ${data.members.length ? `<table class="data-table">
        <thead><tr><th>Name</th><th>Patrol / Six</th></tr></thead>
        <tbody>${data.members.map(m => `<tr><td>${escapeHtml(m.name)}</td><td class="muted">${escapeHtml(m.patrol || '—')}</td></tr>`).join('')}</tbody>
      </table>` : '<p class="muted">OSM returned no members for the current term.</p>'}`;
  } catch (err) {
    const hint = err.status === 502 ? ' You can retry in a moment.' : '';
    box.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}${hint}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = 'Refresh from OSM';
  }
}
