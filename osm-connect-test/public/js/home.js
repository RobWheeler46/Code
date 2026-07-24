import { el, initPage, renderMessage, statusPill } from './app.js';

const state = await initPage();

const statusArea = document.getElementById('status-area');
const actionArea = document.getElementById('action-area');
const warningArea = document.getElementById('warning-area');

const facts = el('dl', { class: 'facts' });
const add = (term, value) => {
  facts.appendChild(el('dt', { text: term }));
  facts.appendChild(typeof value === 'string' ? el('dd', { text: value }) : el('dd', {}, [value]));
};

add('Connection state', statusPill(state.connectionState));
add('Last successful OSM request', state.connection?.lastSuccessfulRequest || 'No successful request yet');
add('Selected group and section', state.selectedSection
  ? `${state.selectedSection.groupName || 'Unnamed group'} — ${state.selectedSection.name || 'Unnamed section'} (${state.selectedSection.maskedId})`
  : 'No section selected');
add('Sections available', String(state.sectionCount));
add('Mode', 'Read only. No write operation can be run.');

statusArea.replaceChildren(facts);

if (!state.configurationComplete) {
  const list = el('ul', {}, state.missingConfiguration.map((m) => el('li', { text: m })));
  warningArea.appendChild(el('div', { class: 'card' }, [
    el('h3', { text: 'The application is not ready to connect' }),
    el('p', { text: 'The following items have not been configured. No information has been sent to OSM.' }),
    list,
    el('p', { text: 'Enter these settings on the first-run setup screen, or ask an application administrator to review the OSM connection configuration.' }),
    el('div', { class: 'actions' }, [
      el('a', { class: 'button', href: '/setup.html', text: 'Open first-run setup' })
    ])
  ]));
}

if (state.sectionWarning) warningArea.appendChild(renderMessage(state.sectionWarning));

const primary = el('a', { class: 'button', href: state.primaryAction.href, text: state.primaryAction.label });
if (!state.configurationComplete) {
  primary.setAttribute('aria-disabled', 'true');
  primary.classList.add('secondary');
}
actionArea.appendChild(primary);
actionArea.appendChild(el('a', { class: 'button secondary', href: '/dashboard.html', text: 'Connection dashboard' }));
actionArea.appendChild(el('a', { class: 'button secondary', href: '/help.html', text: 'Help and message catalogue' }));
