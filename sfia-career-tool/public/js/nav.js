// Shared inline-SVG icon set (FRD v0.27 FR-UX4: consistent iconography for repeated actions). Each icon
// inherits currentColor and is aria-hidden; meaningful icons must sit next to a text label.
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/>',
  roles: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  compare: '<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/>',
  pathways: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h6a4 4 0 0 0 4-4V8"/>',
  coach: '<path d="M21 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z"/><circle cx="9.5" cy="10.5" r="0.6" fill="currentColor"/><circle cx="13" cy="10.5" r="0.6" fill="currentColor"/><circle cx="16.5" cy="10.5" r="0.6" fill="currentColor"/>',
  assess: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  plan: '<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 13l2 2 4-4"/>',
  evidence: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>',
  arrowRight: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
  gauge: '<path d="M12 13l4-4"/><path d="M4 18a8 8 0 1 1 16 0"/><circle cx="12" cy="13" r="1.3" fill="currentColor"/>',
  bridge: '<path d="M3 8v10M21 8v10"/><path d="M3 12c4 0 5-4 9-4s5 4 9 4"/><path d="M8 12v6M16 12v6"/>',
  more: '<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>'
};

// Return an inline SVG string for a named icon. Decorative by default (aria-hidden); pass a `title` to
// give it an accessible label when it conveys meaning on its own.
function svgIcon(name, opts = {}) {
  const body = ICONS[name] || '';
  const cls = opts.className ? ` class="${opts.className}"` : '';
  const a11y = opts.title ? ` role="img" aria-label="${opts.title}"` : ' aria-hidden="true"';
  return `<svg${cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"${a11y}>${body}</svg>`;
}

// Wrap an icon body as a bottom-nav <svg> (kept for the mobile tab bar markup).
const NAV_ICONS = {
  home: svgIcon('home'), roles: svgIcon('roles'), compare: svgIcon('compare'), coach: svgIcon('coach')
};

function renderPublicNav() {
  const page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  const isActive = (files) => files.includes(page) ? 'active' : '';

  const target = document.getElementById('app-nav');
  if (target) {
    target.innerHTML = `
      <a class="brand" href="index.html">Career Explorer</a>
      <nav>
        <a href="index.html" class="${isActive(['index.html', 'role.html', ''])}">Home</a>
        <a href="index.html#roles-heading">Roles</a>
        <a href="compare.html" class="${isActive(['compare.html'])}">Compare</a>
        <a href="coach.html" class="${isActive(['coach.html'])}">Coach</a>
      </nav>
      <span class="nav-auth" id="nav-auth"></span>
    `;
    updatePublicNavAuth();
  }

  // Mobile bottom tab bar — the four persistent public journeys (FRD v0.27 FR-UX1:
  // Home, Roles, Compare, Coach). Pathways and Assessment are surfaced contextually instead.
  if (!document.getElementById('bottom-nav')) {
    const bottom = document.createElement('nav');
    bottom.id = 'bottom-nav';
    bottom.className = 'bottom-nav';
    bottom.setAttribute('aria-label', 'Primary');
    bottom.innerHTML = `
      <a href="index.html" class="${isActive(['index.html', 'role.html', ''])}">${NAV_ICONS.home}<span>Home</span></a>
      <a href="index.html#roles-heading">${NAV_ICONS.roles}<span>Roles</span></a>
      <a href="compare.html" class="${isActive(['compare.html'])}">${NAV_ICONS.compare}<span>Compare</span></a>
      <a href="coach.html" class="${isActive(['coach.html'])}">${NAV_ICONS.coach}<span>Coach</span></a>
    `;
    document.body.appendChild(bottom);
  }
}

// Populates the nav's auth slot: "Sign in" when logged out, or the user's name + "Sign out" when a
// registered end user (or admin) is signed in. Cached on window so it's fetched once per page load.
async function updatePublicNavAuth() {
  const slot = document.getElementById('nav-auth');
  if (!slot) return;
  let me = null;
  try { me = await Api.get('/api/me'); } catch (e) { me = null; }
  if (me) {
    slot.innerHTML = `
      <a href="dashboard.html">My dashboard</a>
      <a href="change-password.html">Change password</a>
      <a href="#" id="nav-signout">Sign out</a>
    `;
    slot.querySelector('#nav-signout').addEventListener('click', async (e) => {
      e.preventDefault();
      await Api.post('/api/logout');
      location.href = 'index.html';
    });
  } else {
    slot.innerHTML = `
      <a href="login.html" class="nav-admin-link">Admin</a>
      <a href="signin.html" class="btn btn-primary btn-sm">Sign in</a>`;
  }
}

// Returns the signed-in user (or null) - lets pages show/hide save buttons. Single shared fetch.
let _mePromise;
function getMe() {
  if (!_mePromise) _mePromise = Api.get('/api/me').catch(() => null);
  return _mePromise;
}

// Reusable mountain + winding-path hero illustration from the wireframes (inline SVG so it themes
// with the palette and needs no external asset).
function heroIllustrationSvg() {
  return `<svg class="hero-illustration" viewBox="0 0 320 200" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="70" cy="45" r="10" fill="#ffffff" opacity="0.6"/><circle cx="85" cy="45" r="13" fill="#ffffff" opacity="0.6"/><circle cx="102" cy="45" r="9" fill="#ffffff" opacity="0.6"/>
    <path d="M150 200 L235 55 L320 200 Z" fill="#9db8de"/>
    <path d="M235 55 L215 90 L228 100 L240 88 L252 102 L235 55Z" fill="#ffffff"/>
    <path d="M40 200 L120 80 L200 200 Z" fill="#c3d4ec"/>
    <path d="M120 80 L106 105 L118 114 L128 103 L120 80Z" fill="#ffffff"/>
    <path d="M120 200 C120 165 175 165 175 130 C175 100 210 100 210 70" stroke="#ffffff" stroke-width="9" stroke-linecap="round" fill="none" opacity="0.9"/>
    <rect x="206" y="52" width="3" height="20" fill="#0b1f3a"/><path d="M209 53 L224 58 L209 64 Z" fill="#fcca12"/>
  </svg>`;
}

async function requireAdminNav() {
  const target = document.getElementById('app-nav');
  let me;
  try {
    me = await Api.get('/api/me');
  } catch (e) {
    location.href = 'login.html';
    return null;
  }
  if (target) {
    target.innerHTML = `
      <a class="brand" href="admin.html">Career Explorer - Admin</a>
      <nav>
        <a href="index.html" target="_blank">View public site</a>
        <span class="user-info">${escapeHtml(me.firstName)} ${escapeHtml(me.lastName)} (${me.roles.join(', ')})</span>
        <a href="change-password.html">Change password</a>
        <a href="#" id="logout-link">Log out</a>
      </nav>
    `;
    document.getElementById('logout-link').addEventListener('click', async (e) => {
      e.preventDefault();
      await Api.post('/api/logout');
      location.href = 'login.html';
    });
  }
  return me;
}
