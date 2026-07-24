let ME = null;
const CATEGORY_LABELS = { policy: 'Policy', process: 'Process', template: 'Template', guidance: 'Guidance', other: 'Other' };
let ACTIVE_CATEGORY = '';

(async () => {
  ME = await requireUserNav();
  if (!ME) return;
  if (ME.role === 'parent') { location.href = 'parent-dashboard.html'; return; }
  await load();
})();

async function load() {
  const content = document.getElementById('content');
  content.innerHTML = '<p class="muted">Loading&hellip;</p>';
  const cfg = await Api.get('/api/config');
  if (!cfg.documentLibraryEnabled) {
    content.innerHTML = '<div class="alert alert-warning">The document library is not enabled yet. Ask a Portal Administrator to turn this on in Admin Settings.</div>';
    return;
  }
  const [documents, managed] = await Promise.all([
    Api.get('/api/documents' + (ACTIVE_CATEGORY ? `?category=${ACTIVE_CATEGORY}` : '')),
    Api.get('/api/documents/manage'),
  ]);

  content.innerHTML = `
    <div class="card">
      <div class="tabs" id="category-tabs">
        <button data-cat="" class="${ACTIVE_CATEGORY === '' ? 'active' : ''}">All</button>
        ${Object.entries(CATEGORY_LABELS).map(([value, label]) => `<button data-cat="${value}" class="${ACTIVE_CATEGORY === value ? 'active' : ''}">${label}</button>`).join('')}
      </div>
      ${documents.length === 0 ? '<p class="muted">No published documents yet.</p>' : `
      <div style="overflow-x:auto;"><table><thead><tr><th>Title</th><th>Category</th><th>Version</th><th>Review date</th><th>Acknowledged</th><th></th></tr></thead>
      <tbody>${documents.map(d => `
        <tr>
          <td>${escapeHtml(d.title)}</td><td>${CATEGORY_LABELS[d.category] || escapeHtml(d.category)}</td>
          <td>${d.currentVersion ? 'v' + d.currentVersion.versionNumber : '&mdash;'}</td>
          <td>${d.reviewDate ? formatDate(d.reviewDate) : '&mdash;'}</td>
          <td>${d.myAcknowledged ? '<span class="badge" data-status="active">Yes</span>' : '<span class="badge" data-status="suspended">Not yet</span>'}</td>
          <td><a class="btn btn-secondary btn-sm" href="document-edit.html?id=${d.id}">Open</a></td>
        </tr>`).join('')}</tbody></table></div>`}
    </div>

    <div class="card">
      <h2>Documents you manage</h2>
      <div class="actions-row">
        <button class="btn btn-primary btn-sm" id="new-document">Add a document</button>
      </div>
      <div id="new-document-error"></div>
      ${managed.length === 0 ? '<p class="muted">None yet.</p>' : `
      <div style="overflow-x:auto;"><table><thead><tr><th>Title</th><th>Category</th><th>Status</th><th>Version</th><th></th></tr></thead>
      <tbody>${managed.map(d => `
        <tr>
          <td>${escapeHtml(d.title)}</td><td>${CATEGORY_LABELS[d.category] || escapeHtml(d.category)}</td>
          <td>${statusBadge(d.status)}</td><td>${d.currentVersion ? 'v' + d.currentVersion.versionNumber : '&mdash;'} (${d.versionCount} total)</td>
          <td><a class="btn btn-secondary btn-sm" href="document-edit.html?id=${d.id}">Manage</a></td>
        </tr>`).join('')}</tbody></table></div>`}
    </div>
  `;

  document.querySelectorAll('#category-tabs button').forEach(btn => btn.addEventListener('click', () => {
    ACTIVE_CATEGORY = btn.dataset.cat;
    load();
  }));

  document.getElementById('new-document').addEventListener('click', async () => {
    try {
      const created = await Api.post('/api/documents', { title: 'New document' });
      location.href = `document-edit.html?id=${created.id}`;
    } catch (err) {
      document.getElementById('new-document-error').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });
}
