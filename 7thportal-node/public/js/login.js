(async function () {
  const msg = document.getElementById('msg');

  // Show any error passed back from the OSM callback.
  const params = new URLSearchParams(location.search);
  if (params.get('error')) {
    msg.innerHTML = `<div class="msg error">${esc(params.get('error'))}</div>`;
  }

  // Configure the OSM button and demo hint from the server.
  try {
    const cfg = await api('/auth/config');
    if (!cfg.osmConfigured) {
      const btn = document.getElementById('osmBtn');
      btn.classList.add('secondary');
      btn.setAttribute('aria-disabled', 'true');
      btn.addEventListener('click', (e) => e.preventDefault());
      btn.style.opacity = '.5';
      btn.style.cursor = 'not-allowed';
      document.getElementById('osmHint').style.display = 'block';
    }
    if (cfg.seedDemoUsers) {
      const demo = document.getElementById('demo');
      demo.style.display = 'block';
      demo.innerHTML = 'Demo accounts: <b>admin@7thportal.local</b> / portal-admin · '
        + '<b>leader@7thportal.local</b> / portal-leader · '
        + '<b>parent@7thportal.local</b> / portal-parent';
    }
  } catch { /* login page still works without config */ }

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.innerHTML = '';
    try {
      await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: document.getElementById('email').value.trim(),
          password: document.getElementById('password').value
        })
      });
      window.location.href = '/dashboard';
    } catch (err) {
      msg.innerHTML = `<div class="msg error">${esc(err.message)}</div>`;
    }
  });
})();
