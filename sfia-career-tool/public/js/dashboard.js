function gradeBit(g) { return g ? `<span class="role-card-grade">Grade ${escapeHtml(g)}</span>` : ''; }

function renderSavedRoles(roles) {
  if (roles.length === 0) return '<p class="muted">No saved roles yet. Open a role profile and choose &ldquo;Save role&rdquo; to add it here.</p>';
  return `<div class="role-cards">${roles.map(r => `
    <div class="role-card" data-saved-role="${r.role_profile_id}">
      <div class="role-card-head">
        <div class="role-card-title">
          <h3><a href="role.html?id=${r.role_profile_id}">${escapeHtml(r.title)}</a></h3>
          ${gradeBit(r.grade)}
        </div>
      </div>
      <div class="actions-row" style="margin-top:0.5rem;">
        <a class="btn btn-secondary btn-sm" href="compare.html?aspirational=${r.role_profile_id}">Compare</a>
        <button class="btn btn-secondary btn-sm" data-remove-role="${r.role_profile_id}" type="button">Remove</button>
      </div>
    </div>
  `).join('')}</div>`;
}

function renderSavedComparisons(comps) {
  if (comps.length === 0) return '<p class="muted">No saved comparisons yet. Run a comparison and choose &ldquo;Save comparison&rdquo; to keep it here.</p>';
  return `<div class="role-cards">${comps.map(c => `
    <div class="role-card">
      <div class="role-card-title">
        <h3>${escapeHtml(c.current_title)} &rarr; ${escapeHtml(c.aspirational_title)}</h3>
        <div class="role-card-grade">${c.current_grade ? 'Grade ' + escapeHtml(c.current_grade) : ''}${c.current_grade && c.aspirational_grade ? ' &rarr; ' : ''}${c.aspirational_grade ? 'Grade ' + escapeHtml(c.aspirational_grade) : ''}</div>
      </div>
      <div class="actions-row" style="margin-top:0.5rem;">
        <a class="btn btn-secondary btn-sm" href="compare.html?current=${c.current_role_profile_id}&aspirational=${c.aspirational_role_profile_id}">Open</a>
        <button class="btn btn-secondary btn-sm" data-remove-comp="${c.id}" type="button">Remove</button>
      </div>
    </div>
  `).join('')}</div>`;
}

function renderAssessments(items) {
  if (items.length === 0) return '<p class="muted">No assessments yet. Open a role profile and choose &ldquo;Start assessment&rdquo; to rate yourself against it.</p>';
  return `<div class="role-cards">${items.map(a => `
    <div class="role-card">
      <div class="role-card-title">
        <h3>${escapeHtml(a.title)}</h3>
        <div class="role-card-grade">${a.status === 'completed'
          ? `<span class="readiness-label" data-ready="${escapeHtml(a.readinessLabel)}">${escapeHtml(a.readinessLabel)}</span> · ${a.percent}% met`
          : `In progress · ${a.answered}/${a.total} answered`}</div>
      </div>
      <div class="actions-row" style="margin-top:0.5rem;">
        ${a.status === 'completed'
          ? `<a class="btn btn-secondary btn-sm" href="assessment.html?id=${a.id}&results=1">View results</a>`
          : `<a class="btn btn-primary btn-sm" href="assessment.html?id=${a.id}">Continue</a>`}
        <button class="btn btn-secondary btn-sm" data-remove-assessment="${a.id}" type="button">Remove</button>
      </div>
    </div>
  `).join('')}</div>`;
}

async function loadDashboard() {
  const container = document.getElementById('dashboard-container');
  const [roles, comps, assessments, plan] = await Promise.all([
    Api.get('/api/user/saved-roles'),
    Api.get('/api/user/saved-comparisons'),
    Api.get('/api/user/assessments'),
    Api.get('/api/user/development-plan')
  ]);
  const planCounts = { not_started: 0, in_progress: 0, done: 0 };
  plan.forEach(i => planCounts[i.status]++);
  container.innerHTML = `
    <h1>My dashboard</h1>
    <div class="card">
      <h2>My development plan</h2>
      ${plan.length === 0
        ? '<p class="muted">No development goals yet. Add skills from an assessment or comparison gap.</p>'
        : `<div class="summary-stats">
            <div class="stat-tile"><div class="num">${planCounts.in_progress}</div><div class="label">In progress</div></div>
            <div class="stat-tile"><div class="num">${planCounts.not_started}</div><div class="label">Not started</div></div>
            <div class="stat-tile"><div class="num">${planCounts.done}</div><div class="label">Done</div></div>
          </div>`}
      <div class="actions-row"><a class="btn btn-secondary btn-sm" href="plan.html">Open development plan</a></div>
    </div>
    <div class="card">
      <h2>My assessments</h2>
      <div id="assessments">${renderAssessments(assessments)}</div>
    </div>
    <div class="card">
      <h2>Saved roles</h2>
      <div id="saved-roles">${renderSavedRoles(roles)}</div>
    </div>
    <div class="card">
      <h2>Saved comparisons</h2>
      <div id="saved-comparisons">${renderSavedComparisons(comps)}</div>
    </div>
  `;

  container.querySelectorAll('[data-remove-assessment]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await Api.delete(`/api/user/assessments/${btn.dataset.removeAssessment}`);
      loadDashboard();
    });
  });

  container.querySelectorAll('[data-remove-role]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await Api.delete(`/api/user/saved-roles/${btn.dataset.removeRole}`);
      loadDashboard();
    });
  });
  container.querySelectorAll('[data-remove-comp]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await Api.delete(`/api/user/saved-comparisons/${btn.dataset.removeComp}`);
      loadDashboard();
    });
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  renderPublicNav();
  let me;
  try {
    me = await Api.get('/api/me');
  } catch (e) {
    location.href = 'signin.html?next=dashboard.html';
    return;
  }
  await loadDashboard();
});
