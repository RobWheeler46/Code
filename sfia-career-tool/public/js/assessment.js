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
          <h1 style="margin:0;">${escapeHtml(attempt.role.title)}</h1>
          <p class="muted" style="margin:0.2rem 0 0;">Guided self-assessment${attempt.role.grade ? ' · Grade ' + escapeHtml(attempt.role.grade) : ''} · ${total} skills</p>
        </div>
      </div>
      <div class="assessment-progress"><div class="assessment-progress-bar" style="width:${Math.round((answeredCount/total)*100)}%"></div></div>
      <p class="muted" style="margin:0.4rem 0 0; font-size:0.85rem;">Step ${step + 1} of ${total} · ${answeredCount} answered</p>
    </div>

    <div class="card">
      <p class="muted" style="margin-top:0;">${escapeHtml(q.skillCode)}${q.skillName && q.skillName !== q.skillCode ? ' · ' + escapeHtml(q.skillName) : ''} · this role needs <strong>${escapeHtml(levelLabelShort(q.requiredLevel.number, q.requiredLevel.name))}</strong></p>
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
    document.getElementById('assess-alert').innerHTML = `<div class="alert alert-error">Answer all ${attempt.questions.length} skills first — ${unanswered.length} still unanswered (${unanswered.map(u => u.skillCode).join(', ')}).</div>`;
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
  container.innerHTML = `
    <div class="card compare-hero">
      <p class="muted" style="margin:0;">Assessment results</p>
      <h1 style="margin:0.2rem 0;">${escapeHtml(r.role.title)}${r.role.grade ? ' · Grade ' + escapeHtml(r.role.grade) : ''}</h1>
      <p><span class="readiness-label" data-ready="${escapeHtml(r.label)}">${escapeHtml(r.label)}</span> · ${r.percent}% of required skills met</p>
      <div class="summary-stats">
        <div class="stat-tile"><div class="num">${r.met}</div><div class="label">Skills met</div></div>
        <div class="stat-tile"><div class="num">${r.gap}</div><div class="label">Development gaps</div></div>
        <div class="stat-tile"><div class="num">${r.total}</div><div class="label">Skills assessed</div></div>
      </div>
    </div>
    <div class="card">
      <h2>Skill-by-skill readiness</h2>
      <table class="skills-table">
        <thead><tr><th>SFIA code</th><th>Skill</th><th>Required</th><th>Your level</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>
          ${r.details.map(d => `
            <tr>
              <td data-label="SFIA code">${escapeHtml(d.skillCode)}</td>
              <td data-label="Skill">${escapeHtml(d.skillName)}</td>
              <td data-label="Required"><span class="level-pill">L${d.requiredLevel.number}</span></td>
              <td data-label="Your level">${d.selfLevel ? `<span class="level-pill">L${d.selfLevel.number}</span>` : '&mdash;'}</td>
              <td data-label="Status">${statusChip(d.status, d.levelDiff)}</td>
              <td data-label="Action">${d.status === 'gap' ? `<button class="btn btn-secondary btn-sm" data-add-plan="${d.sfiaSkillId}" data-level="${d.requiredLevel.number}" type="button">Add to plan</button>` : ''}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div class="actions-row">
        <a class="btn btn-secondary" href="plan.html">My development plan</a>
        <a class="btn btn-secondary" href="dashboard.html">Back to dashboard</a>
        <a class="btn btn-secondary" href="role.html?id=${r.role.id}">View role profile</a>
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
  if (!id) { container.innerHTML = '<div class="card"><div class="empty-state">No assessment specified.</div></div>'; return; }

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
