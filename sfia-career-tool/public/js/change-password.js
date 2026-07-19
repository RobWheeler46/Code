// Change password screen (FRD v0.26). Works for any signed-in local account (admin or end user).
document.addEventListener('DOMContentLoaded', async () => {
  renderPublicNav();

  let me = null;
  try { me = await Api.get('/api/me'); } catch (e) { location.href = 'signin.html?next=change-password.html'; return; }

  // Admins came from the admin area — point Cancel back there.
  if (me && me.isAdmin) document.getElementById('cp-cancel').href = 'admin.html';

  // Load the policy rules from the server so the panel always matches enforcement.
  try {
    const policy = await Api.get('/api/user/password-policy');
    document.getElementById('rules-list').innerHTML = policy.rules.map(r => `<li>${escapeHtml(r)}</li>`).join('');
  } catch (e) { document.getElementById('rules-list').innerHTML = '<li>At least 12 characters, not common, not your name/email, not a recent password.</li>'; }

  const form = document.getElementById('cp-form');
  const alertBox = document.getElementById('alert-box');
  const submit = document.getElementById('cp-submit');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    alertBox.innerHTML = '';
    const currentPassword = document.getElementById('current').value;
    const newPassword = document.getElementById('new').value;
    const confirmPassword = document.getElementById('confirm').value;

    if (newPassword !== confirmPassword) {
      alertBox.innerHTML = '<div class="alert alert-error">Your new password and confirmation do not match.</div>';
      return;
    }
    submit.disabled = true;
    try {
      await Api.post('/api/user/change-password', { currentPassword, newPassword, confirmPassword });
      form.reset();
      alertBox.innerHTML = '<div class="alert alert-success">Your password has been changed.</div>';
    } catch (err) {
      alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    } finally {
      submit.disabled = false;
    }
  });
});
