// OSM Discovery & Capability Registry (Master FRD v3.4). One admin-only page with three
// surfaces (spec s2): summary (SCR-181), run detail (SCR-182), capability detail (SCR-183),
// switched by ?run=<id> / ?cap=<key>. Read-only: no control here mutates OSM or enables a
// feature. Every capability status shown carries a stated source (evidence).

let ME = null;
const box = () => document.getElementById('content');
const esc = (s) => escapeHtml(s == null ? '' : String(s));
const fmt = (dt) => (typeof formatDateTime === 'function' && dt) ? formatDateTime(dt) : (dt || '&mdash;');

function pill(status, label) {
  return `<span class="osmd-pill osmd-${esc(status)}">${esc(label || status)}</span>`;
}
function readinessLabel(r) {
  return { ready: 'Ready', partial: 'Partial', permission_gap: 'Permission gap', not_ready: 'Not ready' }[r] || r;
}

(async () => {
  ME = await requireUserNav();
  if (!ME) return;
  if (ME.role !== 'admin') {
    renderPageHeader({ title: 'OSM Discovery', crumbs: crumbs() });
    box().innerHTML = '<div class="alert alert-error">Portal Administrator access required.</div>';
    return;
  }
  route();
  window.addEventListener('popstate', route);
})();

function crumbs(extra) {
  const base = [
    { label: 'Admin', href: 'admin.html' },
    { label: 'Integrations', href: 'admin.html?tab=health' },
    { label: 'OSM', href: 'admin.html?tab=health' },
  ];
  if (extra) return base.concat(extra);
  return base.concat([{ label: 'Discovery' }]);
}

function route() {
  const p = new URLSearchParams(location.search);
  if (p.get('run')) return renderRun(p.get('run'));
  if (p.get('cap')) return renderCapability(p.get('cap'));
  return renderSummary();
}

function go(qs) {
  history.pushState({}, '', 'osm-discovery.html' + (qs ? ('?' + qs) : ''));
  route();
}

