import { el, initPage, renderMessage, statusPill } from './app.js';

const state = await initPage();

function factList(pairs) {
  const dl = el('dl', { class: 'facts' });
  for (const [term, value] of pairs) {
    dl.appendChild(el('dt', { text: term }));
    dl.appendChild(typeof value === 'string' || value === null || value === undefined
      ? el('dd', { text: value ?? 'Not available' })
      : el('dd', {}, [value]));
  }
  return dl;
}

document.getElementById('connection-area').replaceChildren(factList([
  ['Status', statusPill(state.connectionState)],
  ['Connected', state.connection?.connectedAt || 'Not connected'],
  ['Last successful request', state.connection?.lastSuccessfulRequest || 'None yet'],
  ['Access token expires', state.connection?.expiresAt || 'Not reported by OSM'],
  ['Refresh token stored', state.connection ? (state.connection.hasRefreshToken ? 'Yes' : 'No') : 'Not connected'],
  ['Scope granted', state.connection?.scope || 'Not reported'],
  ['Application user', state.user ? `${state.user.reference} (role: ${state.user.role})` : 'Not signed in']
]));

document.getElementById('access-area').replaceChildren(factList([
  ['User context', state.connection ? 'Available' : 'Not retrieved'],
  ['Sections found', String(state.sectionCount)],
  ['Selected section', state.selectedSection
    ? `${state.selectedSection.name || 'Unnamed'} (${state.selectedSection.type || 'unknown type'})`
    : 'None selected'],
  ['Selected group', state.selectedSection?.groupName || 'None selected'],
  ['Masked section identifier', state.selectedSection?.maskedId || '—']
]));

const rate = state.rateLimit;
document.getElementById('rate-area').replaceChildren(
  factList([
    ['Reported limit', rate.reportedLimit === null ? 'Not returned by OSM' : String(rate.reportedLimit)],
    ['Reported remaining', rate.reportedRemaining === null ? 'Not returned by OSM' : String(rate.reportedRemaining)],
    ['Reported reset', rate.reportedReset || 'Not returned by OSM'],
    ['Local request count', `${rate.localCount} of ${rate.localThreshold}`],
    ['Local safety threshold', `${rate.usedPercent}% used`]
  ]),
  el('div', { class: 'progress-track', role: 'img', 'aria-label': `Local rate limit ${rate.usedPercent} per cent used` }, [
    el('div', { class: 'progress-fill', style: `width:${Math.min(100, rate.usedPercent)}%` })
  ]),
  rate.warningLevel
    ? el('p', { class: 'hint', text: `Warning: ${rate.warningLevel}% of the local safety threshold has been used.` })
    : el('p', { class: 'hint', text: 'The application stops automatic testing before the OSM limit is reached.' })
);

const breaker = state.circuitBreaker;
if (breaker.state !== 'closed') {
  const area = document.getElementById('breaker-area');
  area.appendChild(el('div', { class: 'card' }, [
    el('h3', {}, [statusPill(breaker.state === 'critical' ? 'Critical' : 'Warning'), ' OSM testing is suspended']),
    factList([
      ['Reason', breaker.reason || 'Not recorded'],
      ['Started', breaker.openedAt || 'Unknown'],
      ['Earliest next test', breaker.retryAfter || (breaker.state === 'critical' ? 'Not until an administrator clears the block' : 'Unknown')],
      ['Recent failures', String(breaker.recentFailures)],
      ['Can a tester override this?', breaker.overridable ? 'Yes, once the cooldown has elapsed' : 'No. Only an application administrator can clear it.']
    ])
  ]));
}

if (state.sectionWarning) document.getElementById('messages-area').appendChild(renderMessage(state.sectionWarning));

const actions = document.getElementById('action-area');
const connected = state.connectionState === 'Connected' || state.connectionState === 'Connected with warnings';
actions.appendChild(el('a', {
  class: 'button', href: connected ? '/guided.html' : '/oauth/connect',
  text: connected ? 'Run guided test' : 'Connect to OSM'
}));
actions.appendChild(el('a', { class: 'button secondary', href: '/sections.html', text: 'Change section' }));
actions.appendChild(el('a', { class: 'button secondary', href: '/tests.html', text: 'Individual tests' }));
actions.appendChild(el('a', { class: 'button secondary', href: '/history.html', text: 'Test history' }));
actions.appendChild(el('a', { class: 'button danger', href: '/disconnect.html', text: 'Disconnect' }));
