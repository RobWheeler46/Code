// Shared helpers: JSON fetch, current user, role-aware navigation, small utilities.

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    ...options
  });
  if (res.status === 401) { window.location.href = '/login'; throw new Error('unauthorised'); }
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s.includes('T') || s.includes(' ') ? s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z') : s);
  if (isNaN(d)) return s;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtDateTime(s) {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z'));
  if (isNaN(d)) return s;
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB']; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

// Render the top navigation for the signed-in user. `active` is the current page key.
async function mountNav(active) {
  let user;
  try { user = (await api('/api/me')).user; } catch { return null; }
  const links = [
    { key: 'dashboard', href: '/dashboard', label: 'Dashboard', roles: ['parent', 'leader', 'admin'] },
    { key: 'notices', href: '/notices', label: 'Notices', roles: ['parent', 'leader', 'admin'] },
    { key: 'documents', href: '/documents', label: 'Documents', roles: ['leader', 'admin'] },
    { key: 'admin', href: '/admin', label: 'Admin', roles: ['admin'] }
  ].filter((l) => l.roles.includes(user.role));

  const nav = links.map((l) => `<a href="${l.href}" class="${l.key === active ? 'active' : ''}">${l.label}</a>`).join('');
  document.getElementById('topbar').innerHTML = `
    <div class="topbar-inner">
      <a class="brand" href="/dashboard"><span class="logo">7</span> 7thPortal</a>
      <nav class="nav">
        ${nav}
        <span class="who">${esc(user.displayName)} · ${user.role}</span>
        <a href="#" id="signout">Sign out</a>
      </nav>
    </div>`;
  document.getElementById('signout').addEventListener('click', async (e) => {
    e.preventDefault();
    await api('/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  });
  return user;
}

// Read a File as base64 for JSON upload.
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function openModal(html) {
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.innerHTML = `<div class="modal">${html}</div>`;
  back.addEventListener('click', (e) => { if (e.target === back) back.remove(); });
  document.body.appendChild(back);
  return back;
}
