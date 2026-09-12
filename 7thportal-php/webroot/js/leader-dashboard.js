// Task-led "Today" landing (v1.1 usability): lead with a greeting + the few things
// that need the leader now (reusing the Action Centre aggregation), then their
// sections and notices. Styled with existing classes + inline rules only - no
// style.css changes.
const PRIORITY_BADGE = { High: 'deleted', Medium: 'suspended', Low: 'draft' };

(async () => {
  const me = await requireUserNav('leader');
  if (!me) return;
  // No leader capability -> this is a parent-only account; send them to their view.
  if (!(me.capabilities && me.capabilities.leader)) {
    location.href = 'parent-dashboard.html';
    return;
  }

  const content = document.getElementById('content');
  const noticesBox = document.getElementById('notices');

  // Dashboard + actions + tonight prep in parallel; a failed side fetch must not
  // break the page. Prepare Tonight is no longer its own destination (v3.0 §1.2 /
  // gap G50) - its readiness summary rides here as the "Tonight" card.
  const [data, actions, tonight] = await Promise.all([
    Api.get('/api/leader/dashboard').catch(e => ({ _error: e.message })),
    Api.get('/api/actions').catch(() => ({ items: [], summary: { total: 0, high: 0, dueThisWeek: 0 } })),
    Api.get('/api/leader/prepare-tonight').catch(() => null),
  ]);

  // Canonical page header (Today is a root destination - no breadcrumb). The greeting
  // is the single H1; the action summary is the lede and the role is the context chip.
  renderTodayHeader(me, actions);

  const today = renderToday(me, actions) + tonightCard(tonight) + '<h2 style="margin:1.5rem 0 .75rem;">Your sections</h2>';

  if (data._error) {
    content.innerHTML = today + `<div class="alert alert-error">${escapeHtml(data._error)}</div>` + insightsCard();
    noticesBox.innerHTML = '<p class="muted">Notices are unavailable right now.</p>';
    return;
  }
  if (data.osmUnavailable) {
    content.innerHTML = today + osmUnavailableAlert(data.reason) + sectionsBlock(data.sections, false) + insightsCard();
    noticesBox.innerHTML = '<p class="muted">Notices are unavailable right now.</p>';
    return;
  }
  content.innerHTML = today + sectionsBlock(data.sections, true) + insightsCard();
  noticesBox.innerHTML = renderNotices(data.notices);
})();

function greetingFor(me) {
  const hour = new Date().getHours();
  const g = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return `${g}, ${me.firstName || 'there'}`;
}

function renderTodayHeader(me, actions) {
  const summary = (actions && actions.summary) || { total: ((actions && actions.items) || []).length, high: 0, dueThisWeek: 0 };
  const ctx = summary.total === 0
    ? 'You&rsquo;re all caught up &mdash; nothing needs you right now.'
    : `You have <strong>${summary.total}</strong> thing${summary.total === 1 ? '' : 's'} to look at${summary.high ? `, <strong>${summary.high}</strong> high priority` : ''}${summary.dueThisWeek ? ` &middot; ${summary.dueThisWeek} due this week` : ''}.`;
  renderPageHeader({
    title: greetingFor(me),
    context: me.roleLabel ? `${me.roleLabel} view` : undefined,
    description: ctx,
  });
}

// Compact "Next section meeting / Tonight" card (v3.0): the meeting-readiness summary
// that used to be the Prepare Tonight page, now a Today card that deep-links to the
// authoritative source modules (attendance, activity forms, equipment).
function tonightCard(t) {
  if (!t) return '';
  const on = (t.sections || []).filter(s => s.meetsToday);
  const next = (t.sections || []).find(s => !s.meetsToday && s.nextMeetingLabel);
  let lead;
  if (on.length) {
    const names = on.map(s => escapeHtml(s.sectionName)).join(', ');
    const times = on.map(s => s.meetingTime ? `${escapeHtml(s.sectionName)} at ${escapeHtml(s.meetingTime)}` : '').filter(Boolean).join(' &middot; ');
    lead = `<strong>Tonight: ${names}</strong>${times ? ` <span class="muted">${times}</span>` : ''}`;
  } else if (next) {
    lead = `<strong>No section meets tonight.</strong> <span class="muted">Next: ${escapeHtml(next.sectionName)} ${escapeHtml(next.nextMeetingLabel)}</span>`;
  } else {
    lead = `<strong>No section meets tonight.</strong> <span class="muted">Here&rsquo;s what&rsquo;s coming up.</span>`;
  }
  const chip = (label, n, href) => n ? `<a class="btn btn-secondary btn-sm" href="${href}">${escapeHtml(label)} <span class="badge" data-status="suspended" style="margin-left:.3rem">${n}</span></a>` : '';
  const whatsOn = (t.whatsOn || []).length;
  const chips = [
    whatsOn ? `<a class="btn btn-secondary btn-sm" href="calendar.html">On today <span class="badge" data-status="draft" style="margin-left:.3rem">${whatsOn}</span></a>` : '',
    chip('Forms to sort', (t.forms || []).length, 'activity-forms.html'),
    chip('Equipment', (t.equipment || []).length, 'quartermaster.html'),
    (t.attendance && t.attendance.link) ? `<a class="btn btn-secondary btn-sm" href="${escapeHtml(t.attendance.link)}">Attendance</a>` : '',
  ].filter(Boolean).join('');
  return `
    <div class="card card-accent" style="margin-bottom:1.25rem;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:.5rem;flex-wrap:wrap;">
        <h2 style="margin:0;">Next section meeting</h2>
      </div>
      <p style="margin:.35rem 0 ${chips ? '.7rem' : '0'};">${lead}</p>
      ${chips ? `<div class="cap-actions">${chips}</div>` : ''}
    </div>`;
}

