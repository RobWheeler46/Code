// Prepare Tonight (FRD-IA): a focused, time-based leader view for the next section
// night. Leads with the section(s) on tonight (from OSM meeting day cached at login),
// then what's on the calendar today, the forms and equipment to sort, the top actions,
// and an honest link-out for the live attendance register (OSM's system of record).
// Styled with existing classes + inline rules only - no style.css changes.
const PT_PRIORITY_BADGE = { High: 'deleted', Medium: 'suspended', Low: 'draft' };

(async () => {
  const me = await requireUserNav('leader');
  if (!me) return;
  if (!(me.capabilities && me.capabilities.leader)) { location.href = 'parent-dashboard.html'; return; }

  const content = document.getElementById('content');
  let data;
  try { data = await Api.get('/api/leader/prepare-tonight'); }
  catch (e) { content.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; return; }

  content.innerHTML = tonightBanner(data) + sectionsCard(data.sections) + whatsOnCard(data.whatsOn)
    + listCard('Forms to sort', 'Activity approvals and risk-assessment reminders to clear before the activity.', data.forms, 'No forms need your attention.')
    + listCard('Equipment', 'Kit to collect for, or return after, an activity.', data.equipment, 'No equipment tasks right now.')
    + actionsCard(data.actions) + attendanceCard(data.attendance);
})();

// A one-line lead: how many sections meet tonight (the headline of the whole page).
function tonightBanner(data) {
  const n = data.tonightCount || 0;
  const on = (data.sections || []).filter(s => s.meetsToday);
  if (!n) return `<div class="card" style="margin-bottom:1rem"><strong>No section meets tonight.</strong> <span class="muted">Here's what's coming up and what to prepare.</span></div>`;
  const names = on.map(s => escapeHtml(s.sectionName)).join(', ');
  return `<div class="card" style="border-left:4px solid var(--accent, #5b3d8f);margin-bottom:1rem">
    <strong>Tonight: ${names}</strong>
    <span class="muted">${on.map(s => s.meetingTime ? escapeHtml(s.sectionName) + ' at ' + escapeHtml(s.meetingTime) : '').filter(Boolean).join(' &middot; ')}</span>
  </div>`;
}

function sectionsCard(sections) {
  sections = sections || [];
  if (!sections.length) return `<div class="card"><h2 style="margin:0 0 .3rem">Your sections</h2><p class="muted">No youth sections found on your OSM account. Section detail is read from OSM at sign-in.</p></div>`;
  const rows = sections.map(s => {
    const pill = s.meetsToday
      ? '<span class="badge" data-status="active">Tonight</span>'
      : (s.nextMeetingLabel ? `<span class="badge" data-status="draft">${escapeHtml(s.nextMeetingLabel)}</span>` : '<span class="badge" data-status="suspended">Meeting day not set</span>');
    const meta = [s.meetingDay, s.meetingTime, s.location].filter(Boolean).map(escapeHtml).join(' &middot; ') || 'No meeting details in OSM';
    const term = s.currentTerm ? ` &middot; ${escapeHtml(s.currentTerm.name)}` : '';
    return `<div style="padding:.55rem 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;gap:.5rem;align-items:flex-start">
      <div><strong>${escapeHtml(s.sectionName)}</strong><div class="muted" style="font-size:.85rem">${meta}${term}</div></div>
      <div>${pill}</div>
    </div>`;
  }).join('');
  return `<div class="card"><h2 style="margin:0 0 .3rem">Your sections</h2>
    <p class="muted" style="margin:0 0 .4rem;font-size:.85rem">Meeting day, time and place come from OSM (read at sign-in).</p>${rows}</div>`;
}

function whatsOnCard(items) {
  items = items || [];
  const body = items.length
    ? items.map(e => `<div style="padding:.5rem 0;border-bottom:1px solid var(--border)">
        <strong>${e.link ? `<a href="${escapeHtml(e.link)}">${escapeHtml(e.title)}</a>` : escapeHtml(e.title)}</strong>
        ${e.typeLabel ? ` <span class="badge" data-status="draft">${escapeHtml(e.typeLabel)}</span>` : ''}
        <div class="muted" style="font-size:.85rem">${[e.allDay ? 'All day' : (e.start ? formatDateTime(e.start) : ''), e.location, e.sectionName].filter(Boolean).map(escapeHtml).join(' &middot; ')}</div>
      </div>`).join('')
    : '<p class="muted">Nothing scheduled in the calendar for today.</p>';
  return `<div class="card"><h2 style="margin:0 0 .3rem">What's on today</h2>
    <p class="muted" style="margin:0 0 .4rem;font-size:.85rem">Calendar entries and event/camp pages dated today.</p>${body}</div>`;
}

// Shared renderer for the forms / equipment action lists (both are actionItem arrays).
function listCard(title, blurb, items, empty) {
  items = items || [];
  const body = items.length
    ? items.map(i => `<div style="padding:.5rem 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;gap:.5rem;align-items:flex-start">
        <div><strong>${escapeHtml(i.action)}</strong><div class="muted" style="font-size:.85rem">${escapeHtml(i.type)}${i.due ? ' &middot; due ' + escapeHtml(formatDate(i.due)) : ''}</div></div>
        <div style="display:flex;gap:.4rem;align-items:center"><span class="badge" data-status="${PT_PRIORITY_BADGE[i.priority] || 'draft'}">${escapeHtml(i.priority)}</span><a class="btn btn-secondary btn-sm" href="${escapeHtml(i.link)}">${escapeHtml(i.status)}</a></div>
      </div>`).join('')
    : `<p class="muted">${escapeHtml(empty)}</p>`;
  return `<div class="card"><h2 style="margin:0 0 .3rem">${escapeHtml(title)}</h2>
    <p class="muted" style="margin:0 0 .4rem;font-size:.85rem">${escapeHtml(blurb)}</p>${body}</div>`;
}

function actionsCard(actions) {
  actions = actions || [];
  if (!actions.length) return `<div class="card"><h2 style="margin:0 0 .3rem">Top actions</h2><p class="muted">You're all caught up.</p></div>`;
  const rows = actions.map(a => `<div style="padding:.5rem 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;gap:.5rem;align-items:flex-start">
      <div><strong>${escapeHtml(a.action)}</strong><div class="muted" style="font-size:.85rem">${escapeHtml(a.type)}${a.due ? ' &middot; due ' + escapeHtml(formatDate(a.due)) : ''}</div></div>
      <div style="display:flex;gap:.4rem;align-items:center"><span class="badge" data-status="${PT_PRIORITY_BADGE[a.priority] || 'draft'}">${escapeHtml(a.priority)}</span><a class="btn btn-secondary btn-sm" href="${escapeHtml(a.link)}">${escapeHtml(a.status)}</a></div>
    </div>`).join('');
  return `<div class="card"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:.5rem">
    <h2 style="margin:0 0 .3rem">Top actions</h2><a class="muted" href="action-centre.html" style="font-size:.85rem">All in Action Centre &rarr;</a></div>${rows}</div>`;
}

function attendanceCard(a) {
  if (!a) return '';
  return `<div class="card"><h2 style="margin:0 0 .3rem">Attendance register</h2>
    <p class="muted" style="margin:0 0 .5rem">${escapeHtml(a.note)}</p>
    ${a.link ? `<a class="btn btn-secondary btn-sm" href="${escapeHtml(a.link)}">Open attendance</a>` : ''}
    <a class="btn btn-secondary btn-sm" href="https://www.onlinescoutmanager.co.uk" target="_blank" rel="noopener">Open OSM</a></div>`;
}
