function renderDetailRow(d) {
  const current = d.currentLevel ? `Level ${d.currentLevel.number}` : '&mdash;';
  const aspirational = d.aspirationalLevel ? `Level ${d.aspirationalLevel.number}` : '&mdash;';
  const formal = d.learningResources.filter(r => !PRACTICAL_RESOURCE_TYPES.includes(r.resourceType));
  const practical = d.learningResources.filter(r => PRACTICAL_RESOURCE_TYPES.includes(r.resourceType));

  return `
    <div class="card">
      <div class="skill-row">
        <div>
          <div class="skill-name">${escapeHtml(d.skillName)} <span class="muted">(${escapeHtml(d.skillCode)})</span></div>
          <div class="skill-meta">${importanceBadge(d.importance)}</div>
        </div>
        <div style="text-align:right;">
          <div>${current} &rarr; ${aspirational}</div>
          <div>${gapBadge(d.gapSeverity)}</div>
        </div>
      </div>
      ${d.gapStatus !== 'no_gap' && d.gapStatus !== 'current_role_strength' ? `
        <h3>Suggested learning</h3>
        ${renderResourceList(formal)}
        ${practical.length > 0 ? `<h3>Practical development suggestions</h3>${renderResourceList(practical)}` : ''}
      ` : ''}
    </div>
  `;
}

async function loadRoleOptions() {
  const roles = await Api.get('/api/roles');
  const currentSelect = document.getElementById('current-role');
  const aspirationalSelect = document.getElementById('aspirational-role');
  const optionsHtml = roles.map(r => `<option value="${r.id}">${escapeHtml(r.title)}</option>`).join('');
  currentSelect.insertAdjacentHTML('beforeend', optionsHtml);
  aspirationalSelect.insertAdjacentHTML('beforeend', optionsHtml);

  const params = new URLSearchParams(location.search);
  if (params.get('current')) currentSelect.value = params.get('current');
  if (params.get('aspirational')) aspirationalSelect.value = params.get('aspirational');
}

async function runComparison() {
  const alertBox = document.getElementById('compare-alert');
  const resultsBox = document.getElementById('results');
  alertBox.innerHTML = '';
  const currentRoleId = document.getElementById('current-role').value;
  const aspirationalRoleId = document.getElementById('aspirational-role').value;

  if (!currentRoleId) {
    alertBox.innerHTML = '<div class="alert alert-info">Select a current role to start the comparison.</div>';
    return;
  }
  if (!aspirationalRoleId) {
    alertBox.innerHTML = '<div class="alert alert-info">Select an aspirational role to compare against.</div>';
    return;
  }

  let result;
  try {
    result = await Api.post('/api/compare', { currentRoleId, aspirationalRoleId });
  } catch (e) {
    alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`;
    resultsBox.innerHTML = '';
    return;
  }

  const { summary, details } = result;
  resultsBox.innerHTML = `
    <div class="card">
      <h2>${escapeHtml(result.currentRole.title)} &rarr; ${escapeHtml(result.aspirationalRole.title)}</h2>
      <div class="summary-stats">
        <div class="stat-tile"><div class="num">${summary.totalGaps}</div><div class="label">Total gaps</div></div>
        <div class="stat-tile"><div class="num">${summary.newSkillsRequired}</div><div class="label">New skills required</div></div>
        <div class="stat-tile"><div class="num">${summary.levelUpliftRequired}</div><div class="label">Level uplift needed</div></div>
        <div class="stat-tile"><div class="num">${summary.alignedSkills}</div><div class="label">Aligned skills</div></div>
      </div>
    </div>
    <h2>Skill-by-skill gap</h2>
    ${details.map(renderDetailRow).join('')}
  `;
}

document.addEventListener('DOMContentLoaded', async () => {
  renderPublicNav();
  await loadRoleOptions();
  document.getElementById('compare-btn').addEventListener('click', runComparison);
  const params = new URLSearchParams(location.search);
  if (params.get('current') && params.get('aspirational')) runComparison();
});
