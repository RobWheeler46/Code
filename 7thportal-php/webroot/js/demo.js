// Demo persona chooser - lists every access level with one-click sign-in. Only
// available where demo mode is allowed (Test Environment pack DEMO-AUTH-002/004).
const PERSONAS = [
  { as: 'parent', name: 'Parent', role: 'Parent view', desc: 'Linked demo children, programme, photos, notices and the parent-safe leaderboard.' },
  { as: 'leaderparent', name: 'Parent + Section Leader', role: 'Dual role', desc: 'Switch between Parent and Leader views; tests role separation and no data leakage.' },
  { as: 'leader', name: 'Section Leader', role: 'section_leader', desc: 'Section people, attendance, programme, activity forms, expenses, QM bookings and Patrol Points.' },
  { as: 'assistantleader', name: 'Assistant Leader', role: 'assistant_leader', desc: 'Operational leader access without group-leadership approvals.' },
  { as: 'grouplead', name: 'Group Leadership (GLV)', role: 'group_leadership', desc: 'GLV approvals: activity forms and Patrol Points sign-off, plus leader tools.' },
  { as: 'treasurer', name: 'Treasurer', role: 'treasurer', desc: 'Expenses, mileage, the payment queue and the finance dashboard.' },
  { as: 'chair', name: 'Chair', role: 'chair', desc: 'Senior leadership: governance dashboard and approvals.' },
  { as: 'trustee', name: 'Trustee Viewer', role: 'trustee_viewer', desc: 'Read-only trustee governance dashboard, finance summaries and risk indicators.' },
  { as: 'admin', name: 'System Administrator', role: 'admin', desc: 'Configure modules, users, section capacity, audit log and demo feedback.' },
];

(async () => {
  const box = document.getElementById('content');
  let cfg;
  try { cfg = await Api.get('/api/config'); } catch (e) { cfg = null; }
  if (!cfg || !cfg.demoModeAllowed) {
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
