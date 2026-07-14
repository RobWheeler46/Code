(async () => {
  const me = await requireUserNav();
  if (!me) return;
  const params = new URLSearchParams(location.search);
  const sectionId = params.get('section');
  const memberId = params.get('id');
  document.getElementById('back-link').innerHTML = `<a href="section.html?id=${encodeURIComponent(sectionId)}">&larr; Back to section</a>`;
  const content = document.getElementById('content');
  if (!sectionId || !memberId) { content.innerHTML = '<div class="alert alert-error">No member specified.</div>'; return; }

  try {
    const m = await Api.get(`/api/sections/${encodeURIComponent(sectionId)}/members/${encodeURIComponent(memberId)}`);
    if (m.osmUnavailable) { content.innerHTML = osmUnavailableAlert(m.reason); return; }

    content.innerHTML = `
      <div class="child-card" style="margin-bottom:1.25rem;">
        <div class="child-avatar" style="width:56px;height:56px;font-size:1.2rem;">${escapeHtml(initials(m.firstName + ' ' + m.lastName))}</div>
        <div>
          <h1 style="margin-bottom:0.15rem;">${escapeHtml(m.firstName)} ${escapeHtml(m.lastName)}</h1>
          <span class="muted">${m.patrol ? escapeHtml(m.patrol) : ''}${m.dob ? ' &middot; DOB ' + formatDate(m.dob) : ''}</span>
        </div>
      </div>
      <div class="card">
        <h2>Badge progress</h2>
        ${m.badgesAvailable ? renderBadges(m.badges) : '<p class="muted">Badge information is not available right now.</p>'}
        <div class="osm-link-row">This is a read-only summary limited by your permissions. <a href="https://www.onlinescoutmanager.co.uk/" target="_blank" rel="noopener">Open full record in OSM &rarr;</a></div>
      </div>
    `;
  } catch (err) {
    content.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  }
})();

function renderBadges(badges) {
  if (!badges || badges.length === 0) return '<p class="muted">No badge activity recorded yet.</p>';
  return badges.map(b => `<span class="badge" data-completed="${b.completed}" style="margin:0.2rem 0.3rem 0.2rem 0;">${escapeHtml(b.badgeName)}${b.type ? ' &middot; ' + escapeHtml(b.type) : ''}</span>`).join(' ');
}
