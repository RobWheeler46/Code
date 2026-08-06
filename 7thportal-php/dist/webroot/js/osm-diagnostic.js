// OSM login diagnostic viewer. Standalone (no nav / no login required): a parent
// can run it. Shows what a real OSM authorization returns, so we can see whether
// their child links come through. Nothing is stored server-side beyond the session.

(async () => {
  const box = document.getElementById('content');
  let data;
  try { data = await Api.get('/api/osm/diagnostic/result'); }
  catch (e) {
    if (e.status === 404) { box.innerHTML = launcher(); return; }
    box.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>` + launcher();
    return;
  }
  render(box, data);
})();

function launcher() {
  return `
    <div class="card">
      <h2>Run the diagnostic</h2>
      <p>Click below and sign in with the OSM account you want to test - ideally a <strong>parent</strong> account. OSM will ask you to authorise 7thPortal; afterwards this page shows what OSM sent back.</p>
      <p class="muted">You will not be logged in to 7thPortal, and nothing is saved. If a parent account can't authorise the app, that itself is a useful result.</p>
      <a class="btn btn-primary" href="/auth/osm/login?intent=diagnostic">Sign in with OSM to run the diagnostic</a>
    </div>`;
}

function render(box, d) {
  const id = d.identity;
  const flags = d.flags || [];
  const childish = flags.length > 0;
  box.innerHTML = `
    <div class="card">
      <div class="cap-head"><h2 style="margin:0">Captured result</h2>
        <span class="badge" data-status="${childish ? 'active' : 'suspended'}">${childish ? flags.length + ' possible child/parent field(s)' : 'no obvious child fields'}</span></div>
      <p class="muted">Captured ${d.capturedAt ? new Date(d.capturedAt).toLocaleString('en-GB') : ''}. Redacted of tokens. Shown once - not stored.</p>
      <table class="kv-table">
        <tr><td class="muted">Identity found</td><td>${id ? `${escapeHtml((id.firstName || '') + ' ' + (id.lastName || ''))}${id.email ? ' &middot; ' + escapeHtml(id.email) : ''} &middot; OSM id ${escapeHtml(String(id.osmUserId))}` : '<em>none - the payload carried no leader identity (this can be normal for a parent)</em>'}</td></tr>
        <tr><td class="muted">Leader roles</td><td>${id ? id.roleCount : 0}</td></tr>
        <tr><td class="muted">Term sections</td><td>${id ? id.termSectionCount : 0}</td></tr>
        <tr><td class="muted">Top-level keys</td><td><code>${(d.topLevelKeys || []).map(escapeHtml).join(', ') || '—'}</code></td></tr>
        <tr><td class="muted">globals keys</td><td><code>${(d.globalsKeys || []).map(escapeHtml).join(', ') || '—'}</code></td></tr>
      </table>
    </div>

    <div class="card">
      <h2>Possible child / parent fields</h2>
      <p class="muted">Keys anywhere in the payload whose name suggests child, parent, member or family data. This is where a parent's children would appear if OSM sends them.</p>
      ${flags.length ? `<div style="overflow-x:auto"><table class="data-table">
        <thead><tr><th>Path</th><th>Type</th><th>Count</th><th>Preview</th></tr></thead>
        <tbody>${flags.map(f => `<tr><td><code>${escapeHtml(f.path)}</code></td><td>${escapeHtml(f.type)}</td><td>${f.count ?? ''}</td><td class="muted">${escapeHtml(f.preview || '')}</td></tr>`).join('')}</tbody>
      </table></div>` : '<p class="muted">No child/parent-looking fields were found in the payload. With the current OSM app scope, a parent login may not return child data - which would mean we keep admin linking (or need a different OSM scope).</p>'}
    </div>

    <div class="card">
      <div class="cap-head"><h2 style="margin:0">Full payload (token-redacted)</h2>
        <button class="btn btn-secondary btn-sm" id="copy-btn">Copy JSON</button></div>
      <p class="muted">Send this to whoever is building the integration to confirm exactly what's available.</p>
      <pre id="raw" style="overflow:auto;max-height:420px;background:var(--bg);padding:1rem;border-radius:8px;font-size:.8rem">${escapeHtml(JSON.stringify(d.raw, null, 2))}</pre>
      <div class="cap-actions" style="margin-top:.8rem">
        <button class="btn btn-secondary" id="clear-btn">Clear this result</button>
        <a class="btn btn-secondary" href="/auth/osm/login?intent=diagnostic">Run again with another account</a>
      </div>
    </div>`;

  document.getElementById('copy-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(JSON.stringify(d.raw, null, 2)).then(
      () => { document.getElementById('copy-btn').textContent = 'Copied'; },
      () => { document.getElementById('copy-btn').textContent = 'Copy failed'; }
    );
  });
  document.getElementById('clear-btn').addEventListener('click', async () => {
    try { await Api.post('/api/osm/diagnostic/clear'); } catch (e) { /* ignore */ }
    document.getElementById('content').innerHTML = launcher();
  });
}
