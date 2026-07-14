(async () => {
  const me = await initNav();
  if (!me) return;
  if (!me.isRequester && !me.isAdmin) {
    document.querySelector('.container').innerHTML = '<div class="card"><p>You do not have access to submit requests.</p></div>';
    return;
  }

  await setupActivityFormFields();

  if (me.isAdmin) {
    try {
      const requesters = await Api.get('/api/admin/requesters');
      const select = document.getElementById('on_behalf_of_user_id');
      requesters.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.id;
        opt.textContent = `${u.name} (${u.email})`;
        select.appendChild(opt);
      });
      document.getElementById('admin-on-behalf-card').style.display = '';
    } catch (e) { /* ignore */ }
  }

  const form = document.getElementById('request-form');
  const alertBox = document.getElementById('alert-box');

  async function submitForm(action) {
    alertBox.innerHTML = '';
    clearFieldErrors(form);
    const formData = new FormData(form);
    formData.set('action', action);
    try {
      const result = await Api.postForm('/api/requests', formData);
      location.href = `request.html?id=${result.id}`;
    } catch (err) {
      alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
      if (err.fields) showFieldErrors(form, err.fields);
      window.scrollTo(0, 0);
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitForm('submit');
  });

  document.getElementById('draft-btn').addEventListener('click', () => {
    submitForm('draft');
  });
})();
