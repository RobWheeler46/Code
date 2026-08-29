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

function renderDemoBanner(cfg, me) {
  if (!cfg || document.querySelector('.demo-banner')) return;
  const el = document.createElement('div');
  if (cfg.demoModeAllowed) {
    // Prominent, unmistakable banner for the demo/test environment, naming the
    // current persona and offering a one-click persona switch (DEMO-AUTH-003/004).
    const who = me ? ` — you are <strong>${escapeHtml(me.firstName)} ${escapeHtml(me.lastName)}</strong> (${escapeHtml(me.roleLabel || me.role || '')})` : '';
    el.className = 'demo-banner demo-banner-strong';
    el.innerHTML = `<span class="demo-badge">DEMO</span> Test environment — synthetic sample data, not connected to OSM, email or calendar${who}. <a href="demo.html">Switch persona</a>`;
    document.body.prepend(el);
    document.body.classList.add('has-demo-banner');
  } else if (!cfg.osmConfigured) {
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
    links.push({ href: 'search.html', label: 'Search' });
    if (cfg && cfg.eventHubEnabled) links.push({ href: 'events.html', label: 'Events & camps' });
    if (cfg && cfg.calendarEnabled) links.push({ href: 'calendar.html', label: 'Calendar' });
    if (cfg && cfg.patrolPointsEnabled) links.push({ href: 'patrol-leaderboard.html', label: 'Patrol Points' });
    if (cfg && cfg.galleryEnabled) links.push({ href: 'gallery.html', label: 'Photo gallery' });
    links.push({ href: 'notices.html', label: 'Notices' });
    links.push({ href: 'notifications.html', label: 'Notifications' });
    links.push({ href: 'privacy.html', label: 'Privacy notice' });
    return links;
  }
  const links = [{ href: 'leader-dashboard.html', label: 'Dashboard' }];
  links.push({ href: 'prepare-tonight.html', label: 'Prepare Tonight' });
  links.push({ href: 'action-centre.html', label: 'Action Centre' });
  links.push({ href: 'search.html', label: 'Search' });
  if (cfg && cfg.eventHubEnabled) links.push({ href: 'events.html', label: 'Events & camps' });
  if (cfg && cfg.calendarEnabled) links.push({ href: 'calendar.html', label: 'Calendar' });
  if (cfg && cfg.attendanceEnabled) links.push({ href: 'attendance.html', label: 'Attendance' });
  if (cfg && cfg.activityFormsEnabled) links.push({ href: 'activity-forms.html', label: 'Activity forms' });
  if (cfg && cfg.patrolPointsEnabled) links.push({ href: 'patrol-points.html', label: 'Patrol Points' });
  if (cfg && cfg.galleryEnabled) links.push({ href: 'leader-gallery.html', label: 'Photo gallery' });
  if (cfg && cfg.financeEnabled) links.push({ href: 'expenses.html', label: 'Expenses & mileage' });
  if (cfg && cfg.documentLibraryEnabled) links.push({ href: 'documents.html', label: 'Document library' });
  if (cfg && cfg.incidentLoggingEnabled) links.push({ href: 'incidents.html', label: 'Incidents' });
  if (cfg && cfg.equipmentRegisterEnabled) links.push({ href: 'equipment.html', label: 'Equipment' });
  if (cfg && cfg.qmBookingEnabled) links.push({ href: 'quartermaster.html', label: 'QM bookings' });
  if (cfg && cfg.financeEnabled && ['treasurer', 'admin'].includes(me.role)) links.push({ href: 'treasurer.html', label: 'Treasurer' });
  if (['trustee_viewer', 'chair', 'treasurer', 'admin'].includes(me.role)) links.push({ href: 'governance.html', label: 'Trustee dashboard' });
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

// Mobile navigation: a slide-in drawer (shown via the header burger below 900px)
// carrying the same links as the sidebar plus the role switcher, so the whole app
// is navigable on a phone. Reuses sidebarLinksForRole so there's one source of nav.
function renderMobileDrawer(me, cfg, pillLabel) {
  document.getElementById('nav-drawer')?.remove();
  const currentPage = location.pathname.split('/').pop() || 'index.html';
  const isAdmin = currentPage === 'admin.html';
  // On the admin page the sidebar is admin sub-nav; give the drawer the normal app
  // nav plus a link back into Admin so a mobile admin isn't stranded.
  let links = sidebarLinksForRole(me, cfg);
  if (isAdmin && me.role === 'admin' && !links.some(l => l.href === 'admin.html')) links.push({ href: 'admin.html', label: 'Admin' });
  const linksHtml = links.map(l => `<a href="${l.href}"${currentPage === l.href ? ' class="active"' : ''}>${escapeHtml(l.label)}</a>`).join('');

  const drawer = document.createElement('div');
  drawer.id = 'nav-drawer';
  drawer.className = 'nav-drawer';
  drawer.innerHTML = `
    <div class="nav-drawer-backdrop" id="nav-drawer-backdrop"></div>
    <aside class="nav-drawer-panel" role="dialog" aria-label="Menu">
      <div class="nav-drawer-head">
        <span class="sidebar-role">${escapeHtml(pillLabel)}</span>
        <button class="nav-drawer-close" id="nav-drawer-close" aria-label="Close menu">&times;</button>
      </div>
      ${me.dualRole ? `<div class="nav-drawer-switch">${viewSwitcherHtml(me)}</div>` : ''}
      <nav>${linksHtml}</nav>
      <a href="#" id="drawer-logout" class="nav-drawer-logout">Log out</a>
    </aside>`;
  document.body.appendChild(drawer);

  const close = () => { drawer.classList.remove('open'); document.getElementById('nav-burger')?.setAttribute('aria-expanded', 'false'); };
  const open = () => { drawer.classList.add('open'); document.getElementById('nav-burger')?.setAttribute('aria-expanded', 'true'); };
  document.getElementById('nav-burger')?.addEventListener('click', open);
  document.getElementById('nav-drawer-close').addEventListener('click', close);
  document.getElementById('nav-drawer-backdrop').addEventListener('click', close);
  drawer.querySelector('nav').addEventListener('click', e => { if (e.target.tagName === 'A') close(); });
  document.getElementById('drawer-logout').addEventListener('click', async (e) => { e.preventDefault(); await Api.post('/api/auth/logout'); location.href = 'login.html'; });
  wireViewSwitcher(drawer); // wire only the drawer's switcher (top bar wired separately)
}

// Mobile bottom navigation (FRD v1.3 wireframes s3): a fixed, task-led bar on phones
// carrying the primary destinations - Today, Actions, a context slot (Events/Calendar)
// and More (which opens the same drawer). Built from the resolved nav model so it
// respects role, active context and feature flags. Hidden on desktop, where the
// left sidebar already serves. One source of nav truth: More reuses the drawer.
function renderBottomNav(me, cfg) {
  document.getElementById('bottom-nav')?.remove();
  const view = me.activeView || (me.role === 'parent' ? 'parent' : 'leader');
  const current = location.pathname.split('/').pop() || 'index.html';
  const today = view === 'parent' ? 'parent-dashboard.html' : 'leader-dashboard.html';
  const items = [
    { href: today, label: 'Today', icon: '\u{1F3E0}', match: [today] },
    { href: 'action-centre.html', label: 'Actions', icon: '✅', match: ['action-centre.html'] },
  ];
  // Third slot: the primary planning surface enabled for this context.
  if (cfg && cfg.eventHubEnabled) items.push({ href: 'events.html', label: 'Events', icon: '\u{1F3D5}️', match: ['events.html', 'event-hub.html'] });
  else if (cfg && cfg.calendarEnabled) items.push({ href: 'calendar.html', label: 'Calendar', icon: '\u{1F4C5}', match: ['calendar.html'] });
  else if (view === 'leader') items.push({ href: 'prepare-tonight.html', label: 'Tonight', icon: '\u{1F4CB}', match: ['prepare-tonight.html'] });
  else items.push({ href: 'notices.html', label: 'Notices', icon: '\u{1F4E3}', match: ['notices.html'] });

  const primaryActive = items.some(it => it.match.includes(current));
  const link = (it) => `<a class="bottom-nav-item${it.match.includes(current) ? ' active' : ''}" href="${it.href}"><span class="bn-icon" aria-hidden="true">${it.icon}</span><span class="bn-label">${escapeHtml(it.label)}</span></a>`;
  const moreBtn = `<button type="button" class="bottom-nav-item${primaryActive ? '' : ' active'}" id="bottom-nav-more" aria-label="More menu"><span class="bn-icon" aria-hidden="true">☰</span><span class="bn-label">More</span></button>`;

  const bar = document.createElement('nav');
  bar.id = 'bottom-nav';
  bar.className = 'bottom-nav';
  bar.setAttribute('aria-label', 'Primary');
  bar.innerHTML = items.map(link).join('') + moreBtn;
  document.body.appendChild(bar);
  document.body.classList.add('has-bottom-nav');
  // "More" opens the existing drawer, reusing its wiring via the header burger.
  document.getElementById('bottom-nav-more').addEventListener('click', () => document.getElementById('nav-burger')?.click());
}

// A dual-role user's Parent/Leader toggle. Switching stores the view server-side
// (audited) then lands on that view's dashboard.
function viewSwitcherHtml(me) {
  if (!me.dualRole) return '';
  const btn = (view, label) => `<button class="view-switch${me.activeView === view ? ' active' : ''}" data-view="${view}">${label}</button>`;
  return `<div class="view-switcher" title="You are both a parent and a leader">${btn('parent', 'Parent')}${btn('leader', 'Leader')}</div>`;
}
function wireViewSwitcher(root = document) {
  root.querySelectorAll('.view-switch').forEach(b => b.addEventListener('click', async () => {
    if (b.classList.contains('active')) return;
    const view = b.dataset.view;
    try { await Api.post('/api/context', { view }); } catch (e) { alert(e.message); return; }
    location.href = view === 'parent' ? 'parent-dashboard.html' : 'leader-dashboard.html';
  }));
}

// Feature-flag deep-link guard (FRD v1.3 Responsive & Feature-Flag pack). Each module
// page maps to the /api/config flag its module needs. If someone opens a disabled
// module's URL directly, we show a friendly "Feature unavailable" screen with a way
// back, instead of a broken shell or a raw API error. The module's APIs already refuse
// to return data when the flag is off, so this is the UI half of "no dead links".
const PAGE_FEATURE_MAP = {
  'gallery.html': 'galleryEnabled', 'leader-gallery.html': 'galleryEnabled', 'album-edit.html': 'galleryEnabled',
  'expenses.html': 'financeEnabled', 'claim-edit.html': 'financeEnabled', 'treasurer.html': 'financeEnabled',
  'documents.html': 'documentLibraryEnabled', 'document-edit.html': 'documentLibraryEnabled',
  'equipment.html': 'equipmentRegisterEnabled', 'equipment-labels.html': 'equipmentRegisterEnabled',
  'quartermaster.html': 'qmBookingEnabled',
  'incidents.html': 'incidentLoggingEnabled',
  'events.html': 'eventHubEnabled', 'event-hub.html': 'eventHubEnabled',
  'calendar.html': 'calendarEnabled',
  'attendance.html': 'attendanceEnabled',
  'activity-forms.html': 'activityFormsEnabled', 'activity-form.html': 'activityFormsEnabled',
  'patrol-points.html': 'patrolPointsEnabled', 'patrol-point.html': 'patrolPointsEnabled',
  'patrol-leaderboard.html': 'patrolPointsEnabled', 'patrol-score.html': 'patrolPointsEnabled',
};

// The config flag the current page needs, or null. A page can override the map with
// <meta name="requires-feature" content="flagName"> so future pages can self-declare.
function currentPageFeature() {
  const meta = document.querySelector('meta[name="requires-feature"]');
  if (meta && meta.content) return meta.content;
  const page = location.pathname.split('/').pop() || 'index.html';
  return PAGE_FEATURE_MAP[page] || null;
}

// Replace the page body with the standard "Feature unavailable" screen, keeping the
// nav chrome so the user can move on. Returns false so callers can halt the page.
function renderFeatureUnavailable(me) {
  const today = (me && (me.activeView === 'parent' || (me.role === 'parent' && me.activeView !== 'leader'))) ? 'parent-dashboard.html' : 'leader-dashboard.html';
  const host = document.querySelector('main.app-main') || document.getElementById('content') || document.body;
  const inner = `
    <div class="container">
      <div class="card" style="max-width:560px;margin:2rem auto;text-align:center">
        <div style="font-size:2.2rem;line-height:1">&#128274;</div>
        <h1 style="margin:.4rem 0 .3rem">Feature unavailable</h1>
        <p>This feature isn&rsquo;t currently enabled for 7thPortal or for your role.</p>
        <p class="muted">No action is needed &mdash; head back to your dashboard to carry on with what&rsquo;s available.</p>
        <div style="margin-top:1rem"><a class="btn" href="${today}">Back to Today</a></div>
      </div>
    </div>`;
  if (host.tagName === 'MAIN') host.innerHTML = inner; else host.innerHTML = inner;
  return false;
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
  renderDemoBanner(cfg, me);
  const activeView = me.activeView || (me.role === 'parent' ? 'parent' : 'leader');
  const pillLabel = me.dualRole ? (activeView === 'parent' ? 'Parent view' : 'Leader view') : me.roleLabel;
  const target = document.getElementById('app-nav');
  if (target) {
    target.innerHTML = `
      <button class="nav-burger" id="nav-burger" aria-label="Open menu" aria-expanded="false">&#9776;</button>
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
    renderMobileDrawer(me, cfg, pillLabel);
  }
  renderSidebar(me, cfg);
  renderBottomNav(me, cfg);
  renderFeedbackWidget(cfg);
  // Deep-link guard: if this page's module is switched off, show the unavailable
  // screen and return null so the page's own JS halts (it already does `if (!me)
  // return;`). Only block when cfg loaded and the flag is explicitly false - a
  // transient config failure fails open, since the module APIs still refuse data.
  const feature = currentPageFeature();
  if (cfg && feature && cfg[feature] === false) {
    renderFeatureUnavailable(me);
    return null;
  }
  return me;
}

// A floating "Feedback" button + modal, shown only in demo mode (OSM not
// connected), so UAT testers can leave feedback from any page (DEMO-FB).
function renderFeedbackWidget(cfg) {
  if (!cfg || !cfg.demoModeAllowed || document.getElementById('demo-fb-btn')) return;
  const device = window.matchMedia('(max-width: 767px)').matches ? 'mobile' : (window.matchMedia('(max-width: 1024px)').matches ? 'tablet' : 'desktop');
  const btn = document.createElement('button');
  btn.id = 'demo-fb-btn';
  btn.className = 'demo-fb-btn';
  btn.textContent = 'Feedback';
  document.body.appendChild(btn);
  btn.addEventListener('click', () => {
    if (document.getElementById('demo-fb-modal')) return;
    const page = location.pathname.split('/').pop() || 'index.html';
    const wrap = document.createElement('div');
    wrap.id = 'demo-fb-modal';
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<div class="modal-box">
      <h2 style="margin-top:0">Demo feedback</h2>
      <p class="muted" style="margin-top:-.3rem">On <strong>${escapeHtml(page)}</strong> · this is a demo, so anything here is fine to share.</p>
      <div class="field"><label>Type</label><select id="demo-fb-cat">
        <option value="feedback">Feedback</option><option value="defect">Defect</option><option value="question">Question</option><option value="enhancement">Enhancement idea</option>
      </select></div>
      <div class="field"><label>Rating</label><select id="demo-fb-rating">
        <option value="">No rating</option><option value="5">5 — great</option><option value="4">4</option><option value="3">3 — ok</option><option value="2">2</option><option value="1">1 — poor</option>
      </select></div>
      <div class="field"><label>Comment</label><textarea id="demo-fb-comment" rows="3" placeholder="What worked, what didn't, or an idea"></textarea></div>
      <div id="demo-fb-msg"></div>
      <div class="cap-actions"><button class="btn" id="demo-fb-send">Send</button><button class="btn btn-secondary" id="demo-fb-cancel">Cancel</button></div>
    </div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
    document.getElementById('demo-fb-cancel').addEventListener('click', close);
    document.getElementById('demo-fb-send').addEventListener('click', async () => {
      const comment = document.getElementById('demo-fb-comment').value.trim();
      const msg = document.getElementById('demo-fb-msg');
      if (!comment) { msg.innerHTML = '<div class="alert alert-error">Please add a comment.</div>'; return; }
      try {
        await Api.post('/api/feedback', {
          page, device, comment,
          category: document.getElementById('demo-fb-cat').value,
          rating: document.getElementById('demo-fb-rating').value || undefined,
        });
        wrap.querySelector('.modal-box').innerHTML = '<h2 style="margin-top:0">Thank you!</h2><p>Your feedback has been recorded.</p><div class="cap-actions"><button class="btn" id="demo-fb-done">Close</button></div>';
        document.getElementById('demo-fb-done').addEventListener('click', close);
      } catch (e) { msg.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
    });
  });
}
