import { el, api, initPage, renderMessage } from './app.js';

await initPage();

const groupsArea = document.getElementById('groups-area');
const messageArea = document.getElementById('message-area');

async function load() {
  const { data } = await api('/api/sections');
  messageArea.replaceChildren(data.message ? renderMessage(data.message) : document.createComment(''));

  if (!data.groups.length) {
    groupsArea.replaceChildren(el('div', { class: 'card' }, [
      el('h3', { text: 'No sections are stored yet' }),
      el('p', { text: 'Run the guided test to retrieve your groups, sections and permissions from OSM.' }),
      el('div', { class: 'actions' }, [el('a', { class: 'button', href: '/guided.html', text: 'Run guided test' })])
    ]));
    return;
  }

  groupsArea.replaceChildren(...data.groups.map((group) => {
    const card = el('div', { class: 'card' });
    card.appendChild(el('h3', { text: group.groupName }));
    card.appendChild(el('p', { class: 'hint', text: `Group identifier (masked): ${group.groupIdMasked || 'not returned'}` }));

    for (const section of group.sections) {
      const box = el('div', { class: 'card' });
      const heading = el('h4', {}, [
        section.sectionName || 'Unnamed section',
        section.isDefault ? el('span', { class: 'risk risk-low', text: ' OSM default ' }) : null,
        section.isSelected ? el('span', { class: 'risk risk-none', text: ' Active for testing ' }) : null
      ]);
      box.appendChild(heading);

      const facts = el('dl', { class: 'facts' });
      const add = (t, v) => { facts.appendChild(el('dt', { text: t })); facts.appendChild(el('dd', { text: v })); };
      add('Section identifier (masked)', section.sectionIdMasked || 'not returned');
      add('Section type', section.sectionType || 'not returned');
      add('Default section', section.isDefault ? 'Yes' : 'No');
      add('Permission summary', section.permissionSummary || 'none returned');
      add('Last retrieved', section.retrievedAt || 'unknown');
      box.appendChild(facts);

      if (section.permissions?.length) {
        const table = el('table');
        table.appendChild(el('caption', { text: 'Permissions returned for this section' }));
        table.appendChild(el('thead', {}, [el('tr', {}, [
          el('th', { scope: 'col', text: 'Category' }),
          el('th', { scope: 'col', text: 'Raw value' }),
          el('th', { scope: 'col', text: 'Interpretation' }),
          el('th', { scope: 'col', text: 'Warning' })
        ])]));
        table.appendChild(el('tbody', {}, section.permissions.map((p) => el('tr', {}, [
          el('td', { text: `${p.category} (${p.categoryLabel})` }),
          el('td', {}, [el('code', { text: String(p.raw) })]),
          el('td', { text: p.known ? p.label : 'Unknown permission value — grants no access' }),
          el('td', { text: p.warning || '—' })
        ]))));
        box.appendChild(el('div', { class: 'table-scroll' }, [table]));
      } else {
        box.appendChild(el('p', { text: 'No permission information was returned for this section.' }));
      }

      if (!section.isSelected) {
        const btn = el('button', { type: 'button', text: 'Use this section for testing' });
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          const res = await api('/api/sections/select', { method: 'POST', body: { sectionId: section.id } });
          if (res.ok) { load(); return; }
          btn.disabled = false;
          box.appendChild(el('p', { role: 'alert', text: res.data.error || 'The section could not be selected.' }));
        });
        box.appendChild(el('div', { class: 'actions' }, [btn]));
      }
      card.appendChild(box);
    }
    return card;
  }));
}

await load();
