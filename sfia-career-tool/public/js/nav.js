const NAV_ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/></svg>',
  roles: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  compare: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/></svg>',
  pathways: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h6a4 4 0 0 0 4-4V8"/></svg>'
};

function renderPublicNav() {
  const page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  const isActive = (files) => files.includes(page) ? 'active' : '';

  const target = document.getElementById('app-nav');
  if (target) {
    target.innerHTML = `
      <a class="brand" href="index.html">SFIA Career</a>
      <nav>
        <a href="index.html" class="${isActive(['index.html', 'role.html', ''])}">Home</a>
        <a href="index.html" class="${isActive(['browse'])}">Roles</a>
        <a href="compare.html" class="${isActive(['compare.html'])}">Compare</a>
        <a href="pathways.html" class="${isActive(['pathways.html', 'pathway.html'])}">Pathways</a>
        <a href="login.html">Admin</a>
      </nav>
    `;
  }

  // Mobile bottom tab bar (FRD v0.9/v0.20 wireframes). Deferred "Coach" tab omitted since the AI
  // Career Coach is a Phase-2 feature that isn't built.
  if (!document.getElementById('bottom-nav')) {
    const bottom = document.createElement('nav');
    bottom.id = 'bottom-nav';
    bottom.className = 'bottom-nav';
    bottom.setAttribute('aria-label', 'Primary');
    bottom.innerHTML = `
      <a href="index.html" class="${isActive(['index.html', 'role.html', ''])}">${NAV_ICONS.home}<span>Home</span></a>
      <a href="index.html" class="${isActive(['browse'])}">${NAV_ICONS.roles}<span>Roles</span></a>
      <a href="compare.html" class="${isActive(['compare.html'])}">${NAV_ICONS.compare}<span>Compare</span></a>
      <a href="pathways.html" class="${isActive(['pathways.html', 'pathway.html'])}">${NAV_ICONS.pathways}<span>Pathways</span></a>
    `;
    document.body.appendChild(bottom);
  }
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
      <a class="brand" href="admin.html">SFIA Career Tool - Admin</a>
      <nav>
        <a href="index.html" target="_blank">View public site</a>
        <span class="user-info">${escapeHtml(me.firstName)} ${escapeHtml(me.lastName)} (${me.roles.join(', ')})</span>
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
