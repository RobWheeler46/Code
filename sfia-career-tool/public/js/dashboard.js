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

async function loadDashboard() {
  const container = document.getElementById('dashboard-container');
  const [roles, comps] = await Promise.all([
    Api.get('/api/user/saved-roles'),
    Api.get('/api/user/saved-comparisons')
  ]);
  container.innerHTML = `
    <h1>My dashboard</h1>
    <div class="card">
      <h2>Saved roles</h2>
      <div id="saved-roles">${renderSavedRoles(roles)}</div>
    </div>
    <div class="card">
      <h2>Saved comparisons</h2>
      <div id="saved-comparisons">${renderSavedComparisons(comps)}</div>
    </div>
  `;

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
