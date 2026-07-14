function renderPublicNav() {
  const target = document.getElementById('app-nav');
  if (!target) return;
  target.innerHTML = `
    <a class="brand" href="index.html">SFIA Career Tool</a>
    <nav>
      <a href="index.html">Browse roles</a>
      <a href="pathways.html">Career pathways</a>
      <a href="compare.html">Compare roles</a>
      <a href="login.html">Admin</a>
    </nav>
  `;
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
