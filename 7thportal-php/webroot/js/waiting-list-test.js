// TEST tool: write a member to the live OSM waiting list to confirm the write contract.
// Admin-only. A successful write creates a REAL record in OSM that must be deleted there.
const esc = (s) => escapeHtml(s == null ? '' : String(s));
const box = () => document.getElementById('content');

(async () => {
  const me = await requireUserNav();
  if (!me) return;
  if (me.role !== 'admin') {
    renderPageHeader({ title: 'Waiting List Write Test', crumbs: crumbs() });
    box().innerHTML = '<div class="alert alert-error">Portal Administrator access required.</div>';
    return;
  }
  render();
})();

function crumbs() {
  return [{ label: 'Admin', href: 'admin.html' }, { label: 'Integrations', href: 'admin.html?tab=health' }, { label: 'Waiting List Write Test' }];
}

function render() {
  renderPageHeader({ title: 'Waiting List Write Test', crumbs: crumbs() });
  box().innerHTML = `
    <div class="alert alert-warning"><strong>This writes a real record to your live OSM waiting list.</strong>
      Use test data only. A "ZZTEST" marker is forced onto the name so the entry is obvious, but you must still
      delete it in OSM afterwards. Requires the OSM connection to have been re-authorised with member-write access.</div>
    <div class="wt-field"><label for="wt-first">First name</label><input id="wt-first" value="ZZTEST"></div>
    <div class="wt-field"><label for="wt-last">Last name</label><input id="wt-last" value="Please Delete"></div>
    <div class="wt-field"><label for="wt-dob">Date of birth (YYYY-MM-DD)</label><input id="wt-dob" value="2018-01-01"></div>
    <div class="wt-field"><label for="wt-gender">Gender</label><input id="wt-gender" value="Other"></div>
    <div class="wt-field"><label for="wt-day">Preferred day</label><input id="wt-day" value="Tuesday"></div>
    <div class="wt-field"><label for="wt-sibling">Sibling in the group?</label><input id="wt-sibling" value="No"></div>
    <div class="wt-field"><label for="wt-volunteer">Can you help volunteer?</label><input id="wt-volunteer" value="Maybe"></div>
    <label class="wt-confirm"><input type="checkbox" id="wt-confirm"> <span>I understand this creates a real entry on the live OSM waiting list and I will delete it.</span></label>
    <button class="btn" id="wt-submit">Write test entry to OSM</button>
    <pre id="wt-out" hidden></pre>`;
  document.getElementById('wt-submit').addEventListener('click', submit);
}

async function submit() {
  const out = document.getElementById('wt-out');
  const btn = document.getElementById('wt-submit');
  const v = (id) => document.getElementById(id).value.trim();
  const body = {
    firstname: v('wt-first'), lastname: v('wt-last'), dob: v('wt-dob'), gender: v('wt-gender'),
    prefDay: v('wt-day'), sibling: v('wt-sibling'), volunteer: v('wt-volunteer'),
    confirm: document.getElementById('wt-confirm').checked,
  };
  if (!body.confirm) { out.hidden = false; out.textContent = 'Tick the confirmation box first.'; return; }
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = 'Writing to OSM…';
  try {
    const d = await Api.post('/api/admin/waiting-list/test-write', body);
    out.hidden = false;
    const head = d.simulated ? d.note
      : (d.ok ? `Created on the live waiting list (OSM id ${d.scoutid}). "${d.wrote}" - CHECK OSM AND DELETE IT.`
              : `Did not write (HTTP ${d.status || '?'}).${d.error ? ' ' + d.error : ''}`);
    let body = head + (d.response !== undefined && d.response !== null ? '\n\n' + JSON.stringify(d.response, null, 2) : '');
    if (d.custom && Object.keys(d.custom).length) body += '\n\nCustom fields:\n' + JSON.stringify(d.custom, null, 2);
    out.textContent = body;
  } catch (e) {
    out.hidden = false;
    out.textContent = 'Request failed: ' + (e && e.message ? e.message : e) + (e && e.data ? '\n\n' + JSON.stringify(e.data, null, 2) : '');
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
}
