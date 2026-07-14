renderPublicNav();

const token = new URLSearchParams(location.search).get('token');
const content = document.getElementById('content');

(async () => {
  if (!token) {
    content.innerHTML = `<div class="alert alert-error">This link is missing its setup token.</div>`;
    return;
  }
  try {
    const invite = await Api.get(`/api/auth/invite/${encodeURIComponent(token)}`);
    content.innerHTML = `
      <p class="muted">Welcome, ${escapeHtml(invite.firstName)}. Set a password for <strong>${escapeHtml(invite.email)}</strong> to finish setting up your 7thPortal account.</p>
      <form id="set-password-form">
        <div class="field">
          <label for="password">New password</label>
          <input type="password" id="password" required minlength="8" autocomplete="new-password">
          <div class="help">At least 8 characters.</div>
        </div>
        <button class="btn btn-primary" type="submit">Set password and log in</button>
      </form>
      <div id="error-box"></div>
    `;
    document.getElementById('set-password-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const result = await Api.post('/api/auth/set-password', { token, password: document.getElementById('password').value });
        location.href = result.redirect || 'parent-dashboard.html';
      } catch (err) {
        document.getElementById('error-box').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
      }
    });
  } catch (err) {
    content.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  }
})();
