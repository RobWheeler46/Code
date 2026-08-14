let EQ_META = { categories: {}, conditions: {}, statuses: {} };
const eqFilters = { q: '', category: '', status: '' };

(async () => {
  const me = await requireUserNav();
  if (!me) return;
  document.getElementById('add-asset').addEventListener('click', () => openAssetForm(null));
  document.getElementById('import-assets').addEventListener('click', openImportModal);
  document.getElementById('stocktake-btn').addEventListener('click', openStocktakeModal);
  loadEquipment();
})();

// Bulk import from a CSV: shows a dry-run preview (ready count + skipped rows)
// before applying (QM Equipment Register Import).
function openImportModal() {
  const existing = document.getElementById('eq-import-modal'); if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'eq-import-modal'; modal.className = 'modal-backdrop';
  modal.innerHTML = `<div class="modal-box"><h2>Import equipment</h2>
    <p class="muted">Upload a CSV with one item per row. <a href="/api/equipment/import-template.csv">Download the template</a>. Imports are <strong>staged for review</strong> — you confirm each item's tracking mode before it goes live.</p>
    <div class="field"><input type="file" id="eq-import-file" accept=".csv,text/csv"></div>
    <div id="eq-import-preview"></div>
    <div class="cap-actions"><button class="btn" id="eq-import-apply" disabled>Stage for review</button><button class="btn btn-secondary" id="eq-import-cancel">Cancel</button></div>
    <div id="eq-import-msg"></div></div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.getElementById('eq-import-cancel').addEventListener('click', () => modal.remove());

  let csvText = '';
  document.getElementById('eq-import-file').addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      csvText = String(reader.result);
      try {
        const d = await Api.post('/api/equipment/import', { csv: csvText, dryRun: true });
        const errs = d.errors.length ? `<div class="alert alert-warning">${d.errors.length} row(s) will be skipped: ${d.errors.slice(0, 5).map(x => `row ${x.row} (${escapeHtml(x.error)})`).join(', ')}${d.errors.length > 5 ? '…' : ''}</div>` : '';
        const rows = d.preview.map(p => `<tr><td>${escapeHtml(p.name)}</td><td class="muted">${escapeHtml(p.category)}</td><td>${p.quantity}</td></tr>`).join('');
        document.getElementById('eq-import-preview').innerHTML = `<div class="alert alert-success">${d.readyCount} row(s) will be staged for review.</div>${errs}
          ${rows ? `<table class="data-table"><thead><tr><th>Name</th><th>Category</th><th>Qty</th><th>Tracking</th></tr></thead><tbody>${d.preview.map(p => `<tr><td>${escapeHtml(p.name)}</td><td class="muted">${escapeHtml(p.category)}</td><td>${p.quantity}</td><td class="muted">${p.trackingMode ? escapeHtml(p.trackingMode) : '<span class="badge" data-status="suspended">needs review</span>'}</td></tr>`).join('')}</tbody></table>${d.readyCount > 10 ? '<p class="muted">Showing the first 10.</p>' : ''}` : ''}`;
        const apply = document.getElementById('eq-import-apply');
        apply.disabled = d.readyCount === 0;
        apply.textContent = `Stage ${d.readyCount} row${d.readyCount === 1 ? '' : 's'} for review`;
      } catch (err) { document.getElementById('eq-import-msg').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`; }
    };
    reader.readAsText(file);
  });
  document.getElementById('eq-import-apply').addEventListener('click', async () => {
    if (!csvText) return;
    try {
      const r = await Api.post('/api/equipment/import', { csv: csvText });
      modal.remove();
      renderImportReview(r.batchId);
    } catch (err) { document.getElementById('eq-import-msg').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`; }
  });
}

// Import review (v2.4.3): confirm each staged row's tracking mode / unit / opening,
// split a mixed row, skip a row, then activate only the validated ('ready') rows.
async function renderImportReview(batchId) {
  const d = await Api.get(`/api/equipment/import-batches/${batchId}`);
  const sel = (map, v, blank) => (blank ? `<option value="">${blank}</option>` : '') + Object.entries(map).map(([k, l]) => `<option value="${k}"${k === v ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('');
  const badge = s => ({ needs_review: '<span class="badge" data-status="suspended">needs review</span>', ready: '<span class="badge" data-status="active">ready</span>', activated: '<span class="badge" data-status="archived">activated</span>', skipped: '<span class="badge" data-status="draft">skipped</span>' }[s] || s);
  const rowsHtml = d.rows.map(r => {
    const editable = r.reviewStatus !== 'activated' && r.reviewStatus !== 'skipped';
    return `<tr>
      <td><input data-ir-name="${r.id}" value="${escapeHtml(r.name)}" ${editable ? '' : 'disabled'} style="min-width:130px"></td>
      <td><select data-ir-cat="${r.id}" ${editable ? '' : 'disabled'}>${sel(d.meta.categories, r.category)}</select></td>
      <td><select data-ir-track="${r.id}" ${editable ? '' : 'disabled'}>${sel(d.meta.trackingModes, r.trackingMode, '— choose —')}</select></td>
      <td><input data-ir-unit="${r.id}" value="${escapeHtml(r.issueUnit || '')}" ${editable ? '' : 'disabled'} style="width:90px" placeholder="unit"></td>
      <td><input type="number" min="0" data-ir-open="${r.id}" value="${r.openingQty}" ${editable ? '' : 'disabled'} style="width:70px"></td>
      <td>${badge(r.reviewStatus)}${r.issues && r.issues.length ? `<br><span class="muted" style="font-size:.78rem">${r.issues.map(escapeHtml).join(', ')}</span>` : ''}</td>
      <td style="white-space:nowrap">${editable ? `<button class="btn btn-secondary btn-sm ir-save" data-id="${r.id}">Save</button> <button class="btn btn-secondary btn-sm ir-split" data-id="${r.id}">Split</button> <button class="btn btn-secondary btn-sm ir-skip" data-id="${r.id}">Skip</button>` : ''}</td>
    </tr>`;
  }).join('');
  const readyCount = d.counts.ready || 0, needCount = d.counts.needs_review || 0;
  const existing = document.getElementById('eq-ir-modal'); if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'eq-ir-modal'; modal.className = 'modal-backdrop';
  modal.innerHTML = `<div class="modal-box" style="max-width:920px"><h2>Import review</h2>
    <p class="muted">Confirm each row's <strong>tracking mode</strong> (and a unit for consumables) so it becomes "ready", then activate. Rows in "needs review" won't be activated. Split a mixed reusable+consumable row into two.</p>
    <div id="eq-ir-msg"></div>
    <div style="overflow-x:auto"><table class="data-table"><thead><tr><th>Name</th><th>Category</th><th>Tracking mode</th><th>Unit</th><th>Opening</th><th>Status</th><th></th></tr></thead><tbody>${rowsHtml}</tbody></table></div>
    <div class="cap-actions" style="margin-top:1rem">
      <button class="btn" id="ir-activate"${readyCount ? '' : ' disabled'}>Activate ${readyCount} ready row${readyCount === 1 ? '' : 's'}</button>
      <span class="muted">${needCount ? needCount + ' still need review' : ''}</span>
      <button class="btn btn-secondary" id="eq-ir-close" style="margin-left:auto">Close</button>
    </div></div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.getElementById('eq-ir-close').addEventListener('click', () => { modal.remove(); loadEquipment(); });
  const irMsg = document.getElementById('eq-ir-msg');
  const saveRow = async (id) => Api.patch(`/api/equipment/import-rows/${id}`, {
    name: document.querySelector(`[data-ir-name="${id}"]`).value.trim(),
    category: document.querySelector(`[data-ir-cat="${id}"]`).value,
    trackingMode: document.querySelector(`[data-ir-track="${id}"]`).value,
    issueUnit: document.querySelector(`[data-ir-unit="${id}"]`).value.trim(),
    openingQty: document.querySelector(`[data-ir-open="${id}"]`).value,
  });
  modal.querySelectorAll('.ir-save').forEach(b => b.addEventListener('click', async () => { try { await saveRow(b.dataset.id); renderImportReview(batchId); } catch (e) { irMsg.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; } }));
  modal.querySelectorAll('.ir-split').forEach(b => b.addEventListener('click', async () => { try { await Api.post(`/api/equipment/import-rows/${b.dataset.id}/split`, {}); renderImportReview(batchId); } catch (e) { irMsg.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; } }));
  modal.querySelectorAll('.ir-skip').forEach(b => b.addEventListener('click', async () => { try { await Api.post(`/api/equipment/import-rows/${b.dataset.id}/skip`, {}); renderImportReview(batchId); } catch (e) { irMsg.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; } }));
  document.getElementById('ir-activate').addEventListener('click', async () => {
    try {
      const r = await Api.post(`/api/equipment/import-batches/${batchId}/activate`, {});
      irMsg.innerHTML = `<div class="alert alert-success">Activated ${r.activated} item(s) into the register.${r.remaining ? ` ${r.remaining} still need review.` : ''}</div>`;
      setTimeout(() => renderImportReview(batchId), 800);
    } catch (e) { irMsg.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  });
}

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
      <div class="card"><div class="muted">Low stock</div><div class="cap-big">${s.lowStock ?? 0}</div></div>
      <div class="card"><div class="muted">Restricted</div><div class="cap-big">${s.restricted ?? 0}</div></div>
      <div class="card"><div class="muted">Unknown location</div><div class="cap-big">${s.unknownLocation ?? 0}</div></div>
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
            <td><strong>${escapeHtml(a.name)}</strong>${a.quantity > 1 ? ` <span class="muted">&times;${a.quantity}</span>` : ''}${a.itemType && a.itemType !== 'asset' ? ` <span class="muted">· ${escapeHtml((EQ_META.itemTypes && EQ_META.itemTypes[a.itemType]) || a.itemType)}</span>` : ''}${a.restricted ? ' <span class="badge" data-status="suspended">Restricted</span>' : ''}${a.belowReorder ? ' <span class="badge" data-status="deleted">Low stock</span>' : ''}</td>
            <td>${escapeHtml(EQ_META.categories[a.category] || a.category)}</td>
            <td class="muted">${escapeHtml(a.location || '&mdash;')}</td>
            <td>${escapeHtml(EQ_META.conditions[a.condition] || a.condition)}</td>
            <td><span class="badge" data-status="${a.status === 'available' ? 'active' : (a.status === 'retired' ? 'archived' : 'pending_approval')}">${escapeHtml(EQ_META.statuses[a.status] || a.status)}</span>${a.maintenanceLocked ? ' <span class="badge" data-status="deleted">Locked</span>' : ''}</td>
            <td>${nextCheckLabel(a)}</td>
            <td style="white-space:nowrap">${a.itemType === 'kit' ? `<button class="btn btn-secondary btn-sm eq-kit" data-id="${a.id}">Kit</button> ` : ''}<button class="btn btn-secondary btn-sm eq-stock" data-id="${a.id}">Stock</button> <button class="btn btn-secondary btn-sm eq-inspect" data-id="${a.id}">Inspect</button> <button class="btn btn-secondary btn-sm eq-edit" data-id="${a.id}">Edit</button></td>
          </tr>`).join('')}</tbody>
      </table>` : '<div class="empty-state">No assets match. Add your first asset to get started.</div>'}
    </div>`;

  const q = document.getElementById('eq-q');
  let t; q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { eqFilters.q = q.value.trim(); loadEquipment(); }, 300); });
  document.getElementById('eq-cat').addEventListener('change', e => { eqFilters.category = e.target.value; loadEquipment(); });
  document.getElementById('eq-status').addEventListener('change', e => { eqFilters.status = e.target.value; loadEquipment(); });
  document.querySelectorAll('.eq-edit').forEach(b => b.addEventListener('click', () => openAssetForm(data.assets.find(a => a.id == b.dataset.id))));
  document.querySelectorAll('.eq-inspect').forEach(b => b.addEventListener('click', () => openInspectForm(b.dataset.id)));
  document.querySelectorAll('.eq-kit').forEach(b => b.addEventListener('click', () => openKitModal(b.dataset.id)));
  document.querySelectorAll('.eq-stock').forEach(b => b.addEventListener('click', () => openStockModal(b.dataset.id)));
}