// ── Summary (SCR-181) ────────────────────────────────────────────────────────
let SUMMARY = null;
async function renderSummary() {
  renderPageHeader({
    title: 'OSM Discovery',
    crumbs: crumbs(),
    description: 'A read-only check of which OSM data capabilities the connected context exposes. Discovery records evidence; it never enables a feature or changes OSM.',
    actions: `<label class="osmd-tokenlabel">Read as
      <select id="osmd-token"><option value="service">Service connection</option><option value="me">My OSM sign-in</option></select></label>
      <button class="btn" id="osmd-run">Run discovery</button>
      <button class="btn btn-secondary" id="osmd-run-ext">Extended read validation</button>`,
  });
  box().innerHTML = '<p class="muted">Loading&hellip;</p>';
  let d;
  try { d = await Api.get('/api/osm/discovery'); } catch (e) { box().innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`; return; }
  SUMMARY = d;
  const counts = (d.lastRun && d.lastRun.summary && d.lastRun.summary.counts) || {};
  const ch = (d.lastRun && d.lastRun.changes) || {};
  const statusLabel = (k) => (d.statuses.find(s => s.key === k) || {}).label || k;

  const tiles = ['available', 'partial', 'permission_limited', 'unknown', 'error']
    .map(k => `<div class="osmd-tile"><div class="n">${counts[k] || 0}</div><div class="l">${esc(statusLabel(k))}</div></div>`).join('');

  const changeRows = [];
  (ch.newlyAvailable || []).forEach(k => changeRows.push(`<div class="chg osmd-chg-new">+ ${esc(capLabel(d, k))}: now available</div>`));
  (ch.lost || []).forEach(k => changeRows.push(`<div class="chg osmd-chg-lost">- ${esc(capLabel(d, k))}: lost</div>`));
  (ch.statusChanged || []).forEach(c => changeRows.push(`<div class="chg">~ ${esc(capLabel(d, c.key))}: ${esc(statusLabel(c.from))} &rarr; ${esc(statusLabel(c.to))}</div>`));
  (ch.scopeChanged || []).forEach(k => changeRows.push(`<div class="chg">~ ${esc(capLabel(d, k))}: scope changed</div>`));

  box().innerHTML = `
    ${d.stale ? '<div class="alert alert-warning">The most recent discovery run did not complete, so the capabilities below are the last known state and may be stale.</div>' : ''}
    <div class="card">
      <h2>Connection</h2>
      <p>${esc((d.context && d.context.account) || 'OSM context')}${d.context && d.context.demo ? ' <span class="badge" data-status="draft">demo</span>' : ''}
        ${d.context && d.context.connected ? '' : ' <span class="badge" data-status="suspended">not connected</span>'}</p>
      <p class="muted">Connector ${esc(d.connectorVersion)}${d.lastRun ? ' &middot; last completed ' + fmt(d.lastRun.completedAt) : ''}${d.lastRun && d.lastRun.context && d.lastRun.context.readVia ? ' &middot; read via ' + (d.lastRun.context.readVia === 'me' ? 'an administrator OSM sign-in' : 'the service connection') : ''}</p>
      ${d.lastRun ? `<div class="osmd-summary-tiles">${tiles}</div>` : '<p class="muted">No discovery has been run yet. Use Run discovery to build the capability registry.</p>'}
    </div>

    ${d.lastRun ? `<div class="card">
      <h2>Changes since the previous run</h2>
      ${changeRows.length ? `<div class="osmd-changes">${changeRows.join('')}</div>` : '<p class="muted">No capability or scope changes since the previous completed run.</p>'}
    </div>` : ''}

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.5rem">
        <h2 style="margin:0">Capabilities</h2>
        <div>
          <a class="btn btn-sm btn-secondary" id="osmd-export" href="#">Export report</a>
          <a class="btn btn-sm btn-secondary" href="osm-discovery.html?runs=1" id="osmd-runs">Compare runs</a>
        </div>
      </div>
      <div class="osmd-filters">
        <label>Status <select id="osmd-f-status"><option value="">All</option>${d.statuses.map(s => `<option value="${esc(s.key)}">${esc(s.label)}</option>`).join('')}</select></label>
        <label><input type="checkbox" id="osmd-f-changed"> Changed since last run</label>
      </div>
      <div class="osmd-table-wrap">
        <table class="data-table">
          <thead><tr><th>Capability</th><th>Status</th><th>Sections</th><th>Last tested</th><th>Dependent features</th><th></th></tr></thead>
          <tbody id="osmd-rows"></tbody>
        </table>
      </div>
    </div>`;

  const runBtn = document.getElementById('osmd-run');
  if (runBtn) runBtn.addEventListener('click', () => doRun('safe'));
  const extBtn = document.getElementById('osmd-run-ext');
  if (extBtn) extBtn.addEventListener('click', () => doRun('extended'));
  const exportBtn = document.getElementById('osmd-export');
  if (exportBtn) exportBtn.addEventListener('click', showExport);
  const runsBtn = document.getElementById('osmd-runs');
  if (runsBtn) runsBtn.addEventListener('click', (e) => { e.preventDefault(); renderRunList(); });
  const changedKeys = new Set([...(ch.newlyAvailable || []), ...(ch.lost || []), ...(ch.statusChanged || []).map(c => c.key), ...(ch.scopeChanged || [])]);
  const drawRows = () => {
    const fs = document.getElementById('osmd-f-status').value;
    const fc = document.getElementById('osmd-f-changed').checked;
    const rows = d.registry.filter(r => (!fs || r.status === fs) && (!fc || changedKeys.has(r.key)));
    document.getElementById('osmd-rows').innerHTML = rows.length ? rows.map(r => `
      <tr>
        <td><strong>${esc(r.area)}</strong></td>
        <td>${pill(r.status, r.statusLabel)}</td>
        <td>${r.scope && r.scope.length ? esc(r.scope.join(', ')) : '<span class="muted">&mdash;</span>'}</td>
        <td class="muted">${r.lastTestedAt ? fmt(r.lastTestedAt) : 'not tested'}</td>
        <td>${(r.features || []).map(f => `<span class="osmd-feature">${esc(f)}</span>`).join('')}</td>
        <td><a class="btn btn-sm btn-secondary" href="osm-discovery.html?cap=${encodeURIComponent(r.key)}">Open</a></td>
      </tr>`).join('') : '<tr><td colspan="6" class="muted">No capabilities match the filter.</td></tr>';
  };
  document.getElementById('osmd-f-status').addEventListener('change', drawRows);
  document.getElementById('osmd-f-changed').addEventListener('change', drawRows);
  drawRows();
}

function capLabel(d, key) {
  const r = (d.registry || []).find(x => x.key === key);
  return r ? r.area : key;
}

async function doRun(mode) {
  const btns = document.querySelectorAll('#osmd-run, #osmd-run-ext');
  btns.forEach(b => b.disabled = true);
  const tokenSel = document.getElementById('osmd-token');
  const tokenSource = tokenSel ? tokenSel.value : 'service';
  try {
    await Api.post('/api/osm/discovery/runs', { mode, tokenSource });
    renderSummary();
  } catch (e) {
    btns.forEach(b => b.disabled = false);
    alert(e.message || 'Could not start discovery.');
  }
}

async function showExport() {
  let ex;
  try { ex = await Api.get('/api/osm/discovery/export'); } catch (e) { alert(e.message); return; }
  const text = JSON.stringify(ex, null, 2);
  const w = document.getElementById('osmd-export-panel') || (() => {
    const el = document.createElement('div'); el.id = 'osmd-export-panel'; el.className = 'card';
    box().appendChild(el); return el;
  })();
  w.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0">Discovery export</h2><button class="btn btn-sm btn-secondary" id="osmd-export-close">Close</button></div>
    <p class="muted">Permission-filtered evidence and aggregate metadata. No secrets or bulk personal data.</p>
    <textarea readonly rows="14" style="width:100%;font-family:monospace;font-size:.8rem">${esc(text)}</textarea>`;
  document.getElementById('osmd-export-close').addEventListener('click', () => w.remove());
  w.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── Run list / compare (reached from Compare runs) ─────────────────────────────
async function renderRunList() {
  renderPageHeader({ title: 'Discovery runs', crumbs: crumbs([{ label: 'Discovery', href: 'osm-discovery.html' }, { label: 'Runs' }]) });
  box().innerHTML = '<p class="muted">Loading&hellip;</p>';
  const d = await Api.get('/api/osm/discovery/runs');
  box().innerHTML = `<div class="card">
    <h2>Discovery runs</h2>
    <p class="muted">Each run is an immutable record of one discovery execution.</p>
    <div class="osmd-table-wrap"><table class="data-table">
      <thead><tr><th>Run</th><th>Mode</th><th>Status</th><th>Started</th><th>Completed</th><th></th></tr></thead>
      <tbody>${d.runs.map(r => `<tr>
        <td>#${r.id}</td><td>${esc(r.mode)}</td>
        <td>${esc(r.status)}</td>
        <td class="muted">${fmt(r.startedAt)}</td>
        <td class="muted">${r.completedAt ? fmt(r.completedAt) : '&mdash;'}</td>
        <td><a class="btn btn-sm btn-secondary" href="osm-discovery.html?run=${r.id}">Open</a></td>
      </tr>`).join('')}</tbody>
    </table></div>
    <p><a href="osm-discovery.html">&larr; Back to Discovery</a></p>
  </div>`;
}

// ── Run detail (SCR-182) ───────────────────────────────────────────────────────
async function renderRun(id) {
  renderPageHeader({ title: 'Discovery run #' + esc(id), crumbs: crumbs([{ label: 'Discovery', href: 'osm-discovery.html' }, { label: 'Run #' + id }]) });
  box().innerHTML = '<p class="muted">Loading&hellip;</p>';
  let d;
  try { d = await Api.get('/api/osm/discovery/runs/' + encodeURIComponent(id)); } catch (e) { box().innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`; return; }
  const run = d.run;
  const ctx = run.context || {};
  box().innerHTML = `
    <div class="card">
      <h2>Run #${run.id} <span class="badge" data-status="${run.status === 'complete' ? 'active' : 'suspended'}">${esc(run.status)}</span></h2>
      <p class="muted">Mode ${esc(run.mode)} &middot; connector ${esc(run.connectorVersion)} &middot; started ${fmt(run.startedAt)}${run.completedAt ? ' &middot; completed ' + fmt(run.completedAt) : ''}</p>
      <p>${esc(ctx.account || 'OSM context')}${ctx.sections && ctx.sections.length ? ' &middot; ' + ctx.sections.map(s => esc(s.name)).join(', ') : ''}</p>
      ${run.scopeNote ? `<p class="muted">${esc(run.scopeNote)}</p>` : ''}
    </div>
    <div class="card">
      <h2>Probe results</h2>
      <div class="osmd-table-wrap"><table class="data-table">
        <thead><tr><th>Capability</th><th>Status</th><th>Scope</th><th>Evidence</th><th>Dependent features</th></tr></thead>
        <tbody>${(d.results || []).map(r => `<tr>
          <td><a href="osm-discovery.html?cap=${encodeURIComponent(r.capability)}"><strong>${esc(r.area)}</strong></a></td>
          <td>${pill(r.status, r.statusLabel)}</td>
          <td>${r.scope && r.scope.length ? esc(r.scope.join(', ')) : '<span class="muted">&mdash;</span>'}</td>
          <td class="osmd-ev">${esc((r.evidence && r.evidence.detail) || '')}</td>
          <td>${(r.features || []).map(f => `<span class="osmd-feature">${esc(f)}</span>`).join('')}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>
    <p><a href="osm-discovery.html">&larr; Back to Discovery</a></p>`;
}

// ── Capability detail & history (SCR-183) ──────────────────────────────────────
async function renderCapability(key) {
  box().innerHTML = '<p class="muted">Loading&hellip;</p>';
  let d;
  try { d = await Api.get('/api/osm/discovery/capabilities/' + encodeURIComponent(key)); } catch (e) { box().innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`; return; }
  renderPageHeader({
    title: d.area,
    crumbs: crumbs([{ label: 'Discovery', href: 'osm-discovery.html' }, { label: d.area }]),
    status: { label: d.statusLabel, tone: d.status === 'available' ? 'ready' : (d.status === 'error' ? 'attention' : 'neutral') },
    actions: `<label class="osmd-tokenlabel">Read as
      <select id="osmd-cap-token"><option value="service">Service connection</option><option value="me">My OSM sign-in</option></select></label>
      <button class="btn btn-secondary" id="osmd-retest">Re-test</button>`,
  });
  box().innerHTML = `
    <div class="card">
      <h2>Status ${pill(d.status, d.statusLabel)}</h2>
      <p class="muted">${esc(d.checks)}</p>
      <p>Tested scope: ${d.scope && d.scope.length ? esc(d.scope.join(', ')) : '<span class="muted">no section scope</span>'}</p>
      <p>Last successful/attempted test: ${d.lastTestedAt ? fmt(d.lastTestedAt) : '<span class="muted">not tested</span>'}</p>
      ${d.evidence && d.evidence.detail ? `<p class="osmd-ev"><strong>Evidence:</strong> ${esc(d.evidence.detail)}</p>` : ''}
      <p class="muted">Discovery evidence never includes personal response bodies, tokens or secrets.</p>
    </div>
    <div class="card">
      <h2>Dependent 7thPortal features</h2>
      <p>${(d.features || []).map(f => `<span class="osmd-feature">${esc(f)}</span>`).join('')}</p>
      <p class="muted">Readiness: <strong>${esc(readinessLabel(d.readiness))}</strong>. Discovery reporting Available does not enable a feature; enablement stays a separate configuration decision.</p>
    </div>
    <div class="card">
      <h2>History</h2>
      ${(d.history || []).length ? `<div class="osmd-table-wrap"><table class="data-table">
        <thead><tr><th>Run</th><th>Status</th><th>Scope</th><th>Tested</th></tr></thead>
        <tbody>${d.history.map(h => `<tr><td><a href="osm-discovery.html?run=${h.runId}">#${h.runId}</a></td><td>${pill(h.status, h.statusLabel)}</td><td>${h.scope && h.scope.length ? esc(h.scope.join(', ')) : '<span class="muted">&mdash;</span>'}</td><td class="muted">${fmt(h.testedAt)}</td></tr>`).join('')}</tbody>
      </table></div>` : '<p class="muted">No history yet.</p>'}
    </div>
    <div class="card">
      <h2>Administrator notes</h2>
      <p class="muted">A note records a support/contract fact against this capability. It never edits recorded probe evidence.</p>
      <div id="osmd-notes">${notesHtml(d.notes)}</div>
      <div style="display:flex;gap:.5rem;margin-top:.6rem">
        <input id="osmd-note-input" placeholder="e.g. OSM support confirmed scope on 2026-09-11" style="flex:1">
        <button class="btn btn-sm" id="osmd-note-add">Add note</button>
      </div>
    </div>
    <p><a href="osm-discovery.html">&larr; Back to Discovery</a></p>`;

  document.getElementById('osmd-retest').addEventListener('click', async (e) => {
    e.target.disabled = true;
    const tokenSel = document.getElementById('osmd-cap-token');
    const tokenSource = tokenSel ? tokenSel.value : 'service';
    try { await Api.post('/api/osm/discovery/capabilities/' + encodeURIComponent(key) + '/retest', { mode: 'extended', tokenSource }); renderCapability(key); }
    catch (err) { e.target.disabled = false; alert(err.message); }
  });
  document.getElementById('osmd-note-add').addEventListener('click', async () => {
    const input = document.getElementById('osmd-note-input');
    const note = input.value.trim();
    if (!note) return;
    try {
      await Api.post('/api/osm/discovery/capabilities/' + encodeURIComponent(key) + '/notes', { note });
      const fresh = await Api.get('/api/osm/discovery/capabilities/' + encodeURIComponent(key));
      document.getElementById('osmd-notes').innerHTML = notesHtml(fresh.notes);
      input.value = '';
    } catch (err) { alert(err.message); }
  });
}

function notesHtml(notes) {
  if (!notes || !notes.length) return '<p class="muted">No notes yet.</p>';
  return notes.map(n => `<div style="border-bottom:1px solid var(--border,#e4ddea);padding:.4rem 0">
    <div>${esc(n.note)}</div>
    <div class="muted" style="font-size:.8rem">${esc(n.author)} &middot; ${fmt(n.createdAt)}</div>
  </div>`).join('');
}
