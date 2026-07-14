let ME = null;
const albumId = new URLSearchParams(location.search).get('id');

(async () => {
  ME = await requireUserNav();
  if (!ME) return;
  if (ME.role === 'parent') { location.href = 'gallery.html'; return; }
  if (!albumId) { document.getElementById('content').innerHTML = '<div class="alert alert-error">No album specified.</div>'; return; }
  await load();
})();

async function load() {
  const content = document.getElementById('content');
  try {
    const album = await Api.get(`/api/leader/gallery/albums/${albumId}`);
    render(album);
  } catch (err) {
    content.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  }
}

function render(album) {
  const content = document.getElementById('content');
  const editable = album.status === 'draft';
  content.innerHTML = `
    <h1>${escapeHtml(album.title)} ${statusBadge(album.status)}</h1>
    ${statusNote(album)}

    <div class="card">
      <h2>Details</h2>
      <form id="meta-form">
        <div class="grid cols-2">
          <div class="field"><label>Title</label><input type="text" id="m-title" value="${escapeHtml(album.title)}" ${editable ? '' : 'disabled'}></div>
          <div class="field"><label>Grouping label (optional)</label><input type="text" id="m-label" value="${escapeHtml(album.groupingLabel || '')}" ${editable ? '' : 'disabled'}></div>
        </div>
        <div class="grid cols-2">
          <div class="field"><label>Who can see it</label>
            <select id="m-scope" ${editable ? '' : 'disabled'}>
              <option value="section" ${album.visibilityScope === 'section' ? 'selected' : ''}>Parents/carers with a child in this section</option>
              <option value="all_parents" ${album.visibilityScope === 'all_parents' ? 'selected' : ''}>All parents/carers</option>
            </select>
          </div>
          <div class="field"><label>Watermark photos</label>
            <select id="m-watermark" ${editable ? '' : 'disabled'}>
              <option value="0" ${!album.watermarkEnabled ? 'selected' : ''}>Off</option>
              <option value="1" ${album.watermarkEnabled ? 'selected' : ''}>On (adds "7th Swindon Scouts" text)</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label style="font-weight:400;"><input type="checkbox" id="m-consent" ${album.consentConfirmed ? 'checked' : ''} ${editable ? '' : 'disabled'}>
            I confirm every child clearly identifiable in this album has valid photo consent on record.</label>
        </div>
        ${editable ? '<button class="btn btn-secondary" type="submit">Save details</button>' : ''}
        <div id="meta-error"></div>
      </form>
    </div>

    ${editable ? `
    <div class="card">
      <h2>Upload photos</h2>
      <div class="dropzone" id="dropzone">
        <p>Drag photos here, or</p>
        <input type="file" id="file-input" accept="image/*" multiple style="display:none;">
        <button class="btn btn-secondary btn-sm" id="choose-files" type="button">Choose files</button>
      </div>
      <div id="upload-status"></div>
    </div>
    ` : ''}

    <div class="card">
      <h2>Photos (${album.photos.length})</h2>
      <div class="photo-grid">${album.photos.map(p => `
        <div class="photo-tile">
          <img src="/api/gallery/photos/${p.id}/image" alt="" oncontextmenu="return false" draggable="false">
          ${editable ? `<button class="btn btn-danger btn-sm remove-btn" data-remove="${p.id}">Remove</button>` : ''}
        </div>
      `).join('') || '<p class="muted">No photos uploaded yet.</p>'}</div>
    </div>

    <div class="actions-row">${actionButtons(album)}</div>
    <div id="action-error"></div>
  `;

  document.getElementById('meta-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await Api.patch(`/api/leader/gallery/albums/${album.id}`, {
        title: document.getElementById('m-title').value,
        groupingLabel: document.getElementById('m-label').value,
        visibilityScope: document.getElementById('m-scope').value,
        watermarkEnabled: document.getElementById('m-watermark').value === '1',
        consentConfirmed: document.getElementById('m-consent').checked,
      });
      load();
    } catch (err) {
      document.getElementById('meta-error').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });

  content.querySelectorAll('[data-remove]').forEach(btn => btn.addEventListener('click', async () => {
    await Api.delete(`/api/leader/gallery/albums/${album.id}/photos/${btn.dataset.remove}`);
    load();
  }));

  wireActionButtons(album);
  if (editable) wireUpload(album);
}

