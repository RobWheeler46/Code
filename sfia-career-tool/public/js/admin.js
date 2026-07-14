let me = null;
let refData = { families: [], areas: [], levels: [], skills: [], versions: [], categories: [], adminRoles: [], roleProfiles: [] };

function openModal(html) {
  document.getElementById('modal-root').innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal">${html}</div>
    </div>
  `;
  document.getElementById('modal-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'modal-backdrop') closeModal();
  });
}
function closeModal() { document.getElementById('modal-root').innerHTML = ''; }

function confirmAction(message, onConfirm) {
  openModal(`
    <p>${escapeHtml(message)}</p>
    <div class="actions-row">
      <button class="btn btn-danger" id="confirm-action-btn" type="button">Confirm</button>
      <button class="btn btn-secondary" id="cancel-action-btn" type="button">Cancel</button>
    </div>
  `);
  document.getElementById('cancel-action-btn').addEventListener('click', closeModal);
  document.getElementById('confirm-action-btn').addEventListener('click', async () => {
    closeModal();
    await onConfirm();
  });
}

async function loadRefData() {
  refData.families = await Api.get('/api/role-families');
  refData.areas = await Api.get('/api/capability-areas');
  refData.levels = await Api.get('/api/admin/sfia-levels');
  refData.skills = await Api.get('/api/admin/sfia-skills');
  refData.versions = await Api.get('/api/admin/sfia-versions');
  refData.categories = await Api.get('/api/admin/sfia-categories');
  refData.adminRoles = await Api.get('/api/admin/admin-roles');
  refData.roleProfiles = await Api.get('/api/admin/role-profiles');
}

function familyOptions(selected) {
  return `<option value="">None</option>` + refData.families.map(f => `<option value="${f.id}" ${String(f.id) === String(selected) ? 'selected' : ''}>${escapeHtml(f.name)}</option>`).join('');
}
function areaOptions(selected, familyId) {
  const areas = familyId ? refData.areas.filter(a => String(a.role_family_id) === String(familyId)) : refData.areas;
  return `<option value="">None</option>` + areas.map(a => `<option value="${a.id}" ${String(a.id) === String(selected) ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('');
}
function levelOptions(selected) {
  return refData.levels.map(l => `<option value="${l.id}" ${String(l.id) === String(selected) ? 'selected' : ''}>${escapeHtml(levelLabel(l.level_number, l.level_name))}</option>`).join('');
}
function skillOptions(selected) {
  return refData.skills.filter(s => s.status === 'active').map(s => `<option value="${s.id}" ${String(s.id) === String(selected) ? 'selected' : ''}>${escapeHtml(s.skill_code)} - ${escapeHtml(s.skill_name)}</option>`).join('');
}
function versionOptions(selected) {
  return refData.versions.map(v => `<option value="${v.id}" ${String(v.id) === String(selected) ? 'selected' : ''}>${escapeHtml(v.version_name)}</option>`).join('');
}
function categoryOptions(selected, versionId) {
  const cats = versionId ? refData.categories.filter(c => String(c.sfia_version_id) === String(versionId)) : refData.categories;
  return `<option value="">None</option>` + cats.map(c => `<option value="${c.id}" ${String(c.id) === String(selected) ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
}
function roleProfileOptions(selected) {
  return refData.roleProfiles.map(r => `<option value="${r.id}" ${String(r.id) === String(selected) ? 'selected' : ''}>${escapeHtml(r.title)} (${escapeHtml(r.status)})</option>`).join('');
}

const TABS = {
  dashboard: renderDashboardTab,
  roles: renderRolesTab,
  skills: renderSkillsTab,
  learning: renderLearningTab,
  pathways: renderPathwaysTab,
  review: renderReviewTab,
  audit: renderAuditTab,
  users: renderUsersTab
};

async function switchTab(name) {
  document.querySelectorAll('#admin-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  const content = document.getElementById('tab-content');
  content.innerHTML = '<div class="card"><p class="muted">Loading...</p></div>';
  try {
    await TABS[name]();
  } catch (e) {
    content.innerHTML = `<div class="card"><div class="alert alert-error">${escapeHtml(e.message)}</div></div>`;
  }
}

// ---------- Dashboard ----------

async function renderDashboardTab() {
  const reports = await Api.get('/api/admin/reports');
  const content = document.getElementById('tab-content');
  content.innerHTML = `
    <div class="summary-stats">
      <div class="stat-tile"><div class="num">${reports.counts.rolePublished}</div><div class="label">Published roles</div></div>
      <div class="stat-tile"><div class="num">${reports.counts.roleDraft}</div><div class="label">Draft roles</div></div>
      <div class="stat-tile"><div class="num">${reports.counts.learningPublished}</div><div class="label">Published learning resources</div></div>
      <div class="stat-tile"><div class="num">${reports.counts.skillsActive}</div><div class="label">Active SFIA skills</div></div>
    </div>
    <div class="grid cols-2">
      <div class="card">
        <h2>Most viewed role profiles</h2>
        ${reports.mostViewedRoles.length === 0 ? '<p class="muted">No views recorded yet.</p>' :
          `<table><tr><th>Role</th><th>Views</th></tr>${reports.mostViewedRoles.map(r => `<tr><td>${escapeHtml(r.title)}</td><td>${r.views}</td></tr>`).join('')}</table>`}
      </div>
      <div class="card">
        <h2>Most compared role profiles</h2>
        ${reports.mostComparedRoles.length === 0 ? '<p class="muted">No comparisons recorded yet.</p>' :
          `<table><tr><th>Role</th><th>Comparisons</th></tr>${reports.mostComparedRoles.map(r => `<tr><td>${escapeHtml(r.title)}</td><td>${r.comparisons}</td></tr>`).join('')}</table>`}
      </div>
      <div class="card">
        <h2>Common aspirational roles</h2>
        ${reports.commonAspirationalRoles.length === 0 ? '<p class="muted">No data yet.</p>' :
          `<table><tr><th>Role</th><th>Times selected</th></tr>${reports.commonAspirationalRoles.map(r => `<tr><td>${escapeHtml(r.title)}</td><td>${r.times_selected}</td></tr>`).join('')}</table>`}
      </div>
      <div class="card">
        <h2>Common role-to-role comparisons</h2>
        ${reports.commonGaps.length === 0 ? '<p class="muted">No data yet.</p>' :
          `<table><tr><th>Current</th><th>Aspirational</th><th>Count</th></tr>${reports.commonGaps.map(g => `<tr><td>${escapeHtml(g.current)}</td><td>${escapeHtml(g.aspirational)}</td><td>${g.count}</td></tr>`).join('')}</table>`}
      </div>
    </div>
  `;
}

// ---------- Role profiles ----------

async function renderRolesTab() {
  const content = document.getElementById('tab-content');
  const roles = await Api.get('/api/admin/role-profiles');
  content.innerHTML = `
    <div class="card">
      <div class="actions-row">
        <button class="btn btn-primary" id="new-role-btn">+ New role profile</button>
      </div>
    </div>
    <div class="card">
      <table>
        <tr><th>Title</th><th>Family</th><th>Status</th><th>Updated</th><th></th></tr>
        ${roles.map(r => `
          <tr>
            <td>${escapeHtml(r.title)}</td>
            <td>${escapeHtml(r.role_family_name || '')}</td>
            <td>${statusBadge(r.status)}</td>
            <td>${formatDateTime(r.updated_at)}</td>
            <td><button class="btn btn-secondary btn-sm" data-edit-role="${r.id}">Edit</button></td>
          </tr>
        `).join('')}
      </table>
      ${roles.length === 0 ? '<div class="empty-state">No role profiles yet.</div>' : ''}
    </div>
  `;
  document.getElementById('new-role-btn').addEventListener('click', () => renderRoleEditor(null));
  content.querySelectorAll('[data-edit-role]').forEach(btn => {
    btn.addEventListener('click', () => renderRoleEditor(btn.dataset.editRole));
  });
}

async function renderRoleEditor(id) {
  const content = document.getElementById('tab-content');
  const role = id ? await Api.get(`/api/admin/role-profiles/${id}`) : null;
  let roleAtAGlance = null;
  let displayTags = [];
  if (role) {
    try { roleAtAGlance = role.role_at_a_glance ? JSON.parse(role.role_at_a_glance) : null; } catch (e) { roleAtAGlance = null; }
    try { displayTags = role.display_tags ? JSON.parse(role.display_tags) : []; } catch (e) { displayTags = []; }
  }

  content.innerHTML = `
    <div class="card">
      <button class="btn btn-secondary btn-sm" id="back-to-roles">&larr; Back to role profiles</button>
      <h2>${role ? 'Edit role profile' : 'New role profile'}</h2>
      ${role ? `<p>${statusBadge(role.status)} <span class="muted">Version ${role.version_number}</span></p>` : ''}
      <div id="role-form-alert"></div>
      <form id="role-form">
        <div class="field"><label for="rf-title">Title</label><input type="text" id="rf-title" required value="${role ? escapeHtml(role.title) : ''}"></div>
        <div class="grid cols-2">
          <div class="field"><label for="rf-family">Role family</label><select id="rf-family">${familyOptions(role?.role_family_id)}</select></div>
          <div class="field"><label for="rf-area">Capability area</label><select id="rf-area">${areaOptions(role?.capability_area_id, role?.role_family_id)}</select></div>
        </div>
        <div class="grid cols-2">
          <div class="field"><label for="rf-seniority">Seniority level</label><input type="text" id="rf-seniority" value="${role ? escapeHtml(role.seniority_level || '') : ''}" placeholder="e.g. Senior"></div>
          <div class="field"><label for="rf-type">Role type</label>
            <select id="rf-type">
              ${['Individual Contributor', 'Management', 'Hybrid'].map(t => `<option ${role?.role_type === t ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="field"><label for="rf-summary">Summary</label><textarea id="rf-summary">${role ? escapeHtml(role.summary || '') : ''}</textarea></div>
        <div class="field"><label for="rf-responsibilities">Responsibilities</label><textarea id="rf-responsibilities">${role ? escapeHtml(role.responsibilities || '') : ''}</textarea></div>
        <div class="grid cols-2">
          <div class="field"><label for="rf-effective">Effective from</label><input type="date" id="rf-effective" value="${role?.effective_from || ''}"></div>
          <div class="field"><label for="rf-review">Review date</label><input type="date" id="rf-review" value="${role?.review_date || ''}"></div>
        </div>
        <h3>Engaging role profile content</h3>
        <p class="muted">Powers the public role profile's hero, at-a-glance cards and progression panel (FRD 8.1).</p>
        <div class="field"><label for="rf-purpose">Purpose statement</label><textarea id="rf-purpose" placeholder="A plain-English sentence explaining why this role exists">${role ? escapeHtml(role.purpose_statement || '') : ''}</textarea></div>
        <div class="grid cols-2">
          <div class="field"><label for="rf-focus">Focus area</label><input type="text" id="rf-focus" placeholder="e.g. Backend feature delivery" value="${role ? escapeHtml(roleAtAGlance?.focusArea || '') : ''}"></div>
          <div class="field"><label for="rf-tags">Display tags (comma separated)</label><input type="text" id="rf-tags" placeholder="e.g. technical, leadership" value="${role ? escapeHtml(displayTags.join(', ')) : ''}"></div>
        </div>
        <div class="field"><label for="rf-outputs">Typical outputs</label><textarea id="rf-outputs">${role ? escapeHtml(role.typical_outputs || '') : ''}</textarea></div>
        <div class="field"><label for="rf-day">A day in the life</label><textarea id="rf-day">${role ? escapeHtml(role.day_in_the_life || '') : ''}</textarea></div>
        <div class="field"><label for="rf-success">What good looks like</label><textarea id="rf-success">${role ? escapeHtml(role.success_indicators || '') : ''}</textarea></div>
        <div class="field"><label for="rf-progression">Progression summary</label><textarea id="rf-progression">${role ? escapeHtml(role.progression_summary || '') : ''}</textarea></div>
        <div class="actions-row">
          <button class="btn btn-primary" type="submit">Save</button>
          ${role && me.canPublish && role.status !== 'published' ? '<button class="btn btn-success" type="button" id="publish-btn">Publish</button>' : ''}
          ${role && me.canPublish && role.status === 'published' ? '<button class="btn btn-secondary" type="button" id="unpublish-btn">Unpublish</button>' : ''}
          ${role && me.canPublish && role.status !== 'archived' ? '<button class="btn btn-danger" type="button" id="archive-btn">Archive</button>' : ''}
        </div>
      </form>
    </div>
    ${role ? renderRoleSkillsSection(role) : '<div class="card"><p class="muted">Save the role profile before mapping SFIA skills.</p></div>'}
  `;

  document.getElementById('back-to-roles').addEventListener('click', renderRolesTab);
  document.getElementById('rf-family').addEventListener('change', () => {
    document.getElementById('rf-area').innerHTML = areaOptions(null, document.getElementById('rf-family').value);
  });

  document.getElementById('role-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const alertBox = document.getElementById('role-form-alert');
    alertBox.innerHTML = '';
    const payload = {
      title: document.getElementById('rf-title').value,
      roleFamilyId: document.getElementById('rf-family').value || null,
      capabilityAreaId: document.getElementById('rf-area').value || null,
      seniorityLevel: document.getElementById('rf-seniority').value,
      roleType: document.getElementById('rf-type').value,
      summary: document.getElementById('rf-summary').value,
      responsibilities: document.getElementById('rf-responsibilities').value,
      effectiveFrom: document.getElementById('rf-effective').value || null,
      reviewDate: document.getElementById('rf-review').value || null,
      purposeStatement: document.getElementById('rf-purpose').value,
      focusArea: document.getElementById('rf-focus').value,
      typicalOutputs: document.getElementById('rf-outputs').value,
      dayInTheLife: document.getElementById('rf-day').value,
      successIndicators: document.getElementById('rf-success').value,
      progressionSummary: document.getElementById('rf-progression').value,
      displayTags: document.getElementById('rf-tags').value.split(',').map(t => t.trim()).filter(Boolean)
    };
    try {
      if (role) {
        await Api.patch(`/api/admin/role-profiles/${role.id}`, payload);
        renderRoleEditor(role.id);
      } else {
        const created = await Api.post('/api/admin/role-profiles', payload);
        renderRoleEditor(created.id);
      }
    } catch (err) {
      alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });

  if (role) {
    document.getElementById('publish-btn')?.addEventListener('click', async () => {
      try { await Api.post(`/api/admin/role-profiles/${role.id}/publish`); renderRoleEditor(role.id); }
      catch (err) { document.getElementById('role-form-alert').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`; }
    });
    document.getElementById('unpublish-btn')?.addEventListener('click', async () => {
      await Api.post(`/api/admin/role-profiles/${role.id}/unpublish`); renderRoleEditor(role.id);
    });
    document.getElementById('archive-btn')?.addEventListener('click', async () => {
      await Api.post(`/api/admin/role-profiles/${role.id}/archive`); renderRoleEditor(role.id);
    });
    bindRoleSkillsSection(role);
  }
}

function renderRoleSkillsSection(role) {
  return `
    <div class="card">
      <h2>SFIA skill mappings</h2>
      <table>
        <tr><th>Skill</th><th>Level</th><th>Importance</th><th>Shown open?</th><th></th></tr>
        ${role.skills.map(s => `
          <tr>
            <td>${escapeHtml(s.skill_code)} - ${escapeHtml(s.skill_name)}</td>
            <td>Level ${s.level_number}</td>
            <td>${importanceBadge(s.importance)}</td>
            <td>${s.show_full_description ? 'Yes' : 'No'}</td>
            <td>
              <button class="btn btn-secondary btn-sm" data-edit-mapping="${s.mapping_id}">Edit</button>
              <button class="btn btn-danger btn-sm" data-remove-skill="${s.mapping_id}">Remove</button>
            </td>
          </tr>
        `).join('')}
      </table>
      ${role.skills.length === 0 ? '<p class="muted">No skills mapped yet.</p>' : ''}
      <h3>Add a skill</h3>
      <div id="add-skill-alert"></div>
      <div class="grid cols-2">
        <div class="field"><label for="as-skill">SFIA skill</label><select id="as-skill">${skillOptions()}</select></div>
        <div class="field"><label for="as-level">Required level</label><select id="as-level">${levelOptions()}</select></div>
      </div>
      <div class="grid cols-2">
        <div class="field"><label for="as-importance">Importance</label>
          <select id="as-importance"><option value="core">Core</option><option value="important" selected>Important</option><option value="optional">Optional</option></select>
        </div>
        <div class="field"><label for="as-rationale">Rationale (optional)</label><input type="text" id="as-rationale"></div>
      </div>
      <div class="field"><label for="as-notes">Role-specific display notes (optional)</label><input type="text" id="as-notes" placeholder="Shown on the public page as 'Why this matters for this role'"></div>
      <div class="field"><label class="checkbox-row"><input type="checkbox" id="as-show-open" style="width:auto;"> Show full SFIA detail expanded by default on the public page</label></div>
      <button class="btn btn-primary btn-sm" id="add-skill-btn" type="button">Add skill</button>
    </div>
  `;
}

function renderMappingEditModal(role, mapping) {
  openModal(`
    <h2>Edit skill mapping</h2>
    <p class="muted">${escapeHtml(mapping.skill_code)} - ${escapeHtml(mapping.skill_name)}</p>
    <div id="edit-mapping-alert"></div>
    <div class="field"><label for="em-level">Required level</label><select id="em-level">${levelOptions(mapping.required_sfia_level_id)}</select></div>
    <div class="field"><label for="em-importance">Importance</label>
      <select id="em-importance">
        ${['core', 'important', 'optional'].map(v => `<option value="${v}" ${mapping.importance === v ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
    </div>
    <div class="field"><label for="em-rationale">Rationale</label><input type="text" id="em-rationale" value="${escapeHtml(mapping.rationale || '')}"></div>
    <div class="field"><label for="em-notes">Role-specific display notes</label><input type="text" id="em-notes" value="${escapeHtml(mapping.role_specific_display_notes || '')}"></div>
    <div class="field"><label class="checkbox-row"><input type="checkbox" id="em-show-open" style="width:auto;" ${mapping.show_full_description ? 'checked' : ''}> Show full SFIA detail expanded by default on the public page</label></div>
    <div class="actions-row">
      <button class="btn btn-primary" id="em-save-btn" type="button">Save</button>
      <button class="btn btn-secondary" id="em-cancel-btn" type="button">Cancel</button>
    </div>
  `);
  document.getElementById('em-cancel-btn').addEventListener('click', closeModal);
  document.getElementById('em-save-btn').addEventListener('click', async () => {
    const alertBox = document.getElementById('edit-mapping-alert');
    alertBox.innerHTML = '';
    try {
      await Api.patch(`/api/admin/role-profiles/${role.id}/skills/${mapping.mapping_id}`, {
        requiredSfiaLevelId: document.getElementById('em-level').value,
        importance: document.getElementById('em-importance').value,
        rationale: document.getElementById('em-rationale').value,
        roleSpecificDisplayNotes: document.getElementById('em-notes').value,
        showFullDescription: document.getElementById('em-show-open').checked
      });
      closeModal();
      renderRoleEditor(role.id);
    } catch (err) {
      alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });
}

function bindRoleSkillsSection(role) {
  document.getElementById('add-skill-btn')?.addEventListener('click', async () => {
    const alertBox = document.getElementById('add-skill-alert');
    alertBox.innerHTML = '';
    try {
      await Api.post(`/api/admin/role-profiles/${role.id}/skills`, {
        sfiaSkillId: document.getElementById('as-skill').value,
        requiredSfiaLevelId: document.getElementById('as-level').value,
        importance: document.getElementById('as-importance').value,
        rationale: document.getElementById('as-rationale').value,
        roleSpecificDisplayNotes: document.getElementById('as-notes').value,
        showFullDescription: document.getElementById('as-show-open').checked
      });
      renderRoleEditor(role.id);
    } catch (err) {
      alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });
  document.querySelectorAll('[data-edit-mapping]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mapping = role.skills.find(s => String(s.mapping_id) === btn.dataset.editMapping);
      if (mapping) renderMappingEditModal(role, mapping);
    });
  });
  document.querySelectorAll('[data-remove-skill]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await Api.delete(`/api/admin/role-profiles/${role.id}/skills/${btn.dataset.removeSkill}`);
        renderRoleEditor(role.id);
      } catch (err) {
        if (err.requiresConfirmation) {
          confirmAction(`${err.message} Remove anyway?`, async () => {
            await Api.delete(`/api/admin/role-profiles/${role.id}/skills/${btn.dataset.removeSkill}`, { confirmRemove: true });
            renderRoleEditor(role.id);
          });
        }
      }
    });
  });
}

// ---------- SFIA skills ----------

async function renderSkillsTab() {
  await loadRefData();
  const content = document.getElementById('tab-content');
  content.innerHTML = `
    <div class="grid cols-2">
      <div class="card">
        <h2>Role families &amp; capability areas</h2>
        <div id="rf-alert"></div>
        <div class="field"><label for="new-family-name">New role family</label>
          <div style="display:flex; gap:0.5rem;"><input type="text" id="new-family-name"><button class="btn btn-secondary btn-sm" id="add-family-btn">Add</button></div>
        </div>
        <table><tr><th>Name</th><th>Status</th></tr>
          ${refData.families.map(f => `<tr><td>${escapeHtml(f.name)}</td><td>${statusBadge(f.status)}</td></tr>`).join('')}
        </table>
        <div class="field" style="margin-top:1rem;"><label for="new-area-family">New capability area - role family</label><select id="new-area-family">${familyOptions()}</select></div>
        <div class="field"><label for="new-area-name">Capability area name</label>
          <div style="display:flex; gap:0.5rem;"><input type="text" id="new-area-name"><button class="btn btn-secondary btn-sm" id="add-area-btn">Add</button></div>
        </div>
      </div>
      <div class="card">
        <h2>SFIA versions &amp; categories</h2>
        <div id="sv-alert"></div>
        <div class="field"><label for="new-version-name">New SFIA version</label>
          <div style="display:flex; gap:0.5rem;"><input type="text" id="new-version-name" placeholder="e.g. SFIA 9"><button class="btn btn-secondary btn-sm" id="add-version-btn">Add</button></div>
        </div>
        <table><tr><th>Version</th><th>Status</th></tr>
          ${refData.versions.map(v => `<tr><td>${escapeHtml(v.version_name)}</td><td>${statusBadge(v.status)}</td></tr>`).join('')}
        </table>
        <div class="field" style="margin-top:1rem;"><label for="new-cat-version">New category - SFIA version</label><select id="new-cat-version">${versionOptions()}</select></div>
        <div class="field"><label for="new-cat-name">Category name</label>
          <div style="display:flex; gap:0.5rem;"><input type="text" id="new-cat-name"><button class="btn btn-secondary btn-sm" id="add-cat-btn">Add</button></div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>SFIA levels</h2>
      <p class="muted">Full responsibility descriptions shown on the public role profile page (FRD FR2A).</p>
      <table>
        <tr><th>Level</th><th>Full description</th><th></th></tr>
        ${refData.levels.map(l => `
          <tr>
            <td>${escapeHtml(levelLabel(l.level_number, l.level_name))}</td>
            <td class="muted">${l.level_full_description ? escapeHtml(l.level_full_description.slice(0, 60)) + (l.level_full_description.length > 60 ? '&hellip;' : '') : 'Not set'}</td>
            <td><button class="btn btn-secondary btn-sm" data-edit-level="${l.id}">Edit</button></td>
          </tr>
        `).join('')}
      </table>
    </div>

    <div class="card">
      <h2>SFIA skills</h2>
      <div class="filters-row">
        <div class="field"><label for="skill-search">Search</label><input type="search" id="skill-search" placeholder="Code or name"></div>
      </div>
      <table id="skills-table">
        <tr><th>Code</th><th>Name</th><th>Category</th><th>Status</th><th></th></tr>
      </table>
      <h3>Add a skill</h3>
      <div id="add-skill-form-alert"></div>
      <div class="grid cols-2">
        <div class="field"><label for="ns-version">SFIA version</label><select id="ns-version">${versionOptions()}</select></div>
        <div class="field"><label for="ns-category">Category</label><select id="ns-category">${categoryOptions()}</select></div>
      </div>
      <div class="grid cols-2">
        <div class="field"><label for="ns-code">Skill code</label><input type="text" id="ns-code"></div>
        <div class="field"><label for="ns-name">Skill name</label><input type="text" id="ns-name"></div>
      </div>
      <div class="field"><label for="ns-desc">Short description</label><textarea id="ns-desc"></textarea></div>
      <div class="field"><label for="ns-full-desc">Full description</label><textarea id="ns-full-desc" placeholder="Full SFIA skill description shown on the public role profile page"></textarea></div>
      <div class="field"><label for="ns-source">Source reference (optional)</label><input type="text" id="ns-source"></div>
      <button class="btn btn-primary btn-sm" id="add-skill-form-btn" type="button">Add skill</button>
    </div>
  `;

  function renderSkillsTable() {
    const search = document.getElementById('skill-search').value.trim().toLowerCase();
    const rows = refData.skills.filter(s => !search || s.skill_code.toLowerCase().includes(search) || s.skill_name.toLowerCase().includes(search));
    document.getElementById('skills-table').innerHTML = `
      <tr><th>Code</th><th>Name</th><th>Category</th><th>Status</th><th></th></tr>
      ${rows.map(s => `
        <tr>
          <td>${escapeHtml(s.skill_code)}</td>
          <td>${escapeHtml(s.skill_name)}</td>
          <td>${escapeHtml(s.category_name || '')}</td>
          <td>${statusBadge(s.status)}</td>
          <td>
            <button class="btn btn-secondary btn-sm" data-edit-skill="${s.id}">Edit</button>
            <button class="btn btn-secondary btn-sm" data-toggle-skill="${s.id}" data-status="${s.status}">${s.status === 'active' ? 'Deactivate' : 'Activate'}</button>
          </td>
        </tr>
      `).join('')}
    `;
    document.querySelectorAll('[data-edit-skill]').forEach(btn => {
      btn.addEventListener('click', () => renderSkillEditor(btn.dataset.editSkill));
    });
    document.querySelectorAll('[data-toggle-skill]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const nextStatus = btn.dataset.status === 'active' ? 'inactive' : 'active';
        try {
          await Api.patch(`/api/admin/sfia-skills/${btn.dataset.toggleSkill}`, { status: nextStatus });
          renderSkillsTab();
        } catch (err) {
          if (err.requiresConfirmation) {
            confirmAction(`${err.message} Confirm?`, async () => {
              await Api.patch(`/api/admin/sfia-skills/${btn.dataset.toggleSkill}`, { status: nextStatus, confirmDeactivate: true });
              renderSkillsTab();
            });
          }
        }
      });
    });
  }
  renderSkillsTable();
  content.querySelectorAll('[data-edit-level]').forEach(btn => {
    btn.addEventListener('click', () => renderLevelEditModal(refData.levels.find(l => String(l.id) === btn.dataset.editLevel)));
  });
  document.getElementById('skill-search').addEventListener('input', debounceAdmin(renderSkillsTable, 200));

  document.getElementById('add-family-btn').addEventListener('click', async () => {
    const name = document.getElementById('new-family-name').value.trim();
    if (!name) return;
    try { await Api.post('/api/admin/role-families', { name }); renderSkillsTab(); }
    catch (err) { document.getElementById('rf-alert').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`; }
  });
  document.getElementById('add-area-btn').addEventListener('click', async () => {
    const name = document.getElementById('new-area-name').value.trim();
    const roleFamilyId = document.getElementById('new-area-family').value;
    if (!name || !roleFamilyId) return;
    try { await Api.post('/api/admin/capability-areas', { roleFamilyId, name }); renderSkillsTab(); }
    catch (err) { document.getElementById('rf-alert').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`; }
  });
  document.getElementById('add-version-btn').addEventListener('click', async () => {
    const versionName = document.getElementById('new-version-name').value.trim();
    if (!versionName) return;
    try { await Api.post('/api/admin/sfia-versions', { versionName }); renderSkillsTab(); }
    catch (err) { document.getElementById('sv-alert').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`; }
  });
  document.getElementById('add-cat-btn').addEventListener('click', async () => {
    const name = document.getElementById('new-cat-name').value.trim();
    const sfiaVersionId = document.getElementById('new-cat-version').value;
    if (!name || !sfiaVersionId) return;
    try { await Api.post('/api/admin/sfia-categories', { sfiaVersionId, name }); renderSkillsTab(); }
    catch (err) { document.getElementById('sv-alert').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`; }
  });
  document.getElementById('ns-version').addEventListener('change', () => {
    document.getElementById('ns-category').innerHTML = categoryOptions(null, document.getElementById('ns-version').value);
  });
  document.getElementById('add-skill-form-btn').addEventListener('click', async () => {
    const alertBox = document.getElementById('add-skill-form-alert');
    alertBox.innerHTML = '';
    try {
      await Api.post('/api/admin/sfia-skills', {
        sfiaVersionId: document.getElementById('ns-version').value,
        sfiaCategoryId: document.getElementById('ns-category').value || null,
        skillCode: document.getElementById('ns-code').value,
        skillName: document.getElementById('ns-name').value,
        shortDescription: document.getElementById('ns-desc').value,
        fullDescription: document.getElementById('ns-full-desc').value,
        sourceReference: document.getElementById('ns-source').value
      });
      renderSkillsTab();
    } catch (err) {
      alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });
}

function renderLevelEditModal(level) {
  openModal(`
    <h2>Edit ${escapeHtml(levelLabel(level.level_number, level.level_name))}</h2>
    <div id="level-edit-alert"></div>
    <div class="field"><label for="lv-name">Level name</label><input type="text" id="lv-name" value="${escapeHtml(level.level_name)}"></div>
    <div class="field"><label for="lv-desc">Short description</label><textarea id="lv-desc">${escapeHtml(level.description || '')}</textarea></div>
    <div class="field"><label for="lv-full">Full responsibility description</label><textarea id="lv-full">${escapeHtml(level.level_full_description || '')}</textarea></div>
    <div class="field"><label for="lv-source">Source reference</label><input type="text" id="lv-source" value="${escapeHtml(level.source_reference || '')}"></div>
    <div class="actions-row">
      <button class="btn btn-primary" id="lv-save-btn" type="button">Save</button>
      <button class="btn btn-secondary" id="lv-cancel-btn" type="button">Cancel</button>
    </div>
  `);
  document.getElementById('lv-cancel-btn').addEventListener('click', closeModal);
  document.getElementById('lv-save-btn').addEventListener('click', async () => {
    const alertBox = document.getElementById('level-edit-alert');
    alertBox.innerHTML = '';
    try {
      await Api.patch(`/api/admin/sfia-levels/${level.id}`, {
        levelName: document.getElementById('lv-name').value,
        description: document.getElementById('lv-desc').value,
        levelFullDescription: document.getElementById('lv-full').value,
        sourceReference: document.getElementById('lv-source').value
      });
      closeModal();
      renderSkillsTab();
    } catch (err) {
      alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });
}

async function renderSkillEditor(id) {
  const content = document.getElementById('tab-content');
  const skill = refData.skills.find(s => String(s.id) === String(id));
  const levelDescriptions = await Api.get(`/api/admin/sfia-skill-level-descriptions?sfiaSkillId=${id}`);

  content.innerHTML = `
    <div class="card">
      <button class="btn btn-secondary btn-sm" id="back-to-skills">&larr; Back to SFIA skills</button>
      <h2>Edit SFIA skill</h2>
      <p>${escapeHtml(skill.skill_code)} ${statusBadge(skill.status)}</p>
      <div id="skill-form-alert"></div>
      <form id="skill-form">
        <div class="grid cols-2">
          <div class="field"><label for="sk-category">Category</label><select id="sk-category">${categoryOptions(skill.sfia_category_id, skill.sfia_version_id)}</select></div>
          <div class="field"><label for="sk-status">Status</label>
            <select id="sk-status"><option value="active" ${skill.status === 'active' ? 'selected' : ''}>Active</option><option value="inactive" ${skill.status === 'inactive' ? 'selected' : ''}>Inactive</option></select>
          </div>
        </div>
        <div class="field"><label for="sk-name">Skill name</label><input type="text" id="sk-name" value="${escapeHtml(skill.skill_name)}"></div>
        <div class="field"><label for="sk-short">Short description</label><textarea id="sk-short">${escapeHtml(skill.short_description || '')}</textarea></div>
        <div class="field"><label for="sk-full">Full description</label><textarea id="sk-full">${escapeHtml(skill.full_description || '')}</textarea></div>
        <div class="field"><label for="sk-source">Source reference</label><input type="text" id="sk-source" value="${escapeHtml(skill.source_reference || '')}"></div>
        <div class="actions-row"><button class="btn btn-primary" type="submit">Save</button></div>
      </form>
    </div>

    <div class="card">
      <h2>Skill-at-level descriptions</h2>
      <p class="muted">The exact wording shown on the public role profile page for this skill at a specific SFIA level (FRD: SFIA Skill Level Description).</p>
      <table>
        <tr><th>Level</th><th>Description</th><th>Status</th><th></th></tr>
        ${levelDescriptions.map(d => `
          <tr>
            <td>Level ${d.level_number}</td>
            <td class="muted">${escapeHtml(d.skill_level_description.slice(0, 60))}${d.skill_level_description.length > 60 ? '&hellip;' : ''}</td>
            <td>${statusBadge(d.status)}</td>
            <td><button class="btn btn-secondary btn-sm" data-edit-skill-level="${d.id}">Edit</button></td>
          </tr>
        `).join('')}
      </table>
      ${levelDescriptions.length === 0 ? '<p class="muted">No level descriptions yet.</p>' : ''}
      <h3>Add a level description</h3>
      <div id="add-skill-level-alert"></div>
      <div class="field"><label for="sld-level">SFIA level</label><select id="sld-level">${levelOptions()}</select></div>
      <div class="field"><label for="sld-desc">Skill-at-level description</label><textarea id="sld-desc"></textarea></div>
      <div class="field"><label for="sld-guidance">Guidance notes (optional)</label><input type="text" id="sld-guidance"></div>
      <div class="field"><label for="sld-source">Source reference (optional)</label><input type="text" id="sld-source"></div>
      <button class="btn btn-primary btn-sm" id="add-skill-level-btn" type="button">Add description</button>
    </div>
  `;

  document.getElementById('back-to-skills').addEventListener('click', renderSkillsTab);
  document.getElementById('skill-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const alertBox = document.getElementById('skill-form-alert');
    alertBox.innerHTML = '';
    try {
      await Api.patch(`/api/admin/sfia-skills/${skill.id}`, {
        sfiaCategoryId: document.getElementById('sk-category').value || null,
        skillName: document.getElementById('sk-name').value,
        shortDescription: document.getElementById('sk-short').value,
        fullDescription: document.getElementById('sk-full').value,
        sourceReference: document.getElementById('sk-source').value,
        status: document.getElementById('sk-status').value
      });
      await loadRefData();
      renderSkillEditor(skill.id);
    } catch (err) {
      if (err.requiresConfirmation) {
        confirmAction(`${err.message} Confirm?`, async () => {
          await Api.patch(`/api/admin/sfia-skills/${skill.id}`, { status: document.getElementById('sk-status').value, confirmDeactivate: true });
          await loadRefData();
          renderSkillEditor(skill.id);
        });
      } else {
        alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
      }
    }
  });

  document.getElementById('add-skill-level-btn').addEventListener('click', async () => {
    const alertBox = document.getElementById('add-skill-level-alert');
    alertBox.innerHTML = '';
    try {
      await Api.post('/api/admin/sfia-skill-level-descriptions', {
        sfiaVersionId: skill.sfia_version_id,
        sfiaSkillId: skill.id,
        sfiaLevelId: document.getElementById('sld-level').value,
        skillLevelDescription: document.getElementById('sld-desc').value,
        guidanceNotes: document.getElementById('sld-guidance').value,
        sourceReference: document.getElementById('sld-source').value
      });
      renderSkillEditor(skill.id);
    } catch (err) {
      alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });

  content.querySelectorAll('[data-edit-skill-level]').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = levelDescriptions.find(x => String(x.id) === btn.dataset.editSkillLevel);
      if (d) renderSkillLevelDescriptionEditModal(skill, d);
    });
  });
}

