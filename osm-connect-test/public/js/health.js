import { el, api, initPage, statusPill } from './app.js';

await initPage();

const area = document.getElementById('health-area');
const { data } = await api('/api/health');

const table = el('table');
table.appendChild(el('caption', { text: `Overall: ${data.healthy ? 'all local checks passed' : `failed checks — ${data.failed.join(', ')}`}` }));
table.appendChild(el('thead', {}, [el('tr', {}, [
  el('th', { scope: 'col', text: 'Check' }),
  el('th', { scope: 'col', text: 'Result' }),
  el('th', { scope: 'col', text: 'Detail' }),
  el('th', { scope: 'col', text: 'Duration' })
])]));
table.appendChild(el('tbody', {}, data.checks.map((c) => el('tr', {}, [
  el('td', { text: c.name }),
  el('td', {}, [statusPill(c.ok ? 'Passed' : 'Failed')]),
  el('td', { text: c.detail }),
  el('td', { text: `${c.durationMs} ms` })
]))));

area.replaceChildren(
  el('div', { class: 'table-scroll' }, [table]),
  el('p', { class: 'hint', text: `Application version ${data.version} · environment ${data.environment}` })
);
