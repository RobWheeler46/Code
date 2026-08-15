// Demo persona chooser - lists every access level with one-click sign-in. Only
// available where demo mode is allowed (Test Environment pack DEMO-AUTH-002/004).
const PERSONAS = [
  { as: 'parent', name: 'Parent', role: 'Parent view', desc: 'Linked demo children, programme, photos, notices and the parent-safe leaderboard.' },
  { as: 'leaderparent', name: 'Parent + Section Leader', role: 'Dual role', desc: 'Switch between Parent and Leader views; tests role separation and no data leakage.' },
  { as: 'leader', name: 'Section Leader', role: 'section_leader', desc: 'Section people, attendance, programme, activity forms, expenses, QM bookings and Patrol Points.' },
  { as: 'assistantleader', name: 'Assistant Leader', role: 'assistant_leader', desc: 'Operational leader access without group-leadership approvals.' },
  { as: 'grouplead', name: 'Group Leadership (GLV)', role: 'group_leadership', desc: 'GLV approvals: activity forms and Patrol Points sign-off, plus leader tools.' },
  { as: 'quartermaster', name: 'Quartermaster', role: 'quartermaster', desc: 'Owns the equipment register: approve bookings, catalogue, inspections, bulk import and labels. Not a GLV.' },
  { as: 'treasurer', name: 'Treasurer', role: 'treasurer', desc: 'Expenses, mileage, the payment queue and the finance dashboard.' },
  { as: 'chair', name: 'Chair', role: 'chair', desc: 'Senior leadership: governance dashboard and approvals.' },
  { as: 'trustee', name: 'Trustee Viewer', role: 'trustee_viewer', desc: 'Read-only trustee governance dashboard, finance summaries and risk indicators.' },
];
// Note: the System Administrator persona is deliberately not listed here - it is
// reached only via its direct demo URL (optionally key-protected), so testers
// can't change system settings during a workshop.

(async () => {
  const box = document.getElementById('content');
  // Load the server config, retrying a couple of times: on a fresh deploy the
  // first requests can transiently fail (500 / DB lock) while migrations settle,
  // and a failed load must NOT be mistaken for "demo mode disabled" - those are
  // different conditions with different messages.
  let cfg = null, loadFailed = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { cfg = await Api.get('/api/config'); loadFailed = false; break; }
    catch (e) { loadFailed = true; await new Promise(r => setTimeout(r, 600)); }
  }
  if (loadFailed || !cfg) {
    box.innerHTML = '<div class="alert alert-warning">Couldn\'t reach the server to load the demo options. This is usually temporary just after a deploy - <a href="#" onclick="location.reload();return false;">try again</a> in a moment.</div>';
    return;
  }
  if (!cfg.demoModeAllowed) {
    box.innerHTML = '<div class="alert alert-warning">Demo mode is not enabled on this server. <a href="login.html">Go to login</a>.</div>';
    return;
  }
  box.innerHTML = `<div class="cap-stats" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr))">
    ${PERSONAS.map(p => `<a class="card demo-persona" href="/auth/demo/login?as=${p.as}">
      <div class="cap-head"><strong>${escapeHtml(p.name)}</strong><span class="badge" data-status="active">${escapeHtml(p.role)}</span></div>
      <p class="muted" style="margin:.3rem 0 0;font-size:.85rem">${escapeHtml(p.desc)}</p>
    </a>`).join('')}
  </div>`;
})();
