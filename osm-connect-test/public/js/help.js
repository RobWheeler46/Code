import { el, api, initPage, statusPill } from './app.js';

await initPage();

const area = document.getElementById('catalogue-area');
const filter = document.getElementById('filter');
const count = document.getElementById('filter-count');

const { data } = await api('/api/messages');
const all = data.messages;

function entryNode(m) {
  const card = el('div', { class: 'card' });
  card.appendChild(el('h3', {}, [statusPill(m.status), ' ', el('code', { text: m.code }), ' — ', m.title]));
  card.appendChild(el('p', { text: m.whatHappened }));
  const dl = el('dl', { class: 'facts' });
  const add = (t, v) => { if (!v) return; dl.appendChild(el('dt', { text: t })); dl.appendChild(typeof v === 'string' ? el('dd', { text: v }) : el('dd', {}, [v])); };
  add('What this means', m.whatThisMeans);
  add('What has not happened', m.whatHasNotHappened);
  if (m.possibleCauses?.length) add('Possible causes', el('ul', {}, m.possibleCauses.map((c) => el('li', { text: c }))));
  if (m.whatYouCanDo?.length) add('What you can do', el('ul', {}, m.whatYouCanDo.map((c) => el('li', { text: c }))));
  add('Retrying', m.retryStatus);
  card.appendChild(dl);
  return card;
}

function render(term) {
  const needle = term.trim().toLowerCase();
  const matches = needle
    ? all.filter((m) => JSON.stringify(m).toLowerCase().includes(needle))
    : all;
  count.textContent = `${matches.length} of ${all.length} messages shown.`;
  area.replaceChildren(...(matches.length
    ? matches.map(entryNode)
    : [el('p', { text: 'No message matched that filter.' })]));
}

filter.addEventListener('input', () => render(filter.value));
render('');
