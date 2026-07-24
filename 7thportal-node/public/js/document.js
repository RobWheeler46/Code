(async function () {
  const user = await mountNav('documents');
  if (!user) return;
  const id = location.pathname.split('/').pop();
  const el = document.getElementById('doc');

  async function render() {
    let data;
    try { data = await api(`/api/documents/${id}`); }
    catch (err) { el.innerHTML = `<div class="msg error">${esc(err.message)}</div>`; return; }
    const d = data.document;
    const latest = data.versions[0];

    el.innerHTML = `
      <div class="page-head">
        <h1>${esc(d.title)}</h1>
        <p>${esc(d.description || '')}</p>
      </div>
      <div class="grid cols-2">
        <section class="card">
          <h2>Details</h2>
          <table>
            <tr><th>Category</th><td>${esc(d.category)}</td></tr>
            <tr><th>Audience</th><td>${esc(d.audience)}</td></tr>
            <tr><th>Owner</th><td>${esc(d.owner_name || '—')}</td></tr>
            <tr><th>Current version</th><td>v${latest ? latest.version_number : '—'} · ${latest ? fmtBytes(latest.size_bytes) : ''}</td></tr>
            <tr><th>Review date</th><td>${d.review_date ? fmtDate(d.review_date) : '—'}</td></tr>
            <tr><th>Acknowledgements</th><td>${d.requires_ack ? `${data.ackCount} recorded` : 'Not required'}</td></tr>
          </table>
          <div class="stack" style="margin-top:16px">
            ${latest ? `<a class="btn" href="/api/documents/${id}/download?version=${latest.version_number}">Download v${latest.version_number}</a>` : ''}
            ${d.requires_ack ? (data.acknowledgedLatest
              ? '<span class="pill ok">You have acknowledged this version</span>'
              : '<button class="btn secondary" id="ackBtn">Acknowledge this version</button>') : ''}
            ${data.canEdit ? '<button class="btn ghost" id="newVerBtn">Upload new version</button>' : ''}
          </div>
          <div id="msg"></div>
        </section>

        <section class="card">
          <h2>Version history</h2>
          ${data.versions.map((v) => `
            <div class="list-item">
              <div class="grow">
                <div><strong>v${v.version_number}</strong> — ${esc(v.file_name)}</div>
                <div class="small muted">${fmtDateTime(v.uploaded_at)} · ${esc(v.uploaded_by_name || '')} · ${fmtBytes(v.size_bytes)}</div>
                ${v.notes ? `<div class="small" style="margin-top:2px">${esc(v.notes)}</div>` : ''}
              </div>
              <a class="btn secondary sm" href="/api/documents/${id}/download?version=${v.version_number}">Download</a>
            </div>`).join('')}
        </section>
      </div>`;

    const ackBtn = document.getElementById('ackBtn');
    if (ackBtn) ackBtn.addEventListener('click', async () => {
      await api(`/api/documents/${id}/acknowledge`, { method: 'POST' });
      render();
    });
    const newVerBtn = document.getElementById('newVerBtn');
    if (newVerBtn) newVerBtn.addEventListener('click', openNewVersion);
  }

  function openNewVersion() {
    const back = openModal(`
      <h2>Upload new version</h2>
      <div id="vMsg"></div>
      <label>File</label>
      <input id="vFile" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt">
      <label>Version notes (optional)</label>
      <textarea id="vNotes" style="min-height:70px"></textarea>
      <div class="modal-actions">
        <button class="btn ghost" id="vCancel">Cancel</button>
        <button class="btn" id="vSave">Upload</button>
      </div>`);
    back.querySelector('#vCancel').addEventListener('click', () => back.remove());
    back.querySelector('#vSave').addEventListener('click', async () => {
      const file = back.querySelector('#vFile').files[0];
      const msg = back.querySelector('#vMsg');
      if (!file) { msg.innerHTML = '<div class="msg error">Choose a file.</div>'; return; }
      back.querySelector('#vSave').disabled = true;
      try {
        const dataBase64 = await readFileAsBase64(file);
        await api(`/api/documents/${id}/versions`, {
          method: 'POST',
          body: JSON.stringify({ notes: back.querySelector('#vNotes').value.trim(), file: { fileName: file.name, mimeType: file.type, dataBase64 } })
        });
        back.remove();
        render();
      } catch (err) {
        msg.innerHTML = `<div class="msg error">${esc(err.message)}</div>`;
        back.querySelector('#vSave').disabled = false;
      }
    });
  }

  render();
})();
