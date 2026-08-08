// Patrol Points - single competition: lifecycle, teams, categories, scoring,
// approvals and the live leaderboard.
let C, TEAMS, CATS, PARTS, SUBS, BOARD, ACT, META, ID;
const SKEY = { draft: 'suspended', open: 'active', paused: 'pending_approval', completed: 'active', archived: 'deleted' };
const SUB_SKEY = { pending: 'pending_approval', approved: 'active', rejected: 'deleted', returned: 'suspended', withdrawn: 'deleted', superseded: 'suspended' };
const SUB_LABEL = { pending: 'pending', approved: 'approved', rejected: 'rejected', returned: 'returned', withdrawn: 'withdrawn', superseded: 'superseded' };
const esc = s => escapeHtml(s == null ? '' : String(s));

(async () => {
  const me = await requireUserNav();
  if (!me) return;
  ID = new URLSearchParams(location.search).get('id');
  document.getElementById('pp-head').innerHTML = '<a class="btn btn-secondary" href="patrol-points.html">Back</a>';
  if (!ID) { document.getElementById('content').innerHTML = '<div class="alert alert-error">No competition specified.</div>'; return; }
  load();
})();

async function load() {
  const box = document.getElementById('content');
  let d;
  try { d = await Api.get(`/api/patrol-points/competitions/${ID}`); }
  catch (e) { box.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; return; }
  C = d.competition; TEAMS = d.teams; CATS = d.categories; PARTS = d.participants || []; SUBS = d.submissions; BOARD = d.leaderboard; ACT = d.myActions; META = d.meta;
  document.getElementById('pp-title').textContent = C.name;
  document.getElementById('pp-head').innerHTML = (ACT.canSubmit ? `<a class="btn" href="patrol-score.html?id=${ID}">Quick Score</a>` : '') + lifecycleButtons() + '<a class="btn btn-secondary" href="patrol-points.html">Back</a>';
  const editable = ACT.canManage && ['draft', 'open', 'paused'].includes(C.status);
  box.innerHTML = summaryCard() + leaderboardCard() + (ACT.canSubmit ? submitCard() : '')
    + ((editable || TEAMS.length) ? teamsCard(!editable) : '')
    + (editable ? membersCard() + categoriesCard() : '') + submissionsCard()
    + (ACT.canManage ? reportsCard() : '');
  wire();
}

function lifecycleButtons() {
  if (!ACT.canManage) return '';
  const label = { open: C.status === 'paused' ? 'Resume' : 'Open', paused: 'Pause', completed: 'Complete', archived: 'Archive' };
  const btns = (META.transitions[C.status] || []).map(t =>
    `<button class="btn btn-secondary pp-status" data-to="${t}">${label[t] || t}</button>`).join('');
  const del = C.status === 'draft' ? '<button class="btn btn-secondary" id="pp-delete">Delete</button>' : '';
  return btns + del;
}

function summaryCard() {
  return `<div class="card">
    <div class="cap-head"><h2 style="margin:0">${esc(C.name)}</h2>
      <span class="badge" data-status="${SKEY[C.status] || 'suspended'}">${esc(C.statusLabel)}</span></div>
    ${C.description ? `<p>${esc(C.description)}</p>` : ''}
    <p class="muted">Scoring approval: ${esc(C.approvalModeLabel)}${C.completedAt ? ' · Completed ' + formatDate(C.completedAt) : ''}</p>
    ${ACT.canManage && ['draft', 'open', 'paused'].includes(C.status)
      ? `<div class="field" style="margin:0"><label style="font-weight:400"><input type="checkbox" id="pp-deduct"${C.allowDeductions ? ' checked' : ''}> Allow deductions (negative points)</label></div>`
      : `<p class="muted">Deductions: ${C.allowDeductions ? 'allowed' : 'off'}</p>`}
    <div id="pp-msg"></div></div>`;
}

function leaderboardCard() {
  const rows = BOARD.length ? BOARD.map(r => `<tr>
      <td data-label="Position"><strong>${r.position}</strong></td>
      <td data-label="Team" class="rcard-title">${esc(r.teamName)}</td>
      <td data-label="Total"><strong>${r.total}</strong></td>
    </tr>`).join('') : '<tr><td colspan="3" class="muted">No teams yet.</td></tr>';
  return `<div class="card card-accent accent-yellow"><h2>Leaderboard</h2>
    <table class="data-table rcards"><thead><tr><th>Position</th><th>Team</th><th>Total points</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p class="field help">Totals reflect approved scores only; tied teams share a position.</p></div>`;
}

