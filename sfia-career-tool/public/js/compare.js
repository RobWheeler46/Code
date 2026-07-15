const GAP_FILTERS = {
  all: { label: 'All skills', test: () => true },
  uplift: { label: 'Level uplifts', test: d => d.gapStatus === 'level_uplift' },
  new_skill: { label: 'New skills', test: d => d.gapStatus === 'new_skill_required' },
  aligned: { label: 'Aligned', test: d => d.gapStatus === 'no_gap' },
  priority: { label: 'High priority', test: d => d.importance === 'core' && (d.gapStatus === 'new_skill_required' || d.gapStatus === 'level_uplift') }
};

function movementLabel(d) {
  if (d.gapStatus === 'new_skill_required') return 'New';
  if (d.gapStatus === 'current_role_strength') return 'Not applicable';
  if (d.levelDiff == null) return '&mdash;';
  if (d.levelDiff === 0) return '0';
  return d.levelDiff > 0 ? `+${d.levelDiff}` : `${d.levelDiff}`;
}

function plainEnglishDifference(d) {
  if (d.gapStatus === 'no_gap') return 'Already at or above the level required for the aspirational role.';
  if (d.gapStatus === 'current_role_strength') return 'This skill is part of the current role but is not required by the aspirational role. It may still transfer as a strength.';
  if (d.gapStatus === 'new_skill_required') return `This is a new skill, not currently required in the current role. Target level: Level ${d.aspirationalLevel.number}${d.aspirationalLevel.name && d.aspirationalLevel.name !== `Level ${d.aspirationalLevel.number}` ? ' — ' + d.aspirationalLevel.name : ''}.`;
  if (d.levelDiff === 1) return 'Minor uplift — one level higher than the current role. A meaningful but achievable development step.';
  if (d.levelDiff === 2) return 'Moderate uplift — two levels higher than the current role. Likely needs a staged development plan.';
  return 'Significant gap — three or more levels higher than the current role. Consider a longer-term development pathway.';
}

function overallAlignment(summary) {
  if (summary.totalGaps === 0) return 'Fully aligned — no skill gaps identified.';
  if (summary.totalGaps <= 2) return 'Close — a small development step.';
  if (summary.totalGaps <= 5) return 'Moderate stretch — a meaningful development step.';
  return 'Significant stretch role — a longer-term development journey.';
}

function renderSideBySide(d) {
  return `
    <div class="compare-detail-grid">
      <div>
        <h4>Current role${d.currentLevel ? ` — Level ${d.currentLevel.number}` : ''}</h4>
        ${d.currentLevel
          ? `<p class="rich-text">${escapeHtml(d.currentLevel.skillLevelDescription || d.currentLevel.levelFullDescription || 'No detailed level description available.')}</p>`
          : '<p class="muted">Not required in the current role.</p>'}
      </div>
      <div>
        <h4>Aspirational role${d.aspirationalLevel ? ` — Level ${d.aspirationalLevel.number}` : ''}</h4>
        ${d.aspirationalLevel
          ? `<p class="rich-text">${escapeHtml(d.aspirationalLevel.skillLevelDescription || d.aspirationalLevel.levelFullDescription || 'No detailed level description available.')}</p>`
          : '<p class="muted">Not required in the aspirational role.</p>'}
      </div>
    </div>
    <h4>What this means</h4>
    <p>${escapeHtml(plainEnglishDifference(d))}</p>
  `;
}

