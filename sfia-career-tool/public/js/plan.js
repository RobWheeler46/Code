const STATUS_LABELS = { not_started: 'Not started', in_progress: 'In progress', done: 'Done' };

function planItemCard(it) {
  const target = [it.target_role_title ? escapeHtml(it.target_role_title) : null, it.target_level_number ? `Level ${it.target_level_number}` : null].filter(Boolean).join(' · ');
  return `
    <div class="card plan-item" data-item="${it.id}">
      <div class="plan-item-head">
        <div>
          <h3 style="margin:0;">${escapeHtml(it.skill_name && it.skill_name !== it.skill_code ? it.skill_name : it.skill_code)} <span class="muted">(${escapeHtml(it.skill_code)})</span></h3>
          ${target ? `<p class="muted" style="margin:0.2rem 0 0;">Toward ${target}</p>` : ''}
        </div>
        <span class="badge" data-plan-status="${escapeHtml(it.status)}">${escapeHtml(STATUS_LABELS[it.status])}</span>
      </div>
      <div class="grid cols-2" style="margin-top:0.6rem;">
        <div class="field" style="margin-bottom:0;"><label>Status</label>
          <select data-status="${it.id}">
            ${Object.entries(STATUS_LABELS).map(([v, l]) => `<option value="${v}" ${it.status === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field" style="margin-top:0.6rem; margin-bottom:0.4rem;"><label>Notes</label>
        <textarea data-notes="${it.id}" placeholder="Your plan for developing this skill">${escapeHtml(it.notes || '')}</textarea>
      </div>
      ${it.learning && it.learning.length ? `<div><span class="muted" style="font-size:0.8rem;">Suggested learning:</span> ${it.learning.map(l => `<a href="${escapeHtml(l.url || '#')}" target="_blank" rel="noopener">${escapeHtml(l.title)}</a>`).join(' · ')}</div>` : ''}
      <div class="actions-row">
        <a class="btn btn-secondary btn-sm" href="evidence.html?skill=${it.sfia_skill_id}">Add evidence</a>
        <a class="btn btn-secondary btn-sm" href="role.html?id=${it.target_role_profile_id || ''}" ${it.target_role_profile_id ? '' : 'style="display:none;"'}>View role</a>
        <button class="btn btn-secondary btn-sm" data-remove="${it.id}" type="button">Remove</button>
      </div>
    </div>
  `;
}

async function loadPlan() {
  const container = document.getElementById('plan-container');
  const items = await Api.get('/api/user/development-plan');
  const counts = { not_started: 0, in_progress: 0, done: 0 };
  items.forEach(i => counts[i.status]++);
  container.innerHTML = `
    <h1>My development plan</h1>
    <div class="card">
      <div class="summary-stats">
        <div class="stat-tile"><div class="num">${counts.in_progress}</div><div class="label">In progress</div></div>
        <div class="stat-tile"><div class="num">${counts.not_started}</div><div class="label">Not started</div></div>
        <div class="stat-tile"><div class="num">${counts.done}</div><div class="label">Done</div></div>
      </div>
      <p class="muted" style="margin-bottom:0;">Add skills from an <a href="dashboard.html">assessment</a> or a <a href="compare.html">role comparison</a> gap, then track your progress here.</p>
    </div>
    ${items.length === 0 ? '<div class="card"><div class="empty-state">Your development plan is empty. Run an assessment or compare two roles, then use &ldquo;Add to plan&rdquo; on a gap.</div></div>' : items.map(planItemCard).join('')}
    ${items.length ? '<div class="card" id="share-card"></div>' : ''}
  `;

  if (items.length) {
    initShareControl({ mount: document.getElementById('share-card'), shareType: 'plan', resourceId: null, label: 'your development plan' });
  }

  container.querySelectorAll('[data-status]').forEach(sel => {
    sel.addEventListener('change', async () => { await Api.patch(`/api/user/development-plan/${sel.dataset.status}`, { status: sel.value }); loadPlan(); });
  });
  container.querySelectorAll('[data-notes]').forEach(t => {
    t.addEventListener('blur', async () => { await Api.patch(`/api/user/development-plan/${t.dataset.notes}`, { notes: t.value }); });
  });
  container.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', async () => { await Api.delete(`/api/user/development-plan/${btn.dataset.remove}`); loadPlan(); });
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  renderPublicNav();
  try { await Api.get('/api/me'); } catch (e) { location.href = 'signin.html?next=plan.html'; return; }
  await loadPlan();
});