function teamsCard(readOnly) {
  const byTeam = {}; TEAMS.forEach(t => byTeam[t.id] = []);
  PARTS.forEach(p => (byTeam[p.teamId] = byTeam[p.teamId] || []).push(p));
  const teamOpts = (sel) => TEAMS.map(t => `<option value="${t.id}"${t.id === sel ? ' selected' : ''}>${esc(t.name)}</option>`).join('');
  const chip = (p, teamId) => readOnly
    ? `<span class="pp-chip">${esc(p.name)}${p.patrol ? ` <span class="muted">(${esc(p.patrol)})</span>` : ''}</span>`
    : `<span class="pp-chip">${esc(p.name)}<select class="pp-move" data-id="${p.id}" title="Move team">${teamOpts(teamId)}</select><button class="pp-chip-x pp-part-del" data-id="${p.id}" title="Remove">×</button></span>`;
  const block = (t) => {
    const members = byTeam[t.id] || [];
    return `<div class="pp-team">
      <div class="cap-head" style="align-items:center">
        ${readOnly ? `<strong>${esc(t.name)}</strong>` : `<input class="pp-team-name" data-id="${t.id}" value="${esc(t.name)}" style="max-width:240px">`}
        <span class="muted">${members.length} member${members.length === 1 ? '' : 's'}</span></div>
      <div class="pp-chips">${members.length ? members.map(p => chip(p, t.id)).join('') : '<span class="muted">No members yet.</span>'}</div>
      ${readOnly ? '' : `<div style="margin-top:.3rem"><button class="btn btn-secondary btn-sm pp-team-del" data-id="${t.id}">Remove team</button></div>`}
    </div>`;
  };
  return `<div class="card"><h2>Teams &amp; members</h2>
    ${TEAMS.length ? TEAMS.map(block).join('') : '<p class="muted">No teams yet.</p>'}
    ${readOnly ? '' : `<div class="cap-actions" style="margin-top:.6rem"><input id="pp-team-new" placeholder="New team name"><button class="btn btn-secondary" id="pp-team-add">Add team</button></div>`}
  </div>`;
}