// Record inspection modal: the six outcomes drive condition/lock/repair/retire,
// with the asset's inspection history shown below (QM Maintenance & Inspection).
async function openInspectForm(assetId) {
  let d;
  try { d = await Api.get(`/api/equipment/${assetId}`); } catch (e) { alert(e.message); return; }
  const a = d.asset;
  const sel = (map, v) => Object.entries(map).map(([k, l]) => `<option value="${k}"${k === v ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('');
  const openRepairs = d.repairs.filter(r => r.status === 'open');
  const history = d.inspections.slice(0, 8).map(r => `<div style="padding:.3rem 0;border-bottom:1px solid var(--border);font-size:.85rem">
      <strong>${escapeHtml(r.outcomeLabel)}</strong>${r.locked ? ' <span class="badge" data-status="deleted">locked</span>' : ''} <span class="muted">· ${escapeHtml(r.by)} · ${formatDateTime(r.at)}</span>
      ${r.note ? `<br><span class="muted">${escapeHtml(r.note)}</span>` : ''}</div>`).join('') || '<p class="muted">No inspections recorded yet.</p>';
  const existing = document.getElementById('eq-insp-modal'); if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'eq-insp-modal'; modal.className = 'modal-backdrop';
  modal.innerHTML = `<div class="modal-box"><h2>Inspect: ${escapeHtml(a.name)}</h2>
    ${a.maintenanceLocked ? '<div class="alert alert-warning">Maintenance-locked — not available for booking. A Pass returns it to service.</div>' : ''}
    ${openRepairs.length ? `<div class="alert alert-warning">Open repair: ${escapeHtml(openRepairs[0].description || '')}</div>` : ''}
    <div id="eq-insp-msg"></div>
    <div class="field"><label>Outcome</label><select id="ei-outcome">${sel(d.meta.outcomes, 'pass')}</select></div>
    <div class="field"><label>Condition</label><select id="ei-cond">${sel(d.meta.conditions, a.condition)}</select></div>
    <div class="field" id="ei-next-wrap"><label>Next inspection date</label><input id="ei-next" type="date" value="${a.nextInspectionDate || ''}"></div>
    <div class="field" id="ei-lock-wrap" hidden><label style="font-weight:400"><input type="checkbox" id="ei-lock"> Lock the item until it can be inspected</label></div>
    <div class="field"><label>Note</label><textarea id="ei-note" rows="2" placeholder="Findings, advisory, or repair details"></textarea></div>
    <div class="cap-actions"><button class="btn" id="ei-save">Record inspection</button><button class="btn btn-secondary" id="ei-cancel">Cancel</button></div>
    <h3 style="font-size:1rem;margin:1rem 0 .3rem">Inspection history</h3>${history}
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.getElementById('ei-cancel').addEventListener('click', () => modal.remove());
  const outcome = document.getElementById('ei-outcome');
  const syncFields = () => {
    document.getElementById('ei-next-wrap').hidden = !['pass', 'advisory'].includes(outcome.value);
    document.getElementById('ei-lock-wrap').hidden = outcome.value !== 'unable';
  };
  outcome.addEventListener('change', syncFields); syncFields();
  document.getElementById('ei-save').addEventListener('click', async () => {
    const body = {
      outcome: outcome.value, condition: document.getElementById('ei-cond').value,
      nextInspectionDate: document.getElementById('ei-next').value, note: document.getElementById('ei-note').value.trim(),
      lock: document.getElementById('ei-lock').checked,
    };
    try { await Api.post(`/api/equipment/${assetId}/inspections`, body); modal.remove(); loadEquipment(); }
    catch (e) { document.getElementById('eq-insp-msg').innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  });
}

// Kit modal: manage a kit's expected contents and record a pre-loan/post-return
// completeness check (each component present/missing/damaged) (FR-QM-ADV-002/003).
async function openKitModal(assetId) {
  let d;
  try { d = await Api.get(`/api/equipment/${assetId}`); } catch (e) { alert(e.message); return; }
  const a = d.asset;
  const opt = (map, v) => Object.entries(map).map(([k, l]) => `<option value="${k}"${k === v ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('');
  const compRows = d.kitComponents.length
    ? d.kitComponents.map(c => `<tr><td>${escapeHtml(c.name)}</td><td style="width:70px">&times;${c.expectedQty}</td>
        <td style="width:150px"><select data-kc-status="${c.id}">${opt(d.meta.kitComponentStatuses, 'present')}</select></td>
        <td style="width:60px"><button class="btn btn-secondary btn-sm kc-del" data-cid="${c.id}">&times;</button></td></tr>`).join('')
    : '<tr><td colspan="4" class="muted">No expected contents yet — add the items this kit should hold.</td></tr>';
  const history = d.kitChecks.length
    ? d.kitChecks.map(k => `<div style="padding:.3rem 0;border-bottom:1px solid var(--border);font-size:.85rem">
        <strong>${escapeHtml(k.checkTypeLabel)}</strong> <span class="badge" data-status="${k.result === 'complete' ? 'active' : 'deleted'}">${escapeHtml(k.result)}</span>
        <span class="muted">· ${escapeHtml(k.by)} · ${formatDateTime(k.at)}</span>
        ${k.items.filter(i => i.status !== 'present').length ? `<br><span class="muted">${k.items.filter(i => i.status !== 'present').map(i => escapeHtml(i.name) + ': ' + escapeHtml(i.statusLabel)).join(', ')}</span>` : ''}</div>`).join('')
    : '<p class="muted">No checks recorded yet.</p>';
  const existing = document.getElementById('eq-kit-modal'); if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'eq-kit-modal'; modal.className = 'modal-backdrop';
  modal.innerHTML = `<div class="modal-box"><h2>Kit: ${escapeHtml(a.name)}</h2>
    <div id="eq-kit-msg"></div>
    <h3 style="font-size:1rem;margin:.6rem 0 .3rem">Expected contents</h3>
    <table class="data-table"><tbody id="eq-kit-comps">${compRows}</tbody></table>
    <div class="cap-actions" style="margin:.5rem 0">
      <input id="kc-name" placeholder="Component name" style="min-width:180px">
      <input id="kc-qty" type="number" min="1" value="1" style="width:80px" title="Expected quantity">
      <button class="btn btn-secondary btn-sm" id="kc-add">Add content</button>
    </div>
    <h3 style="font-size:1rem;margin:1rem 0 .3rem">Record completeness check</h3>
    <div class="cap-actions">
      <div class="field"><label>Check type</label><select id="kk-type">${opt(d.meta.kitCheckTypes, 'pre_loan')}</select></div>
      <div class="field" style="flex:1"><label>Note (optional)</label><input id="kk-note" placeholder="e.g. missing tent pegs replaced"></div>
    </div>
    <p class="muted" style="font-size:.82rem">Set each component's status above, then record. A missing/damaged result locks the kit and opens a repair.</p>
    <div class="cap-actions"><button class="btn" id="kk-save"${d.kitComponents.length ? '' : ' disabled'}>Record check</button><button class="btn btn-secondary" id="eq-kit-cancel">Close</button></div>
    <h3 style="font-size:1rem;margin:1rem 0 .3rem">Check history</h3>${history}
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.getElementById('eq-kit-cancel').addEventListener('click', () => { modal.remove(); loadEquipment(); });
  const msg = document.getElementById('eq-kit-msg');
  document.getElementById('kc-add').addEventListener('click', async () => {
    const name = document.getElementById('kc-name').value.trim();
    if (!name) return;
    try { await Api.post(`/api/equipment/${assetId}/kit-components`, { name, expectedQty: document.getElementById('kc-qty').value }); openKitModal(assetId); }
    catch (e) { msg.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  });
  modal.querySelectorAll('.kc-del').forEach(btn => btn.addEventListener('click', async () => {
    try { await Api.delete(`/api/equipment/${assetId}/kit-components/${btn.dataset.cid}`); openKitModal(assetId); }
    catch (e) { msg.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  }));
  const saveBtn = document.getElementById('kk-save');
  if (saveBtn) saveBtn.addEventListener('click', async () => {
    const statuses = {};
    modal.querySelectorAll('[data-kc-status]').forEach(s => { statuses[s.dataset.kcStatus] = s.value; });
    try {
      const r = await Api.post(`/api/equipment/${assetId}/kit-checks`, { checkType: document.getElementById('kk-type').value, note: document.getElementById('kk-note').value.trim(), statuses });
      msg.innerHTML = `<div class="alert ${r.result === 'complete' ? 'alert-success' : 'alert-warning'}">Check recorded: ${escapeHtml(r.result)}${r.result !== 'complete' ? ' — kit locked, repair opened.' : ''}</div>`;
      setTimeout(() => openKitModal(assetId), 700);
    } catch (e) { msg.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  });
}

// Stock administration (v2.4.3 18.8): post an attributable movement (there is no
// direct set-quantity) and see the ledger. The balance shown is ledger-derived.
async function openStockModal(assetId) {
  let d;
  try { d = await Api.get(`/api/equipment/${assetId}`); } catch (e) { alert(e.message); return; }
  if (d.isSerialised) return renderInstancesModal(assetId, d);
  const a = d.asset;
  const opt = (map, v) => Object.entries(map).map(([k, l]) => `<option value="${k}"${k === v ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('');
  const ledger = d.stockLedger.length
    ? d.stockLedger.map(m => `<tr><td>${escapeHtml(m.movementLabel)}</td><td style="text-align:right">${m.delta > 0 ? '+' : ''}${m.delta}</td><td style="text-align:right">${m.balanceAfter}</td>
        <td class="muted">${escapeHtml(m.by)} · ${formatDateTime(m.at)}${m.reason ? ' · ' + escapeHtml(m.reason) : ''}</td></tr>`).join('')
    : '<tr><td colspan="4" class="muted">No movements yet.</td></tr>';
  const existing = document.getElementById('eq-stock-modal'); if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'eq-stock-modal'; modal.className = 'modal-backdrop';
  modal.innerHTML = `<div class="modal-box"><h2>Stock: ${escapeHtml(a.name)}</h2>
    <p>Current balance: <strong style="font-size:1.2rem">${d.stockBalance}</strong> <span class="muted">${escapeHtml(a.issueUnit || '')}</span></p>
    <p class="muted" style="font-size:.82rem">Stock only changes through recorded movements — there is no direct edit. A correction needs a reason and records the before/after.</p>
    <div id="eq-stock-msg"></div>
    <div class="cap-actions">
      ${field2('Movement', `<select id="sm-type">${opt(d.meta.stockMovements, 'purchase')}</select>`)}
      <div class="field" id="sm-qty-wrap"><label>Quantity</label><input id="sm-qty" type="number" min="1" value="1" style="width:100px"></div>
      <div class="field" id="sm-target-wrap" style="display:none"><label>Correct to</label><input id="sm-target" type="number" min="0" value="${d.stockBalance}" style="width:100px"></div>
    </div>
    <div class="cap-actions">
      ${field2('Reason', `<input id="sm-reason" placeholder="Required for loss, disposal or correction" style="min-width:220px">`)}
      ${field2('Reference (optional)', `<input id="sm-ref" placeholder="e.g. invoice no.">`)}
    </div>
    <div class="cap-actions"><button class="btn" id="sm-save">Post movement</button><button class="btn btn-secondary" id="eq-stock-cancel">Close</button></div>
    <h3 style="font-size:1rem;margin:1rem 0 .3rem">Stock ledger</h3>
    <table class="data-table"><thead><tr><th>Movement</th><th style="text-align:right">Δ</th><th style="text-align:right">Balance</th><th>Who / when</th></tr></thead><tbody>${ledger}</tbody></table>
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.getElementById('eq-stock-cancel').addEventListener('click', () => { modal.remove(); loadEquipment(); });
  const typeSel = document.getElementById('sm-type');
  typeSel.addEventListener('change', () => {
    const isCorr = typeSel.value === 'correction';
    document.getElementById('sm-qty-wrap').style.display = isCorr ? 'none' : '';
    document.getElementById('sm-target-wrap').style.display = isCorr ? '' : 'none';
  });
  document.getElementById('sm-save').addEventListener('click', async () => {
    const type = typeSel.value;
    const body = { movementType: type, reason: document.getElementById('sm-reason').value.trim(), sourceRef: document.getElementById('sm-ref').value.trim() };
    if (type === 'correction') body.targetBalance = document.getElementById('sm-target').value;
    else body.quantity = document.getElementById('sm-qty').value;
    try { await Api.post(`/api/equipment/${assetId}/stock`, body); openStockModal(assetId); }
    catch (e) { document.getElementById('eq-stock-msg').innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  });
}
function field2(label, html) { return `<div class="field"><label>${label}</label>${html}</div>`; }

// Stocktake (v2.4.3 18.8): pick a scope, count each item, then post variances as
// attributable 'stocktake' ledger adjustments (a reason is required).
async function openStocktakeModal() {
  let recent = [];
  try { recent = await Api.get('/api/equipment/stocktakes'); } catch (e) { /* ignore */ }
  const existing = document.getElementById('eq-stk-modal'); if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'eq-stk-modal'; modal.className = 'modal-backdrop';
  modal.innerHTML = `<div class="modal-box"><h2>Stocktake</h2>
    <div id="eq-stk-msg"></div>
    <div id="eq-stk-body">
      <p class="muted">Count your bulk &amp; consumable stock. Serialised units are reconciled in their own Units panel.</p>
      <div class="cap-actions">
        ${field2('Category', `<select id="stk-cat">${optionList(EQ_META.categories, '', 'All categories')}</select>`)}
        ${field2('Location contains (optional)', `<input id="stk-loc" placeholder="e.g. Container A">`)}
      </div>
      <div class="cap-actions"><button class="btn" id="stk-start">Start stocktake</button><button class="btn btn-secondary" id="eq-stk-cancel">Close</button></div>
      ${recent.length ? `<h3 style="font-size:1rem;margin:1rem 0 .3rem">Recent</h3>
        <table class="data-table"><tbody>${recent.slice(0, 6).map(s => `<tr><td><strong>${escapeHtml(s.reference)}</strong> <span class="muted">${escapeHtml(s.scope || '')}</span></td>
          <td><span class="badge" data-status="${s.status === 'posted' ? 'active' : 'draft'}">${escapeHtml(s.status)}</span></td>
          <td class="muted">${escapeHtml(s.by)} · ${formatDate(s.at)}</td></tr>`).join('')}</tbody></table>` : ''}
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.getElementById('eq-stk-cancel').addEventListener('click', () => { modal.remove(); loadEquipment(); });
  document.getElementById('stk-start').addEventListener('click', async () => {
    try {
      const st = await Api.post('/api/equipment/stocktakes', { category: document.getElementById('stk-cat').value || null, location: document.getElementById('stk-loc').value.trim() });
      renderStocktakeSheet(st.id);
    } catch (e) { document.getElementById('eq-stk-msg').innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  });
}

async function renderStocktakeSheet(stocktakeId) {
  const d = await Api.get(`/api/equipment/stocktakes/${stocktakeId}`);
  const body = document.getElementById('eq-stk-body');
  const posted = d.status === 'posted';
  body.innerHTML = `
    <p><strong>${escapeHtml(d.reference)}</strong> — <span class="muted">${escapeHtml(d.scope || '')}</span> ${posted ? '<span class="badge" data-status="active">posted</span>' : ''}</p>
    <table class="data-table"><thead><tr><th>Item</th><th style="text-align:right">System</th><th style="text-align:right">Counted</th><th style="text-align:right">Variance</th></tr></thead>
    <tbody>${d.lines.map(l => `<tr>
      <td>${escapeHtml(l.name)} <span class="muted">${escapeHtml(l.issueUnit || '')}</span></td>
      <td style="text-align:right">${l.systemQty}</td>
      <td style="text-align:right">${posted ? (l.countedQty ?? '&mdash;') : `<input type="number" min="0" data-stk-line="${l.id}" data-sys="${l.systemQty}" value="${l.countedQty ?? ''}" style="width:80px;text-align:right">`}</td>
      <td style="text-align:right" data-stk-var="${l.id}">${l.postedDelta != null ? (l.postedDelta > 0 ? '+' + l.postedDelta : l.postedDelta) : (l.variance != null ? (l.variance > 0 ? '+' + l.variance : l.variance) : '&mdash;')}</td>
    </tr>`).join('')}</tbody></table>
    ${posted ? `<div class="alert alert-success">Stocktake posted. Variances were written to the stock ledger.</div>
      <div class="cap-actions"><button class="btn btn-secondary" id="eq-stk-cancel2">Close</button></div>`
    : `${field2('Reason (required to post)', `<input id="stk-reason" placeholder="e.g. Annual stocktake, damage write-off">`)}
      <div class="cap-actions"><button class="btn" id="stk-post">Post adjustments</button><button class="btn btn-secondary" id="eq-stk-cancel2">Cancel</button></div>`}`;
  document.getElementById('eq-stk-cancel2').addEventListener('click', () => { document.getElementById('eq-stk-modal').remove(); loadEquipment(); });
  if (posted) return;
  // live variance as you type
  body.querySelectorAll('[data-stk-line]').forEach(inp => inp.addEventListener('input', () => {
    const cell = body.querySelector(`[data-stk-var="${inp.dataset.stkLine}"]`);
    if (inp.value === '') { cell.textContent = '—'; return; }
    const v = Number(inp.value) - Number(inp.dataset.sys);
    cell.textContent = v > 0 ? '+' + v : String(v);
  }));
  document.getElementById('stk-post').addEventListener('click', async () => {
    const reason = document.getElementById('stk-reason').value.trim();
    if (!reason) { document.getElementById('eq-stk-msg').innerHTML = '<div class="alert alert-error">A reason is required.</div>'; return; }
    try {
      // save each counted line, then post
      for (const inp of body.querySelectorAll('[data-stk-line]')) {
        if (inp.value !== '') await Api.patch(`/api/equipment/stocktakes/${stocktakeId}/lines/${inp.dataset.stkLine}`, { countedQty: inp.value });
      }
      await Api.post(`/api/equipment/stocktakes/${stocktakeId}/post`, { reason });
      renderStocktakeSheet(stocktakeId);
    } catch (e) { document.getElementById('eq-stk-msg').innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  });
}

// Serialised-asset instances (v2.4.3 18.4): each physical unit is tracked with its
// own reference, status and condition; the asset's balance is the active count.
function renderInstancesModal(assetId, d) {
  const a = d.asset;
  const opt = (map, v) => Object.entries(map).map(([k, l]) => `<option value="${k}"${k === v ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('');
  const rows = d.instances.length
    ? d.instances.map(i => `<tr${i.active ? '' : ' class="muted"'}>
        <td><strong>${escapeHtml(i.ref)}</strong></td>
        <td><select data-inst-status="${i.id}">${opt(d.meta.instanceStatuses, i.status)}</select></td>
        <td><select data-inst-cond="${i.id}">${opt(d.meta.conditions, i.condition)}</select></td>
        <td><input data-inst-loc="${i.id}" value="${escapeHtml(i.location || '')}" style="width:130px"></td>
        <td><button class="btn btn-secondary btn-sm inst-save" data-iid="${i.id}">Save</button></td></tr>`).join('')
    : '<tr><td colspan="5" class="muted">No units yet — add each physical unit with its own reference.</td></tr>';
  const existing = document.getElementById('eq-stock-modal'); if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'eq-stock-modal'; modal.className = 'modal-backdrop';
  modal.innerHTML = `<div class="modal-box"><h2>Units: ${escapeHtml(a.name)}</h2>
    <p>Active: <strong>${d.instanceCounts ? d.instanceCounts.active : 0}</strong> · Available: <strong>${d.instanceCounts ? d.instanceCounts.available : 0}</strong></p>
    <p class="muted" style="font-size:.82rem">Serialised: each unit has its own identity and lifecycle. Availability is the count of Available units; retiring/disposing keeps the record but removes it from stock.</p>
    <div id="eq-stock-msg"></div>
    <table class="data-table"><thead><tr><th>Reference</th><th>Status</th><th>Condition</th><th>Location</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <h3 style="font-size:1rem;margin:1rem 0 .3rem">Add a unit</h3>
    <div class="cap-actions">
      ${field2('Reference / asset ID', `<input id="in-ref" placeholder="e.g. Radio #04 or serial">`)}
      ${field2('Condition', `<select id="in-cond">${opt(d.meta.conditions, 'good')}</select>`)}
      ${field2('Location', `<input id="in-loc" style="width:130px">`)}
      <button class="btn btn-secondary btn-sm" id="in-add" style="align-self:end">Add unit</button>
    </div>
    <div class="cap-actions" style="margin-top:1rem"><button class="btn btn-secondary" id="eq-stock-cancel">Close</button></div>
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  const msg = document.getElementById('eq-stock-msg');
  document.getElementById('eq-stock-cancel').addEventListener('click', () => { modal.remove(); loadEquipment(); });
  document.getElementById('in-add').addEventListener('click', async () => {
    const ref = document.getElementById('in-ref').value.trim();
    if (!ref) return;
    try { await Api.post(`/api/equipment/${assetId}/instances`, { ref, condition: document.getElementById('in-cond').value, location: document.getElementById('in-loc').value.trim() }); openStockModal(assetId); }
    catch (e) { msg.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  });
  modal.querySelectorAll('.inst-save').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.dataset.iid;
    try {
      await Api.patch(`/api/equipment/${assetId}/instances/${id}`, {
        status: document.querySelector(`[data-inst-status="${id}"]`).value,
        condition: document.querySelector(`[data-inst-cond="${id}"]`).value,
        location: document.querySelector(`[data-inst-loc="${id}"]`).value.trim(),
      });
      openStockModal(assetId);
    } catch (e) { msg.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  }));
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
      ${isEdit
        ? field('Current stock', `<input value="${a.stockBalance ?? 0}" disabled style="width:90px" title="Ledger-derived — change it with the Stock button"><span class="muted" style="font-size:.8rem"> use Stock</span>`)
        : field('Opening stock', `<input id="ef-quantity" type="number" min="0" value="${a.quantity ?? 1}" style="width:90px">`)}
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
    <details class="eq-advanced"${(a.itemType && a.itemType !== 'asset') || a.restricted || a.stockLevel != null || a.serialNumber || a.storageArea ? ' open' : ''}>
      <summary>Advanced — type, restricted gear, stock &amp; identity</summary>
      <div class="cap-actions">
        ${field('Item type', `<select id="ef-itemtype">${sel(EQ_META.itemTypes || { asset: 'Asset' }, a.itemType || 'asset')}</select>`)}
        ${field('Tracking mode', `<select id="ef-trackmode">${sel(EQ_META.trackingModes || { bulk_reusable: 'Bulk reusable' }, a.trackingMode || 'bulk_reusable')}</select>`)}
      </div>
      <div class="cap-actions">
        ${field('Restricted / controlled', `<label class="check"><input type="checkbox" id="ef-restricted" ${a.restricted ? 'checked' : ''}> Requires a permit</label>`)}
        <div class="field" id="ef-restricted-cat-wrap" style="${a.restricted ? '' : 'display:none'}"><label>Restricted category</label><select id="ef-restricted-cat"><option value="">&mdash;</option>${sel(EQ_META.restrictedCategories || {}, a.restrictedCategory || '')}</select></div>
      </div>
      <div id="ef-stock-wrap" style="${a.itemType === 'consumable' ? '' : 'display:none'}">
        <div class="cap-actions">
          ${field('Reorder at', `<input id="ef-reorder" type="number" min="0" value="${a.reorderThreshold ?? ''}" style="width:110px">`)}
          ${field('Issue unit', `<input id="ef-issueunit" value="${escapeHtml(a.issueUnit || '')}" placeholder="e.g. box, litre" style="width:150px">`)}
        </div>
      </div>
      <div class="cap-actions">
        ${field('Storage area', `<input id="ef-storagearea" value="${escapeHtml(a.storageArea || '')}" placeholder="e.g. Container A">`)}
        ${field('Location code', `<input id="ef-loccode" value="${escapeHtml(a.locationCode || '')}" placeholder="e.g. A-3-2" style="width:130px">`)}
        ${field('Confidence', `<select id="ef-locconf"><option value="">&mdash;</option>${sel(EQ_META.locationConfidence || {}, a.locationConfidence || '')}</select>`)}
      </div>
      <div class="cap-actions">
        ${field('Serial number', `<input id="ef-serial" value="${escapeHtml(a.serialNumber || '')}">`)}
        ${field('Supplier', `<input id="ef-supplier" value="${escapeHtml(a.supplier || '')}">`)}
      </div>
      <div class="cap-actions">
        ${field('Warranty expiry', `<input id="ef-warranty" type="date" value="${a.warrantyExpiry || ''}">`)}
        ${field('Replacement value (£)', `<input id="ef-repval" type="number" min="0" step="0.01" value="${a.replacementValue ?? ''}" style="width:140px">`)}
      </div>
      ${field('&nbsp;', `<label class="check"><input type="checkbox" id="ef-insurance" ${a.insuranceRelevant ? 'checked' : ''}> Insurance-relevant item</label>`)}
      <p class="muted" style="margin:.6rem 0 .2rem;font-size:.82rem">Suitability (shown to requesters when booking)</p>
      <div class="cap-actions">
        ${field('Suitable sections', `<input id="ef-suit-sections" value="${escapeHtml(a.suitableSections || '')}" placeholder="e.g. Cubs, Scouts">`)}
        ${field('Suitable events', `<input id="ef-suit-events" value="${escapeHtml(a.suitableEvents || '')}" placeholder="e.g. camp, day trip">`)}
      </div>
      <div class="cap-actions">
        ${field('Max group size', `<input id="ef-maxgroup" type="number" min="0" value="${a.maxGroupSize ?? ''}" style="width:110px">`)}
        ${field('Setup time (mins)', `<input id="ef-setup" type="number" min="0" value="${a.setupTimeMins ?? ''}" style="width:120px">`)}
        ${field('Vehicle required', `<input id="ef-vehicle" value="${escapeHtml(a.vehicleRequired || '')}" placeholder="e.g. van, minibus" style="width:150px">`)}
      </div>
    </details>
    <div class="modal-actions" style="display:flex;gap:.5rem;margin-top:1rem;align-items:center">
      <button class="btn" id="ef-save">${isEdit ? 'Save changes' : 'Add asset'}</button>
      <button class="btn btn-secondary" id="ef-cancel">Cancel</button>
      ${isEdit ? '<button class="btn btn-secondary eq-delete" id="ef-delete" style="margin-left:auto">Delete</button>' : ''}
    </div></div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.getElementById('ef-cancel').addEventListener('click', () => modal.remove());
  // Consumable stock fields only apply to consumables; restricted category only
  // when the item is marked restricted.
  const itypeSel = document.getElementById('ef-itemtype');
  itypeSel.addEventListener('change', () => { document.getElementById('ef-stock-wrap').style.display = itypeSel.value === 'consumable' ? '' : 'none'; });
  const restrChk = document.getElementById('ef-restricted');
  restrChk.addEventListener('change', () => { document.getElementById('ef-restricted-cat-wrap').style.display = restrChk.checked ? '' : 'none'; });

  document.getElementById('ef-save').addEventListener('click', async () => {
    const payload = {
      name: document.getElementById('ef-name').value.trim(),
      category: document.getElementById('ef-category').value,
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
      itemType: document.getElementById('ef-itemtype').value,
      trackingMode: document.getElementById('ef-trackmode').value,
      restricted: document.getElementById('ef-restricted').checked,
      restrictedCategory: document.getElementById('ef-restricted-cat').value,
      storageArea: document.getElementById('ef-storagearea').value.trim(),
      locationCode: document.getElementById('ef-loccode').value.trim(),
      locationConfidence: document.getElementById('ef-locconf').value,
      reorderThreshold: document.getElementById('ef-reorder').value,
      issueUnit: document.getElementById('ef-issueunit').value.trim(),
      serialNumber: document.getElementById('ef-serial').value.trim(),
      supplier: document.getElementById('ef-supplier').value.trim(),
      warrantyExpiry: document.getElementById('ef-warranty').value,
      replacementValue: document.getElementById('ef-repval').value,
      insuranceRelevant: document.getElementById('ef-insurance').checked,
      suitableSections: document.getElementById('ef-suit-sections').value.trim(),
      suitableEvents: document.getElementById('ef-suit-events').value.trim(),
      maxGroupSize: document.getElementById('ef-maxgroup').value,
      setupTimeMins: document.getElementById('ef-setup').value,
      vehicleRequired: document.getElementById('ef-vehicle').value.trim(),
    };
    // Opening stock is only set at creation; thereafter the balance moves only via
    // the stock ledger (the Stock button), never a direct quantity edit.
    if (!isEdit) payload.quantity = document.getElementById('ef-quantity').value;
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
