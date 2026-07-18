// Public read-only view of a shared assessment result or development plan.
// The token in the URL is the only credential; no sign-in required.

const STATUS_LABELS = { not_started: 'Not started', in_progress: 'In progress', done: 'Done' };

function notFoundCard(msg) {
  return `<div class="card"><div class="empty-state">${escapeHtml(msg)}</div>
    <div class="actions-row"><a class="btn btn-secondary" href="index.html">Explore Career Explorer</a></div></div>`;
}

function statusChip(status, levelDiff) {
  if (status === 'met') return gapBadge('No gap');
  if (status === 'not_answered') return '<span class="badge" data-gap="Not applicable">Not answered</span>';
  const label = levelDiff === 1 ? 'Minor gap' : levelDiff === 2 ? 'Moderate gap' : 'Significant gap';
  return gapBadge(label);
}

function renderSharedAssessment(container, r) {
  container.innerHTML = `
    <div class="card compare-hero">
      <p class="muted" style="margin:0;">${escapeHtml(r.ownerName)}&rsquo;s assessment</p>
      <h1 style="margin:0.2rem 0;">${escapeHtml(r.role ? r.role.title : 'Role')}${r.role && r.role.grade ? ' · Grade ' + escapeHtml(r.role.grade) : ''}</h1>
      <p><span class="readiness-label" data-ready="${escapeHtml(r.label)}">${escapeHtml(r.label)}</span> · ${r.percent}% of required skills met</p>
      <div class="summary-stats">
        <div class="stat-tile"><div class="num">${r.met}</div><div class="label">Skills met</div></div>
        <div class="stat-tile"><div class="num">${r.gap}</div><div class="label">Development gaps</div></div>
        <div class="stat-tile"><div class="num">${r.total}</div><div class="label">Skills assessed</div></div>
      </div>
    </div>
    <div class="card">
      <h2>Skill-by-skill readiness</h2>
      <table class="skills-table">
        <thead><tr><th>SFIA code</th><th>Skill</th><th>Required</th><th>Level held</th><th>Status</th></tr></thead>
        <tbody>
          ${r.details.map(d => `
            <tr>
              <td data-label="SFIA code">${escapeHtml(d.skillCode)}</td>
              <td data-label="Skill">${escapeHtml(d.skillName)}</td>
              <td data-label="Required"><span class="level-pill">L${d.requiredLevel.number}</span></td>
              <td data-label="Level held">${d.selfLevel ? `<span class="level-pill">L${d.selfLevel.number}</span>` : '&mdash;'}</td>
              <td data-label="Status">${statusChip(d.status, d.levelDiff)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <div class="card"><p class="muted" style="margin:0;">This is a read-only shared view. <a href="index.html">Explore Career Explorer</a> to build your own role comparisons and assessments.</p></div>
  `;
}

function renderSharedPlan(container, r) {
  const counts = { not_started: 0, in_progress: 0, done: 0 };
  r.items.forEach(i => counts[i.status]++);
  container.innerHTML = `
    <div class="card compare-hero">
      <p class="muted" style="margin:0;">${escapeHtml(r.ownerName)}&rsquo;s development plan</p>
      <h1 style="margin:0.2rem 0;">Development plan</h1>
      <div class="summary-stats">
        <div class="stat-tile"><div class="num">${counts.in_progress}</div><div class="label">In progress</div></div>
        <div class="stat-tile"><div class="num">${counts.not_started}</div><div class="label">Not started</div></div>
        <div class="stat-tile"><div class="num">${counts.done}</div><div class="label">Done</div></div>
      </div>
    </div>
    ${r.items.length === 0
      ? '<div class="card"><div class="empty-state">This development plan has no items yet.</div></div>'
      : r.items.map(it => {
          const target = [it.target_role_title ? escapeHtml(it.target_role_title) : null, it.target_level_number ? `Level ${it.target_level_number}` : null].filter(Boolean).join(' · ');
          return `
            <div class="card plan-item">
              <div class="plan-item-head">
                <div>
                  <h3 style="margin:0;">${escapeHtml(it.skill_name && it.skill_name !== it.skill_code ? it.skill_name : it.skill_code)} <span class="muted">(${escapeHtml(it.skill_code)})</span></h3>
                  ${target ? `<p class="muted" style="margin:0.2rem 0 0;">Toward ${target}</p>` : ''}
                </div>
                <span class="badge" data-plan-status="${escapeHtml(it.status)}">${escapeHtml(STATUS_LABELS[it.status] || it.status)}</span>
              </div>
              ${it.notes ? `<p style="margin:0.6rem 0 0; white-space:pre-wrap;">${escapeHtml(it.notes)}</p>` : ''}
            </div>`;
        }).join('')}
    <div class="card"><p class="muted" style="margin:0;">This is a read-only shared view. <a href="index.html">Explore Career Explorer</a> to build your own development plan.</p></div>
  `;
}

document.addEventListener('DOMContentLoaded', async () => {
  const container = document.getElementById('shared-container');
  const token = new URLSearchParams(location.search).get('token');
  if (!token) { container.innerHTML = notFoundCard('No share link was provided.'); return; }
  let data;
  try { data = await Api.get('/api/shared/' + encodeURIComponent(token)); }
  catch (e) { container.innerHTML = notFoundCard(e.message || 'This shared link is not valid or has been revoked.'); return; }
  if (data.shareType === 'assessment') renderSharedAssessment(container, data);
  else renderSharedPlan(container, data);
});
