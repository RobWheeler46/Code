(async function () {
  const user = await mountNav('documents');
  if (!user) return;

  const listEl = document.getElementById('list');
  const searchEl = document.getElementById('search');
  const categoryEl = document.getElementById('category');

  async function loadCategories() {
    const { categories } = await api('/api/documents/categories');
    categoryEl.innerHTML = '<option value="">All categories</option>' +
      categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  }

  async function load() {
    const params = new URLSearchParams();
    if (searchEl.value.trim()) params.set('q', searchEl.value.trim());
    if (categoryEl.value) params.set('category', categoryEl.value);
    const { documents } = await api('/api/documents?' + params.toString());
    if (!documents.length) { listEl.innerHTML = '<div class="empty">No documents found.</div>'; return; }
    listEl.innerHTML = documents.map((d) => `
      <a class="card" href="/documents/${d.id}" style="text-decoration:none;color:inherit;display:block">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span class="pill">${esc(d.category)}</span>
          ${d.audience !== 'leaders' ? `<span class="pill grey">${esc(d.audience)}</span>` : ''}
          ${d.requires_ack ? '<span class="pill warn">Acknowledge</span>' : ''}
          <span class="small muted" style="margin-left:auto">v${d.latest_version || 1}</span>
        </div>
        <h2 style="margin:10px 0 4px">${esc(d.title)}</h2>
        <p class="small muted" style="margin:0">${esc(d.description || '').slice(0, 140)}</p>
        <div class="small muted" style="margin-top:10px">
          ${d.owner_name ? 'Owner: ' + esc(d.owner_name) + ' · ' : ''}Updated ${fmtDate(d.updated_at)}
        </div>
      </a>`).join('');
  }

  let t;
  searchEl.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 250); });
  categoryEl.addEventListener('change', load);
  document.getElementById('newBtn').addEventListener('click', openUpload);

  function openUpload() {
    const back = openModal(`
      <h2>Upload document</h2>
      <div id="uMsg"></div>
      <label>Title</label><input id="uTitle" required>
      <label>Description</label><textarea id="uDesc" style="min-height:70px"></textarea>
      <div class="row">
        <div><label>Category</label><input id="uCat" value="General"></div>
        <div><label>Audience</label>
          <select id="uAud">
            <option value="leaders">All leaders</option>
            ${user.role === 'admin' ? '<option value="trustees">Trustees</option><option value="admins">Admins only</option>' : ''}
          </select>
        </div>
      </div>
      <div class="row">
        <div><label>Review date</label><input id="uReview" type="date"></div>
        <div><label style="margin-top:12px"><input type="checkbox" id="uAck" style="width:auto"> Require acknowledgement</label></div>
      </div>
      <label>File (PDF, Word, image or text — max 20 MB)</label>
      <input id="uFile" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt">
      <div class="modal-actions">
        <button class="btn ghost" id="uCancel">Cancel</button>
        <button class="btn" id="uSave">Upload</button>
      </div>`);

    back.querySelector('#uCancel').addEventListener('click', () => back.remove());
    back.querySelector('#uSave').addEventListener('click', async () => {
      const msg = back.querySelector('#uMsg');
      const file = back.querySelector('#uFile').files[0];
      const title = back.querySelector('#uTitle').value.trim();
      if (!title) { msg.innerHTML = '<div class="msg error">A title is required.</div>'; return; }
      if (!file) { msg.innerHTML = '<div class="msg error">Choose a file to upload.</div>'; return; }
      back.querySelector('#uSave').disabled = true;
      try {
        const dataBase64 = await readFileAsBase64(file);
        await api('/api/documents', {
          method: 'POST',
          body: JSON.stringify({
            title,
            description: back.querySelector('#uDesc').value.trim(),
            category: back.querySelector('#uCat').value.trim() || 'General',
            audience: back.querySelector('#uAud').value,
            reviewDate: back.querySelector('#uReview').value || null,
            requiresAck: back.querySelector('#uAck').checked,
            file: { fileName: file.name, mimeType: file.type, dataBase64 }
          })
        });
        back.remove();
        await loadCategories();
        await load();
      } catch (err) {
        msg.innerHTML = `<div class="msg error">${esc(err.message)}</div>`;
        back.querySelector('#uSave').disabled = false;
      }
    });
  }

  await loadCategories();
  await load();
})();
