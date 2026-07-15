const CONNECTION_TYPE_LABELS = {
  progression: 'Progression',
  lateral: 'Lateral move',
  specialisation: 'Specialisation',
  management: 'Management move',
  architecture: 'Architecture move',
  stretch: 'Stretch role',
  alternative: 'Alternative pathway'
};

function levelRangeLabel(role) {
  if (role.minLevel == null) return null;
  return role.minLevel === role.maxLevel ? `Level ${role.minLevel}` : `Level ${role.minLevel}–${role.maxLevel}`;
}

function renderRoleCard(role, connections, highlightId) {
  const outgoing = connections.filter(c => c.from_role_profile_id === role.id);
  const levelRange = levelRangeLabel(role);
  const isHighlighted = String(role.id) === String(highlightId);
  return `
    <div class="card pathway-role-card${isHighlighted ? ' highlighted' : ''}" id="pathway-role-${role.id}">
      ${role.displayLabel ? `<p class="muted" style="margin:0 0 0.3rem;">${escapeHtml(role.displayLabel)}</p>` : ''}
      <h3 style="margin-top:0;">${escapeHtml(role.title)}</h3>
      <p class="muted">${escapeHtml(role.role_family_name || '')}${role.capability_area_name ? ' &middot; ' + escapeHtml(role.capability_area_name) : ''}</p>
      <p class="muted">${escapeHtml(role.seniority_level || '')}${levelRange ? ' &middot; ' + escapeHtml(levelRange) : ''} &middot; ${role.coreSkillCount} core skill${role.coreSkillCount === 1 ? '' : 's'}</p>
      <p>${escapeHtml(role.summary || '')}</p>
      <div class="actions-row">
        <a class="btn btn-secondary btn-sm" href="role.html?id=${role.id}">View role</a>
        <a class="btn btn-secondary btn-sm" href="compare.html?current=${role.id}">Compare from here</a>
        <a class="btn btn-secondary btn-sm" href="compare.html?aspirational=${role.id}">Set as aspirational</a>
      </div>
      ${outgoing.length > 0 ? `
        <div class="pathway-connections">
          <div class="muted" style="font-size:0.8rem; text-transform:uppercase; letter-spacing:0.02em;">Leads to</div>
          ${outgoing.map(c => `
            <a href="#pathway-role-${c.to_role_profile_id}" class="pathway-connection-link" data-jump-role="${c.to_role_profile_id}">
              ${escapeHtml(CONNECTION_TYPE_LABELS[c.connection_type] || c.connection_type)}: ${escapeHtml(c.to_title || '')}
            </a>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

document.addEventListener('DOMContentLoaded', async () => {
  renderPublicNav();
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const highlightId = params.get('highlight');
  const container = document.getElementById('pathway-container');
  if (!id) {
    container.innerHTML = '<div class="card"><div class="empty-state">No career pathway specified.</div></div>';
    return;
  }

  let pathway;
  try {
    pathway = await Api.get(`/api/pathways/${id}`);
  } catch (e) {
    container.innerHTML = `<div class="card"><div class="alert alert-error">${escapeHtml(e.message)}</div></div>`;
    return;
  }

  const connections = pathway.connections.map(c => ({
    ...c,
    to_title: pathway.roles.find(r => r.id === c.to_role_profile_id)?.title
  }));

  const stages = [...new Set(pathway.roles.map(r => r.pathwayStage))].sort((a, b) => a - b);
  const highlightStage = highlightId ? pathway.roles.find(r => String(r.id) === String(highlightId))?.pathwayStage : null;

  container.innerHTML = `
    <div class="card">
      <span class="badge" data-pathway-type="${escapeHtml(pathway.pathway_type)}">${escapeHtml(pathway.pathway_type)}</span>
      <h1>${escapeHtml(pathway.pathway_name)}</h1>
      <p class="muted">${escapeHtml(pathway.role_family_name || '')}</p>
      <p>${escapeHtml(pathway.pathway_description || '')}</p>
    </div>

    ${stages.length > 1 ? `
      <div class="pathway-stage-nav">
        ${stages.map(stage => `<a href="#pathway-stage-${stage}">Stage ${stage}</a>`).join('')}
      </div>
    ` : ''}

    <div class="pathway-map">
      ${stages.map(stage => `
        <details class="pathway-stage" id="pathway-stage-${stage}" ${stage === highlightStage || !highlightStage ? 'open' : ''}>
          <summary>Stage ${stage} <span class="stage-role-count">${pathway.roles.filter(r => r.pathwayStage === stage).length} role${pathway.roles.filter(r => r.pathwayStage === stage).length === 1 ? '' : 's'}</span></summary>
          <div class="pathway-stage-roles">
            ${pathway.roles.filter(r => r.pathwayStage === stage).map(r => renderRoleCard(r, connections, highlightId)).join('')}
          </div>
        </details>
      `).join('')}
    </div>
  `;

  function revealAndScrollTo(roleId) {
    const target = document.getElementById(`pathway-role-${roleId}`);
    if (!target) return;
    const stageEl = target.closest('details.pathway-stage');
    if (stageEl) stageEl.open = true;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  container.querySelectorAll('[data-jump-role]').forEach(link => {
    link.addEventListener('click', () => revealAndScrollTo(link.dataset.jumpRole));
  });

  if (highlightId) revealAndScrollTo(highlightId);
});
