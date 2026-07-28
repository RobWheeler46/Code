let EQ_META = { categories: {}, conditions: {}, statuses: {} };
const eqFilters = { q: '', category: '', status: '' };

(async () => {
  const me = await requireUserNav();
  if (!me) return;
  document.getElementById('add-asset').addEventListener('click', () => openAssetForm(null));
  loadEquipment();
})();

async function loadEquipment() {
  const box = document.getElementById('content');
  const params = new URLSearchParams();
  if (eqFilters.q) params.set('q', eqFilters.q);
  if (eqFilters.category) params.set('category', eqFilters.category);
  if (eqFilters.status) params.set('status', eqFilters.status);
  let data;
  try { data = await Api.get('/api/equipment?' + params.toString()); }
  catch (e) { box.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; return; }
  EQ_META = data.meta;
  const s = data.summary;

  box.innerHTML = `
    <div class="cap-stats">
      <div class="card"><div class="muted">Assets</div><div class="cap-big">${s.total}</div></div>
      <div class="card"><div class="muted">Checks due (30 days)</div><div class="cap-big">${s.checksDue}</div></div>
      <div class="card"><div class="muted">Replacement risk</div><div class="cap-big">${s.replacementRisk}</div></div>
      <div class="card"><div class="muted">On loan</div><div class="cap-big">${s.onLoan}</div></div>
    </div>
    <div class="card">
      <div class="cap-actions" style="margin-bottom:.8rem">
        <input id="eq-q" placeholder="Search name, location, owner" value="${escapeHtml(eqFilters.q)}" style="min-width:220px">
        <select id="eq-cat">${optionList(EQ_META.categories, eqFilters.category, 'All categories')}</select>
        <select id="eq-status">${optionList(EQ_META.statuses, eqFilters.status, 'All statuses')}</select>
      </div>
      ${data.assets.length ? `<table class="data-table">
        <thead><tr><th>Asset</th><th>Category</th><th>Location</th><th>Condition</th><th>Status</th><th>Next check</th><th></th></tr></thead>
        <tbody>${data.assets.map(a => `
          <tr>
            <td><strong>${escapeHtml(a.name)}</strong>${a.quantity > 1 ? ` <span class="muted">&times;${a.quantity}</span>` : ''}</td>
            <td>${escapeHtml(EQ_META.categories[a.category] || a.category)}</td>
            <td class="muted">${escapeHtml(a.location || '&mdash;')}</td>
            <td>${escapeHtml(EQ_META.conditions[a.condition] || a.condition)}</td>
            <td><span class="badge" data-status="${a.status === 'available' ? 'active' : (a.status === 'retired' ? 'archived' : 'pending_approval')}">${escapeHtml(EQ_META.statuses[a.status] || a.status)}</span></td>
            <td>${nextCheckLabel(a)}</td>
            <td><button class="btn btn-secondary btn-sm eq-edit" data-id="${a.id}">Edit</button></td>
          </tr>`).join('')}</tbody>
      </table>` : '<div class="empty-state">No assets match. Add your first asset to get started.</div>'}
    </div>`;

  const q = document.getElementById('eq-q');
  let t; q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { eqFilters.q = q.value.trim(); loadEquipment(); }, 300); });
  document.getElementById('eq-cat').addEventListener('change', e => { eqFilters.category = e.target.value; loadEquipment(); });
  document.getElementById('eq-status').addEventListener('change', e => { eqFilters.status = e.target.value; loadEquipment(); });
  document.querySelectorAll('.eq-edit').forEach(b => b.addEventListener('click', () => openAssetForm(data.assets.find(a => a.id == b.dataset.id))));
}

function optionList(map, selected, allLabel) {
  return `<option value="">${allLabel}</option>` + Object.entries(map).map(([k, v]) => `<option value="${k}"${k === selected ? ' selected' : ''}>${escapeHtml(v)}</option>`).join('');
}

function nextCheckLabel(a) {
  const today = new Date().toISOString().slice(0, 10);
  if (a.condition === 'poor' || a.condition === 'unserviceable' || (a.replacementDueDate && a.replacementDueDate < today)) {
    return '<span class="badge" data-status="deleted">Replace</span>';
  }
  if (a.status === 'loaned' && a.loanDueDate && a.loanDueDate < today) return '<span class="badge" data-status="deleted">Return overdue</span>';
  if (a.nextInspectionDate) {
    return a.nextInspectionDate < today ? '<span class="badge" data-status="suspended">Overdue</span>' : 'Due ' + formatDate(a.nextInspectionDate);
  }
  return '<span class="muted">&mdash;</span>';
}

