(async () => {
  const me = await requireUserNav();
  if (!me) return;
  if (me.role === 'parent') {
    location.href = 'parent-dashboard.html';
    return;
  }

  const content = document.getElementById('content');
  const noticesBox = document.getElementById('notices');
  try {
    const data = await Api.get('/api/leader/dashboard');

    if (data.osmUnavailable) {
      content.innerHTML = osmUnavailableAlert(data.reason) + renderSections(data.sections, false);
      noticesBox.innerHTML = '<p class="muted">Notices are unavailable right now.</p>';
      return;
    }

    if (data.sections.length === 0) {
      content.innerHTML = `<div class="empty-state">No sections are linked to your account yet. If you lead a section in OSM, this should update automatically next time you log in - otherwise contact a Portal Administrator.</div>`;
    } else {
      content.innerHTML = renderSections(data.sections, true);
    }
    noticesBox.innerHTML = renderNotices(data.notices);
  } catch (err) {
    content.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  }
})();

function renderSections(sections, clickable) {
  if (sections.length === 0) return '';
  return `<div class="grid cols-2">` + sections.map(s => {
    const inner = `
      <h2>${escapeHtml(s.sectionName)}</h2>
      ${s.meetingDay ? `<p class="muted">${escapeHtml(s.meetingDay)} ${escapeHtml(s.meetingTime || '')} &middot; ${escapeHtml(s.location || '')}</p>` : ''}
      ${s.memberCount !== undefined && s.memberCount !== null ? `<p>${s.memberCount} member${s.memberCount === 1 ? '' : 's'}</p>` : ''}
      ${s.nextProgrammeItem ? `<p class="muted">Next meeting: ${formatDate(s.nextProgrammeItem.date)} - ${escapeHtml(s.nextProgrammeItem.title)}</p>` : ''}
      ${s.nextEvent ? `<p class="muted">Next event: ${formatDate(s.nextEvent.date)} - ${escapeHtml(s.nextEvent.name)}</p>` : ''}
    `;
    return clickable
      ? `<a class="card clickable" href="section.html?id=${encodeURIComponent(s.sectionId)}">${inner}</a>`
      : `<div class="card">${inner}</div>`;
  }).join('') + `</div>`;
}

function renderNotices(notices) {
  if (!notices || notices.length === 0) return '<p class="muted">No current notices.</p>';
  return notices.map(n => `
    <div class="card notice-card">
      <div class="date">${formatDate(n.startDate)}${n.endDate ? ' - ' + formatDate(n.endDate) : ''}${n.sectionName ? ' &middot; ' + escapeHtml(n.sectionName) : ''}</div>
      <strong>${escapeHtml(n.title)}</strong>
      <p style="margin:0.4rem 0 0;">${escapeHtml(n.body)}</p>
    </div>
  `).join('');
}
