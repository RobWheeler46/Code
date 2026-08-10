// Printable equipment labels: a grid of asset labels, each with a human-readable
// asset code + a scannable Code 128 barcode (QM QR/Barcode label sheet).
(async () => {
  const me = await requireUserNav();
  if (!me) return;
  const box = document.getElementById('content');
  let data;
  try { data = await Api.get('/api/equipment'); }
  catch (e) { box.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; return; }

  const idsParam = new URLSearchParams(location.search).get('ids');
  const ids = idsParam ? idsParam.split(',').map(Number) : null;
  let assets = data.assets.filter(a => a.status !== 'retired');
  if (ids) assets = assets.filter(a => ids.includes(a.id));

  if (!assets.length) { box.innerHTML = '<div class="alert alert-warning">No assets to label.</div>'; return; }

  const code = a => 'EQP-' + String(a.id).padStart(4, '0');
  box.innerHTML = `<p class="muted no-print">${assets.length} label(s). Test-scan one before printing a full batch, then use Print (choose your label sheet or plain A4).</p>
    <div class="eq-label-grid">${assets.map(a => `
      <div class="eq-label">
        <div class="eq-label-name">${escapeHtml(a.name)}</div>
        <div class="eq-label-meta">${escapeHtml(EQ_LABEL_CAT[a.category] || a.category)}${a.location ? ' · ' + escapeHtml(a.location) : ''}</div>
        <div class="eq-label-barcode">${code128Svg(code(a), { unit: 2, height: 44 })}</div>
        <div class="eq-label-code">${escapeHtml(code(a))}</div>
      </div>`).join('')}</div>`;

  document.getElementById('eq-print').addEventListener('click', () => window.print());
})();

const EQ_LABEL_CAT = { camping: 'Camping', activity: 'Activity', safety: 'Safety', general: 'General' };
