let attempt = null;   // { id, status, role, questions: [...] }
let step = 0;         // current question index

function levelLabelShort(number, name) {
  return name && name !== `Level ${number}` ? `Level ${number} — ${name}` : `Level ${number}`;
}

function statusChip(status, levelDiff) {
  if (status === 'met') return gapBadge('No gap');
  if (status === 'not_answered') return '<span class="badge" data-gap="Not applicable">Not answered</span>';
  const label = levelDiff === 1 ? 'Minor gap' : levelDiff === 2 ? 'Moderate gap' : 'Significant gap';
  return gapBadge(label);
}

// ---------- Start screen (FRD v0.35: Core role or Business role assessment) ----------

async function renderStartScreen() {
  const container = document.getElementById('assessment-container');
  const [roles, businessRoles] = await Promise.all([Api.get('/api/roles'), Api.get('/api/user/business-roles').catch(() => [])]);
  container.innerHTML = `
    <div class="card" style="max-width:640px; margin:1.5rem auto;">
      <h1>Start a self-assessment</h1>
      <p class="muted">Assess your readiness against a role. A <strong>core role</strong> assesses SFIA skills; a <strong>business role</strong> also assesses the organisation&rsquo;s Skills &amp; Knowledge Framework items, with separate SFIA and Skills &amp; Knowledge readiness.</p>
      <div id="start-alert"></div>
      <div class="field"><label>Assessment type</label>
        <div class="assess-type-toggle">
          <label class="assess-type"><input type="radio" name="atype" value="core" checked> Core role (SFIA)</label>
          <label class="assess-type"><input type="radio" name="atype" value="business" ${businessRoles.length ? '' : 'disabled'}> Business role (SFIA + Skills &amp; Knowledge)</label>
        </div>
        ${businessRoles.length ? '' : '<p class="muted" style="font-size:0.8rem;">No published business roles are available to assess against yet.</p>'}
      </div>
      <div class="field" id="core-picker"><label>Role</label>
        <select id="start-role"><option value="">Select a role…</option>${roles.map(r => `<option value="${r.id}">${escapeHtml(r.title)}</option>`).join('')}</select>
      </div>
      <div class="field" id="business-picker" style="display:none;"><label>Business role</label>
        <select id="start-brole"><option value="">Select a business role…</option>${businessRoles.map(b => `<option value="${b.id}">${escapeHtml(b.business_role_name)} — ${escapeHtml(b.core_role_title)} (${b.item_count} items)</option>`).join('')}</select>
      </div>
      <button class="btn btn-primary" id="start-btn" type="button">Start assessment</button>
    </div>
  `;
  const showType = () => {
    const t = container.querySelector('input[name="atype"]:checked').value;
    document.getElementById('core-picker').style.display = t === 'core' ? '' : 'none';
    document.getElementById('business-picker').style.display = t === 'business' ? '' : 'none';
  };
  container.querySelectorAll('input[name="atype"]').forEach(r => r.addEventListener('change', showType));
  document.getElementById('start-btn').addEventListener('click', async () => {
    const t = container.querySelector('input[name="atype"]:checked').value;
    const alertBox = document.getElementById('start-alert'); alertBox.innerHTML = '';
    const body = t === 'business'
      ? { businessRoleProfileId: Number(document.getElementById('start-brole').value) }
      : { roleProfileId: Number(document.getElementById('start-role').value) };
    if ((t === 'business' && !body.businessRoleProfileId) || (t === 'core' && !body.roleProfileId)) {
      alertBox.innerHTML = '<div class="alert alert-error">Select a role first.</div>'; return;
    }
    try {
      const res = await Api.post('/api/user/assessments', body);
      location.href = `assessment.html?id=${res.id}`;
    } catch (e) { alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  });
}

// ---------- Stepper ----------

function renderStepper() {
  const container = document.getElementById('assessment-container');
  const q = attempt.questions[step];
  const total = attempt.questions.length;
  const answeredCount = attempt.questions.filter(x => x.response && x.response.selfAssessedLevelId != null).length;
  const resp = q.response || {};

  container.innerHTML = `
    <div class="card assessment-head">
      <div class="role-card-head">
        <span class="icon-tile"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></span>
        <div>
          <h1 style="margin:0;">${escapeHtml(attempt.businessRole ? attempt.businessRole.business_role_name : attempt.role.title)}</h1>
          <p class="muted" style="margin:0.2rem 0 0;">Guided self-assessment${attempt.businessRole ? ' · SFIA + Skills & Knowledge' : (attempt.role.grade ? ' · Grade ' + escapeHtml(attempt.role.grade) : '')} · ${total} questions</p>
        </div>
      </div>
      <div class="assessment-progress"><div class="assessment-progress-bar" style="width:${Math.round((answeredCount/total)*100)}%"></div></div>
      <p class="muted" style="margin:0.4rem 0 0; font-size:0.85rem;">Step ${step + 1} of ${total} · ${answeredCount} answered</p>
    </div>

    <div class="card">
      <p class="muted" style="margin-top:0;"><span class="badge" data-status="${q.kind === 'framework' ? 'active' : 'published'}">${q.kind === 'framework' ? 'Skills & Knowledge' : 'SFIA skill'}</span> ${escapeHtml(q.skillCode)}${q.skillName && q.skillName !== q.skillCode ? ' · ' + escapeHtml(q.skillName) : ''} · target <strong>${escapeHtml(levelLabelShort(q.requiredLevel.number, q.requiredLevel.name))}</strong></p>
      <h2>Which statement best describes your current level in ${escapeHtml(q.skillName && q.skillName !== q.skillCode ? q.skillName : q.skillCode)}?</h2>
      <div class="assess-options">
        ${q.options.map(o => `
          <label class="assess-option ${String(resp.selfAssessedLevelId) === String(o.level_id) ? 'selected' : ''}">
            <input type="radio" name="level" value="${o.level_id}" ${String(resp.selfAssessedLevelId) === String(o.level_id) ? 'checked' : ''}>
            <span>
              <strong>${escapeHtml(levelLabelShort(o.level_number, o.level_name))}</strong>
              ${o.skill_level_description ? `<span class="assess-option-desc">${escapeHtml(o.skill_level_description)}</span>` : ''}
            </span>
          </label>
        `).join('')}
      </div>

      <div class="field" style="margin-top:1rem;"><label for="evidence">Evidence (optional)</label>
        <textarea id="evidence" placeholder="Examples that show how you demonstrate this skill">${escapeHtml(resp.evidenceText || '')}</textarea>
      </div>
      <div class="field"><label>How confident are you at this level? (optional)</label>
        <div class="confidence-scale" id="confidence">
          ${[1,2,3,4,5].map(n => `<button type="button" class="confidence-dot ${resp.confidence === n ? 'selected' : ''}" data-conf="${n}">${n}</button>`).join('')}
          <span class="muted" style="font-size:0.8rem; margin-left:0.5rem;">1 = not confident, 5 = very confident</span>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="actions-row">
        <button class="btn btn-secondary" id="prev-btn" type="button" ${step === 0 ? 'disabled' : ''}>&larr; Previous</button>
        ${step < total - 1
          ? '<button class="btn btn-primary" id="next-btn" type="button">Next &rarr;</button>'
          : '<button class="btn btn-success" id="finish-btn" type="button">Finish assessment</button>'}
        <button class="btn btn-secondary" id="save-exit-btn" type="button">Save &amp; exit</button>
      </div>
      <div id="assess-alert"></div>
    </div>
  `;

  // Track selection in the local model so navigation reflects unsaved choices.
  container.querySelectorAll('input[name="level"]').forEach(r => {
    r.addEventListener('change', () => {
      q.response = q.response || {};
      q.response.selfAssessedLevelId = Number(r.value);
      container.querySelectorAll('.assess-option').forEach(l => l.classList.toggle('selected', l.querySelector('input').checked));
    });
  });
  container.querySelectorAll('.confidence-dot').forEach(b => {
    b.addEventListener('click', () => {
      q.response = q.response || {};
      q.response.confidence = Number(b.dataset.conf);
      container.querySelectorAll('.confidence-dot').forEach(d => d.classList.toggle('selected', d === b));
    });
  });
  document.getElementById('evidence').addEventListener('input', (e) => {
    q.response = q.response || {};
    q.response.evidenceText = e.target.value;
  });

  document.getElementById('prev-btn').addEventListener('click', async () => { await saveCurrent(); step--; renderStepper(); });
  document.getElementById('next-btn')?.addEventListener('click', async () => { await saveCurrent(); step++; renderStepper(); });
  document.getElementById('save-exit-btn').addEventListener('click', async () => { await saveCurrent(); location.href = 'dashboard.html'; });
  document.getElementById('finish-btn')?.addEventListener('click', finish);
}

async function saveCurrent() {
  const q = attempt.questions[step];
  if (!q.response) return;
  if (q.kind === 'framework') {
    await Api.put(`/api/user/assessments/${attempt.id}/framework-responses`, {
      frameworkItemId: q.frameworkItemId,
      level: q.requiredLevel.number,
      selfAssessedLevel: q.response.selfAssessedLevelId || null,
      confidence: q.response.confidence || null,
      evidenceText: q.response.evidenceText || null
    }).catch(() => {});
    return;
  }
  await Api.put(`/api/user/assessments/${attempt.id}/responses`, {
    sfiaSkillId: q.sfiaSkillId,
    selfAssessedLevelId: q.response.selfAssessedLevelId || null,
    confidence: q.response.confidence || null,
    evidenceText: q.response.evidenceText || null
  }).catch(() => {});
}

async function finish() {
  await saveCurrent();
  const unanswered = attempt.questions.filter(x => !x.response || x.response.selfAssessedLevelId == null);
  if (unanswered.length > 0) {
    document.getElementById('assess-alert').innerHTML = `<div class="alert alert-error">Answer all ${attempt.questions.length} questions first — ${unanswered.length} still unanswered (${unanswered.map(u => u.skillCode).join(', ')}).</div>`;
    return;
  }
  try {
    await Api.post(`/api/user/assessments/${attempt.id}/complete`);
    location.href = `assessment.html?id=${attempt.id}&results=1`;
  } catch (err) {
    document.getElementById('assess-alert').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  }
}

// ---------- Results ----------

async function renderResults(id) {
  const container = document.getElementById('assessment-container');
  const r = await Api.get(`/api/user/assessments/${id}/results`);
  const sfia = r.sfia || { total: r.total, met: r.met, gap: r.gap, percent: r.percent, details: r.details || [] };
  const fw = r.framework;
  const title = r.businessRole ? r.businessRole.business_role_name : (r.role.title + (r.role.grade ? ' · Grade ' + escapeHtml(r.role.grade) : ''));

  const sfiaTable = `
    <table class="skills-table">
      <thead><tr><th>SFIA code</th><th>Skill</th><th>Target</th><th>Your level</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>
        ${sfia.details.map(d => `
          <tr>
            <td data-label="SFIA code">${escapeHtml(d.skillCode)}</td>
            <td data-label="Skill">${escapeHtml(d.skillName)}</td>
            <td data-label="Target"><span class="level-pill">L${d.requiredLevel.number}</span></td>
            <td data-label="Your level">${d.selfLevel ? `<span class="level-pill">L${d.selfLevel.number}</span>` : '&mdash;'}</td>
            <td data-label="Status">${statusChip(d.status, d.levelDiff)}</td>
            <td data-label="Action">${d.status === 'gap' ? `<button class="btn btn-secondary btn-sm" data-add-plan="${d.sfiaSkillId}" data-level="${d.requiredLevel.number}" type="button">Add to plan</button>` : ''}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;

  const fwTable = fw ? `
    <table class="skills-table">
      <thead><tr><th>Technology / capability</th><th>Family</th><th>Target</th><th>Your level</th><th>Status</th></tr></thead>
      <tbody>
        ${fw.details.map(d => `
          <tr>
            <td data-label="Item">${escapeHtml(d.tech)}</td>
            <td data-label="Family">${escapeHtml(d.family)}</td>
            <td data-label="Target"><span class="level-pill">L${d.requiredLevel.number}</span></td>
            <td data-label="Your level">${d.selfLevel ? `<span class="level-pill">L${d.selfLevel.number}</span>` : '&mdash;'}</td>
            <td data-label="Status">${statusChip(d.status, d.levelDiff)}</td>
          </tr>`).join('')}
      </tbody>
    </table>` : '';

  container.innerHTML = `
    <div class="card compare-hero">
      <p class="muted" style="margin:0;">Assessment results${r.assessmentType === 'business' ? ' · Business role' : ''}</p>
      <h1 style="margin:0.2rem 0;">${escapeHtml(title)}</h1>
      <p><span class="readiness-label" data-ready="${escapeHtml(r.label)}">${escapeHtml(r.label)}</span> · ${r.percent}% overall readiness</p>
      <div class="summary-stats">
        <div class="stat-tile"><div class="num">${r.percent}%</div><div class="label">Overall</div></div>
        <div class="stat-tile"><div class="num">${sfia.percent}%</div><div class="label">SFIA readiness</div></div>
        ${fw ? `<div class="stat-tile"><div class="num">${fw.percent}%</div><div class="label">Skills &amp; Knowledge</div></div>` : ''}
        <div class="stat-tile"><div class="num">${r.evidencePercent != null ? r.evidencePercent + '%' : '—'}</div><div class="label">Evidence confidence</div></div>
      </div>
      <p class="muted" style="font-size:0.82rem; margin-bottom:0;">Scores are development guidance only &mdash; not a formal promotion, hiring or performance decision.</p>
    </div>
    <div class="card">
      <h2>SFIA skill readiness</h2>
      ${sfia.details.length ? sfiaTable : '<p class="muted">No SFIA skills on this role.</p>'}
    </div>
    ${fw ? `<div class="card"><h2>Skills &amp; Knowledge readiness</h2>${fwTable}<p class="muted" style="font-size:0.82rem;">Add Skills &amp; Knowledge gaps to your plan from the development plan page (SFIA gaps can be added directly below).</p></div>` : ''}
    <div class="card">
      <div class="actions-row">
        <a class="btn btn-primary" href="plan.html">${svgIcon('plan', { className: 'btn-icon' })} My development plan</a>
        <a class="btn btn-secondary" href="coach.html">${svgIcon('coach', { className: 'btn-icon' })} Ask the Coach</a>
        <a class="btn btn-secondary" href="dashboard.html">Back to dashboard</a>
      </div>
    </div>
    <div class="card" id="share-card"></div>
  `;

  initShareControl({ mount: document.getElementById('share-card'), shareType: 'assessment', resourceId: Number(id), label: 'this assessment result' });

  container.querySelectorAll('[data-add-plan]').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await Api.post('/api/user/development-plan', { sfiaSkillId: Number(btn.dataset.addPlan), targetRoleProfileId: r.role.id, targetLevelNumber: Number(btn.dataset.level) });
        btn.textContent = 'Added ✓';
      } catch (e) { btn.disabled = false; alert(e.message); }
    });
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  renderPublicNav();
  const container = document.getElementById('assessment-container');
  try { await Api.get('/api/me'); } catch (e) { location.href = 'signin.html?next=' + encodeURIComponent(location.pathname + location.search); return; }

  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  if (!id) { await renderStartScreen(); return; }

  try {
    if (params.get('results')) { await renderResults(id); return; }
    attempt = await Api.get(`/api/user/assessments/${id}`);
    if (attempt.status === 'completed') { await renderResults(id); return; }
    step = 0;
    renderStepper();
  } catch (e) {
    container.innerHTML = `<div class="card"><div class="alert alert-error">${escapeHtml(e.message)}</div></div>`;
  }
});
