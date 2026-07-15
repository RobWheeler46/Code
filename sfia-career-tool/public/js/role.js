function importanceGroupLabel(importance) {
  return { core: 'Core skills', important: 'Important skills', optional: 'Optional skills' }[importance] || 'Other skills';
}

function renderAtAGlanceCards(role) {
  const cards = [
    { label: 'Seniority', value: role.seniority_level },
    { label: 'Role type', value: role.role_type },
    { label: 'Capability area', value: role.capability_area_name },
    { label: 'Core SFIA skills', value: String(role.coreSkillCount) }
  ];
  if (role.roleAtAGlance?.focusArea) cards.push({ label: 'Focus area', value: role.roleAtAGlance.focusArea });
  return `
    <div class="glance-grid">
      ${cards.filter(c => c.value).map(c => `
        <div class="glance-card">
          <div class="glance-label">${escapeHtml(c.label)}</div>
          <div class="glance-value">${escapeHtml(c.value)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderWhatThisRoleDoes(role) {
  const sections = [
    { heading: 'Overview', body: role.summary },
    { heading: 'Responsibilities', body: role.responsibilities },
    { heading: 'Typical outputs', body: role.typical_outputs },
    { heading: 'A day in the life', body: role.day_in_the_life },
    { heading: 'What good looks like', body: role.success_indicators }
  ].filter(s => s.body);
  if (sections.length === 0) return '';
  return `
    <div class="card">
      <h2>What this role does</h2>
      ${sections.map(s => `<h3>${escapeHtml(s.heading)}</h3><p class="rich-text">${escapeHtml(s.body)}</p>`).join('')}
    </div>
  `;
}

function renderSkillsLandscape(skills) {
  const groups = ['core', 'important', 'optional'];
  return `
    <div class="card">
      <h2>Skills landscape</h2>
      <p class="muted">Select a skill to jump to its full detail below.</p>
      <div class="landscape">
        ${groups.map(g => {
          const groupSkills = skills.filter(s => s.importance === g);
          if (groupSkills.length === 0) return '';
          return `
            <div class="landscape-group">
              <h3>${escapeHtml(importanceGroupLabel(g))}</h3>
              <div class="landscape-chips">
                ${groupSkills.map(s => `
                  <a href="#skill-${s.sfia_skill_id}" class="landscape-chip" data-jump-skill="${s.sfia_skill_id}">
                    ${escapeHtml(s.skill_name)} <span class="chip-level">L${s.level_number}</span>
                  </a>
                `).join('')}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

const SKILL_TABLE_GROUPINGS = {
  none: { label: 'No grouping', groupOf: () => '', order: () => 0 },
  importance: { label: 'Importance', groupOf: s => importanceGroupLabel(s.importance), order: s => ({ core: 0, important: 1, optional: 2 }[s.importance] ?? 3) },
  level: { label: 'Required level', groupOf: s => `Level ${s.level_number}`, order: s => s.level_number },
  category: { label: 'SFIA category', groupOf: s => s.category_name || 'Uncategorised', order: s => s.category_name || 'zzz' }
};

function skillsComparisonTableRows(skills) {
  return skills.map(s => `
    <tr>
      <td data-label="Importance">${importanceBadge(s.importance)}</td>
      <td data-label="SFIA code">${escapeHtml(s.skill_code)}</td>
      <td data-label="SFIA skill">${escapeHtml(s.skill_name)}</td>
      <td data-label="Required level">Level ${s.level_number}${s.level_name && s.level_name !== `Level ${s.level_number}` ? ' &mdash; ' + escapeHtml(s.level_name) : ''}</td>
      <td data-label="Summary">${escapeHtml(s.short_description || s.role_specific_display_notes || '')}</td>
      <td data-label="Action"><a href="#skill-${s.sfia_skill_id}" class="btn btn-secondary btn-sm" data-jump-skill="${s.sfia_skill_id}">View full detail</a></td>
    </tr>
  `).join('');
}

function renderSkillsComparisonTable(skills) {
  return `
    <div class="card">
      <h2>SFIA skills and levels comparison</h2>
      <div class="field" style="max-width:260px;">
        <label for="skills-table-group">Group by</label>
        <select id="skills-table-group">
          ${Object.entries(SKILL_TABLE_GROUPINGS).map(([key, g]) => `<option value="${key}" ${key === 'importance' ? 'selected' : ''}>${escapeHtml(g.label)}</option>`).join('')}
        </select>
      </div>
      <div id="skills-table-wrap"></div>
    </div>
  `;
}

function updateSkillsComparisonTable(skills, groupKey) {
  const grouping = SKILL_TABLE_GROUPINGS[groupKey] || SKILL_TABLE_GROUPINGS.importance;
  const wrap = document.getElementById('skills-table-wrap');
  if (!wrap) return;

  const headerRow = `
    <thead>
      <tr>
        <th scope="col">Importance</th>
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
          <span class="skill-summary-meta">${importanceBadge(s.importance)} Level ${s.level_number}${s.level_name && s.level_name !== `Level ${s.level_number}` ? ' &mdash; ' + escapeHtml(s.level_name) : ''}</span>
        </div>
        ${s.short_description ? `<p class="skill-short-desc">${escapeHtml(s.short_description)}</p>` : ''}
      </summary>
      <div class="skill-detail-body">
        ${s.role_specific_display_notes ? `<h4>Why this matters for this role</h4><p>${escapeHtml(s.role_specific_display_notes)}</p>` : ''}
        ${s.rationale ? `<h4>Rationale</h4><p>${escapeHtml(s.rationale)}</p>` : ''}
        ${s.skill_level_description ? `<h4>What this looks like at Level ${s.level_number}</h4><p class="rich-text">${escapeHtml(s.skill_level_description)}</p>${s.skill_level_guidance_notes ? `<p class="muted rich-text">${escapeHtml(s.skill_level_guidance_notes)}</p>` : ''}` : ''}
        ${s.skill_full_description ? `<h4>Full skill description</h4><p class="rich-text">${escapeHtml(s.skill_full_description)}</p>` : ''}
        ${s.level_full_description ? `<h4>Full level description</h4><p class="rich-text">${escapeHtml(s.level_full_description)}</p>` : ''}
      </div>
    </details>
  `;
}

function renderProgressionPanel(role) {
  const hasRelated = role.relatedRoles.length > 0;
  const hasPathways = role.pathways && role.pathways.length > 0;
  if (!role.progression_summary && !hasRelated && !hasPathways) return '';
  return `
    <div class="card" id="progression">
      <h2>Progression</h2>
      ${role.progression_summary ? `<p>${escapeHtml(role.progression_summary)}</p>` : ''}
      ${hasPathways ? `
        <div class="actions-row">
          ${role.pathways.map(p => `<a class="btn btn-secondary" href="pathway.html?id=${p.id}&highlight=${role.id}">Explore &ldquo;${escapeHtml(p.pathway_name)}&rdquo;</a>`).join('')}
        </div>
      ` : ''}
      ${hasRelated ? `
        <div class="grid cols-2">
          ${role.relatedRoles.map(r => `
            <a class="card clickable" href="role.html?id=${r.id}">
              <h3 style="margin-top:0;">${escapeHtml(r.title)}</h3>
              <p class="muted">${escapeHtml(r.seniority_level || '')}</p>
              <p>${escapeHtml(r.summary || '')}</p>
            </a>
          `).join('')}
        </div>
      ` : ''}
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
        <a class="btn btn-secondary" href="compare.html?current=${role.id}">Select as current role</a>
        <a class="btn btn-secondary" href="compare.html?aspirational=${role.id}">Select as aspirational role</a>
        ${role.relatedRoles.length > 0 ? '<a class="btn btn-secondary" href="#progression">View related roles</a>' : ''}
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

  const breadcrumb = [role.role_family_name, role.capability_area_name].filter(Boolean).map(escapeHtml).join(' &middot; ');
  const tags = (role.displayTags || []).map(t => `<span class="tag-badge">${escapeHtml(t)}</span>`).join('');

  container.innerHTML = `
    <div class="role-hero">
      ${role.sfiaVersions && role.sfiaVersions.length > 0 ? `<div class="sfia-version-badge">SFIA version: ${escapeHtml(role.sfiaVersions.join(', '))}</div>` : ''}
      ${breadcrumb ? `<p class="hero-breadcrumb">${breadcrumb}${role.seniority_level ? ' &middot; ' + escapeHtml(role.seniority_level) : ''}</p>` : ''}
      <h1>${escapeHtml(role.title)}</h1>
      ${tags ? `<div class="tag-row">${tags}</div>` : ''}
      <p class="hero-purpose">${escapeHtml(role.purpose_statement || role.summary || '')}</p>
      <a class="btn btn-primary" href="compare.html?current=${role.id}">Compare this role</a>
    </div>

    <div class="mobile-sticky-actions" aria-label="Primary actions">
      <a class="btn btn-primary" href="compare.html?current=${role.id}">Compare</a>
      <a class="btn btn-secondary" href="compare.html?aspirational=${role.id}">Select aspirational</a>
    </div>

    <div class="container">
      ${renderAtAGlanceCards(role)}
      ${renderWhatThisRoleDoes(role)}
      ${role.skills.length > 0 ? renderSkillsLandscape(role.skills) : ''}
      ${role.skills.length > 0 ? renderSkillsComparisonTable(role.skills) : ''}

      <div class="card">
        <h2>SFIA skills and levels</h2>
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
    updateSkillsComparisonTable(role.skills, 'importance');
    document.getElementById('skills-table-group').addEventListener('change', (e) => {
      updateSkillsComparisonTable(role.skills, e.target.value);
    });
  }
});
