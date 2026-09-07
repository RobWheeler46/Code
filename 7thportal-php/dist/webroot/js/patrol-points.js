// Patrol Points - competition list + create.
const PP_SKEY = { draft: 'suspended', open: 'active', paused: 'pending_approval', completed: 'active', archived: 'deleted' };

(async () => {
  const me = await requireUserNav();
  if (!me) return;
  const box = document.getElementById('content');
  let data;
  try { data = await Api.get('/api/patrol-points/competitions'); }
  catch (e) { box.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; return; }

  if (data.canManage) {
    document.getElementById('pp-head').innerHTML = '<button class="btn" id="pp-new">New competition</button>';
    document.getElementById('pp-new').addEventListener('click', () => openWizard(data.meta, data.competitions));
  }

  const row = (c) => `<tr class="pp-row clickable" data-id="${c.id}">
      <td data-label="Competition" class="rcard-title"><strong>${escapeHtml(c.name)}</strong></td>
      <td data-label="Teams" class="muted">${c.teamCount}</td>
      <td data-label="Approval" class="muted">${escapeHtml(c.approvalModeLabel)}</td>
      <td data-label="Pending">${c.pendingCount ? `<span class="badge" data-status="pending_approval">${c.pendingCount} pending</span>` : '<span class="muted">—</span>'}</td>
      <td data-label="Status"><span class="badge" data-status="${PP_SKEY[c.status] || 'suspended'}">${escapeHtml(c.statusLabel)}</span></td>
    </tr>`;
  const table = (rows) => `<table class="data-table rcards">
    <thead><tr><th>Competition</th><th>Teams</th><th>Approval</th><th>Pending</th><th>Status</th></tr></thead>
    <tbody>${rows.map(row).join('')}</tbody></table>`;

  const active = data.competitions.filter(c => c.status !== 'archived');
  const archived = data.competitions.filter(c => c.status === 'archived');
  box.innerHTML = `
    <div id="pp-create"></div>
    <div class="card"><h2>Competitions</h2>${active.length ? table(active) : '<p class="muted">No competitions yet. Create one to get started.</p>'}</div>
    ${archived.length ? `<div class="card"><h2>Archived</h2>${table(archived)}</div>` : ''}`;
  document.querySelectorAll('.pp-row').forEach(r => r.addEventListener('click', () => location.href = 'patrol-point.html?id=' + r.dataset.id));
})();

// ── Setup wizard (FRD s13.2 / App. E): Basics → Teams → Scoring → Review & Start ──
let WIZ = null, CLONE_SOURCES = [];
const WIZ_STEPS = ['Basics', 'Teams', 'Scoring', 'Review & start'];
const TEAM_TEMPLATES = {
  'Six colours': ['Red', 'Blue', 'Green', 'Yellow'],
  'Patrol animals': ['Eagles', 'Foxes', 'Hawks', 'Owls', 'Wolves'],
};

