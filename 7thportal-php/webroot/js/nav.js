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
  if (me.role === 'parent') {
    const links = [{ href: 'parent-dashboard.html', label: 'Dashboard' }];
    if (cfg && cfg.galleryEnabled) links.push({ href: 'gallery.html', label: 'Photo gallery' });
    links.push({ href: 'notices.html', label: 'Notices' });
    links.push({ href: 'privacy.html', label: 'Privacy notice' });
    return links;
  }
  const links = [{ href: 'leader-dashboard.html', label: 'Dashboard' }];
  if (cfg && cfg.galleryEnabled) links.push({ href: 'leader-gallery.html', label: 'Photo gallery' });
  if (cfg && cfg.financeEnabled) links.push({ href: 'expenses.html', label: 'Expenses & mileage' });
  if (cfg && cfg.financeEnabled && ['treasurer', 'admin'].includes(me.role)) links.push({ href: 'treasurer.html', label: 'Treasurer' });
  if (cfg && cfg.financeEnabled && ['trustee_viewer', 'chair', 'treasurer', 'admin'].includes(me.role)) links.push({ href: 'trustee-dashboard.html', label: 'Trustee dashboard' });
  links.push({ href: 'notices.html', label: 'Notices' });
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
  target.innerHTML = `<div class="sidebar-role">${escapeHtml(me.roleLabel)}</div><nav>${links}</nav>`;
}

// Loads the current user, redirects to login if not authenticated, and
// renders the top nav + role-specific left sidebar. Returns the user object.
async function requireUserNav() {
  let me;
  let cfg = null;
  try {
    me = await Api.get('/api/me');
  } catch (e) {
    location.href = 'login.html';
    return null;
  }
  try { cfg = await Api.get('/api/config'); } catch (e) { /* best effort */ }
  renderDemoBanner(cfg);
  const target = document.getElementById('app-nav');
  if (target) {
    target.innerHTML = `
      <div class="brand-block">
        <a class="brand" href="${me.role === 'parent' ? 'parent-dashboard.html' : 'leader-dashboard.html'}">7thPortal</a>
        <span class="tagline">Skills for Life | 7th Swindon</span>
      </div>
      <div class="nav-right">
        <span class="user-info">${escapeHtml(me.firstName)} ${escapeHtml(me.lastName)}</span>
        <span class="role-pill">${escapeHtml(me.roleLabel)}</span>
        <a href="#" id="logout-link" class="logout-link">Log out</a>
      </div>
    `;
    document.getElementById('logout-link').addEventListener('click', async (e) => {
      e.preventDefault();
      await Api.post('/api/auth/logout');
      location.href = 'login.html';
    });
  }
  renderSidebar(me, cfg);
  return me;
}