function openAssetForm(asset) {
  const isEdit = !!asset;
  const a = asset || { category: 'general', condition: 'good', status: 'available', quantity: 1 };
  const sel = (map, v) => Object.entries(map).map(([k, l]) => `<option value="${k}"${k === v ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('');
  const field = (label, html) => `<div class="field"><label>${label}</label>${html}</div>`;
  const existing = document.getElementById('eq-modal'); if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'eq-modal'; modal.className = 'modal-backdrop';
  modal.innerHTML = `<div class="modal-box"><h2>${isEdit ? 'Edit asset' : 'Add asset'}</h2>
    <div id="eq-form-msg"></div>
    ${field('Name', `<input id="ef-name" value="${escapeHtml(a.name || '')}">`)}
    <div class="cap-actions">
      ${field('Category', `<select id="ef-category">${sel(EQ_META.categories, a.category)}</select>`)}
      ${field('Quantity', `<input id="ef-quantity" type="number" min="0" value="${a.quantity ?? 1}" style="width:90px">`)}
    </div>
    <div class="cap-actions">
      ${field('Condition', `<select id="ef-condition">${sel(EQ_META.conditions, a.condition)}</select>`)}
      ${field('Status', `<select id="ef-status">${sel(EQ_META.statuses, a.status)}</select>`)}
    </div>
    ${field('Owner / responsible', `<input id="ef-owner" value="${escapeHtml(a.owner || '')}" placeholder="e.g. Quartermaster">`)}
    ${field('Storage location', `<input id="ef-location" value="${escapeHtml(a.location || '')}">`)}
    ${field('Section (optional)', `<input id="ef-section" value="${escapeHtml(a.sectionName || '')}">`)}
    ${field('Linked event/camp (optional)', `<input id="ef-event" value="${escapeHtml(a.linkedEvent || '')}">`)}
    <div class="cap-actions">
      ${field('Next inspection', `<input id="ef-inspect" type="date" value="${a.nextInspectionDate || ''}">`)}
      ${field('Replacement due', `<input id="ef-replace" type="date" value="${a.replacementDueDate || ''}">`)}
    </div>
    <div class="cap-actions">
      ${field('Loan due (if loaned)', `<input id="ef-loan" type="date" value="${a.loanDueDate || ''}">`)}
      ${field('Value (£)', `<input id="ef-value" type="number" min="0" step="0.01" value="${a.value ?? ''}" style="width:120px">`)}
    </div>
    ${field('Notes', `<textarea id="ef-notes" rows="2">${escapeHtml(a.notes || '')}</textarea>`)}
    <div class="modal-actions" style="display:flex;gap:.5rem;margin-top:1rem;align-items:center">
      <button class="btn" id="ef-save">${isEdit ? 'Save changes' : 'Add asset'}</button>
      <button class="btn btn-secondary" id="ef-cancel">Cancel</button>
      ${isEdit ? '<button class="btn btn-secondary eq-delete" id="ef-delete" style="margin-left:auto">Delete</button>' : ''}
    </div></div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.getElementById('ef-cancel').addEventListener('click', () => modal.remove());

  document.getElementById('ef-save').addEventListener('click', async () => {
    const payload = {
      name: document.getElementById('ef-name').value.trim(),
      category: document.getElementById('ef-category').value,
      quantity: document.getElementById('ef-quantity').value,
      condition: document.getElementById('ef-condition').value,
      status: document.getElementById('ef-status').value,
      owner: document.getElementById('ef-owner').value.trim(),
      location: document.getElementById('ef-location').value.trim(),
      sectionName: document.getElementById('ef-section').value.trim(),
      linkedEvent: document.getElementById('ef-event').value.trim(),
      nextInspectionDate: document.getElementById('ef-inspect').value,
      replacementDueDate: document.getElementById('ef-replace').value,
      loanDueDate: document.getElementById('ef-loan').value,
      value: document.getElementById('ef-value').value,
      notes: document.getElementById('ef-notes').value.trim(),
    };
    if (!payload.name) { document.getElementById('eq-form-msg').innerHTML = '<div class="alert alert-error">A name is required.</div>'; return; }
    try {
      if (isEdit) await Api.patch(`/api/equipment/${asset.id}`, payload);
      else await Api.post('/api/equipment', payload);
      modal.remove(); loadEquipment();
    } catch (e) { document.getElementById('eq-form-msg').innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  });

  const del = document.getElementById('ef-delete');
  if (del) del.addEventListener('click', async () => {
    if (!confirm('Delete this asset? This cannot be undone.')) return;
    try { await Api.delete(`/api/equipment/${asset.id}`); modal.remove(); loadEquipment(); }
    catch (e) { document.getElementById('eq-form-msg').innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  });
}
