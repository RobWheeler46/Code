import { el, api, initPage } from './app.js';

const state = await initPage();

const btn = document.getElementById('delete-btn');
const result = document.getElementById('delete-result');

if (!state.user) {
  btn.disabled = true;
  result.appendChild(el('p', { class: 'hint', text: 'You need to be connected before you can request deletion of your own data.' }));
}

let armed = false;
btn.addEventListener('click', async () => {
  // Inline confirmation rather than a native dialog, so the flow stays keyboard
  // and screen-reader friendly.
  if (!armed) {
    armed = true;
    btn.textContent = 'Confirm: permanently delete my test data';
    result.replaceChildren(el('p', {
      role: 'alert',
      text: 'This removes your test history, stored section references and OSM tokens, and signs you out. Audit records are kept for security. Select the button again to confirm, or navigate away to cancel.'
    }));
    return;
  }
  btn.disabled = true;
  const { ok, data } = await api('/api/privacy/delete', { method: 'POST', body: {} });
  result.replaceChildren(
    el('p', { role: 'status', text: ok ? data.note : (data.error || 'The deletion request could not be completed.') }),
    ok ? el('div', { class: 'actions' }, [el('a', { class: 'button', href: '/index.html', text: 'Back to home' })]) : null
  );
});