function renderDetailRow(d) {
  const formal = d.learningResources.filter(r => !PRACTICAL_RESOURCE_TYPES.includes(r.resourceType));
  const practical = d.learningResources.filter(r => PRACTICAL_RESOURCE_TYPES.includes(r.resourceType));

  return `
    <details class="skill-detail compare-row" data-gap-status="${escapeHtml(d.gapStatus)}" data-importance="${escapeHtml(d.importance)}">
      <summary>
        <div class="skill-summary-main">
          <span class="skill-name">${escapeHtml(d.skillName)} <span class="muted">(${escapeHtml(d.skillCode)})</span></span>
          <span class="skill-summary-meta">${importanceBadge(d.importance)} ${gapBadge(d.gapSeverity)}</span>
        </div>
        <p class="skill-short-desc">
          ${d.currentLevel ? `Level ${d.currentLevel.number}` : '&mdash;'} &rarr; ${d.aspirationalLevel ? `Level ${d.aspirationalLevel.number}` : '&mdash;'}
          <span class="muted">(${movementLabel(d)})</span>
        </p>
      </summary>
      <div class="skill-detail-body">
        ${renderSideBySide(d)}
        ${d.gapStatus !== 'no_gap' && d.gapStatus !== 'current_role_strength' ? `
          <h4>Suggested learning</h4>
          ${renderResourceList(formal)}
          ${practical.length > 0 ? `<h4>Practical development suggestions</h4>${renderResourceList(practical)}` : ''}
        ` : ''}
      </div>
    </details>
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

function applyFilter(filterKey) {
  document.querySelectorAll('.compare-row').forEach(row => {
    const detail = row._detail;
    row.style.display = GAP_FILTERS[filterKey].test(detail) ? '' : 'none';
  });
  document.querySelectorAll('#compare-filters button').forEach(b => b.classList.toggle('active', b.dataset.filter === filterKey));
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

  const { summary, details, currentRole, aspirationalRole } = result;
  const versionMismatch = currentRole.sfiaVersion && aspirationalRole.sfiaVersion && currentRole.sfiaVersion !== aspirationalRole.sfiaVersion;
  const learningActionsAvailable = details.filter(d => d.learningResources.length > 0).length;

  resultsBox.innerHTML = `
    <div class="card compare-hero">
      <h2>${escapeHtml(currentRole.title)} &rarr; ${escapeHtml(aspirationalRole.title)}</h2>
      <p>${escapeHtml(overallAlignment(summary))}</p>
      ${currentRole.sfiaVersion || aspirationalRole.sfiaVersion ? `
        <p class="muted">
          SFIA version: ${escapeHtml(currentRole.sfiaVersion || 'Unknown')}${currentRole.sfiaVersion !== aspirationalRole.sfiaVersion ? ` vs ${escapeHtml(aspirationalRole.sfiaVersion || 'Unknown')}` : ''}
        </p>
      ` : ''}
      ${versionMismatch ? '<div class="alert alert-info">These two roles use different SFIA versions, so this comparison may not be exactly like-for-like.</div>' : ''}
      <div class="summary-stats">
        <div class="stat-tile"><div class="num">${summary.totalGaps}</div><div class="label">Total gaps</div></div>
        <div class="stat-tile"><div class="num">${summary.newSkillsRequired}</div><div class="label">New skills required</div></div>
        <div class="stat-tile"><div class="num">${summary.levelUpliftRequired}</div><div class="label">Level uplift needed</div></div>
        <div class="stat-tile"><div class="num">${summary.alignedSkills}</div><div class="label">Aligned skills</div></div>
        <div class="stat-tile"><div class="num">${learningActionsAvailable}</div><div class="label">Skills with learning available</div></div>
      </div>
    </div>

    <div class="card">
      <h2>Skill-by-skill gap</h2>
      <div class="tabs" id="compare-filters">
        ${Object.entries(GAP_FILTERS).map(([key, f]) => `<button type="button" data-filter="${key}" class="${key === 'all' ? 'active' : ''}">${escapeHtml(f.label)}</button>`).join('')}
      </div>
      ${details.length === 0 ? '<p class="muted">No skills to compare.</p>' : details.map(renderDetailRow).join('')}
    </div>
  `;

  // Attach each detail object to its row for client-side filtering, and generate unique ids for details.
  document.querySelectorAll('.compare-row').forEach((row, i) => { row._detail = details[i]; });

  document.querySelectorAll('#compare-filters button').forEach(btn => {
    btn.addEventListener('click', () => applyFilter(btn.dataset.filter));
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  renderPublicNav();
  await loadRoleOptions();
  document.getElementById('compare-btn').addEventListener('click', runComparison);
  const params = new URLSearchParams(location.search);
  if (params.get('current') && params.get('aspirational')) runComparison();
});
