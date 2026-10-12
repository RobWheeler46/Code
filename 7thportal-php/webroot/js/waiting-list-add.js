// Staff-only quick-add to the OSM waiting list. Writes straight to OSM; nothing is stored
// in 7thPortal. Admin-only.
const esc = (s) => escapeHtml(s == null ? '' : String(s));
const box = () => document.getElementById('content');

(async () => {
  const me = await requireUserNav();
  if (!me) return;
  if (me.role !== 'admin') {
    renderPageHeader({ title: 'Add to Waiting List', crumbs: crumbs() });
    box().innerHTML = '<div class="alert alert-error">Portal Administrator access required.</div>';
    return;
  }
  render();
})();

function crumbs() {
  return [
    { label: 'Admin', href: 'admin.html' },
    { label: 'Waiting List', href: 'waiting-list.html' },
    { label: 'Add someone' },
  ];
}

function render() {
  renderPageHeader({
    title: 'Add to Waiting List',
    crumbs: crumbs(),
    description: 'Add a person to the group’s OSM waiting list. Writes straight into OSM; nothing is stored in 7thPortal.',
  });
  box().innerHTML = `
    <div id="wa-msg"></div>
    <div class="wa-sec">Child</div>
    <div class="wa-grid">
      <div class="wa-field"><label for="wa-first">First name *</label><input id="wa-first"></div>
      <div class="wa-field"><label for="wa-last">Last name *</label><input id="wa-last"></div>
      <div class="wa-field"><label for="wa-dob">Date of birth</label><input id="wa-dob" type="date"></div>
      <div class="wa-field"><label for="wa-gender">Gender</label>
        <select id="wa-gender"><option value="">—</option><option>Male</option><option>Female</option><option>Other</option><option>Unspecified</option></select></div>
    </div>
    <div class="wa-sec">Preferences</div>
    <div class="wa-field"><label for="wa-day">Preferred day</label><input id="wa-day" placeholder="e.g. Tuesday"></div>
    <div class="wa-grid">
      <div class="wa-field"><label for="wa-sibling">Sibling in the group? (name)</label><input id="wa-sibling"></div>
      <div class="wa-field"><label for="wa-volunteer">Can you help volunteer?</label><input id="wa-volunteer"></div>
    </div>
    <div class="wa-sec">Parent / carer</div>
    <div class="wa-grid">
      <div class="wa-field"><label for="wa-pfirst">First name</label><input id="wa-pfirst"></div>
      <div class="wa-field"><label for="wa-plast">Last name</label><input id="wa-plast"></div>
      <div class="wa-field"><label for="wa-pemail">Email</label><input id="wa-pemail" type="email"></div>
      <div class="wa-field"><label for="wa-pphone">Phone</label><input id="wa-pphone"></div>
    </div>
    <p style="margin-top:1rem"><button class="btn" id="wa-submit">Add to waiting list</button>
      <a class="btn btn-secondary" href="waiting-list.html">View waiting list</a></p>`;
  document.getElementById('wa-submit').addEventListener('click', submit);
}

async function submit() {
  const msg = document.getElementById('wa-msg');
  const btn = document.getElementById('wa-submit');
  const v = (id) => document.getElementById(id).value.trim();
  const body = {
    firstname: v('wa-first'), lastname: v('wa-last'), dob: v('wa-dob'), gender: v('wa-gender'),
    prefDay: v('wa-day'), sibling: v('wa-sibling'), volunteer: v('wa-volunteer'),
    parentFirst: v('wa-pfirst'), parentLast: v('wa-plast'), parentEmail: v('wa-pemail'), parentPhone: v('wa-pphone'),
  };
  if (!body.firstname || !body.lastname) { msg.innerHTML = '<div class="alert alert-error">First and last name are required.</div>'; return; }
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = 'Adding…';
  try {
    const d = await Api.post('/api/admin/waiting-list/add', body);
    const warn = (d.warnings || []).length ? `<br><span class="muted">Some fields may not have saved: ${esc((d.warnings || []).join(', '))}</span>` : '';
    msg.innerHTML = `<div class="alert alert-success">${d.simulated ? 'Demo mode - nothing was written.' : `Added to the waiting list${d.scoutid ? ' (OSM id ' + esc(d.scoutid) + ')' : ''}.`}${warn}</div>`;
    if (!d.simulated) ['wa-first', 'wa-last', 'wa-dob', 'wa-day', 'wa-sibling', 'wa-volunteer', 'wa-pfirst', 'wa-plast', 'wa-pemail', 'wa-pphone'].forEach((id) => { document.getElementById(id).value = ''; });
  } catch (e) {
    msg.innerHTML = `<div class="alert alert-error">${esc(e && e.message ? e.message : e)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
}
