import { el, api, initPage, renderMessage, statusPill } from './app.js';

await initPage();

const testsArea = document.getElementById('tests-area');
const resultArea = document.getElementById('result-area');

const { data } = await api('/api/tests');

testsArea.replaceChildren(...data.tests.map((t) => {
  const card = el('div', { class: 'card' });
  card.appendChild(el('h3', {}, [
    t.name,
    ' ',
    el('span', { class: `risk risk-${t.personalDataRisk}`, text: `${t.personalDataRisk} personal data risk` })
  ]));

  const facts = el('dl', { class: 'facts' });
  const add = (term, value) => { facts.appendChild(el('dt', { text: term })); facts.appendChild(el('dd', { text: value })); };
  // FR-API-001
  add('What it is testing', t.whatItTests || 'Not described');
  add('Why the test is useful', t.whyUseful || 'Not described');
  add('What may be requested', `${t.method} ${t.informationRequested}`);
  add('Could personal information be returned?', t.personalInformationPossible ? 'Yes — the response is sanitised before it is shown or stored.' : 'No.');
  add('Will the result be retained?', t.resultRetained);
  add('Permission likely required', t.permissionRequired || 'Not known');
  add('Requires an active section', t.requiresSection ? 'Yes' : 'No');
  add('Definition version', t.version);
  add('Last verified against OSM', t.lastVerifiedAt || 'Never');
  add('Status', t.enabled ? 'Enabled' : 'Disabled');
  if (t.notes) add('Notes', t.notes);
  card.appendChild(facts);

  if (t.blockedReason) {
    card.appendChild(el('p', { class: 'hint', text: t.blockedReason }));
  } else {
    const btn = el('button', { type: 'button', text: `Run ${t.name}` });
    btn.addEventListener('click', () => run(t, btn));
    card.appendChild(el('div', { class: 'actions' }, [btn]));
  }
  return card;
}));

async function run(test, btn) {
  btn.disabled = true;
  resultArea.replaceChildren(el('p', { role: 'status', text: `Running ${test.name}…` }));
  const { ok, data: result } = await api(`/api/tests/${encodeURIComponent(test.key)}/run`, { method: 'POST', body: {} });
  btn.disabled = false;

  if (!ok) {
    resultArea.replaceChildren(result.message ? renderMessage(result.message) : el('p', { role: 'alert', text: result.error || 'The test could not be run.' }));
    return;
  }
  resultArea.replaceChildren(buildResult(result));
  resultArea.scrollIntoView({ block: 'start' });
}

// FR-REQ-004: summary, request, response, parsing, schema, timings, recommendations.
function buildResult(r) {
  const card = el('div', { class: 'card' });
  card.appendChild(el('h3', {}, [`Result: ${r.test.name} `, statusPill(r.status)]));
  card.appendChild(renderMessage(r.message));

  const panels = {
    Summary: () => facts([
      ['HTTP status', String(r.summary.httpStatus ?? 'no response')],
      ['Content type', r.summary.contentType || 'not supplied'],
      ['Response size', `${r.summary.responseBytes} bytes`],
      ['Duration', `${r.summary.durationMs} ms`],
      ['Attempts', String(r.summary.attempts)],
      ['Parse result', r.summary.parseResult],
      ['Truncated', r.summary.truncated ? 'Yes — the safe processing limit was reached' : 'No'],
      ['Test session reference', r.sessionRef]
    ]),
    Request: () => facts([
      ['Method', r.request.method],
      ['Destination', r.request.destination],
      ['Query parameter names', r.request.queryParamNames.join(', ') || 'none'],
      ['Timeout used', `${r.request.timeoutMs} ms`],
      ['Note', 'Query parameter values, headers and credentials are never displayed.']
    ]),
    Response: () => el('div', {}, [
      el('h4', { text: 'Interpreted response' }),
      el('pre', { text: JSON.stringify(r.interpreted, null, 2) }),
      el('h4', { text: 'Raw response (sanitised)' }),
      el('pre', { text: r.rawPreview || '(no content)' }),
      el('p', { class: 'hint', text: `Sanitisation applied: ${r.sanitisation.fieldsRemoved} value(s) removed or masked${r.sanitisation.truncated ? ', content truncated' : ''}. ${r.sanitisation.note}` })
    ]),
    Parsing: () => facts([
      ['Parse result', r.summary.parseResult],
      ['Content type recognised', /json/i.test(r.summary.contentType || '') ? 'Yes' : 'No'],
      ['Wrapper detected', r.summary.parseResult === 'json-wrapped' ? 'Yes — a non-standard wrapper was removed' : 'No']
    ]),
    'Schema validation': () => facts([
      ['Result', r.schema.result],
      ['Fields found', (r.schema.present || []).join(', ') || 'none declared'],
      ['Fields missing', (r.schema.missing || []).join(', ') || 'none']
    ]),
    Timings: () => facts([
      ['Duration', `${r.timings.durationMs} ms`],
      ['Warning threshold', `${r.timings.warningThresholdMs} ms`],
      ['Slower than threshold', r.timings.slow ? 'Yes' : 'No']
    ]),
    Recommendations: () => el('ul', {}, (r.recommendations || []).map((x) => el('li', { text: x })))
  };

  const tabList = el('ul', { class: 'tabs', role: 'tablist' });
  const panelHost = el('div', { class: 'tabpanel' });
  const names = Object.keys(panels);
  names.forEach((name, i) => {
    const btn = el('button', { type: 'button', role: 'tab', id: `tab-${i}`, 'aria-selected': i === 0 ? 'true' : 'false', text: name });
    btn.addEventListener('click', () => {
      [...tabList.querySelectorAll('button')].forEach((b) => b.setAttribute('aria-selected', 'false'));
      btn.setAttribute('aria-selected', 'true');
      panelHost.replaceChildren(panels[name]());
    });
    tabList.appendChild(el('li', { role: 'presentation' }, [btn]));
  });
  panelHost.replaceChildren(panels[names[0]]());
  card.appendChild(tabList);
  card.appendChild(panelHost);

  card.appendChild(el('div', { class: 'actions' }, [
    el('a', { class: 'button secondary', href: `/report.html?ref=${encodeURIComponent(r.sessionRef)}`, text: 'View diagnostic report' })
  ]));
  return card;
}

function facts(pairs) {
  const dl = el('dl', { class: 'facts' });
  for (const [t, v] of pairs) { dl.appendChild(el('dt', { text: t })); dl.appendChild(el('dd', { text: v })); }
  return dl;
}
