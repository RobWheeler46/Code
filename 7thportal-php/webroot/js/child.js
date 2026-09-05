(async () => {
  const me = await requireUserNav();
  if (!me) return;
  const linkId = new URLSearchParams(location.search).get('id');
  const content = document.getElementById('content');
  if (!linkId) { content.innerHTML = '<div class="alert alert-error">No child specified.</div>'; return; }

  try {
    const c = await Api.get(`/api/children/${linkId}`);

    // Canonical header: My Children live under the parent Today home.
    renderPageHeader({
      crumbs: [{ label: 'Today', href: 'parent-dashboard.html' }, { label: c.name }],
      title: c.name,
      context: [c.sectionName, c.dob ? 'DOB ' + formatDate(c.dob) : '', c.patrol].filter(Boolean).join(' · ') || undefined,
    });

    if (c.osmUnavailable) {
      content.innerHTML = osmUnavailableAlert(c.reason);
      return;
    }

    const header = `
      <div class="child-card" style="margin-bottom:1.25rem;">
        <div class="child-avatar" style="width:64px;height:64px;font-size:1.4rem;">${escapeHtml(initials(c.name))}</div>
        <div>
          <div style="font-weight:700;font-size:1.1rem;margin-bottom:0.15rem;">${escapeHtml(c.name)}</div>
          <span class="muted">${escapeHtml(c.sectionName || '')}${c.dob ? ' &middot; DOB ' + formatDate(c.dob) : ''}${c.patrol ? ' &middot; ' + escapeHtml(c.patrol) : ''}</span>
        </div>
      </div>`;

    // Live: programme, badges and the full profile are managed in OSM (the portal
    // does not read them from the server). Show a clean link-out rather than empty
    // "not available" cards.
    if (c.detailInOsm) {
      content.innerHTML = header + `
        <div class="card">
          <h2>Programme, events &amp; badges</h2>
          <p class="muted">${escapeHtml(c.name)}'s programme, upcoming events and badge progress are kept in OSM, along with contact details and payments.</p>
          <a class="btn" href="${c.osmLink}" target="_blank" rel="noopener">Open in OSM &rarr;</a>
        </div>`;
      return;
    }

    content.innerHTML = header + `
      <div class="grid cols-2">
        <div class="card">
          <h2>Upcoming programme</h2>
          ${c.programmeAvailable ? renderProgramme(c.programme) : '<p class="muted">No programme information right now.</p>'}
        </div>
        <div class="card">
          <h2>Upcoming events</h2>
          ${c.eventsAvailable ? renderEvents(c.events) : '<p class="muted">No event information right now.</p>'}
        </div>
      </div>

      <div class="card">
        <h2>Badge progress</h2>
        ${c.badgesAvailable ? renderBadges(c.badges) : '<p class="muted">No badge information right now.</p>'}
        <div class="osm-link-row">This is a read-only summary. <a href="${c.osmLink}" target="_blank" rel="noopener">Manage badges, contact details, events and payments in OSM &rarr;</a></div>
      </div>
    `;
  } catch (err) {
    content.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  }
})();

function renderProgramme(items) {
  if (!items || items.length === 0) return '<p class="muted">No upcoming programme items.</p>';
  return `<table><tbody>${items.map(p => `<tr><td>${formatDate(p.date)}</td><td>${escapeHtml(p.title)}${p.notes ? '<br><span class="muted">' + escapeHtml(p.notes) + '</span>' : ''}</td></tr>`).join('')}</tbody></table>`;
}
function renderEvents(items) {
  if (!items || items.length === 0) return '<p class="muted">No upcoming events.</p>';
  return `<table><tbody>${items.map(e => `<tr><td>${formatDate(e.date)}</td><td>${escapeHtml(e.name)}${e.location ? '<br><span class="muted">' + escapeHtml(e.location) + '</span>' : ''}</td></tr>`).join('')}</tbody></table>`;
}
function renderBadges(badges) {
  if (!badges || badges.length === 0) return '<p class="muted">No badge activity recorded yet.</p>';
  const completed = badges.filter(b => b.completed);
  const inProgress = badges.filter(b => !b.completed);
  return `
    ${completed.length ? `<h3>Completed</h3>` + badgeList(completed) : ''}
    ${inProgress.length ? `<h3>In progress</h3>` + badgeList(inProgress) : ''}
  `;
}
function badgeList(badges) {
  return badges.map(b => `<span class="badge" data-completed="${b.completed}" style="margin:0.2rem 0.3rem 0.2rem 0;">${escapeHtml(b.badgeName)}${b.type ? ' &middot; ' + escapeHtml(b.type) : ''}</span>`).join(' ');
}
