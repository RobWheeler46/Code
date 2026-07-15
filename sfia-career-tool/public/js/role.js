function renderSkillsLandscape(skills) {
  return `
    <div class="card">
      <h2>Skills landscape</h2>
      <p class="muted">Select a skill to jump to its full detail below.</p>
      <div class="landscape-chips">
        ${skills.map(s => `
          <a href="#skill-${s.sfia_skill_id}" class="landscape-chip" data-jump-skill="${s.sfia_skill_id}">
            ${escapeHtml(s.skill_name)} <span class="chip-level">L${s.level_number}</span>
          </a>
        `).join('')}
      </div>
    </div>
  `;
}

const SKILL_TABLE_GROUPINGS = {
  none: { label: 'No grouping', groupOf: () => '', order: () => 0 },
  level: { label: 'Required level', groupOf: s => `Level ${s.level_number}`, order: s => s.level_number },
  category: { label: 'SFIA category', groupOf: s => s.category_name || 'Uncategorised', order: s => s.category_name || 'zzz' }
};

function skillsComparisonTableRows(skills) {
  return skills.map(s => `
    <tr>
      <td data-label="SFIA code">${escapeHtml(s.skill_code)}</td>
      <td data-label="SFIA skill">${escapeHtml(s.skill_name)}</td>
      <td data-label="Required level">Level ${s.level_number}${s.level_name && s.level_name !== `Level ${s.level_number}` ? ' &mdash; ' + escapeHtml(s.level_name) : ''}</td>
      <td data-label="Summary">${escapeHtml(s.short_description || '')}</td>
      <td data-label="Action"><a href="#skill-${s.sfia_skill_id}" class="btn btn-secondary btn-sm" data-jump-skill="${s.sfia_skill_id}">View full detail</a></td>
    </tr>
  `).join('');
}

function renderSkillsComparisonTable(skills) {
  return `
    <div class="card">
      <h2>SFIA skills and levels</h2>
      <div class="field" style="max-width:260px;">
        <label for="skills-table-group">Group by</label>
        <select id="skills-table-group">
          ${Object.entries(SKILL_TABLE_GROUPINGS).map(([key, g]) => `<option value="${key}">${escapeHtml(g.label)}</option>`).join('')}
        </select>
      </div>
      <div id="skills-table-wrap"></div>
    </div>
  `;
}

function updateSkillsComparisonTable(skills, groupKey) {
  const grouping = SKILL_TABLE_GROUPINGS[groupKey] || SKILL_TABLE_GROUPINGS.none;
  const wrap = document.getElementById('skills-table-wrap');
  if (!wrap) return;

  const headerRow = `
    <thead>
      <tr>
        <th scope="col">SFIA code</th>
        <th scope="col">SFIA skill</th>
        <th scope="col">Required level</th>
        <th scope="col">Summary</th>
        <th scope="col">Full detail</th>
      </tr>
    </thead>
  `;

  if (groupKey === 'none') {
    wrap.innerHTML = `<table class="skills-table"><caption class="sr-only">SFIA skills and levels for this role</caption>${headerRow}<tbody>${skillsComparisonTableRows(skills)}</tbody></table>`;
  } else {
    const groupNames = [...new Set(skills.map(grouping.groupOf))].sort((a, b) => {
      const oa = grouping.order(skills.find(s => grouping.groupOf(s) === a));
      const ob = grouping.order(skills.find(s => grouping.groupOf(s) === b));
      return oa < ob ? -1 : oa > ob ? 1 : 0;
    });
    wrap.innerHTML = groupNames.map(name => `
      <h3>${escapeHtml(name)}</h3>
      <table class="skills-table">
        <caption class="sr-only">SFIA skills and levels: ${escapeHtml(name)}</caption>
        ${headerRow}
        <tbody>${skillsComparisonTableRows(skills.filter(s => grouping.groupOf(s) === name))}</tbody>
      </table>
    `).join('');
  }

  wrap.querySelectorAll('[data-jump-skill]').forEach(link => {
    link.addEventListener('click', () => {
      const target = document.getElementById(`skill-${link.dataset.jumpSkill}`);
      if (target) target.open = true;
    });
  });
}

