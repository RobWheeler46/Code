let ME = null;
const documentId = new URLSearchParams(location.search).get('id');
const CATEGORY_LABELS = { policy: 'Policy', process: 'Process', template: 'Template', guidance: 'Guidance', other: 'Other' };

(async () => {
  ME = await requireUserNav();
  if (!ME) return;
  if (ME.role === 'parent') { location.href = 'parent-dashboard.html'; return; }
  if (!documentId) { document.getElementById('content').innerHTML = '<div class="alert alert-error">No document specified.</div>'; return; }
  await load();
})();

async function load() {
  const content = document.getElementById('content');
  try {
    const doc = await Api.get(`/api/documents/${documentId}`);
    render(doc);
  } catch (err) {
    content.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  }
}

function render(doc) {
  const content = document.getElementById('content');
  const categoryOptions = Object.entries(CATEGORY_LABELS).map(([value, label]) => `<option value="${value}" ${doc.category === value ? 'selected' : ''}>${label}</option>`).join('');

  content.innerHTML = `
    <h1>${escapeHtml(doc.title)} ${statusBadge(doc.status)}</h1>
    ${doc.status === 'draft' ? '<div class="alert alert-warning">Draft - not visible to other leaders until a version is published.</div>' : ''}

    <div class="card">
      <h2>Details</h2>
      <form id="details-form">
        <div class="grid cols-2">
          <div class="field"><label>Title</label><input type="text" id="d-title" value="${escapeHtml(doc.title)}" ${doc.isManager ? '' : 'disabled'}></div>
          <div class="field"><label>Category</label><select id="d-category" ${doc.isManager ? '' : 'disabled'}>${categoryOptions}</select></div>
        </div>
        <div class="field" style="max-width:220px;"><label>Review date (optional)</label><input type="date" id="d-review" value="${doc.reviewDate || ''}" ${doc.isManager ? '' : 'disabled'}></div>
        ${doc.isManager ? '<button class="btn btn-secondary btn-sm" type="submit">Save details</button>' : ''}
        <div id="details-error"></div>
      </form>
      <p class="muted">Owner: ${escapeHtml(doc.owner ? doc.owner.name : 'Unassigned')}</p>
    </div>

    <div class="card">
      <h2>Current version</h2>
      ${doc.currentVersion ? `
        <p>v${doc.currentVersion.versionNumber} - ${escapeHtml(doc.currentVersion.originalFilename || '')} - uploaded by ${escapeHtml(doc.currentVersion.uploadedBy || '')} on ${formatDateTime(doc.currentVersion.createdAt)}</p>
        ${doc.currentVersion.notes ? `<p class="muted">${escapeHtml(doc.currentVersion.notes)}</p>` : ''}
        <div class="actions-row">
          <a class="btn btn-secondary btn-sm" href="/api/documents/${doc.id}/file" target="_blank" rel="noopener">Open document</a>
          ${doc.status === 'published' && !doc.myAcknowledged ? `<button class="btn btn-primary btn-sm" id="acknowledge-btn">I have read and understood this document</button>` : ''}
          ${doc.myAcknowledged ? '<span class="badge" data-status="active">Acknowledged</span>' : ''}
        </div>
        <div id="acknowledge-error"></div>
      ` : '<p class="muted">No version published yet.</p>'}
    </div>

    ${doc.isManager ? renderManagerSection(doc) : ''}
  `;

  document.getElementById('details-form').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await Api.patch(`/api/documents/${doc.id}`, {
        title: document.getElementById('d-title').value,
        category: document.getElementById('d-category').value,
        reviewDate: document.getElementById('d-review').value || null,
      });
      load();
    } catch (err) {
      document.getElementById('details-error').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });

  const ackBtn = document.getElementById('acknowledge-btn');
  if (ackBtn) ackBtn.addEventListener('click', async () => {
    try { await Api.post(`/api/documents/${doc.id}/acknowledge`); load(); }
    catch (err) { document.getElementById('acknowledge-error').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`; }
  });

  if (doc.isManager) wireManagerSection(doc);
}

function renderManagerSection(doc) {
  const unpublished = doc.versions.filter(v => !doc.currentVersion || v.id !== doc.currentVersion.id);
  return `
    <div class="card">
      <h2>Upload a new version</h2>
      <form id="upload-form">
        <div class="field"><label>File (PDF, Word, Excel, PowerPoint or image)</label><input type="file" id="upload-file" required></div>
        <div class="field"><label>Notes (optional, e.g. what changed)</label><input type="text" id="upload-notes"></div>
        <div id="upload-error"></div>
        <button class="btn btn-secondary" type="submit">Upload</button>
      </form>
    </div>

    <div class="card">
      <h2>Version history</h2>
      <div style="overflow-x:auto;"><table><thead><tr><th>Version</th><th>Uploaded by</th><th>When</th><th>Notes</th><th></th></tr></thead>
      <tbody>${doc.versions.map(v => `
        <tr>
          <td>v${v.versionNumber} ${doc.currentVersion && v.id === doc.currentVersion.id ? '<span class="badge" data-status="published">current</span>' : ''}</td>
          <td>${escapeHtml(v.uploadedBy || '')}</td><td>${formatDateTime(v.createdAt)}</td><td>${escapeHtml(v.notes || '')}</td>
          <td>
            <a class="btn btn-secondary btn-sm" href="/api/documents/${doc.id}/versions/${v.id}/file" target="_blank" rel="noopener">Open</a>
            ${!doc.currentVersion || v.id !== doc.currentVersion.id ? `<button class="btn btn-success btn-sm" data-publish="${v.id}">Publish</button>` : ''}
            ${!doc.currentVersion || v.id !== doc.currentVersion.id ? `<button class="btn btn-danger btn-sm" data-delete-version="${v.id}">Delete</button>` : ''}
          </td>
        </tr>`).join('')}</tbody></table></div>
      <div id="version-action-error"></div>
    </div>

    <div class="card">
      <h2>Acknowledgement status</h2>
      ${!doc.currentVersion ? '<p class="muted">Publish a version first.</p>' : `
      <div style="overflow-x:auto;"><table><thead><tr><th>Name</th><th>Acknowledged</th><th>When</th></tr></thead>
      <tbody>${doc.acknowledgementStatus.map(a => `<tr><td>${escapeHtml(a.name)}</td><td>${a.acknowledged ? 'Yes' : 'Not yet'}</td><td>${a.acknowledgedAt ? formatDateTime(a.acknowledgedAt) : ''}</td></tr>`).join('')}</tbody></table></div>`}
    </div>

    <div class="actions-row">
      ${ME.role === 'admin' ? '<button class="btn btn-danger" id="delete-doc-btn">Delete document</button>' : ''}
      <a class="btn btn-secondary" href="documents.html">Back to library</a>
    </div>
    <div id="doc-action-error"></div>
  `;
}

function wireManagerSection(doc) {
  document.getElementById('upload-form').addEventListener('submit', async e => {
    e.preventDefault();
    const fileInput = document.getElementById('upload-file');
    if (!fileInput.files.length) return;
    const form = new FormData();
    form.append('file', fileInput.files[0]);
    form.append('notes', document.getElementById('upload-notes').value);
    try {
      const res = await fetch(`/api/documents/${doc.id}/versions`, { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed.');
      load();
    } catch (err) {
      document.getElementById('upload-error').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });

  document.querySelectorAll('[data-publish]').forEach(btn => btn.addEventListener('click', async () => {
    try { await Api.post(`/api/documents/${doc.id}/publish`, { versionId: Number(btn.dataset.publish) }); load(); }
    catch (err) { document.getElementById('version-action-error').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`; }
  }));
  document.querySelectorAll('[data-delete-version]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('Delete this version?')) return;
    try { await Api.delete(`/api/documents/${doc.id}/versions/${btn.dataset.deleteVersion}`); load(); }
    catch (err) { document.getElementById('version-action-error').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`; }
  }));

  const deleteDocBtn = document.getElementById('delete-doc-btn');
  if (deleteDocBtn) deleteDocBtn.addEventListener('click', async () => {
    if (!confirm('Delete this document and all its versions? This cannot be undone.')) return;
    try { await Api.delete(`/api/documents/${doc.id}`); location.href = 'documents.html'; }
    catch (err) { document.getElementById('doc-action-error').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`; }
  });
}
