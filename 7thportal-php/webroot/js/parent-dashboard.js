(async () => {
  const me = await requireUserNav();
  if (!me) return;
  if (me.role !== 'parent') {
    location.href = 'leader-dashboard.html';
    return;
  }

  const content = document.getElementById('content');
  const noticesBox = document.getElementById('notices');
  try {
    const data = await Api.get('/api/parent/dashboard');

    if (data.osmUnavailable) {
      content.innerHTML = osmUnavailableAlert(data.reason) + renderChildCards(data.children, false);
      noticesBox.innerHTML = '<p class="muted">Notices are unavailable right now.</p>';
      return;
    }

    if (data.noLinkedChildren) {
      content.innerHTML = `<div class="empty-state">No linked children were found for your account yet.<br>Ask your section leader or a Portal Administrator to link your child's OSM record to your 7thPortal account.</div>`;
      noticesBox.innerHTML = renderNotices(data.notices);
      return;
    }

    content.innerHTML = renderChildCards(data.children, true);
    noticesBox.innerHTML = renderNotices(data.notices);
  } catch (err) {
    content.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  }
})();

function renderChildCards(children, clickable) {
  if (children.length === 0) return '<p class="muted">No children found.</p>';
  return `<div class="grid cols-2">` + children.map(c => {
    const inner = `
      <div class="child-card">
        <div class="child-avatar">${escapeHtml(initials(c.name))}</div>
        <div>
          <strong>${escapeHtml(c.name)}</strong><br>
          <span class="muted">${escapeHtml(c.status || c.sectionName || '')}</span>
        </div>
      </div>`;
    return clickable
      ? `<a class="card clickable" href="child.html?id=${c.linkId}">${inner}</a>`
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
