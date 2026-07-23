import { el, api, initPage, renderMessage } from './app.js';

await initPage();

const btn = document.getElementById('confirm-btn');
const result = document.getElementById('result-area');

btn.addEventListener('click', async () => {
  btn.disabled = true;
  const { ok, data } = await api('/api/disconnect', { method: 'POST', body: {} });
  if (!ok) {
    btn.disabled = false;
    result.replaceChildren(el('p', { role: 'alert', text: data.error || 'You are not currently connected.' }));
    return;
  }
  result.replaceChildren(
    renderMessage(data.message),
    el('p', { text: data.note }),
    el('div', { class: 'actions' }, [el('a', { class: 'button', href: '/index.html', text: 'Back to home' })])
  );
});
