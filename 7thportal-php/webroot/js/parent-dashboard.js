// Task-led parent landing (v1.1 usability): a greeting, anything that needs the
// parent (reused from the Action Centre aggregation), then their children and
// notices. Inline styles + existing classes only - no style.css change.
const PRIORITY_BADGE = { High: 'deleted', Medium: 'suspended', Low: 'draft' };

(async () => {
  const me = await requireUserNav('parent');
  if (!me) return;
  // A user with no parent capability (a leader with no linked children) has no
  // parent dashboard - send them to the leader view.
  if (!(me.capabilities && me.capabilities.parent)) {
    location.href = 'leader-dashboard.html';
    return;
  }

  const content = document.getElementById('content');
  const noticesBox = document.getElementById('notices');

  const [data, actions] = await Promise.all([
    Api.get('/api/parent/dashboard').catch(e => ({ _error: e.message })),
    Api.get('/api/actions').catch(() => ({ items: [], summary: { total: 0 } })),
  ]);
  const items = (actions && actions.items) || [];

  if (data._error) {
    content.innerHTML = topBlock(me, items, 0) + `<div class="alert alert-error">${escapeHtml(data._error)}</div>`;
    noticesBox.innerHTML = '<p class="muted">Notices are unavailable right now.</p>';
    return;
  }
  if (data.osmUnavailable) {
    content.innerHTML = topBlock(me, items, (data.children || []).length) + osmUnavailableAlert(data.reason) + childrenBlock(data.children, false);
    noticesBox.innerHTML = '<p class="muted">Notices are unavailable right now.</p>';
    return;
  }
  if (data.noLinkedChildren) {
    content.innerHTML = topBlock(me, items, 0) + `<div class="empty-state">No linked children were found for your account yet.<br>Ask your section leader or a Portal Administrator to link your child's OSM record to your 7thPortal account.</div>`;
    noticesBox.innerHTML = renderNotices(data.notices);
    return;
  }
  content.innerHTML = topBlock(me, items, data.children.length) + childrenBlock(data.children, true);
  noticesBox.innerHTML = renderNotices(data.notices);
})();

// Greeting + (only when there is something to do) a "Needs you now" block. For a
// parent the children are the primary content, so an empty task list is folded
// into the greeting line rather than shown as a big empty state.
function topBlock(me, items, childCount) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const name = me.firstName || 'there';
  const sub = items.length
    ? `You have <strong>${items.length}</strong> thing${items.length === 1 ? '' : 's'} to look at.`
    : (childCount ? 'Nothing needs you right now &mdash; here&rsquo;s your family.' : '');

  let needs = '';
  if (items.length) {
    const top = items.slice(0, 5);
    const cards = top.map(actionCard).join('');
    needs = `
      <h2 style="margin:0 0 .75rem;">Needs you now</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1rem;">${cards}</div>
      ${items.length > top.length ? `<p style="margin:.7rem 0 0;"><a href="action-centre.html">View all ${items.length} in the Action Centre &rsaquo;</a></p>` : ''}
      <h2 style="margin:1.5rem 0 .75rem;">Your children</h2>`;
  } else {
    needs = childCount ? `<h2 style="margin:1.25rem 0 .75rem;">Your children</h2>` : '';
  }

  return `
    <div class="card card-accent" style="margin-bottom:1.25rem;">
      <h1 style="margin:0;">${greeting}, ${escapeHtml(name)}</h1>
      ${sub ? `<p class="muted" style="margin:.25rem 0 0;">${sub}</p>` : ''}
    </div>
    ${needs}`;
}

function actionCard(i) {
  return `
    <a class="card clickable" href="${escapeHtml(i.link)}" style="margin:0;display:flex;flex-direction:column;gap:.35rem;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.6rem;">
        <div>
          <div class="muted" style="font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;font-weight:700;">${escapeHtml(i.type)}</div>
          <strong>${escapeHtml(i.action)}</strong>
        </div>
        <span class="badge" data-status="${PRIORITY_BADGE[i.priority] || 'draft'}">${escapeHtml(i.priority)}</span>
      </div>
      <div class="muted" style="font-size:.9rem;">${i.due ? 'Due ' + formatDate(i.due) : escapeHtml(i.status)}</div>
    </a>`;
}

function childrenBlock(children, clickable) {
  if (!children || children.length === 0) return '<p class="muted">No children found.</p>';
  return `<div class="grid cols-2">` + children.map(c => {
    const inner = `
      <div class="child-card">
        <div class="child-avatar">${escapeHtml(initials(c.name))}</div>
        <div>
          <strong>${escapeHtml(c.name)}</strong><br>
          <span class="muted">${escapeHtml(c.status || c.sectionName || '')}</span>
          ${c.sectionMemberCount !== undefined && c.sectionMemberCount !== null ? `<br><span class="muted">${c.sectionMemberCount} in section${c.sectionMemberCountSyncedAt ? ` &middot; OSM ${formatDate(c.sectionMemberCountSyncedAt)}` : ''}</span>` : ''}
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
