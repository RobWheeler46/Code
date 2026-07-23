import { el, api, initPage, statusPill } from './app.js';

await initPage();

const area = document.getElementById('report-area');
const ref = new URLSearchParams(window.location.search).get('ref');

if (!ref) {
  area.replaceChildren(el('p', { text: 'No test session was requested. Choose one from the test history.' }),
    el('div', { class: 'actions' }, [el('a', { class: 'button secondary', href: '/history.html', text: 'Test history' })]));
} else {
  const { ok, data } = await api(`/api/report/${encodeURIComponent(ref)}`);
  if (!ok) {
    area.replaceChildren(el('p', { role: 'alert', text: data.error || 'That report could not be produced.' }));
  } else {
    render(data);
  }
}

function facts(pairs) {
  const dl = el('dl', { class: 'facts' });
  for (const [t, v] of pairs) {
    dl.appendChild(el('dt', { text: t }));
    dl.appendChild(typeof v === 'string' || v === null || v === undefined ? el('dd', { text: v ?? '—' }) : el('dd', {}, [v]));
  }
  return dl;
}

function render(r) {
  const nodes = [];

  nodes.push(el('div', { class: 'card' }, [
    el('h3', { text: 'Report summary' }),
    facts([
      ['Session reference', r.test.sessionReference],
      ['Overall result', statusPill(r.test.overallResult)],
      ['Started', r.test.startedAtUk],
      ['Warnings / failures', `${r.test.warningCount} / ${r.test.failureCount}`],
      ['Application', `${r.application.name} v${r.application.version}`],
      ['Environment', r.application.environment],
      ['Reporting role', r.test.userRole],
      ['Generated', r.generatedAtUk],
      ['Sanitisation', r.sanitisation]
    ]),
    el('div', { class: 'actions' }, [
      el('a', { class: 'button', href: `/api/report/${encodeURIComponent(r.test.sessionReference)}?format=text`, text: 'Download plain text report' }),
      el('a', { class: 'button secondary', href: `/api/report/${encodeURIComponent(r.test.sessionReference)}?download=1`, text: 'Download JSON report' })
    ])
  ]));

  nodes.push(el('div', { class: 'card' }, [
    el('h3', { text: 'Connection' }),
    facts([
      ['Status', r.connection.status],
      ['Token acquired', r.connection.tokenAcquired ? 'Yes' : 'No'],
      ['Refresh attempted', r.connection.refreshAttempted ? 'Yes' : 'No'],
      ['Refresh succeeded', r.connection.refreshSucceeded ? 'Yes' : 'No'],
      ['Scope', r.connection.scope || 'not reported'],
      ['Groups found', String(r.access.groupsFound)],
      ['Sections found', String(r.access.sectionsFound)],
      ['Selected section type', r.access.selectedSectionType || 'none selected'],
      ['Masked section identifiers', r.access.maskedSectionIdentifiers.join(', ') || 'none'],
      ['Permission categories', r.access.permissionCategories.join(', ') || 'none returned']
    ])
  ]));

  const stageTable = el('table');
  stageTable.appendChild(el('caption', { text: 'Stages' }));
  stageTable.appendChild(el('thead', {}, [el('tr', {}, [
    el('th', { scope: 'col', text: 'Stage' }), el('th', { scope: 'col', text: 'Status' }),
    el('th', { scope: 'col', text: 'Duration' }), el('th', { scope: 'col', text: 'Message code' }),
    el('th', { scope: 'col', text: 'Summary' })
  ])]));
  stageTable.appendChild(el('tbody', {}, r.stages.map((s) => el('tr', {}, [
    el('td', { text: s.stage }),
    el('td', {}, [statusPill(s.status)]),
    el('td', { text: s.durationMs === null ? '—' : `${s.durationMs} ms` }),
    el('td', {}, [el('code', { text: s.messageCode || '—' })]),
    el('td', { text: s.summary || '—' })
  ]))));
  nodes.push(el('div', { class: 'card' }, [el('div', { class: 'table-scroll' }, [stageTable])]));

  const reqTable = el('table');
  reqTable.appendChild(el('caption', { text: 'OSM requests (sanitised)' }));
  reqTable.appendChild(el('thead', {}, [el('tr', {}, [
    el('th', { scope: 'col', text: 'Attempt' }), el('th', { scope: 'col', text: 'Destination' }),
    el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Type' }),
    el('th', { scope: 'col', text: 'Bytes' }), el('th', { scope: 'col', text: 'Duration' }),
    el('th', { scope: 'col', text: 'Parse' }), el('th', { scope: 'col', text: 'Redactions' })
  ])]));
  reqTable.appendChild(el('tbody', {}, r.requests.map((q) => el('tr', {}, [
    el('td', {}, [el('code', { text: q.attemptId })]),
    el('td', { text: `${q.method} ${q.destination}` }),
    el('td', { text: String(q.httpStatus ?? 'none') }),
    el('td', { text: q.contentType || '—' }),
    el('td', { text: String(q.responseBytes ?? 0) }),
    el('td', { text: `${q.durationMs ?? '—'} ms` }),
    el('td', { text: q.parseResult || '—' }),
    el('td', { text: String(q.redactionsApplied) })
  ]))));
  nodes.push(el('div', { class: 'card' }, [
    el('div', { class: 'table-scroll' }, [reqTable]),
    r.requests.length ? null : el('p', { text: 'No OSM requests were recorded for this session.' })
  ]));

  nodes.push(el('div', { class: 'card' }, [
    el('h3', { text: 'Rate limit and circuit breaker' }),
    facts([
      ['Reported limit', String(r.rateLimit.reportedLimit ?? 'not returned')],
      ['Reported remaining', String(r.rateLimit.reportedRemaining ?? 'not returned')],
      ['Reported reset', r.rateLimit.reportedReset || 'not returned'],
      ['Local count', `${r.rateLimit.localCount} of ${r.rateLimit.localThreshold}`],
      ['Circuit breaker', r.circuitBreaker.state]
    ])
  ]));

  nodes.push(el('div', { class: 'card' }, [
    el('h3', { text: 'Recommended next actions' }),
    el('ol', {}, r.recommendedActions.map((a) => el('li', { text: a })))
  ]));

  nodes.push(el('div', { class: 'card' }, [
    el('h3', { text: 'Excluded from this report' }),
    el('ul', {}, r.excluded.map((x) => el('li', { text: x })))
  ]));

  area.replaceChildren(...nodes.filter(Boolean));
}