function renderToday(me, actions) {
  const items = (actions && actions.items) || [];
  const summary = (actions && actions.summary) || { total: items.length, high: 0, dueThisWeek: 0 };

  const top = items.slice(0, 5);
  const cards = top.map(i => `
    <a class="card clickable" href="${escapeHtml(i.link)}" style="margin:0;display:flex;flex-direction:column;gap:.35rem;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.6rem;">
        <div>
          <div class="muted" style="font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;font-weight:700;">${escapeHtml(i.type)}</div>
          <strong>${escapeHtml(i.action)}</strong>
        </div>
        <span class="badge" data-status="${PRIORITY_BADGE[i.priority] || 'draft'}">${escapeHtml(i.priority)}</span>
      </div>
      <div class="muted" style="font-size:.9rem;">${i.owner && i.owner !== 'You' ? escapeHtml(i.owner) + ' &middot; ' : ''}${i.due ? 'Due ' + formatDate(i.due) : escapeHtml(i.status)}</div>
    </a>`).join('');

  const needsYou = items.length
    ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1rem;">${cards}</div>
       ${summary.total > top.length ? `<p style="margin:.7rem 0 0;"><a href="action-centre.html">View all ${summary.total} in Actions &rsaquo;</a></p>` : ''}`
    : `<div class="empty-state" style="padding:1.5rem;">
         <div style="font-size:1.8rem;">&#127881;</div>
         <strong>You&rsquo;re all caught up</strong>
         <p class="muted" style="margin:.2rem 0 0;">New tasks &mdash; approvals, claims, camp jobs &mdash; will appear here as they come in.</p>
       </div>`;

  return `
    <h2 style="margin:0 0 .75rem;">Needs you now</h2>
    ${needsYou}`;
}

// Quick links to leader-wide insight screens (aggregate, cross-section). Kept separate
// from a single section's card because these span every section the leader can see.
function insightsCard() {
  return `
    <h2 style="margin:1.5rem 0 .75rem;">Insights</h2>
    <div class="cap-actions">
      <a class="btn btn-secondary btn-sm" href="osm-badges.html">Badges awarded</a>
    </div>`;
}

function sectionsBlock(sections, clickable) {
  if (!sections || sections.length === 0) {
    return `<div class="empty-state">No sections are linked to your account yet. If you lead a section in OSM, this should update automatically next time you log in - otherwise contact a Portal Administrator.</div>`;
  }
  return renderSections(sections, clickable);
}

function renderSections(sections, clickable) {
  if (sections.length === 0) return '';
  return `<div class="grid cols-2">` + sections.map(s => {
    const inner = `
      <h2>${escapeHtml(s.sectionName)}</h2>
      ${s.meetingDay ? `<p class="muted">${escapeHtml(s.meetingDay)} ${escapeHtml(s.meetingTime || '')} &middot; ${escapeHtml(s.location || '')}</p>` : ''}
      ${s.currentTerm && s.currentTerm.name ? `<p class="muted">Current term: ${escapeHtml(s.currentTerm.name)}${s.currentTerm.startDate ? ` (${formatDate(s.currentTerm.startDate)}${s.currentTerm.endDate ? ' - ' + formatDate(s.currentTerm.endDate) : ''})` : ''}</p>` : ''}
      ${s.memberCount !== undefined && s.memberCount !== null ? `<p><strong>${s.memberCount}</strong> member${s.memberCount === 1 ? '' : 's'}${s.memberCountSyncedAt ? ` <span class="muted">&middot; OSM ${formatDate(s.memberCountSyncedAt)}</span>` : ''}</p>` : ''}
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
