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
      </div>`;
  } catch (err) {
    content.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  }
})();
