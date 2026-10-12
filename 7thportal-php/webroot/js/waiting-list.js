// Admin-only waiting-list view. Live read-through of the OSM waiting-list section - the
// full enquiry details (child + parent contacts) are shown to the admin and NOTHING is
// stored in 7thPortal. Access is audited server-side.
const esc = (s) => escapeHtml(s == null ? '' : String(s));
const box = () => document.getElementById('content');

(async () => {
  const me = await requireUserNav();
  if (!me) return;
  if (me.role !== 'admin') {
    renderPageHeader({ title: 'Waiting List', crumbs: crumbs() });
    box().innerHTML = '<div class="alert alert-error">Portal Administrator access required.</div>';
    return;
  }
  render();
})();

function crumbs() {
  return [
    { label: 'Admin', href: 'admin.html' },
    { label: 'Integrations', href: 'admin.html?tab=health' },
    { label: 'Waiting List' },
  ];
}

async function render() {
  renderPageHeader({
    title: 'Waiting List',
    crumbs: crumbs(),
    description: 'Everyone on the group’s OSM waiting list, longest-waiting first. Read live from OSM for administrators; nothing is stored in 7thPortal, and each view is audited.',
  });

  let d;
  try { d = await Api.get('/api/admin/waiting-list'); }
  catch (e) { box().innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`; return; }

  if (!d.available) {
    box().innerHTML = `<div class="alert alert-warning">${esc(d.reason || 'The waiting list could not be read from OSM right now.')}</div>`;
    return;
  }
  const members = d.members || [];
  const demo = d.source === 'demo';
  if (!members.length) {
    box().innerHTML = `${demo ? demoBanner() : ''}<div class="empty-state">The waiting list is empty.</div>`;
    return;
  }

  const rows = members.map((m) => {
    const contacts = (m.contacts || []).map((c) => `<div class="wl-contact">
      ${c.name ? `<span class="nm">${esc(c.name)}</span>` : ''}
      ${c.email ? ` &middot; <a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ''}
      ${c.phone ? ` &middot; <a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : ''}
    </div>`).join('') || '<span class="muted">No contact on file</span>';
    return `<tr>
      <td><strong>${esc(m.name || '—')}</strong></td>
      <td>${m.dob ? esc(formatDate(m.dob)) : '—'}</td>
      <td>${esc(m.age || '—')}</td>
      <td>${m.started ? esc(formatDate(m.started)) : '—'}</td>
      <td>${contacts}</td>
    </tr>`;
  }).join('');

  box().innerHTML = `${demo ? demoBanner() : ''}
    <p class="wl-meta"><strong>${members.length}</strong> on the waiting list.
      <button class="btn btn-secondary btn-sm" id="wl-fields">Show all OSM fields</button></p>
    <pre id="wl-fields-out" hidden style="overflow:auto;max-height:24rem;background:var(--surface-2,#f2eef7);padding:.8rem;border-radius:8px;font-size:.82rem;white-space:pre-wrap"></pre>
    <div class="wl-table-wrap"><table class="wl-table">
      <thead><tr><th>Name</th><th>Date of birth</th><th>Age (y/m)</th><th>Waiting since</th><th>Contacts</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  wireFields();
}

// Lists every field OSM holds on the waiting-list grid (labelled, with masked samples),
// so an admin can see what extra custom data exists beyond the columns shown above.
function wireFields() {
  const btn = document.getElementById('wl-fields');
  const out = document.getElementById('wl-fields-out');
  if (!btn || !out) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = 'Reading from OSM…';
    try {
      const d = await Api.get('/api/admin/waiting-list/fields');
      out.hidden = false;
      if (!d.available) { out.textContent = d.reason || 'Could not read the fields.'; return; }
      out.textContent = (d.fields || []).map((f) => `${f.parentish ? '[contact] ' : ''}${f.path}  =  ${f.sample}`).join('\n') || 'No fields returned.';
    } catch (e) {
      out.hidden = false;
      out.textContent = e.message;
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  });
}

function demoBanner() {
  return '<div class="alert alert-info">Demonstration data - connect a live OSM service account to see the real waiting list.</div>';
}