function membersCard() {
  const hasSections = (META.sections || []).length > 0;
  const sectionOpts = (META.sections || []).map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  const teamOpts = TEAMS.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
  return `<div class="card"><h2>Add members</h2>
    ${hasSections ? `
    <h3 style="margin:.2rem 0 .3rem;font-size:1rem">From an OSM section</h3>
    <div class="cap-actions"><select id="pp-r-section">${sectionOpts}</select><button class="btn btn-secondary" id="pp-r-load">Load roster</button></div>
    <div id="pp-roster"></div>
    <h3 style="margin:.9rem 0 .3rem;font-size:1rem">Auto-generate balanced teams</h3>
    <div class="cap-actions"><select id="pp-a-section">${sectionOpts}</select>
      <label class="muted">Teams <input id="pp-a-count" type="number" min="2" max="12" value="4" style="width:70px"></label>
      <button class="btn btn-secondary" id="pp-a-go">Generate</button></div>
    <p class="field help">Creates the teams and shares the section's members out evenly; edit afterwards as needed.</p>` : '<p class="muted">Sign in with an OSM leader account to add young people from a section.</p>'}
    <h3 style="margin:.9rem 0 .3rem;font-size:1rem">Add someone manually</h3>
    <div class="cap-actions"><input id="pp-m-name" placeholder="Name"><select id="pp-m-team">${teamOpts}</select>
      <button class="btn btn-secondary" id="pp-m-add"${TEAMS.length ? '' : ' disabled'}>Add</button></div>
    <div id="pp-m-msg"></div>
  </div>`;
}

async function loadRoster() {
  const sid = document.getElementById('pp-r-section').value;
  const host = document.getElementById('pp-roster');
  host.innerHTML = '<p class="muted">Loading roster&hellip;</p>';
  let data;
  try { data = await Api.get(`/api/patrol-points/competitions/${ID}/roster?sectionId=${encodeURIComponent(sid)}`); }
  catch (e) { host.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; return; }
  if (!data.members.length) { host.innerHTML = '<p class="muted">No members found for that section.</p>'; return; }
  const teamOpts = TEAMS.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
  host.innerHTML = `<div class="af-sections" style="margin-top:.4rem">${data.members.map(m => `
      <label class="af-sec-opt"><input type="checkbox" class="pp-r-mem" data-ref="${esc(m.id)}" data-name="${esc(m.name)}" data-patrol="${esc(m.patrol || '')}"${m.alreadyIn ? ' disabled' : ''}> ${esc(m.name)}${m.patrol ? ` <span class="muted">(${esc(m.patrol)})</span>` : ''}${m.alreadyIn ? ' <span class="muted">— already in</span>' : ''}</label>`).join('')}</div>
    <div class="cap-actions" style="margin-top:.5rem"><select id="pp-r-team">${teamOpts}</select><button class="btn btn-secondary" id="pp-r-add"${TEAMS.length ? '' : ' disabled'}>Add selected</button></div>`;
  const addBtn = document.getElementById('pp-r-add');
  if (addBtn) addBtn.addEventListener('click', async () => {
    const members = Array.from(document.querySelectorAll('.pp-r-mem:checked')).map(el => ({ personRef: el.dataset.ref, displayName: el.dataset.name, patrol: el.dataset.patrol }));
    if (!members.length) return;
    try { await Api.post(`/api/patrol-points/competitions/${ID}/participants`, { teamId: Number(document.getElementById('pp-r-team').value), members }); load(); }
    catch (e) { alert(e.message); }
  });
}

function categoriesCard() {
  const list = CATS.length ? CATS.map(c => `<tr>
      <td data-label="Category" class="rcard-title">${esc(c.name)}<br>
        <span class="muted" style="font-size:.8rem">Quick Score buttons: ${(c.pointButtons || []).map(n => (n >= 0 ? '+' : '') + n).join(' ')} · reasons: ${(c.reasonPresets || []).length}
        <button class="btn-link pp-cat-cfg" data-id="${c.id}" style="background:none;border:0;color:var(--purple);cursor:pointer;padding:0">edit</button></span>
        <div class="pp-cat-cfg-slot" data-id="${c.id}"></div></td>
      <td data-label="Type" class="muted">${esc(c.pointsTypeLabel)}${c.pointsType === 'fixed' ? ` (${c.fixedPoints})` : ''}</td>
      <td style="text-align:right"><button class="btn btn-secondary btn-sm pp-cat-del" data-id="${c.id}">Remove</button></td>
    </tr>`).join('') : '<tr><td colspan="3" class="muted">No categories yet.</td></tr>';
  return `<div class="card"><h2>Scoring categories</h2>
    <table class="data-table rcards"><tbody>${list}</tbody></table>
    <div class="cap-actions" style="margin-top:.6rem;align-items:flex-end">
      <div class="field" style="margin:0"><label>Name</label><input id="pp-cat-name" placeholder="e.g. Tidiest tent"></div>
      <div class="field" style="margin:0"><label>Type</label><select id="pp-cat-type">
        ${Object.entries(META.pointsTypes).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}
      </select></div>
      <div class="field" style="margin:0" id="pp-cat-fixed-wrap" hidden><label>Fixed points</label><input id="pp-cat-fixed" type="number" value="10" style="width:100px"></div>
      <button class="btn btn-secondary" id="pp-cat-add">Add category</button>
    </div></div>`;
}

function submitCard() {
  if (!TEAMS.length || !CATS.length) return '';
  return `<div class="card"><h2>Award points</h2>
    <div class="field"><label>Category</label><select id="pp-s-cat">
      ${CATS.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
    </select></div>
    <div id="pp-s-teams"></div>
    <div class="field"><label>Comment (required)</label><textarea id="pp-s-comment" rows="2" placeholder="Why these points were awarded"></textarea></div>
    <button class="btn" id="pp-s-save">Submit scores</button>
    <div id="pp-s-msg"></div></div>`;
}

function renderScoreInputs() {
  const host = document.getElementById('pp-s-teams');
  if (!host) return;
  const cat = CATS.find(c => c.id === Number(document.getElementById('pp-s-cat').value));
  const fixed = cat && cat.pointsType === 'fixed';
  host.innerHTML = `<div class="af-sections">${TEAMS.map(t => fixed
    ? `<label class="af-sec-opt"><input type="checkbox" class="pp-s-team" data-id="${t.id}"> ${esc(t.name)} <span class="muted">(+${cat.fixedPoints})</span></label>`
    : `<label class="af-sec-opt" style="justify-content:space-between">${esc(t.name)} <input type="number" class="pp-s-team" data-id="${t.id}" style="width:90px" placeholder="pts"></label>`
  ).join('')}</div>`;
}

function submissionsCard() {
  if (!SUBS.length) return '<div class="card"><h2>Score history</h2><p class="muted">No scores submitted yet.</p></div>';
  const openComp = ['open', 'paused'].includes(C.status);
  const rows = SUBS.map(s => {
    const lines = s.lines.map(l => `${esc(l.teamName)}: ${l.points >= 0 ? '+' : ''}${l.points}`).join(' · ');
    const mine = s.submittedById === ACT.userId;
    const dim = ['withdrawn', 'superseded', 'rejected'].includes(s.status) ? ' style="opacity:.6"' : '';
    let actions = '';
    if (openComp && s.status === 'pending' && ACT.canManage && !mine) {
      actions = `<div class="cap-actions" style="margin-top:.4rem">
        <input class="pp-d-comment" data-id="${s.id}" placeholder="Comment (needed to reject/return)" style="flex:1;min-width:180px">
        <button class="btn btn-sm pp-approve" data-id="${s.id}">Approve</button>
        <button class="btn btn-secondary btn-sm pp-return" data-id="${s.id}">Return</button>
        <button class="btn btn-secondary btn-sm pp-reject" data-id="${s.id}">Reject</button></div>`;
    } else if (openComp && mine && ['pending', 'returned'].includes(s.status)) {
      actions = `<div class="cap-actions" style="margin-top:.4rem">
        ${s.status === 'pending' ? '<span class="field help" style="margin:0">Awaiting another leader\'s approval.</span>' : ''}
        <button class="btn btn-secondary btn-sm pp-amend" data-id="${s.id}" style="margin-left:auto">Amend</button>
        <button class="btn btn-secondary btn-sm pp-withdraw" data-id="${s.id}">Withdraw</button></div>`;
    } else if (openComp && s.status === 'approved' && ACT.canManage) {
      actions = `<div class="cap-actions" style="margin-top:.4rem"><button class="btn btn-secondary btn-sm pp-revise" data-id="${s.id}" style="margin-left:auto">Propose correction</button></div>`;
    }
    return `<div${dim} style="padding:.5rem 0;border-bottom:1px solid var(--border)">
      <div class="cap-head"><strong>${esc(s.categoryName)}${s.isRevision ? ' <span class="muted">· correction</span>' : ''}</strong>
        <span class="badge" data-status="${SUB_SKEY[s.status]}">${esc(SUB_LABEL[s.status] || s.status)}</span></div>
      <div>${lines}</div>
      <div class="muted" style="font-size:.85rem">“${esc(s.comment)}” — ${esc(s.submittedBy)}${s.decidedBy ? ` · decided by ${esc(s.decidedBy)}` : ''}${s.decisionComment ? ` — ${esc(s.decisionComment)}` : ''}</div>
      ${actions}
      <div class="pp-editor-slot" data-id="${s.id}"></div></div>`;
  }).join('');
  return `<div class="card"><h2>Score history</h2>${rows}</div>`;
}

// Reports: on-screen summary (computed from loaded data) + server-side CSV exports.
function reportsCard() {
  const eff = SUBS.filter(s => s.status === 'approved');
  const byCat = {}; let awarded = 0, deducted = 0;
  eff.forEach(s => s.lines.forEach(l => {
    byCat[s.categoryName] = (byCat[s.categoryName] || 0) + l.points;
    if (l.points >= 0) awarded += l.points; else deducted += l.points;
  }));
  const counts = {}; SUBS.forEach(s => counts[s.status] = (counts[s.status] || 0) + 1);
  const catRows = Object.keys(byCat).length
    ? Object.entries(byCat).map(([n, v]) => `<tr><td data-label="Category">${esc(n)}</td><td data-label="Effective points">${v}</td></tr>`).join('')
    : '<tr><td colspan="2" class="muted">No approved scores yet.</td></tr>';
  const chips = Object.entries(counts).map(([k, v]) => `${SUB_LABEL[k] || k}: ${v}`).join(' · ');
  const base = `/api/patrol-points/competitions/${ID}/export`;
  return `<div class="card"><h2>Reports</h2>
    <div class="cap-stats">
      <div class="card" style="margin:0"><div class="muted">Points awarded</div><div class="cap-big">${awarded}</div></div>
      <div class="card" style="margin:0"><div class="muted">Deductions</div><div class="cap-big">${deducted}</div></div>
    </div>
    <h3 style="font-size:1rem;margin:.6rem 0 .3rem">Effective points by category</h3>
    <table class="data-table rcards"><thead><tr><th>Category</th><th>Effective points</th></tr></thead><tbody>${catRows}</tbody></table>
    <p class="muted" style="margin-top:.5rem">Submissions — ${chips || '—'}</p>
    <div class="cap-actions" style="margin-top:.6rem">
      <a class="btn btn-secondary" href="${base}/results.csv">Final results (CSV)</a>
      <a class="btn btn-secondary" href="${base}/points.csv">Points history (CSV)</a>
      <a class="btn btn-secondary" href="${base}/approvals.csv">Approval activity (CSV)</a>
    </div></div>`;
}

// Inline editor for amending a pending/returned submission or proposing a correction.
function scoreEditor(s, mode) {
  const cat = CATS.find(c => c.id === s.categoryId) || { pointsType: 'free' };
  const fixed = cat.pointsType === 'fixed';
  const existing = {}; s.lines.forEach(l => existing[l.teamId] = l.points);
  const inputs = TEAMS.map(t => fixed
    ? `<label class="af-sec-opt"><input type="checkbox" class="pp-e-team" data-id="${t.id}"${existing[t.id] !== undefined ? ' checked' : ''}> ${esc(t.name)} <span class="muted">(+${cat.fixedPoints})</span></label>`
    : `<label class="af-sec-opt" style="justify-content:space-between">${esc(t.name)} <input type="number" class="pp-e-team" data-id="${t.id}" style="width:90px" value="${existing[t.id] !== undefined ? existing[t.id] : ''}" placeholder="pts"></label>`).join('');
  return `<div class="card" style="margin:.4rem 0;background:var(--bg)">
    <strong>${mode === 'revise' ? 'Propose correction' : 'Amend score'} — ${esc(s.categoryName)}</strong>
    <div class="af-sections" style="margin-top:.4rem">${inputs}</div>
    <div class="field"><label>${mode === 'revise' ? 'Reason for the correction' : 'Comment'} (required)</label><textarea class="pp-e-comment" rows="2">${mode === 'amend' ? esc(s.comment) : ''}</textarea></div>
    <div class="cap-actions"><button class="btn btn-sm pp-e-save" data-mode="${mode}" data-id="${s.id}">${mode === 'revise' ? 'Submit correction' : 'Save'}</button><button class="btn btn-secondary btn-sm pp-e-cancel" data-id="${s.id}">Cancel</button></div>
    <div class="pp-e-msg"></div></div>`;
}
function openEditor(id, mode) {
  const s = SUBS.find(x => x.id === id);
  const slot = document.querySelector(`.pp-editor-slot[data-id="${id}"]`);
  if (!s || !slot) return;
  slot.innerHTML = scoreEditor(s, mode);
  slot.querySelector('.pp-e-cancel').addEventListener('click', () => slot.innerHTML = '');
  slot.querySelector('.pp-e-save').addEventListener('click', async () => {
    const emsg = slot.querySelector('.pp-e-msg');
    const lines = [];
    slot.querySelectorAll('.pp-e-team').forEach(el => {
      if (el.type === 'checkbox') { if (el.checked) lines.push({ teamId: Number(el.dataset.id), points: 0 }); }
      else if (el.value.trim() !== '') lines.push({ teamId: Number(el.dataset.id), points: Number(el.value) });
    });
    const comment = slot.querySelector('.pp-e-comment').value.trim();
    if (!lines.length) { emsg.innerHTML = '<div class="alert alert-error">Score at least one team.</div>'; return; }
    if (!comment) { emsg.innerHTML = '<div class="alert alert-error">A comment is required.</div>'; return; }
    try {
      if (mode === 'revise') await Api.post(`/api/patrol-points/competitions/${ID}/submissions/${id}/revise`, { comment, lines });
      else await Api.patch(`/api/patrol-points/competitions/${ID}/submissions/${id}`, { comment, lines });
      load();
    } catch (e) { emsg.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  });
}

function wire() {
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  const msg = (t, err) => { const m = document.getElementById('pp-msg'); if (m) m.innerHTML = `<div class="alert alert-${err ? 'error' : 'success'}">${escapeHtml(t)}</div>`; };

  document.querySelectorAll('.pp-status').forEach(b => b.addEventListener('click', async () => {
    try { await Api.post(`/api/patrol-points/competitions/${ID}/status`, { status: b.dataset.to }); load(); }
    catch (e) { msg(e.message, true); }
  }));
  on('pp-delete', async () => { if (!confirm('Delete this draft competition?')) return; try { await Api.delete(`/api/patrol-points/competitions/${ID}`); location.href = 'patrol-points.html'; } catch (e) { msg(e.message, true); } });
  const deduct = document.getElementById('pp-deduct');
  if (deduct) deduct.addEventListener('change', async () => {
    try { await Api.patch(`/api/patrol-points/competitions/${ID}`, { allowDeductions: deduct.checked }); load(); } catch (e) { msg(e.message, true); }
  });

  // Teams
  on('pp-team-add', async () => {
    const name = document.getElementById('pp-team-new').value.trim();
    if (!name) return;
    try { await Api.post(`/api/patrol-points/competitions/${ID}/teams`, { name }); load(); } catch (e) { msg(e.message, true); }
  });
  document.querySelectorAll('.pp-team-del').forEach(b => b.addEventListener('click', async () => {
    try { await Api.delete(`/api/patrol-points/competitions/${ID}/teams/${b.dataset.id}`); load(); } catch (e) { msg(e.message, true); }
  }));
  document.querySelectorAll('.pp-team-name').forEach(inp => inp.addEventListener('change', async () => {
    try { await Api.patch(`/api/patrol-points/competitions/${ID}/teams/${inp.dataset.id}`, { name: inp.value.trim() }); load(); } catch (e) { msg(e.message, true); }
  }));

  // Members / participants
  on('pp-r-load', loadRoster);
  document.querySelectorAll('.pp-move').forEach(sel => sel.addEventListener('change', async () => {
    try { await Api.patch(`/api/patrol-points/competitions/${ID}/participants/${sel.dataset.id}`, { teamId: Number(sel.value) }); load(); } catch (e) { msg(e.message, true); }
  }));
  document.querySelectorAll('.pp-part-del').forEach(b => b.addEventListener('click', async () => {
    try { await Api.delete(`/api/patrol-points/competitions/${ID}/participants/${b.dataset.id}`); load(); } catch (e) { msg(e.message, true); }
  }));
  on('pp-m-add', async () => {
    const name = document.getElementById('pp-m-name').value.trim();
    const mmsg = document.getElementById('pp-m-msg');
    if (!name) { mmsg.innerHTML = '<div class="alert alert-error">A name is required.</div>'; return; }
    try { await Api.post(`/api/patrol-points/competitions/${ID}/participants`, { teamId: Number(document.getElementById('pp-m-team').value), displayName: name }); load(); }
    catch (e) { mmsg.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  });
  on('pp-a-go', async () => {
    const mmsg = document.getElementById('pp-m-msg');
    try {
      const r = await Api.post(`/api/patrol-points/competitions/${ID}/auto-teams`, { sectionId: document.getElementById('pp-a-section').value, teamCount: Number(document.getElementById('pp-a-count').value) });
      mmsg.innerHTML = `<div class="alert alert-success">Created ${r.teams} teams and placed ${r.assigned} members.</div>`;
      load();
    } catch (e) { mmsg.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  });

  // Categories
  const catType = document.getElementById('pp-cat-type');
  if (catType) catType.addEventListener('change', () => { document.getElementById('pp-cat-fixed-wrap').hidden = catType.value !== 'fixed'; });
  on('pp-cat-add', async () => {
    const name = document.getElementById('pp-cat-name').value.trim();
    if (!name) return;
    const body = { name, pointsType: catType.value };
    if (catType.value === 'fixed') body.fixedPoints = Number(document.getElementById('pp-cat-fixed').value);
    try { await Api.post(`/api/patrol-points/competitions/${ID}/categories`, body); load(); } catch (e) { msg(e.message, true); }
  });
  document.querySelectorAll('.pp-cat-del').forEach(b => b.addEventListener('click', async () => {
    try { await Api.delete(`/api/patrol-points/competitions/${ID}/categories/${b.dataset.id}`); load(); } catch (e) { msg(e.message, true); }
  }));
  document.querySelectorAll('.pp-cat-cfg').forEach(b => b.addEventListener('click', () => {
    const c = CATS.find(x => x.id === Number(b.dataset.id));
    const slot = document.querySelector(`.pp-cat-cfg-slot[data-id="${b.dataset.id}"]`);
    if (!c || !slot) return;
    if (slot.innerHTML) { slot.innerHTML = ''; return; }
    slot.innerHTML = `<div style="margin:.4rem 0;padding:.5rem;background:var(--bg);border-radius:8px">
      <div class="field" style="margin:0 0 .4rem"><label>Point buttons (comma-separated)</label><input class="pp-cfg-btns" value="${esc((c.pointButtons || []).join(', '))}"></div>
      <div class="field" style="margin:0 0 .4rem"><label>Reason presets (comma-separated)</label><input class="pp-cfg-reasons" value="${esc((c.reasonPresets || []).join(', '))}"></div>
      <button class="btn btn-secondary btn-sm pp-cfg-save">Save</button></div>`;
    slot.querySelector('.pp-cfg-save').addEventListener('click', async () => {
      const pointButtons = slot.querySelector('.pp-cfg-btns').value.split(',').map(s => s.trim()).filter(s => s !== '' && !isNaN(Number(s))).map(Number);
      const reasonPresets = slot.querySelector('.pp-cfg-reasons').value.split(',').map(s => s.trim()).filter(Boolean);
      try { await Api.patch(`/api/patrol-points/competitions/${ID}/categories/${c.id}`, { pointButtons, reasonPresets }); load(); } catch (e) { msg(e.message, true); }
    });
  }));

  // Scoring
  const catSel = document.getElementById('pp-s-cat');
  if (catSel) { catSel.addEventListener('change', renderScoreInputs); renderScoreInputs(); }
  on('pp-s-save', async () => {
    const smsg = document.getElementById('pp-s-msg');
    const lines = [];
    document.querySelectorAll('.pp-s-team').forEach(el => {
      if (el.type === 'checkbox') { if (el.checked) lines.push({ teamId: Number(el.dataset.id), points: 0 }); }
      else if (el.value.trim() !== '') lines.push({ teamId: Number(el.dataset.id), points: Number(el.value) });
    });
    const comment = document.getElementById('pp-s-comment').value.trim();
    if (!lines.length) { smsg.innerHTML = '<div class="alert alert-error">Score at least one team.</div>'; return; }
    if (!comment) { smsg.innerHTML = '<div class="alert alert-error">A comment is required.</div>'; return; }
    try {
      const r = await Api.post(`/api/patrol-points/competitions/${ID}/submissions`, { categoryId: Number(catSel.value), comment, lines });
      smsg.innerHTML = `<div class="alert alert-success">${r.status === 'pending' ? 'Submitted for approval.' : 'Scores recorded.'}</div>`;
      load();
    } catch (e) { smsg.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  });

  // Approvals
  const decide = (cls, action) => document.querySelectorAll(cls).forEach(b => b.addEventListener('click', async () => {
    const comment = (document.querySelector(`.pp-d-comment[data-id="${b.dataset.id}"]`) || {}).value || '';
    try { await Api.post(`/api/patrol-points/competitions/${ID}/submissions/${b.dataset.id}/${action}`, { comment }); load(); }
    catch (e) { msg(e.message, true); }
  }));
  decide('.pp-approve', 'approve');
  decide('.pp-reject', 'reject');
  decide('.pp-return', 'return');

  // Withdraw / amend / correct
  document.querySelectorAll('.pp-withdraw').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Withdraw this submission?')) return;
    try { await Api.post(`/api/patrol-points/competitions/${ID}/submissions/${b.dataset.id}/withdraw`, {}); load(); } catch (e) { msg(e.message, true); }
  }));
  document.querySelectorAll('.pp-amend').forEach(b => b.addEventListener('click', () => openEditor(Number(b.dataset.id), 'amend')));
  document.querySelectorAll('.pp-revise').forEach(b => b.addEventListener('click', () => openEditor(Number(b.dataset.id), 'revise')));
}
