(async () => {
  const me = await initNav();
  if (!me) return;

  const id = new URLSearchParams(location.search).get('id');
  if (!id) { document.querySelector('.container').innerHTML = '<div class="card">No request specified.</div>'; return; }

  const r = await Api.get(`/api/requests/${id}`);
  if (!r.canResubmit) {
    document.querySelector('.container').innerHTML = '<div class="card"><p>This request is not available for resubmission.</p></div>';
    return;
  }

  document.getElementById('reference-label').textContent = r.reference;
  document.getElementById('cancel-link').href = `request.html?id=${id}`;
  const lastRejection = [...r.approvals].reverse().find(a => a.action === 'rejected');
  if (lastRejection) {
    document.getElementById('rejection-reason').textContent = `Rejection reason: ${lastRejection.comment}`;
  }

  await setupActivityFormFields();

  const form = document.getElementById('request-form');
  prefillActivityForm(form, r.data);

  const existingDocsWrap = document.getElementById('existing-documents');
  if (r.documents.length === 0) {
    existingDocsWrap.innerHTML = '<p class="muted">No existing documents.</p>';
  } else {
    existingDocsWrap.innerHTML = r.documents.map(d => `
      <div class="checkbox-row">
        <input type="checkbox" name="remove_document_ids" value="${d.id}" id="doc-${d.id}">
        <label for="doc-${d.id}" style="font-weight:normal">
          Remove <a href="/api/requests/${id}/documents/${d.id}" target="_blank">${escapeHtml(d.original_name)}</a>
          (${d.category === 'risk_assessment' ? 'Risk assessment' : 'Supporting document'})
        </label>
      </div>
    `).join('');
  }

  const alertBox = document.getElementById('alert-box');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    alertBox.innerHTML = '';
    clearFieldErrors(form);
    const formData = new FormData(form);
    try {
      await Api.postForm(`/api/requests/${id}/resubmit`, formData);
      location.href = `request.html?id=${id}`;
    } catch (err) {
      alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
      if (err.fields) showFieldErrors(form, err.fields);
      window.scrollTo(0, 0);
    }
  });
})();