function renderSkillLevelDescriptionEditModal(skill, d) {
  openModal(`
    <h2>Edit level ${d.level_number} description</h2>
    <p class="muted">${escapeHtml(skill.skill_code)} - ${escapeHtml(skill.skill_name)}</p>
    <div id="sld-edit-alert"></div>
    <div class="field"><label for="sld-e-desc">Skill-at-level description</label><textarea id="sld-e-desc">${escapeHtml(d.skill_level_description)}</textarea></div>
    <div class="field"><label for="sld-e-guidance">Guidance notes</label><input type="text" id="sld-e-guidance" value="${escapeHtml(d.guidance_notes || '')}"></div>
    <div class="field"><label for="sld-e-source">Source reference</label><input type="text" id="sld-e-source" value="${escapeHtml(d.source_reference || '')}"></div>
    <div class="field"><label for="sld-e-status">Status</label>
      <select id="sld-e-status"><option value="active" ${d.status === 'active' ? 'selected' : ''}>Active</option><option value="inactive" ${d.status === 'inactive' ? 'selected' : ''}>Inactive</option></select>
    </div>
    <div class="actions-row">
      <button class="btn btn-primary" id="sld-e-save-btn" type="button">Save</button>
      <button class="btn btn-secondary" id="sld-e-cancel-btn" type="button">Cancel</button>
    </div>
  `);
  document.getElementById('sld-e-cancel-btn').addEventListener('click', closeModal);
  document.getElementById('sld-e-save-btn').addEventListener('click', async () => {
    const alertBox = document.getElementById('sld-edit-alert');
    alertBox.innerHTML = '';
    try {
      await Api.patch(`/api/admin/sfia-skill-level-descriptions/${d.id}`, {
        skillLevelDescription: document.getElementById('sld-e-desc').value,
        guidanceNotes: document.getElementById('sld-e-guidance').value,
        sourceReference: document.getElementById('sld-e-source').value,
        status: document.getElementById('sld-e-status').value
      });
      closeModal();
      renderSkillEditor(skill.id);
    } catch (err) {
      alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });
}

// ---------- Learning resources ----------

async function renderLearningTab() {
  await loadRefData();
  const content = document.getElementById('tab-content');
  const resources = await Api.get('/api/admin/learning-resources');
  content.innerHTML = `
    <div class="card">
      <div class="actions-row"><button class="btn btn-primary" id="new-resource-btn">+ New learning resource</button></div>
    </div>
    <div class="card">
      <table>
        <tr><th>Title</th><th>Type</th><th>Status</th><th>Updated</th><th></th></tr>
        ${resources.map(r => `
          <tr>
            <td>${escapeHtml(r.title)}</td>
            <td>${escapeHtml(r.resource_type)}</td>
            <td>${statusBadge(r.status)}</td>
            <td>${formatDateTime(r.updated_at)}</td>
            <td><button class="btn btn-secondary btn-sm" data-edit-resource="${r.id}">Edit</button></td>
          </tr>
        `).join('')}
      </table>
      ${resources.length === 0 ? '<div class="empty-state">No learning resources yet.</div>' : ''}
    </div>
  `;
  document.getElementById('new-resource-btn').addEventListener('click', () => renderResourceEditor(null));
  content.querySelectorAll('[data-edit-resource]').forEach(btn => {
    btn.addEventListener('click', () => renderResourceEditor(btn.dataset.editResource));
  });
}

async function renderResourceEditor(id) {
  const content = document.getElementById('tab-content');
  const resource = id ? await Api.get(`/api/admin/learning-resources/${id}`) : null;
  const resourceTypes = ['course', 'certification', 'article', 'book', 'video', 'workshop', 'mentoring', 'stretch_assignment', 'project_experience', 'communities_of_practice', 'coaching', 'shadowing', 'internal_academy'];

  content.innerHTML = `
    <div class="card">
      <button class="btn btn-secondary btn-sm" id="back-to-resources">&larr; Back to learning resources</button>
      <h2>${resource ? 'Edit learning resource' : 'New learning resource'}</h2>
      ${resource ? `<p>${statusBadge(resource.status)}</p>` : ''}
      <div id="resource-form-alert"></div>
      <form id="resource-form">
        <div class="field"><label for="lr-title">Title</label><input type="text" id="lr-title" required value="${resource ? escapeHtml(resource.title) : ''}"></div>
        <div class="field"><label for="lr-desc">Description</label><textarea id="lr-desc">${resource ? escapeHtml(resource.description || '') : ''}</textarea></div>
        <div class="grid cols-2">
          <div class="field"><label for="lr-provider">Provider</label><input type="text" id="lr-provider" value="${resource ? escapeHtml(resource.provider || '') : ''}"></div>
          <div class="field"><label for="lr-url">URL</label><input type="url" id="lr-url" value="${resource ? escapeHtml(resource.url || '') : ''}"></div>
        </div>
        <div class="grid cols-2">
          <div class="field"><label for="lr-type">Resource type</label>
            <select id="lr-type">${resourceTypes.map(t => `<option value="${t}" ${resource?.resource_type === t ? 'selected' : ''}>${t.replace(/_/g, ' ')}</option>`).join('')}</select>
          </div>
          <div class="field"><label for="lr-cost">Cost type</label>
            <select id="lr-cost">${['free', 'paid', 'internal'].map(t => `<option value="${t}" ${resource?.cost_type === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
          </div>
        </div>
        <div class="grid cols-2">
          <div class="field"><label for="lr-delivery">Delivery method</label><input type="text" id="lr-delivery" value="${resource ? escapeHtml(resource.delivery_method || '') : ''}" placeholder="online, classroom, blended, project-based"></div>
          <div class="field"><label for="lr-duration">Estimated duration</label><input type="text" id="lr-duration" value="${resource ? escapeHtml(resource.estimated_duration || '') : ''}" placeholder="e.g. 2 hours"></div>
        </div>
        <div class="field"><label for="lr-review">Review date</label><input type="date" id="lr-review" value="${resource?.review_date || ''}"></div>
        <div class="actions-row">
          <button class="btn btn-primary" type="submit">Save</button>
          ${resource && me.canPublish && resource.status !== 'published' ? '<button class="btn btn-success" type="button" id="publish-resource-btn">Publish</button>' : ''}
          ${resource && me.canPublish && resource.status !== 'archived' ? '<button class="btn btn-danger" type="button" id="archive-resource-btn">Archive</button>' : ''}
        </div>
      </form>
    </div>
    ${resource ? renderResourceSkillsSection(resource) : '<div class="card"><p class="muted">Save the learning resource before mapping SFIA skills.</p></div>'}
  `;

  document.getElementById('back-to-resources').addEventListener('click', renderLearningTab);
  document.getElementById('resource-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const alertBox = document.getElementById('resource-form-alert');
    alertBox.innerHTML = '';
    const payload = {
      title: document.getElementById('lr-title').value,
      description: document.getElementById('lr-desc').value,
      provider: document.getElementById('lr-provider').value,
      url: document.getElementById('lr-url').value,
      resourceType: document.getElementById('lr-type').value,
      costType: document.getElementById('lr-cost').value,
      deliveryMethod: document.getElementById('lr-delivery').value,
      estimatedDuration: document.getElementById('lr-duration').value,
      reviewDate: document.getElementById('lr-review').value || null
    };
    try {
      if (resource) {
        await Api.patch(`/api/admin/learning-resources/${resource.id}`, payload);
        renderResourceEditor(resource.id);
      } else {
        const created = await Api.post('/api/admin/learning-resources', payload);
        renderResourceEditor(created.id);
      }
    } catch (err) {
      alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });

  if (resource) {
    document.getElementById('publish-resource-btn')?.addEventListener('click', async () => {
      await Api.post(`/api/admin/learning-resources/${resource.id}/publish`); renderResourceEditor(resource.id);
    });
    document.getElementById('archive-resource-btn')?.addEventListener('click', async () => {
      await Api.post(`/api/admin/learning-resources/${resource.id}/archive`); renderResourceEditor(resource.id);
    });
    bindResourceSkillsSection(resource);
  }
}

function renderResourceSkillsSection(resource) {
  return `
    <div class="card">
      <h2>SFIA skill mappings</h2>
      <table>
        <tr><th>Skill</th><th>Level range</th><th>Gap type</th><th>Priority</th><th></th></tr>
        ${resource.mappings.map(m => `
          <tr>
            <td>${escapeHtml(m.skill_code)} - ${escapeHtml(m.skill_name)}</td>
            <td>${m.min_level_number ? 'Level ' + m.min_level_number : 'Any'} &ndash; ${m.max_level_number ? 'Level ' + m.max_level_number : 'Any'}</td>
            <td>${escapeHtml(m.gap_type || 'Any')}</td>
            <td><span class="badge" data-priority="${escapeHtml(m.priority)}">${escapeHtml(m.priority)}</span></td>
            <td><button class="btn btn-danger btn-sm" data-remove-mapping="${m.id}">Remove</button></td>
          </tr>
        `).join('')}
      </table>
      ${resource.mappings.length === 0 ? '<p class="muted">No skills mapped yet.</p>' : ''}
      <h3>Add a skill mapping</h3>
      <div id="add-mapping-alert"></div>
      <div class="grid cols-2">
        <div class="field"><label for="am-skill">SFIA skill</label><select id="am-skill">${skillOptions()}</select></div>
        <div class="field"><label for="am-priority">Priority</label>
          <select id="am-priority"><option value="high">High</option><option value="medium" selected>Medium</option><option value="low">Low</option></select>
        </div>
      </div>
      <div class="grid cols-2">
        <div class="field"><label for="am-min">Min level (optional)</label><select id="am-min"><option value="">Any</option>${levelOptions()}</select></div>
        <div class="field"><label for="am-max">Max level (optional)</label><select id="am-max"><option value="">Any</option>${levelOptions()}</select></div>
      </div>
      <div class="field"><label for="am-gaptype">Gap type (optional)</label>
        <select id="am-gaptype"><option value="">Any</option><option value="new_skill">New skill</option><option value="level_uplift">Level uplift</option><option value="evidence_required">Evidence required</option></select>
      </div>
      <button class="btn btn-primary btn-sm" id="add-mapping-btn" type="button">Add mapping</button>
    </div>
  `;
}

function bindResourceSkillsSection(resource) {
  document.getElementById('add-mapping-btn')?.addEventListener('click', async () => {
    const alertBox = document.getElementById('add-mapping-alert');
    alertBox.innerHTML = '';
    try {
      await Api.post(`/api/admin/learning-resources/${resource.id}/skills`, {
        sfiaSkillId: document.getElementById('am-skill').value,
        minSfiaLevelId: document.getElementById('am-min').value || null,
        maxSfiaLevelId: document.getElementById('am-max').value || null,
        gapType: document.getElementById('am-gaptype').value || null,
        priority: document.getElementById('am-priority').value
      });
      renderResourceEditor(resource.id);
    } catch (err) {
      alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });
  document.querySelectorAll('[data-remove-mapping]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await Api.delete(`/api/admin/learning-resources/${resource.id}/skills/${btn.dataset.removeMapping}`);
      renderResourceEditor(resource.id);
    });
  });
}

// ---------- Career pathways ----------

async function renderPathwaysTab() {
  await loadRefData();
  const content = document.getElementById('tab-content');
  const pathways = await Api.get('/api/admin/career-pathways');
  content.innerHTML = `
    <div class="card">
      <div class="actions-row"><button class="btn btn-primary" id="new-pathway-btn">+ New career pathway</button></div>
    </div>
    <div class="card">
      <table>
        <tr><th>Name</th><th>Type</th><th>Status</th><th>Updated</th><th></th></tr>
        ${pathways.map(p => `
          <tr>
            <td>${escapeHtml(p.pathway_name)}</td>
            <td>${escapeHtml(p.pathway_type)}</td>
            <td>${statusBadge(p.status)}</td>
            <td>${formatDateTime(p.updated_at)}</td>
            <td><button class="btn btn-secondary btn-sm" data-edit-pathway="${p.id}">Edit</button></td>
          </tr>
        `).join('')}
      </table>
      ${pathways.length === 0 ? '<div class="empty-state">No career pathways yet.</div>' : ''}
    </div>
  `;
  document.getElementById('new-pathway-btn').addEventListener('click', () => renderPathwayEditor(null));
  content.querySelectorAll('[data-edit-pathway]').forEach(btn => {
    btn.addEventListener('click', () => renderPathwayEditor(btn.dataset.editPathway));
  });
}

async function renderPathwayEditor(id) {
  const content = document.getElementById('tab-content');
  const pathway = id ? await Api.get(`/api/admin/career-pathways/${id}`) : null;
  const pathwayTypes = ['IC', 'Management', 'Architecture', 'Specialist', 'Hybrid'];

  content.innerHTML = `
    <div class="card">
      <button class="btn btn-secondary btn-sm" id="back-to-pathways">&larr; Back to career pathways</button>
      <h2>${pathway ? 'Edit career pathway' : 'New career pathway'}</h2>
      ${pathway ? `<p>${statusBadge(pathway.status)}</p>` : ''}
      <div id="pathway-form-alert"></div>
      <form id="pathway-form">
        <div class="field"><label for="cp-name">Pathway name</label><input type="text" id="cp-name" required value="${pathway ? escapeHtml(pathway.pathway_name) : ''}"></div>
        <div class="field"><label for="cp-desc">Description</label><textarea id="cp-desc">${pathway ? escapeHtml(pathway.pathway_description || '') : ''}</textarea></div>
        <div class="grid cols-2">
          <div class="field"><label for="cp-family">Role family</label><select id="cp-family">${familyOptions(pathway?.role_family_id)}</select></div>
          <div class="field"><label for="cp-type">Pathway type</label>
            <select id="cp-type">${pathwayTypes.map(t => `<option value="${t}" ${pathway?.pathway_type === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
          </div>
        </div>
        <div class="field"><label for="cp-review">Review date</label><input type="date" id="cp-review" value="${pathway?.review_date || ''}"></div>
        <div class="actions-row">
          <button class="btn btn-primary" type="submit">Save</button>
          ${pathway && me.canPublish && pathway.status !== 'published' ? '<button class="btn btn-success" type="button" id="publish-pathway-btn">Publish</button>' : ''}
          ${pathway && me.canPublish && pathway.status === 'published' ? '<button class="btn btn-secondary" type="button" id="unpublish-pathway-btn">Unpublish</button>' : ''}
          ${pathway && me.canPublish && pathway.status !== 'archived' ? '<button class="btn btn-danger" type="button" id="archive-pathway-btn">Archive</button>' : ''}
        </div>
      </form>
    </div>
    ${pathway ? renderPathwayRolesSection(pathway) + renderPathwayConnectionsSection(pathway) : '<div class="card"><p class="muted">Save the pathway before adding roles and connections.</p></div>'}
  `;

  document.getElementById('back-to-pathways').addEventListener('click', renderPathwaysTab);
  document.getElementById('pathway-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const alertBox = document.getElementById('pathway-form-alert');
    alertBox.innerHTML = '';
    const payload = {
      pathwayName: document.getElementById('cp-name').value,
      pathwayDescription: document.getElementById('cp-desc').value,
      roleFamilyId: document.getElementById('cp-family').value || null,
      pathwayType: document.getElementById('cp-type').value,
      reviewDate: document.getElementById('cp-review').value || null
    };
    try {
      if (pathway) {
        await Api.patch(`/api/admin/career-pathways/${pathway.id}`, payload);
        renderPathwayEditor(pathway.id);
      } else {
        const created = await Api.post('/api/admin/career-pathways', payload);
        renderPathwayEditor(created.id);
      }
    } catch (err) {
      alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });

  if (pathway) {
    document.getElementById('publish-pathway-btn')?.addEventListener('click', async () => {
      try { await Api.post(`/api/admin/career-pathways/${pathway.id}/publish`); renderPathwayEditor(pathway.id); }
      catch (err) { document.getElementById('pathway-form-alert').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`; }
    });
    document.getElementById('unpublish-pathway-btn')?.addEventListener('click', async () => {
      await Api.post(`/api/admin/career-pathways/${pathway.id}/unpublish`); renderPathwayEditor(pathway.id);
    });
    document.getElementById('archive-pathway-btn')?.addEventListener('click', async () => {
      await Api.post(`/api/admin/career-pathways/${pathway.id}/archive`); renderPathwayEditor(pathway.id);
    });
    bindPathwayRolesSection(pathway);
    bindPathwayConnectionsSection(pathway);
  }
}

function renderPathwayRolesSection(pathway) {
  return `
    <div class="card">
      <h2>Roles in this pathway</h2>
      <table>
        <tr><th>Stage</th><th>Role</th><th>Label</th><th>Start / end</th><th></th></tr>
        ${pathway.roles.map(r => `
          <tr>
            <td>${r.pathway_stage}</td>
            <td>${escapeHtml(r.role_title)}</td>
            <td class="muted">${escapeHtml(r.display_label || '')}</td>
            <td>${r.is_starting_role ? 'Start' : ''}${r.is_starting_role && r.is_end_role ? ' / ' : ''}${r.is_end_role ? 'End' : ''}</td>
            <td><button class="btn btn-danger btn-sm" data-remove-pathway-role="${r.pathway_role_id}">Remove</button></td>
          </tr>
        `).join('')}
      </table>
      ${pathway.roles.length === 0 ? '<p class="muted">No roles added yet.</p>' : ''}
      <h3>Add a role</h3>
      <div id="add-pathway-role-alert"></div>
      <div class="grid cols-2">
        <div class="field"><label for="apr-role">Role profile</label><select id="apr-role">${roleProfileOptions()}</select></div>
        <div class="field"><label for="apr-stage">Pathway stage</label><input type="number" id="apr-stage" min="1" value="1"></div>
      </div>
      <div class="field"><label for="apr-label">Display label (optional)</label><input type="text" id="apr-label" placeholder="e.g. Alternative data-focused branch"></div>
      <div class="grid cols-2">
        <div class="field"><label class="checkbox-row"><input type="checkbox" id="apr-start" style="width:auto;"> Starting role</label></div>
        <div class="field"><label class="checkbox-row"><input type="checkbox" id="apr-end" style="width:auto;"> End role</label></div>
      </div>
      <button class="btn btn-primary btn-sm" id="add-pathway-role-btn" type="button">Add role</button>
    </div>
  `;
}

function bindPathwayRolesSection(pathway) {
  document.getElementById('add-pathway-role-btn')?.addEventListener('click', async () => {
    const alertBox = document.getElementById('add-pathway-role-alert');
    alertBox.innerHTML = '';
    try {
      await Api.post(`/api/admin/career-pathways/${pathway.id}/roles`, {
        roleProfileId: document.getElementById('apr-role').value,
        pathwayStage: Number(document.getElementById('apr-stage').value) || 1,
        displayLabel: document.getElementById('apr-label').value,
        isStartingRole: document.getElementById('apr-start').checked,
        isEndRole: document.getElementById('apr-end').checked
      });
      renderPathwayEditor(pathway.id);
    } catch (err) {
      alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });
  document.querySelectorAll('[data-remove-pathway-role]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await Api.delete(`/api/admin/career-pathways/${pathway.id}/roles/${btn.dataset.removePathwayRole}`);
      renderPathwayEditor(pathway.id);
    });
  });
}

function renderPathwayConnectionsSection(pathway) {
  const connectionTypes = ['progression', 'lateral', 'specialisation', 'management', 'architecture', 'stretch', 'alternative'];
  return `
    <div class="card">
      <h2>Connections between roles</h2>
      <table>
        <tr><th>From</th><th>To</th><th>Type</th><th></th></tr>
        ${pathway.connections.map(c => `
          <tr>
            <td>${escapeHtml(c.from_title)}</td>
            <td>${escapeHtml(c.to_title)}</td>
            <td>${escapeHtml(c.connection_type)}</td>
            <td><button class="btn btn-danger btn-sm" data-remove-connection="${c.id}">Remove</button></td>
          </tr>
        `).join('')}
      </table>
      ${pathway.connections.length === 0 ? '<p class="muted">No connections added yet.</p>' : ''}
      <h3>Add a connection</h3>
      <div id="add-connection-alert"></div>
      <div class="grid cols-2">
        <div class="field"><label for="ac-from">From role</label><select id="ac-from">${roleProfileOptions()}</select></div>
        <div class="field"><label for="ac-to">To role</label><select id="ac-to">${roleProfileOptions()}</select></div>
      </div>
      <div class="field"><label for="ac-type">Connection type</label>
        <select id="ac-type">${connectionTypes.map(t => `<option value="${t}">${t}</option>`).join('')}</select>
      </div>
      <div class="field"><label for="ac-desc">Description (optional)</label><input type="text" id="ac-desc"></div>
      <button class="btn btn-primary btn-sm" id="add-connection-btn" type="button">Add connection</button>
    </div>
  `;
}

function bindPathwayConnectionsSection(pathway) {
  document.getElementById('add-connection-btn')?.addEventListener('click', async () => {
    const alertBox = document.getElementById('add-connection-alert');
    alertBox.innerHTML = '';
    try {
      await Api.post(`/api/admin/career-pathways/${pathway.id}/connections`, {
        fromRoleProfileId: document.getElementById('ac-from').value,
        toRoleProfileId: document.getElementById('ac-to').value,
        connectionType: document.getElementById('ac-type').value,
        connectionDescription: document.getElementById('ac-desc').value
      });
      renderPathwayEditor(pathway.id);
    } catch (err) {
      alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });
  document.querySelectorAll('[data-remove-connection]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await Api.delete(`/api/admin/career-pathways/${pathway.id}/connections/${btn.dataset.removeConnection}`);
      renderPathwayEditor(pathway.id);
    });
  });
}

// ---------- Content review ----------

async function renderReviewTab() {
  const content = document.getElementById('tab-content');
  const review = await Api.get('/api/admin/content-review');

  function bucketTable(bucket, label) {
    return `
      <h3>${label}</h3>
      ${bucket.length === 0 ? '<p class="muted">None.</p>' : `<table><tr><th>Title</th><th>Status</th><th>Review date</th></tr>${bucket.map(i => `<tr><td>${escapeHtml(i.title)}</td><td>${statusBadge(i.status)}</td><td>${i.review_date ? formatDate(i.review_date) : '&mdash;'}</td></tr>`).join('')}</table>`}
    `;
  }

  content.innerHTML = `
    <div class="grid cols-2">
      <div class="card">
        <h2>Role profiles</h2>
        ${bucketTable(review.roleProfiles.overdue, 'Overdue')}
        ${bucketTable(review.roleProfiles.dueSoon, 'Due within 30 days')}
        ${bucketTable(review.roleProfiles.noReviewDate, 'No review date set')}
      </div>
      <div class="card">
        <h2>Learning resources</h2>
        ${bucketTable(review.learningResources.overdue, 'Overdue')}
        ${bucketTable(review.learningResources.dueSoon, 'Due within 30 days')}
        ${bucketTable(review.learningResources.noReviewDate, 'No review date set')}
      </div>
    </div>
  `;
}

// ---------- Audit log ----------

async function renderAuditTab() {
  const content = document.getElementById('tab-content');
  content.innerHTML = `
    <div class="card">
      <div class="filters-row">
        <div class="field"><label for="audit-action">Action</label><input type="text" id="audit-action" placeholder="e.g. publish"></div>
        <div class="field"><label for="audit-entity">Entity type</label><input type="text" id="audit-entity" placeholder="e.g. role_profile"></div>
        <div class="field" style="flex:0;"><button class="btn btn-secondary" id="audit-filter-btn" type="button">Filter</button></div>
      </div>
      <ul class="audit-list" id="audit-list"></ul>
    </div>
  `;

  async function loadAudit() {
    const params = new URLSearchParams();
    const action = document.getElementById('audit-action').value.trim();
    const entityType = document.getElementById('audit-entity').value.trim();
    if (action) params.set('action', action);
    if (entityType) params.set('entityType', entityType);
    const rows = await Api.get(`/api/admin/audit-log?${params.toString()}`);
    const list = document.getElementById('audit-list');
    if (rows.length === 0) {
      list.innerHTML = '<li class="empty-state">No audit records match.</li>';
      return;
    }
    list.innerHTML = rows.map(r => `
      <li>
        <strong>${escapeHtml(r.action)}</strong>
        ${r.entity_type ? `on ${escapeHtml(r.entity_type)}${r.entity_id ? ' #' + r.entity_id : ''}` : ''}
        ${r.first_name ? `by ${escapeHtml(r.first_name)} ${escapeHtml(r.last_name)}` : ''}
        <div class="when">${formatDateTime(r.created_at)}</div>
      </li>
    `).join('');
  }

  document.getElementById('audit-filter-btn').addEventListener('click', loadAudit);
  await loadAudit();
}

// ---------- Admin users ----------

async function renderUsersTab() {
  await loadRefData();
  const content = document.getElementById('tab-content');
  const users = await Api.get('/api/admin/users');
  content.innerHTML = `
    <div class="card">
      <h2>Add an admin user</h2>
      <div id="user-form-alert"></div>
      <div class="grid cols-2">
        <div class="field"><label for="nu-first">First name</label><input type="text" id="nu-first"></div>
        <div class="field"><label for="nu-last">Last name</label><input type="text" id="nu-last"></div>
      </div>
      <div class="grid cols-2">
        <div class="field"><label for="nu-email">Email</label><input type="email" id="nu-email"></div>
        <div class="field"><label for="nu-password">Password</label><input type="password" id="nu-password"></div>
      </div>
      <div class="field"><label for="nu-role">Admin role</label>
        <select id="nu-role">${refData.adminRoles.map(r => `<option value="${r.id}">${escapeHtml(r.role_name)}</option>`).join('')}</select>
      </div>
      <button class="btn btn-primary btn-sm" id="add-user-btn" type="button">Add user</button>
    </div>
    <div class="card">
      <table>
        <tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last login</th></tr>
        ${users.map(u => `
          <tr>
            <td>${escapeHtml(u.first_name)} ${escapeHtml(u.last_name)}</td>
            <td>${escapeHtml(u.email)}</td>
            <td>
              <select data-role-for="${u.id}">
                ${refData.adminRoles.map(r => `<option value="${r.id}" ${u.roles.some(ur => ur.id === r.id) ? 'selected' : ''}>${escapeHtml(r.role_name)}</option>`).join('')}
              </select>
            </td>
            <td>
              <select data-status-for="${u.id}">
                ${['active', 'suspended'].map(s => `<option value="${s}" ${u.account_status === s ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
            </td>
            <td>${u.last_login_at ? formatDateTime(u.last_login_at) : 'Never'}</td>
          </tr>
        `).join('')}
      </table>
    </div>
  `;

  document.getElementById('add-user-btn').addEventListener('click', async () => {
    const alertBox = document.getElementById('user-form-alert');
    alertBox.innerHTML = '';
    try {
      await Api.post('/api/admin/users', {
        firstName: document.getElementById('nu-first').value,
        lastName: document.getElementById('nu-last').value,
        email: document.getElementById('nu-email').value,
        password: document.getElementById('nu-password').value,
        adminRoleId: document.getElementById('nu-role').value
      });
      renderUsersTab();
    } catch (err) {
      alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });

  document.querySelectorAll('[data-role-for]').forEach(sel => {
    sel.addEventListener('change', async () => {
      await Api.patch(`/api/admin/users/${sel.dataset.roleFor}`, { adminRoleId: sel.value });
    });
  });
  document.querySelectorAll('[data-status-for]').forEach(sel => {
    sel.addEventListener('change', async () => {
      await Api.patch(`/api/admin/users/${sel.dataset.statusFor}`, { accountStatus: sel.value });
    });
  });
}

function debounceAdmin(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

document.addEventListener('DOMContentLoaded', async () => {
  me = await requireAdminNav();
  if (!me) return;
  if (me.canManageAdmins) document.getElementById('users-tab-btn').style.display = '';
  await loadRefData();

  document.querySelectorAll('#admin-tabs button').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  switchTab('dashboard');
});
