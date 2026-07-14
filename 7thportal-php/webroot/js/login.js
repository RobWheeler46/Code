renderPublicNav();

(async () => {
  const params = new URLSearchParams(location.search);
  const error = params.get('error');
  if (error) {
    document.getElementById('error-box').innerHTML = `<div class="alert alert-error">${escapeHtml(error)}</div>`;
  }
  try {
    const cfg = await Api.get('/api/config');
    if (!cfg.osmConfigured) document.getElementById('demo-leader-link').style.display = 'block';
  } catch (e) { /* best effort */ }
})();

document.getElementById('parent-login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  try {
    const result = await Api.post('/api/auth/local-login', { email, password });
    location.href = result.redirect || 'parent-dashboard.html';
  } catch (err) {
    document.getElementById('error-box').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  }
});