function statusNote(album) {
  if (album.status === 'pending_approval') return '<div class="alert alert-info">Waiting for a Portal Administrator to review and publish this album.</div>';
  if (album.status === 'published') return '<div class="alert alert-success">Published - visible to eligible parents/carers now.</div>';
  if (album.status === 'archived') return '<div class="alert alert-warning">Archived - no longer visible to parents/carers.</div>';
  return '';
}

function actionButtons(album) {
  const btns = [];
  if (album.status === 'draft') btns.push('<button class="btn btn-primary" id="submit-btn">Submit for approval</button>');
  if (ME.role === 'admin' && album.status === 'pending_approval') {
    btns.push('<button class="btn btn-success" id="approve-btn">Approve &amp; publish</button>');
    btns.push('<button class="btn btn-secondary" id="reject-btn">Send back to draft</button>');
  }
  if (ME.role === 'admin' && album.status === 'published') {
    btns.push('<button class="btn btn-secondary" id="unpublish-btn">Unpublish</button>');
  }
  if (album.status !== 'published' && album.status !== 'pending_approval') {
    btns.push('<button class="btn btn-danger" id="delete-btn">Delete album</button>');
  }
  return btns.join(' ');
}

function wireActionButtons(album) {
  const errorBox = document.getElementById('action-error');
  const run = async (fn) => { try { await fn(); load(); } catch (err) { errorBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`; } };
  const submitBtn = document.getElementById('submit-btn');
  if (submitBtn) submitBtn.addEventListener('click', () => run(() => Api.post(`/api/leader/gallery/albums/${album.id}/submit`)));
  const approveBtn = document.getElementById('approve-btn');
  if (approveBtn) approveBtn.addEventListener('click', () => run(() => Api.post(`/api/admin/gallery/albums/${album.id}/approve`)));
  const rejectBtn = document.getElementById('reject-btn');
  if (rejectBtn) rejectBtn.addEventListener('click', () => run(() => Api.post(`/api/admin/gallery/albums/${album.id}/reject`)));
  const unpublishBtn = document.getElementById('unpublish-btn');
  if (unpublishBtn) unpublishBtn.addEventListener('click', () => run(() => Api.post(`/api/admin/gallery/albums/${album.id}/unpublish`)));
  const deleteBtn = document.getElementById('delete-btn');
  if (deleteBtn) deleteBtn.addEventListener('click', async () => {
    if (!confirm('Delete this album and all its photos? This cannot be undone.')) return;
    try {
      const path = ME.role === 'admin' ? `/api/admin/gallery/albums/${album.id}` : `/api/leader/gallery/albums/${album.id}`;
      await Api.delete(path);
      location.href = 'leader-gallery.html';
    } catch (err) {
      errorBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });
}

function wireUpload(album) {
  const input = document.getElementById('file-input');
  const chooseBtn = document.getElementById('choose-files');
  const dropzone = document.getElementById('dropzone');
  chooseBtn.addEventListener('click', () => input.click());
  input.addEventListener('change', () => uploadFiles(album.id, input.files));
  ['dragover', 'dragenter'].forEach(evt => dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach(evt => dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); }));
  dropzone.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) uploadFiles(album.id, e.dataTransfer.files); });
}

async function uploadFiles(albumIdVal, fileList) {
  const status = document.getElementById('upload-status');
  status.innerHTML = '<p class="muted">Uploading&hellip;</p>';
  const form = new FormData();
  [...fileList].forEach(f => form.append('photos', f));
  try {
    const res = await fetch(`/api/leader/gallery/albums/${albumIdVal}/photos`, { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed.');
    status.innerHTML = data.failed.length
      ? `<div class="alert alert-warning">Uploaded ${data.saved}. Could not process: ${data.failed.map(escapeHtml).join(', ')}</div>`
      : `<div class="alert alert-success">Uploaded ${data.saved} photo${data.saved === 1 ? '' : 's'}.</div>`;
    load();
  } catch (err) {
    status.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  }
}
