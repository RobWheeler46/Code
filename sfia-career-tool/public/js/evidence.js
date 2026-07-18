let allSkills = [];

function skillOptionsHtml(selectedId) {
  return '<option value="">Select a SFIA skill…</option>' + allSkills.map(s =>
    `<option value="${s.id}" ${String(s.id) === String(selectedId) ? 'selected' : ''}>${escapeHtml(s.skill_code)} — ${escapeHtml(s.skill_name)}</option>`
  ).join('');
}

function evidenceCard(e) {
  return `
    <div class="card evidence-item" data-evidence="${e.id}">
      <div class="evidence-view">
        <div class="plan-item-head">
          <h3 style="margin:0;">${escapeHtml(e.title)}</h3>
          <button class="btn btn-secondary btn-sm" data-edit="${e.id}" type="button">Edit</button>
        </div>
        ${e.description ? `<p class="rich-text" style="margin:0.4rem 0;">${escapeHtml(e.description)}</p>` : ''}
        ${e.url ? `<p style="margin:0.2rem 0;"><a href="${escapeHtml(e.url)}" target="_blank" rel="noopener">${escapeHtml(e.url)}</a></p>` : ''}
        <div class="actions-row"><button class="btn btn-secondary btn-sm" data-remove="${e.id}" type="button">Remove</button></div>
      </div>
    </div>
  `;
}

function renderEditForm(card, e) {
  card.querySelector('.evidence-view').style.display = 'none';
  const wrap = document.createElement('div');
  wrap.className = 'evidence-edit';
  wrap.innerHTML = `
    <div class="field"><label>Title</label><input type="text" class="ev-title" value="${escapeHtml(e.title)}"></div>
    <div class="field"><label>Description</label><textarea class="ev-desc">${escapeHtml(e.description || '')}</textarea></div>
    <div class="field"><label>Link (optional)</label><input type="url" class="ev-url" value="${escapeHtml(e.url || '')}"></div>
    <div class="actions-row">
      <button class="btn btn-primary btn-sm ev-save" type="button">Save</button>
      <button class="btn btn-secondary btn-sm ev-cancel" type="button">Cancel</button>
    </div>
  `;
  card.appendChild(wrap);
  wrap.querySelector('.ev-cancel').addEventListener('click', () => loadEvidence());
  wrap.querySelector('.ev-save').addEventListener('click', async () => {
    await Api.patch(`/api/user/evidence/${e.id}`, {
      title: wrap.querySelector('.ev-title').value,
      description: wrap.querySelector('.ev-desc').value,
      url: wrap.querySelector('.ev-url').value
    });
    loadEvidence();
  });
}

async function loadEvidence() {
  const container = document.getElementById('evidence-container');
  const items = await Api.get('/api/user/evidence');
  const preselect = new URLSearchParams(location.search).get('skill') || '';

  // Group by skill.
  const groups = {};
  for (const e of items) { (groups[e.sfia_skill_id] = groups[e.sfia_skill_id] || { code: e.skill_code, name: e.skill_name, items: [] }).items.push(e); }

  container.innerHTML = `
    <h1>My evidence</h1>
    <div class="card">
      <h2>Add evidence</h2>
      <p class="muted" style="margin-top:0;">Record examples that show how you demonstrate a SFIA skill &mdash; a project, a review, a document. You can reference these when self-assessing or planning development.</p>
      <div id="ev-form-alert"></div>
      <div class="field"><label for="ev-skill">SFIA skill</label><select id="ev-skill">${skillOptionsHtml(preselect)}</select></div>
      <div class="field"><label for="ev-title">Title</label><input type="text" id="ev-title" placeholder="e.g. Led the payments service rewrite"></div>
      <div class="field"><label for="ev-description">Description (optional)</label><textarea id="ev-description"></textarea></div>
      <div class="field"><label for="ev-url">Link (optional)</label><input type="url" id="ev-url" placeholder="https://…"></div>
      <button class="btn btn-primary btn-sm" id="add-evidence-btn" type="button">Add evidence</button>
    </div>
    ${items.length === 0 ? '<div class="card"><div class="empty-state">No evidence yet. Add your first example above.</div></div>' :
      Object.values(groups).map(g => `
        <h2 style="margin-top:1.5rem;">${escapeHtml(g.name && g.name !== g.code ? g.name : g.code)} <span class="muted">(${escapeHtml(g.code)})</span></h2>
        ${g.items.map(evidenceCard).join('')}
      `).join('')}
  `;

  document.getElementById('add-evidence-btn').addEventListener('click', async () => {
    const alertBox = document.getElementById('ev-form-alert');
    alertBox.innerHTML = '';
    try {
      await Api.post('/api/user/evidence', {
        sfiaSkillId: document.getElementById('ev-skill').value || null,
        title: document.getElementById('ev-title').value,
        description: document.getElementById('ev-description').value,
        url: document.getElementById('ev-url').value
      });
      loadEvidence();
    } catch (err) {
      alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });
  container.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', async () => { await Api.delete(`/api/user/evidence/${btn.dataset.remove}`); loadEvidence(); });
  });
  container.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const e = items.find(x => String(x.id) === btn.dataset.edit);
      renderEditForm(btn.closest('.evidence-item'), e);
    });
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  renderPublicNav();
  try { await Api.get('/api/me'); } catch (e) { location.href = 'signin.html?next=' + encodeURIComponent(location.pathname + location.search); return; }
  allSkills = await Api.get('/api/user/skills');
  await loadEvidence();
});
