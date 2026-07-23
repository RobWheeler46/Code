import { el, api, initPage, statusPill } from './app.js';

await initPage();

const area = document.getElementById('history-area');
const { data } = await api('/api/history');

if (!data.sessions?.length) {
  area.replaceChildren(el('p', { text: 'No test sessions have been recorded yet.' }));
} else {
  const table = el('table');
  table.appendChild(el('caption', { text: `${data.sessions.length} recorded test session(s)` }));
  table.appendChild(el('thead', {}, [el('tr', {}, [
    el('th', { scope: 'col', text: 'Reference' }),
    el('th', { scope: 'col', text: 'Type' }),
    el('th', { scope: 'col', text: 'Started' }),
    el('th', { scope: 'col', text: 'Result' }),
    el('th', { scope: 'col', text: 'Warnings' }),
    el('th', { scope: 'col', text: 'Failures' }),
    el('th', { scope: 'col', text: 'Report' })
  ])]));
  table.appendChild(el('tbody', {}, data.sessions.map((s) => el('tr', {}, [
    el('td', {}, [el('code', { text: s.sessionRef })]),
    el('td', { text: s.kind === 'guided' ? 'Guided test' : 'Individual test' }),
    el('td', { text: s.startedAt || '—' }),
    el('td', {}, [statusPill(s.overallResult)]),
    el('td', { text: String(s.warningCount) }),
    el('td', { text: String(s.failureCount) }),
    el('td', {}, [el('a', { href: `/report.html?ref=${encodeURIComponent(s.sessionRef)}`, text: 'View' })])
  ]))));
  area.replaceChildren(table);
}