function renderSkillDetail(s) {
  return `
    <details class="skill-detail" id="skill-${s.sfia_skill_id}" ${s.show_full_description ? 'open' : ''}>
      <summary>
        <div class="skill-summary-main">
          <span class="skill-name">${escapeHtml(skillLabel(s.skill_code, s.skill_name))}</span>
          <span class="skill-summary-meta">Level ${s.level_number}${s.level_name && s.level_name !== `Level ${s.level_number}` ? ' &mdash; ' + escapeHtml(s.level_name) : ''}</span>
        </div>
        ${s.short_description ? `<p class="skill-short-desc">${escapeHtml(s.short_description)}</p>` : ''}
      </summary>
      <div class="skill-detail-body">
        ${s.skill_level_description ? `<h4>What this looks like at Level ${s.level_number}</h4><p class="rich-text">${escapeHtml(s.skill_level_description)}</p>${s.skill_level_guidance_notes ? `<p class="muted rich-text">${escapeHtml(s.skill_level_guidance_notes)}</p>` : ''}` : ''}
        ${s.skill_full_description ? `<h4>Full skill description</h4><p class="rich-text">${escapeHtml(s.skill_full_description)}</p>` : ''}
        ${s.level_full_description ? `<h4>Full level description</h4><p class="rich-text">${escapeHtml(s.level_full_description)}</p>` : ''}
      </div>
    </details>
  `;
}

function renderProgressionPanel(role) {
  const hasPathways = role.pathways && role.pathways.length > 0;
  if (!hasPathways) return '';
  return `
    <div class="card" id="progression">
      <h2>Progression</h2>
      <div class="actions-row">
        ${role.pathways.map(p => `<a class="btn btn-secondary" href="pathway.html?id=${p.id}&highlight=${role.id}">Explore &ldquo;${escapeHtml(p.pathway_name)}&rdquo;</a>`).join('')}
      </div>
    </div>
  `;
}

function renderLearningPreview(role) {
  return `
    <div class="card">
      <h2>Learning preview</h2>
      ${role.learningPreview.length === 0
        ? '<p class="muted">No learning resources are linked to this role’s skills yet.</p>'
        : renderResourceList(role.learningPreview)}
      <div class="actions-row">
        <a class="btn btn-secondary" href="compare.html?current=${role.id}">View full learning recommendations via comparison</a>
      </div>
    </div>
  `;
}

function renderNextSteps(role) {
  return `
    <div class="card">
      <h2>What next?</h2>
      <div class="actions-row">
        <a class="btn btn-primary" href="compare.html?current=${role.id}">Compare this role</a>
        <a class="btn btn-secondary" href="compare.html?aspirational=${role.id}">Select as aspirational role</a>
      </div>
    </div>
  `;
}

document.addEventListener('DOMContentLoaded', async () => {
  renderPublicNav();
  const id = new URLSearchParams(location.search).get('id');
  const container = document.getElementById('role-container');
  if (!id) {
    container.innerHTML = '<div class="container"><div class="card"><div class="empty-state">No role profile specified.</div></div></div>';
    return;
  }

  let role;
  try {
    role = await Api.get(`/api/roles/${id}`);
  } catch (e) {
    container.innerHTML = `<div class="container"><div class="card"><div class="alert alert-error">${escapeHtml(e.message)}</div></div></div>`;
    return;
  }

  container.innerHTML = `
    <div class="role-hero">
      ${role.sfiaVersions && role.sfiaVersions.length > 0 ? `<div class="sfia-version-badge">SFIA version: ${escapeHtml(role.sfiaVersions.join(', '))}</div>` : ''}
      <h1>${escapeHtml(role.title)}</h1>
      ${role.grade ? `<p class="hero-breadcrumb">Grade ${escapeHtml(role.grade)}</p>` : ''}
      <p class="hero-purpose">${escapeHtml(role.role_description || '')}</p>
      <a class="btn btn-primary" href="compare.html?current=${role.id}">Compare this role</a>
    </div>

    <div class="mobile-sticky-actions" aria-label="Primary actions">
      <a class="btn btn-primary" href="compare.html?current=${role.id}">Compare</a>
      <a class="btn btn-secondary" href="compare.html?aspirational=${role.id}">Select aspirational</a>
    </div>

    <div class="container">
      ${role.skills.length > 0 ? renderSkillsLandscape(role.skills) : ''}
      ${role.skills.length > 0 ? renderSkillsComparisonTable(role.skills) : ''}

      <div class="card">
        <h2>Full SFIA detail</h2>
        ${role.skills.length === 0 ? '<p class="muted">No skills mapped yet.</p>' : role.skills.map(renderSkillDetail).join('')}
      </div>

      ${renderProgressionPanel(role)}
      ${renderLearningPreview(role)}
      ${renderNextSteps(role)}
    </div>
  `;

  container.querySelectorAll('.landscape-chip[data-jump-skill]').forEach(link => {
    link.addEventListener('click', () => {
      const target = document.getElementById(`skill-${link.dataset.jumpSkill}`);
      if (target) target.open = true;
    });
  });

  if (role.skills.length > 0) {
    updateSkillsComparisonTable(role.skills, 'none');
    document.getElementById('skills-table-group').addEventListener('change', (e) => {
      updateSkillsComparisonTable(role.skills, e.target.value);
    });
  }
});
