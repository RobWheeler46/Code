// Role comparison (FRD v0.25 improved comparison + v0.27 FR-UX3). A guided experience: direction-of-
// travel header, plain-English summary, top 3 differences, a filterable gap list with a side-by-side
// selected-gap detail, and clear next actions. Priority is derived from gap size (no importance field).

let comparison = null;   // { summary, details, currentRole, aspirationalRole }
let selectedSkillId = null;
let activeFilter = 'priority';
let currentUser = null;  // cached /api/me

const GAP_FILTERS = {
  priority: { label: 'Priority', test: d => derivedPriority(d) === 'High' },
  uplift: { label: 'Level uplifts', test: d => d.gapStatus === 'level_uplift' },
  new_skill: { label: 'New skills', test: d => d.gapStatus === 'new_skill_required' },
  aligned: { label: 'Aligned', test: d => d.gapStatus === 'no_gap' },
  strengths: { label: 'Strengths', test: d => d.gapStatus === 'current_role_strength' }
};

// ---- Derived meaning ----

function derivedPriority(d) {
  if (d.gapStatus === 'new_skill_required') return 'High';
  if (d.gapStatus === 'level_uplift') return d.levelDiff >= 2 ? 'High' : 'Medium';
  return null;
}

function gapTypeLabel(d) {
  if (d.gapStatus === 'new_skill_required') return 'New skill';
  if (d.gapStatus === 'level_uplift') return 'Level uplift';
  if (d.gapStatus === 'current_role_strength') return 'Strength';
  return 'Aligned';
}

function isGap(d) { return d.gapStatus === 'level_uplift' || d.gapStatus === 'new_skill_required'; }

function whatChangesInPractice(d) {
  if (d.gapStatus === 'no_gap') return 'You already meet the level this role needs for this skill — a strength to build on.';
  if (d.gapStatus === 'current_role_strength') return 'This skill is part of your current role but is not required by the target role. It may still transfer as a strength.';
  if (d.gapStatus === 'new_skill_required') return `This is a new skill for you. You would move from not using it to working at Level ${d.aspirationalLevel.number}${d.aspirationalLevel.name && d.aspirationalLevel.name !== 'Level ' + d.aspirationalLevel.number ? ' (' + d.aspirationalLevel.name + ')' : ''} — expect to build foundational experience and evidence.`;
  if (d.levelDiff === 1) return 'A one-level uplift: you move from applying this skill to shaping how it is done — more ownership, judgement and influence over others.';
  if (d.levelDiff === 2) return 'A two-level uplift: a meaningful step up in autonomy and impact. Best approached as a staged development plan over time.';
  return 'A large uplift of three or more levels: a longer-term development journey rather than a single step.';
}

function overallChange(summary) {
  if (summary.totalGaps === 0) return 'None';
  if (summary.totalGaps <= 2) return 'Minor';
  if (summary.totalGaps <= 5) return 'Moderate';
  return 'Significant';
}

function plainSummary(summary, cur, asp) {
  if (summary.totalGaps === 0) {
    return `You already meet the SFIA skills and levels ${escapeHtml(asp.title)} requires. This looks like a lateral move or a role you are ready for.`;
  }
  let shift;
  if (summary.newSkillsRequired > 0 && summary.levelUpliftRequired > 0) {
    shift = 'picking up some new skills and working at a higher level across several existing ones';
  } else if (summary.newSkillsRequired > 0) {
    shift = 'picking up new skills you do not use in your current role';
  } else {
    shift = 'working at a higher SFIA level across several skills you already use';
  }
  return `Moving from ${escapeHtml(cur.title)} to ${escapeHtml(asp.title)} is mainly about ${shift}. There ${summary.totalGaps === 1 ? 'is 1 development gap' : 'are ' + summary.totalGaps + ' development gaps'} to focus on, with ${summary.alignedSkills} skill${summary.alignedSkills === 1 ? '' : 's'} already aligned.`;
}

function mainShift(summary) {
  if (summary.newSkillsRequired > 0 && summary.levelUpliftRequired > 0) return 'new skills and higher levels';
  if (summary.newSkillsRequired > 0) return 'new skills';
  if (summary.levelUpliftRequired > 0) return 'ownership and influence';
  return 'you are already aligned';
}