function openWizard(meta, competitions) {
  CLONE_SOURCES = (competitions || []).filter(c => c.status !== 'archived');
  WIZ = {
    step: 1, meta,
    name: '', description: '', approvalMode: 'immediate', allowDeductions: false,
    teams: ['', ''],
    categories: [{ name: 'General points', pointsType: 'free', fixedPoints: '', pointButtons: '', reasonPresets: '' }],
  };
  renderWizard();
  document.getElementById('pp-create').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderWizard() {
  const host = document.getElementById('pp-create');
  const steps = WIZ_STEPS.map((label, i) => {
    const n = i + 1;
    const cls = n === WIZ.step ? 'active' : (n < WIZ.step ? 'done' : '');
    return `<button class="wiz-step ${cls}" data-goto="${n}"><span class="wiz-num">${n}</span>${escapeHtml(label)}</button>`;
  }).join('<span class="wiz-sep" aria-hidden="true">›</span>');

  host.innerHTML = `<div class="card card-accent accent-yellow">
    <div class="cap-head"><h2 style="margin:0">New competition</h2><button class="btn btn-secondary btn-sm" id="wz-cancel">Cancel</button></div>
    <nav class="wiz-steps" aria-label="Setup steps">${steps}</nav>
    <div id="wz-body">${wizBody()}</div>
    <div id="wz-msg"></div>
    <div class="cap-actions" style="margin-top:1rem">${wizNav()}</div>
  </div>`;
  wireWizard();
}

function wizBody() {
  if (WIZ.step === 1) return stepBasics();
  if (WIZ.step === 2) return stepTeams();
  if (WIZ.step === 3) return stepScoring();
  return stepReview();
}
function wizNav() {
  const back = WIZ.step > 1 ? '<button class="btn btn-secondary" id="wz-back">Back</button>' : '';
  if (WIZ.step < 4) return `${back}<button class="btn" id="wz-next">Next</button>`;
  const canStart = WIZ.teams.filter(t => t.trim()).length && WIZ.categories.filter(c => c.name.trim()).length;
  return `${back}<button class="btn btn-secondary" id="wz-draft">Save as draft</button><button class="btn" id="wz-start"${canStart ? '' : ' disabled title="Add a team and a scoring category to start"'}>Create &amp; open</button>`;
}

function stepBasics() {
  const clone = CLONE_SOURCES.length
    ? `<div class="field"><label>Copy setup from (optional)</label><select id="wz-clone"><option value="">Start from scratch</option>${CLONE_SOURCES.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}</select><span class="field help">Copies the teams and scoring from an existing competition. You still choose a new name.</span></div>`
    : '';
  return `<div class="field"><label>Name</label><input id="wz-name" value="${escapeHtml(WIZ.name)}" placeholder="e.g. Summer Camp 2026"></div>
    <div class="field"><label>Description (optional)</label><textarea id="wz-desc" rows="2">${escapeHtml(WIZ.description)}</textarea></div>
    ${clone}
    <details class="wiz-adv"${WIZ.allowDeductions || WIZ.approvalMode !== 'immediate' ? ' open' : ''}><summary>Advanced settings</summary>
      <div class="field"><label>Scoring approval</label><select id="wz-mode">${Object.entries(WIZ.meta.approvalModes).map(([k, v]) => `<option value="${k}"${WIZ.approvalMode === k ? ' selected' : ''}>${escapeHtml(v)}</option>`).join('')}</select></div>
      <div class="field"><label style="font-weight:400"><input type="checkbox" id="wz-deduct"${WIZ.allowDeductions ? ' checked' : ''}> Allow deductions (negative points)</label>
        <span class="field help">Off by default to keep scoring positive; enable deliberately where deductions are governed.</span></div>
    </details>`;
}

function stepTeams() {
  const rows = WIZ.teams.map((t, i) => `<div class="cap-actions" style="align-items:center;margin:.3rem 0">
      <input class="wz-team" value="${escapeHtml(t)}" placeholder="Team ${i + 1}" style="flex:1 1 12rem">
      <button class="btn btn-secondary btn-sm wz-team-del" data-i="${i}"${WIZ.teams.length <= 1 ? ' disabled' : ''}>Remove</button>
    </div>`).join('');
  const tmpl = Object.keys(TEAM_TEMPLATES).map(k => `<button class="btn btn-secondary btn-sm wz-team-tmpl" data-t="${escapeHtml(k)}">Add ${escapeHtml(k.toLowerCase())}</button>`).join('');
  return `<p class="muted">Add the teams or patrols that will compete. You can add or remove more later.</p>
    <div id="wz-teams">${rows}</div>
    <div class="cap-actions" style="margin-top:.5rem"><button class="btn btn-secondary btn-sm" id="wz-team-add">Add team</button>${tmpl}</div>`;
}

function stepScoring() {
  const cats = WIZ.categories.map((c, i) => `<div class="card wz-cat" data-i="${i}" style="margin:.5rem 0">
      <div class="cap-actions">
        <div class="field" style="flex:2 1 12rem"><label>Category name</label><input class="wz-cat-name" value="${escapeHtml(c.name)}" placeholder="e.g. Teamwork"></div>
        <div class="field"><label>Points</label><select class="wz-cat-type">
          <option value="free"${c.pointsType === 'free' ? ' selected' : ''}>Scorer chooses</option>
          <option value="fixed"${c.pointsType === 'fixed' ? ' selected' : ''}>Fixed value</option></select></div>
        <div class="field wz-cat-fixed"${c.pointsType === 'fixed' ? '' : ' hidden'}><label>Value</label><input class="wz-cat-fixedval" type="number" value="${escapeHtml(c.fixedPoints)}" style="width:90px"></div>
      </div>
      <details class="wiz-adv"${c.pointButtons || c.reasonPresets ? ' open' : ''}><summary>Quick Score presets (optional)</summary>
        <div class="field"><label>Point buttons (comma separated)</label><input class="wz-cat-buttons" value="${escapeHtml(c.pointButtons)}" placeholder="e.g. 5, 10, 20"></div>
        <div class="field"><label>Reason presets (comma separated)</label><input class="wz-cat-reasons" value="${escapeHtml(c.reasonPresets)}" placeholder="e.g. Teamwork, Kindness, Effort"></div>
      </details>
      <button class="btn btn-secondary btn-sm wz-cat-del" data-i="${i}"${WIZ.categories.length <= 1 ? ' disabled' : ''}>Remove category</button>
    </div>`).join('');
  return `<p class="muted">At least one scoring category is needed. Teams earn points within a category.</p>
    <div id="wz-cats">${cats}</div>
    <button class="btn btn-secondary btn-sm" id="wz-cat-add" style="margin-top:.5rem">Add category</button>`;
}

function stepReview() {
  const teams = WIZ.teams.map(t => t.trim()).filter(Boolean);
  const cats = WIZ.categories.filter(c => c.name.trim());
  const line = (label, val) => `<tr><td class="muted">${label}</td><td>${val}</td></tr>`;
  return `<p class="muted">Check everything, then save as a draft or create and open for scoring right away.</p>
    <table class="kv-table">
      ${line('Name', escapeHtml(WIZ.name) || '<span class="err" style="color:var(--red)">Needs a name</span>')}
      ${WIZ.description ? line('Description', escapeHtml(WIZ.description)) : ''}
      ${line('Scoring approval', escapeHtml(WIZ.meta.approvalModes[WIZ.approvalMode] || WIZ.approvalMode))}
      ${line('Deductions', WIZ.allowDeductions ? 'Allowed' : 'Not allowed')}
      ${line('Teams (' + teams.length + ')', teams.length ? teams.map(escapeHtml).join(', ') : '<span class="muted">None yet</span>')}
      ${line('Scoring (' + cats.length + ')', cats.length ? cats.map(c => escapeHtml(c.name) + (c.pointsType === 'fixed' ? ` (fixed ${escapeHtml(c.fixedPoints)})` : '')).join(', ') : '<span class="muted">None yet</span>')}
    </table>`;
}

// Read the current step's inputs back into WIZ before navigating.
function collectWizStep() {
  if (WIZ.step === 1) {
    WIZ.name = val('wz-name', WIZ.name);
    WIZ.description = val('wz-desc', WIZ.description);
    WIZ.approvalMode = val('wz-mode', WIZ.approvalMode);
    const d = document.getElementById('wz-deduct'); if (d) WIZ.allowDeductions = d.checked;
  } else if (WIZ.step === 2) {
    WIZ.teams = [...document.querySelectorAll('.wz-team')].map(i => i.value);
  } else if (WIZ.step === 3) {
    WIZ.categories = [...document.querySelectorAll('.wz-cat')].map(el => ({
      name: el.querySelector('.wz-cat-name').value,
      pointsType: el.querySelector('.wz-cat-type').value,
      fixedPoints: el.querySelector('.wz-cat-fixedval').value,
      pointButtons: el.querySelector('.wz-cat-buttons').value,
      reasonPresets: el.querySelector('.wz-cat-reasons').value,
    }));
  }
}
function val(id, fallback) { const el = document.getElementById(id); return el ? el.value : fallback; }
function goStep(n) { collectWizStep(); WIZ.step = Math.max(1, Math.min(4, n)); renderWizard(); }

function wireWizard() {
  document.getElementById('wz-cancel').addEventListener('click', () => { WIZ = null; document.getElementById('pp-create').innerHTML = ''; });
  document.querySelectorAll('.wiz-step').forEach(b => b.addEventListener('click', () => goStep(+b.dataset.goto)));
  document.getElementById('wz-back')?.addEventListener('click', () => goStep(WIZ.step - 1));
  document.getElementById('wz-next')?.addEventListener('click', () => {
    collectWizStep();
    if (WIZ.step === 1 && !WIZ.name.trim()) return wizMsg('Give the competition a name.');
    goStep(WIZ.step + 1);
  });
  document.getElementById('wz-draft')?.addEventListener('click', () => finishWizard(false));
  document.getElementById('wz-start')?.addEventListener('click', () => finishWizard(true));

  // Step 1: clone
  document.getElementById('wz-clone')?.addEventListener('change', e => { if (e.target.value) cloneFrom(e.target.value); });
  // Step 2: team add/remove/templates
  document.getElementById('wz-team-add')?.addEventListener('click', () => { collectWizStep(); WIZ.teams.push(''); renderWizard(); });
  document.querySelectorAll('.wz-team-del').forEach(b => b.addEventListener('click', () => { collectWizStep(); WIZ.teams.splice(+b.dataset.i, 1); renderWizard(); }));
  document.querySelectorAll('.wz-team-tmpl').forEach(b => b.addEventListener('click', () => {
    collectWizStep();
    const add = TEAM_TEMPLATES[b.dataset.t] || [];
    WIZ.teams = WIZ.teams.filter(t => t.trim()).concat(add);
    renderWizard();
  }));
  // Step 3: category add/remove + fixed toggle
  document.getElementById('wz-cat-add')?.addEventListener('click', () => { collectWizStep(); WIZ.categories.push({ name: '', pointsType: 'free', fixedPoints: '', pointButtons: '', reasonPresets: '' }); renderWizard(); });
  document.querySelectorAll('.wz-cat-del').forEach(b => b.addEventListener('click', () => { collectWizStep(); WIZ.categories.splice(+b.dataset.i, 1); renderWizard(); }));
  document.querySelectorAll('.wz-cat-type').forEach(sel => sel.addEventListener('change', e => { e.target.closest('.wz-cat').querySelector('.wz-cat-fixed').hidden = e.target.value !== 'fixed'; }));
}

function wizMsg(t) { document.getElementById('wz-msg').innerHTML = `<div class="alert alert-error">${escapeHtml(t)}</div>`; }

async function cloneFrom(id) {
  collectWizStep();
  try {
    const d = await Api.get('/api/patrol-points/competitions/' + id);
    WIZ.teams = (d.teams || []).map(t => t.name);
    if (!WIZ.teams.length) WIZ.teams = [''];
    WIZ.categories = (d.categories || []).map(c => ({
      name: c.name, pointsType: c.pointsType || (c.fixedPoints != null ? 'fixed' : 'free'),
      fixedPoints: c.fixedPoints != null ? String(c.fixedPoints) : '',
      pointButtons: (c.pointButtons || []).join(', '), reasonPresets: (c.reasonPresets || []).join(', '),
    }));
    if (!WIZ.categories.length) WIZ.categories = [{ name: 'General points', pointsType: 'free', fixedPoints: '', pointButtons: '', reasonPresets: '' }];
    WIZ.allowDeductions = !!d.competition.allowDeductions;
    WIZ.approvalMode = d.competition.approvalMode || WIZ.approvalMode;
    renderWizard();
    wizMsg('');
    document.getElementById('wz-msg').innerHTML = '<div class="alert alert-info">Teams and scoring copied. Give this competition its own name.</div>';
  } catch (e) { wizMsg(e.message); }
}

async function finishWizard(start) {
  collectWizStep();
  if (!WIZ.name.trim()) { goStep(1); return wizMsg('Give the competition a name.'); }
  const payload = {
    name: WIZ.name.trim(), description: WIZ.description, approvalMode: WIZ.approvalMode, allowDeductions: WIZ.allowDeductions,
    teams: WIZ.teams.map(t => t.trim()).filter(Boolean),
    categories: WIZ.categories.filter(c => c.name.trim()).map(c => ({
      name: c.name.trim(), pointsType: c.pointsType, fixedPoints: c.fixedPoints,
      pointButtons: String(c.pointButtons || '').split(',').map(s => s.trim()).filter(Boolean),
      reasonPresets: String(c.reasonPresets || '').split(',').map(s => s.trim()).filter(Boolean),
    })),
    start,
  };
  try {
    const c = await Api.post('/api/patrol-points/competitions/wizard', payload);
    location.href = 'patrol-point.html?id=' + c.id;
  } catch (e) { wizMsg(e.message); }
}
