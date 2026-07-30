function renderPublicNav() {
  const target = document.getElementById('app-nav');
  if (!target) return;
  target.innerHTML = `
    <div class="brand-block">
      <a class="brand" href="index.html">7thPortal</a>
      <span class="tagline">Skills for Life | 7th Swindon</span>
    </div>
    <nav class="page-nav">
      <a href="notices.html">Notices</a>
      <a href="privacy.html">Privacy notice</a>
    </nav>
    <div class="nav-right">
      <a class="role-pill" href="login.html">Log in</a>
    </div>
  `;
}

async function renderDemoBanner(cfg) {
  if (cfg && !cfg.osmConfigured) {
    const el = document.createElement('div');
    el.className = 'demo-banner';
    el.innerHTML = `Demo Mode &mdash; OSM is not connected yet, so you are seeing sample data. <a href="index.html#demo">Learn more</a>`;
    document.body.prepend(el);
  }
}

// Sidebar links only ever point at pages that actually exist in this build -
// the wireframe pack's Messages/Help/Reports/Approvals nav items are left out
// deliberately (see project README/memory: layout redesign only this pass).
function sidebarLinksForRole(me, cfg) {
  // Dual-role users see the nav for their ACTIVE view, not their stored role.
  const view = me.activeView || (me.role === 'parent' ? 'parent' : 'leader');
  if (view === 'parent') {
    const links = [{ href: 'parent-dashboard.html', label: 'Dashboard' }];
    links.push({ href: 'action-centre.html', label: 'Action Centre' });
    if (cfg && cfg.eventHubEnabled) links.push({ href: 'events.html', label: 'Events & camps' });
    if (cfg && cfg.calendarEnabled) links.push({ href: 'calendar.html', label: 'Calendar' });
    if (cfg && cfg.galleryEnabled) links.push({ href: 'gallery.html', label: 'Photo gallery' });
    links.push({ href: 'notices.html', label: 'Notices' });
    links.push({ href: 'notifications.html', label: 'Notifications' });
    links.push({ href: 'privacy.html', label: 'Privacy notice' });
    return links;
  }
  const links = [{ href: 'leader-dashboard.html', label: 'Dashboard' }];
  links.push({ href: 'action-centre.html', label: 'Action Centre' });
  if (cfg && cfg.eventHubEnabled) links.push({ href: 'events.html', label: 'Events & camps' });
  if (cfg && cfg.calendarEnabled) links.push({ href: 'calendar.html', label: 'Calendar' });
  if (cfg && cfg.attendanceEnabled) links.push({ href: 'attendance.html', label: 'Attendance' });
  if (cfg && cfg.galleryEnabled) links.push({ href: 'leader-gallery.html', label: 'Photo gallery' });
  if (cfg && cfg.financeEnabled) links.push({ href: 'expenses.html', label: 'Expenses & mileage' });
  if (cfg && cfg.documentLibraryEnabled) links.push({ href: 'documents.html', label: 'Document library' });
  if (cfg && cfg.incidentLoggingEnabled) links.push({ href: 'incidents.html', label: 'Incidents' });
  if (cfg && cfg.equipmentRegisterEnabled) links.push({ href: 'equipment.html', label: 'Equipment' });
  if (cfg && cfg.qmBookingEnabled) links.push({ href: 'quartermaster.html', label: 'QM bookings' });
  if (cfg && cfg.financeEnabled && ['treasurer', 'admin'].includes(me.role)) links.push({ href: 'treasurer.html', label: 'Treasurer' });
  if (cfg && cfg.financeEnabled && ['trustee_viewer', 'chair', 'treasurer', 'admin'].includes(me.role)) links.push({ href: 'trustee-dashboard.html', label: 'Trustee dashboard' });
  links.push({ href: 'notices.html', label: 'Notices' });
  links.push({ href: 'notifications.html', label: 'Notifications' });
  if (me.role === 'admin') links.push({ href: 'admin.html', label: 'Admin' });
  links.push({ href: 'privacy.html', label: 'Privacy notice' });
  return links;
}

function renderSidebar(me, cfg) {
  const target = document.getElementById('app-sidebar');
  if (!target) return;
  const currentPage = location.pathname.split('/').pop() || 'index.html';
  const links = sidebarLinksForRole(me, cfg)
    .map(l => `<a href="${l.href}"${currentPage === l.href ? ' class="active"' : ''}>${escapeHtml(l.label)}</a>`)
    .join('');
  const roleLine = me.dualRole
    ? `${me.activeView === 'parent' ? 'Parent view' : 'Leader view'}`
    : me.roleLabel;
  target.innerHTML = `<div class="sidebar-role">${escapeHtml(roleLine)}</div><nav>${links}</nav>`;
}

// A dual-role user's Parent/Leader toggle. Switching stores the view server-side
// (audited) then lands on that view's dashboard.
function viewSwitcherHtml(me) {
  if (!me.dualRole) return '';
  const btn = (view, label) => `<button class="view-switch${me.activeView === view ? ' active' : ''}" data-view="${view}">${label}</button>`;
  return `<div class="view-switcher" title="You are both a parent and a leader">${btn('parent', 'Parent')}${btn('leader', 'Leader')}</div>`;
}
function wireViewSwitcher() {
  document.querySelectorAll('.view-switch').forEach(b => b.addEventListener('click', async () => {
    if (b.classList.contains('active')) return;
    const view = b.dataset.view;
    try { await Api.post('/api/context', { view }); } catch (e) { alert(e.message); return; }
    location.href = view === 'parent' ? 'parent-dashboard.html' : 'leader-dashboard.html';
  }));
}

// Loads the current user, redirects to login if not authenticated, and
// renders the top nav + role-specific left sidebar. Returns the user object.
// pageView ('parent'|'leader') lets a page (the two dashboards) declare which view
// it belongs to, so a dual-role user's context follows the page they open.
async function requireUserNav(pageView) {
  let me;
  let cfg = null;
  try {
    me = await Api.get('/api/me');
  } catch (e) {
    location.href = 'login.html';
    return null;
  }
  // Keep the active view in step with the page a dual-role user landed on.
  if (pageView && me.capabilities && me.capabilities[pageView] && me.activeView !== pageView) {
    try { await Api.post('/api/context', { view: pageView }); me.activeView = pageView; } catch (e) { /* non-fatal */ }
  }
  try { cfg = await Api.get('/api/config'); } catch (e) { /* best effort */ }
  renderDemoBanner(cfg);
  const activeView = me.activeView || (me.role === 'parent' ? 'parent' : 'leader');
  const pillLabel = me.dualRole ? (activeView === 'parent' ? 'Parent view' : 'Leader view') : me.roleLabel;
  const target = document.getElementById('app-nav');
  if (target) {
    target.innerHTML = `
      <div class="brand-block">
        <a class="brand" href="${activeView === 'parent' ? 'parent-dashboard.html' : 'leader-dashboard.html'}">7thPortal</a>
        <span class="tagline">Skills for Life | 7th Swindon</span>
      </div>
      <div class="nav-right">
        ${viewSwitcherHtml(me)}
        <span class="user-info">${escapeHtml(me.firstName)} ${escapeHtml(me.lastName)}</span>
        <span class="role-pill">${escapeHtml(pillLabel)}</span>
        <a href="#" id="logout-link" class="logout-link">Log out</a>
      </div>
    `;
    document.getElementById('logout-link').addEventListener('click', async (e) => {
      e.preventDefault();
      await Api.post('/api/auth/logout');
      location.href = 'login.html';
    });
    wireViewSwitcher();
  }
  renderSidebar(me, cfg);
  return me;
}