function topThree(details) {
  return details.filter(isGap)
    .map(d => ({ d, score: (derivedPriority(d) === 'High' ? 20 : 10) + (d.levelDiff || (d.gapStatus === 'new_skill_required' ? d.aspirationalLevel.number : 0)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(x => x.d);
}

// ---- Render pieces ----

function levelPill(level) { return level ? `<span class="level-pill">L${level.number}</span>` : '<span class="muted">&mdash;</span>'; }
function priorityBadge(d) {
  const p = derivedPriority(d);
  return p ? `<span class="badge" data-priority-level="${p}">${p} priority</span>` : '';
}

function roleMiniCard(role, label) {
  return `
    <div class="cmp-role-card">
      <p class="muted" style="margin:0;">${label}</p>
      <h3 style="margin:0.15rem 0;">${escapeHtml(role.title)}</h3>
      <div>${role.grade ? `<span class="pill">Grade ${escapeHtml(role.grade)}</span> ` : ''}${role.sfiaVersion ? `<span class="pill">${escapeHtml(role.sfiaVersion)}</span>` : ''}</div>
    </div>`;
}

function gapCard(d) {
  const selected = String(d.sfiaSkillId) === String(selectedSkillId);
  return `
    <button type="button" class="gap-card ${selected ? 'selected' : ''}" data-skill="${d.sfiaSkillId}" data-gap-status="${escapeHtml(d.gapStatus)}">
      <div class="gap-card-head">
        <span class="gap-card-title">${escapeHtml(d.skillCode)} &middot; ${escapeHtml(d.skillName)}</span>
        ${priorityBadge(d)}
      </div>
      <div class="gap-card-meta">
        ${levelPill(d.currentLevel)} ${svgIcon('arrowRight', { className: 'inline-arrow' })} ${levelPill(d.aspirationalLevel)}
        <span class="badge" data-gaptype="${escapeHtml(gapTypeLabel(d))}">${escapeHtml(gapTypeLabel(d))}</span>
      </div>
    </button>`;
}

function gapDetail(d) {
  if (!d) return '<div class="empty-state">Select a skill from the list to see what changes and how to close the gap.</div>';
  const formal = d.learningResources.filter(r => !PRACTICAL_RESOURCE_TYPES.includes(r.resourceType));
  const practical = d.learningResources.filter(r => PRACTICAL_RESOURCE_TYPES.includes(r.resourceType));
  const levelText = (lvl) => lvl ? escapeHtml(lvl.skillLevelDescription || lvl.levelFullDescription || 'No detailed level description available.') : 'Not required in this role.';
  const asp = comparison.aspirationalRole;

  return `
    <div class="gap-detail-head">
      <h3 style="margin:0;">${escapeHtml(d.skillName)} <span class="muted">(${escapeHtml(d.skillCode)})</span></h3>
      ${priorityBadge(d)}
    </div>
    <div class="compare-detail-grid">
      <div class="level-block">
        <h4>Current${d.currentLevel ? ' &middot; Level ' + d.currentLevel.number : ''}</h4>
        <p class="rich-text ${d.currentLevel ? '' : 'muted'}">${levelText(d.currentLevel)}</p>
      </div>
      <div class="level-block level-block-target">
        <h4>Target${d.aspirationalLevel ? ' &middot; Level ' + d.aspirationalLevel.number : ''}</h4>
        <p class="rich-text ${d.aspirationalLevel ? '' : 'muted'}">${levelText(d.aspirationalLevel)}</p>
      </div>
    </div>
    <h4>What changes in practice</h4>
    <p>${escapeHtml(whatChangesInPractice(d))}</p>
    ${isGap(d) ? `
      <h4>Evidence to build</h4>
      <p class="muted">Look for examples that show you working at Level ${d.aspirationalLevel.number}: your own contribution, the judgement or autonomy involved, who you influenced, and the outcome.</p>
      ${d.learningResources.length ? `<h4>Suggested learning</h4>${renderResourceList(formal)}${practical.length ? `<h4>Practical development</h4>${renderResourceList(practical)}` : ''}` : ''}
    ` : ''}
    <div class="gap-detail-actions actions-row" data-skill="${d.sfiaSkillId}" data-level="${d.aspirationalLevel ? d.aspirationalLevel.number : ''}">
      ${isGap(d) && currentUser ? `<button class="btn btn-primary btn-sm" data-action="plan" type="button">${svgIcon('plan', { className: 'btn-icon' })} Add to plan</button>` : ''}
      ${currentUser ? `<a class="btn btn-secondary btn-sm" href="evidence.html?skill=${d.sfiaSkillId}">${svgIcon('evidence', { className: 'btn-icon' })} Add evidence</a>` : ''}
      <a class="btn btn-secondary btn-sm" href="coach.html">${svgIcon('coach', { className: 'btn-icon' })} Ask Coach</a>
    </div>
    ${!currentUser && isGap(d) ? `<p class="muted" style="font-size:0.85rem;"><a href="signin.html?next=compare.html">Sign in</a> to add this to a development plan or capture evidence.</p>` : ''}
  `;
}

function currentFilteredDetails() {
  return comparison.details.filter(GAP_FILTERS[activeFilter].test);
}

function renderGapList() {
  const list = document.getElementById('gap-list');
  const items = currentFilteredDetails();
  if (!items.some(d => String(d.sfiaSkillId) === String(selectedSkillId))) {
    selectedSkillId = items.length ? items[0].sfiaSkillId : null;
  }
  list.innerHTML = items.length ? items.map(gapCard).join('') : '<div class="empty-state">No skills in this view.</div>';
  document.querySelectorAll('#compare-filters button').forEach(b => b.classList.toggle('active', b.dataset.filter === activeFilter));
  renderDetail();
  bindGapCards();
}

function renderDetail() {
  const d = comparison.details.find(x => String(x.sfiaSkillId) === String(selectedSkillId));
  const panel = document.getElementById('gap-detail');
  panel.innerHTML = gapDetail(d);
  bindDetailActions();
}

// ---- Event wiring ----

function bindGapCards() {
  document.querySelectorAll('.gap-card').forEach(card => {
    card.addEventListener('click', () => {
      selectedSkillId = card.dataset.skill;
      document.querySelectorAll('.gap-card').forEach(c => c.classList.toggle('selected', c === card));
      renderDetail();
      if (window.matchMedia('(max-width: 860px)').matches) {
        document.getElementById('gap-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
}

function bindDetailActions() {
  const box = document.querySelector('.gap-detail-actions');
  if (!box) return;
  const planBtn = box.querySelector('[data-action="plan"]');
  if (planBtn) {
    planBtn.addEventListener('click', async () => {
      planBtn.disabled = true;
      try {
        await Api.post('/api/user/development-plan', {
          sfiaSkillId: Number(box.dataset.skill),
          targetRoleProfileId: comparison.aspirationalRole.id,
          targetLevelNumber: Number(box.dataset.level)
        });
        planBtn.innerHTML = 'Added ✓';
      } catch (e) { planBtn.disabled = false; alert(e.message); }
    });
  }
}

async function startAssessment() {
  if (!currentUser) { location.href = 'signin.html?next=' + encodeURIComponent('compare.html?current=' + comparison.currentRole.id + '&aspirational=' + comparison.aspirationalRole.id); return; }
  try {
    const r = await Api.post('/api/user/assessments', { roleProfileId: comparison.aspirationalRole.id });
    location.href = `assessment.html?id=${r.id}`;
  } catch (e) { alert(e.message); }
}

function exportComparison() {
  const { currentRole, aspirationalRole, summary, details } = comparison;
  const lines = [];
  lines.push(`Career Explorer — Role comparison`);
  lines.push(`${currentRole.title}${currentRole.grade ? ' (Grade ' + currentRole.grade + ')' : ''}  ->  ${aspirationalRole.title}${aspirationalRole.grade ? ' (Grade ' + aspirationalRole.grade + ')' : ''}`);
  lines.push('');
  lines.push(`Overall change: ${overallChange(summary)} — ${summary.totalGaps} gap(s), ${summary.alignedSkills} aligned.`);
  lines.push('');
  lines.push('Development gaps:');
  details.filter(isGap).forEach(d => {
    lines.push(`- ${d.skillCode} ${d.skillName}: ${d.currentLevel ? 'L' + d.currentLevel.number : '—'} -> L${d.aspirationalLevel.number} [${derivedPriority(d)} priority] ${gapTypeLabel(d)}`);
    lines.push(`    ${whatChangesInPractice(d)}`);
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `comparison_${currentRole.title}_to_${aspirationalRole.title}`.replace(/[^a-z0-9]+/gi, '_') + '.txt';
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

// ---- Main render ----

function renderResults() {
  const { summary, details, currentRole, aspirationalRole } = comparison;
  const versionMismatch = currentRole.sfiaVersion && aspirationalRole.sfiaVersion && currentRole.sfiaVersion !== aspirationalRole.sfiaVersion;
  const top3 = topThree(details);

  document.getElementById('results').innerHTML = `
    <div class="card cmp-header">
      ${roleMiniCard(currentRole, 'Current role')}
      <div class="cmp-arrow" aria-hidden="true">${svgIcon('arrowRight')}</div>
      ${roleMiniCard(aspirationalRole, 'Target role')}
      <div class="cmp-header-actions"><button class="btn btn-secondary btn-sm" id="save-comparison-btn" type="button" style="display:none;"></button></div>
    </div>

    ${versionMismatch ? '<div class="alert alert-info">These roles use different SFIA versions, so the comparison may not be exactly like-for-like.</div>' : ''}

    <div class="card compare-summary">
      <h2>What changes between these roles?</h2>
      <p>${plainSummary(summary, currentRole, aspirationalRole)}</p>
      <p><span class="pill">Overall change: ${overallChange(summary)}</span> <span class="muted">Main shift: ${escapeHtml(mainShift(summary))}</span></p>
    </div>

    ${top3.length ? `
    <div class="card">
      <h2>Top 3 differences</h2>
      <ol class="top3-list">
        ${top3.map((d, i) => `
          <li>
            <span class="top3-num">${i + 1}</span>
            <div>
              <strong>${escapeHtml(d.skillName)} ${d.currentLevel ? 'L' + d.currentLevel.number + ' → ' : ''}L${d.aspirationalLevel.number}</strong>
              <span class="muted">${escapeHtml(d.gapStatus === 'new_skill_required' ? 'A new skill for this role' : (d.levelDiff === 1 ? 'Shapes the work, not just does it' : 'A step up in autonomy and impact'))}</span>
            </div>
          </li>`).join('')}
      </ol>
    </div>` : ''}

    <div class="compare-split">
      <div class="card compare-gaplist">
        <h2>Skill gaps</h2>
        <div class="tabs" id="compare-filters">
          ${Object.entries(GAP_FILTERS).map(([k, f]) => `<button type="button" data-filter="${k}">${escapeHtml(f.label)}</button>`).join('')}
        </div>
        <div id="gap-list" class="gap-list"></div>
      </div>
      <div class="card compare-gapdetail" id="gap-detail"></div>
    </div>

    <div class="card compare-footer">
      <button class="btn btn-primary" id="footer-assess" type="button">${svgIcon('assess', { className: 'btn-icon' })} Start assessment for ${escapeHtml(aspirationalRole.title)}</button>
      <a class="btn btn-secondary" href="coach.html">${svgIcon('coach', { className: 'btn-icon' })} Ask the Coach</a>
      <button class="btn btn-secondary" id="footer-export" type="button">Export comparison</button>
    </div>
  `;

  renderGapList();
  document.querySelectorAll('#compare-filters button').forEach(btn => {
    btn.addEventListener('click', () => { activeFilter = btn.dataset.filter; renderGapList(); });
  });
  document.getElementById('footer-assess').addEventListener('click', startAssessment);
  document.getElementById('footer-export').addEventListener('click', exportComparison);
  wireSaveButton();
}

async function wireSaveButton() {
  if (!currentUser) return;
  const saveBtn = document.getElementById('save-comparison-btn');
  saveBtn.style.display = '';
  const cur = comparison.currentRole, asp = comparison.aspirationalRole;
  const saved = await Api.get('/api/user/saved-comparisons').catch(() => []);
  const match = () => saved.find(s => String(s.current_role_profile_id) === String(cur.id) && String(s.aspirational_role_profile_id) === String(asp.id));
  let isSaved = !!match();
  const paint = () => { saveBtn.textContent = isSaved ? 'Saved ✓' : 'Save comparison'; };
  paint();
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    try {
      if (isSaved) { const m = match(); if (m) await Api.delete(`/api/user/saved-comparisons/${m.id}`); isSaved = false; if (m) saved.splice(saved.indexOf(m), 1); }
      else { const r = await Api.post('/api/user/saved-comparisons', { currentRoleId: cur.id, aspirationalRoleId: asp.id }); saved.push({ id: r.id, current_role_profile_id: cur.id, aspirational_role_profile_id: asp.id }); isSaved = true; }
      paint();
    } finally { saveBtn.disabled = false; }
  });
}

// ---- Setup ----

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
  if (!currentRoleId || !aspirationalRoleId) {
    alertBox.innerHTML = '<div class="alert alert-info">Select a current role and a target role to compare.</div>';
    return;
  }
  try {
    comparison = await Api.post('/api/compare', { currentRoleId, aspirationalRoleId });
  } catch (e) {
    alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`;
    resultsBox.innerHTML = '';
    return;
  }
  selectedSkillId = null;
  activeFilter = comparison.details.some(d => derivedPriority(d) === 'High') ? 'priority' : (comparison.summary.totalGaps ? 'uplift' : 'aligned');
  renderResults();
}

document.addEventListener('DOMContentLoaded', async () => {
  renderPublicNav();
  currentUser = await getMe();
  await loadRoleOptions();
  document.getElementById('compare-btn').addEventListener('click', runComparison);
  const params = new URLSearchParams(location.search);
  if (params.get('current') && params.get('aspirational')) runComparison();
});
