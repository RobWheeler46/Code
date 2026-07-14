function renderPublicNav() {
  const target = document.getElementById('app-nav');
  if (!target) return;
  target.innerHTML = `
    <a class="brand" href="index.html">7thPortal</a>
    <nav>
      <a href="notices.html">Notices</a>
      <a href="privacy.html">Privacy notice</a>
      <a href="login.html">Log in</a>
    </nav>
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

function navLinksForRole(me, cfg) {
  if (me.role === 'parent') {
    const links = [{ href: 'parent-dashboard.html', label: 'My dashboard' }];
    if (cfg && cfg.galleryEnabled) links.push({ href: 'gallery.html', label: 'Photo gallery' });
    links.push({ href: 'notices.html', label: 'Notices' }, { href: 'privacy.html', label: 'Privacy notice' });
    return links;
  }
  const links = [
    { href: 'leader-dashboard.html', label: 'Leader dashboard' },
  ];
  if (cfg && cfg.galleryEnabled) links.push({ href: 'leader-gallery.html', label: 'Photo gallery' });
  links.push({ href: 'notices.html', label: 'Notices' });
  if (me.role === 'admin') links.push({ href: 'admin.html', label: 'Admin' });
  links.push({ href: 'privacy.html', label: 'Privacy notice' });
  return links;
}

// Loads the current user, redirects to login if not authenticated, and
// renders the top nav with role-appropriate links. Returns the user object.
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
    const links = navLinksForRole(me, cfg).map(l => `<a href="${l.href}">${escapeHtml(l.label)}</a>`).join('');
    target.innerHTML = `
      <a class="brand" href="${me.role === 'parent' ? 'parent-dashboard.html' : 'leader-dashboard.html'}">7thPortal</a>
      <nav>
        ${links}
        <span class="user-info">${escapeHtml(me.firstName)} ${escapeHtml(me.lastName)} &middot; ${escapeHtml(me.roleLabel)}</span>
        <a href="#" id="logout-link">Log out</a>
      </nav>
    `;
    document.getElementById('logout-link').addEventListener('click', async (e) => {
      e.preventDefault();
      await Api.post('/api/auth/logout');
      location.href = 'login.html';
    });
  }
  return me;
}
