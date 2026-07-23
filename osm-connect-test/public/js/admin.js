import { el, api, initPage, statusPill } from './app.js';

const state = await initPage();
const area = document.getElementById('admin-area');

if (state.user?.role !== 'admin') {
  area.replaceChildren(el('div', { class: 'card' }, [
    el('h3', { text: 'Administrator access is required' }),
    el('p', { text: 'This area is available to Application Administrators only. Ask an administrator to review your access.' })
  ]));
} else {
  await render();
}

async function render() {
  const [cfg, eps, overview, auditData, cfgTest] = await Promise.all([
    api('/api/admin/config'), api('/api/admin/endpoints'), api('/api/admin/overview'),
    api('/api/admin/audit'), api('/api/admin/config/test')
  ]);
  area.replaceChildren(
    configCard(cfg.data, cfgTest.data),
    endpointsCard(eps.data),
    overviewCard(overview.data),
    auditCard(auditData.data)
  );
}

function facts(pairs) {
  const dl = el('dl', { class: 'facts' });
  for (const [t, v] of pairs) {
    dl.appendChild(el('dt', { text: t }));
    dl.appendChild(typeof v === 'string' ? el('dd', { text: v }) : el('dd', {}, [v]));
  }
  return dl;
}

function configCard(cfg, test) {
  const card = el('div', { class: 'card' });
  card.appendChild(el('h3', { text: 'OSM connection configuration' }));
  card.appendChild(el('p', { text: cfg.complete ? 'All required items are configured.' : `Missing: ${cfg.missing.join(', ')}` }));

  const form = el('form');
  const status = el('p', { role: 'status' });

  for (const [key, field] of Object.entries(cfg.config)) {
    const wrap = el('div', { class: 'field' });
    wrap.appendChild(el('label', { for: `f-${key}`, text: field.label }));
    if (field.secret) {
      wrap.appendChild(el('input', { type: 'password', id: `f-${key}`, name: key, autocomplete: 'off', placeholder: 'Leave blank to keep the current secret' }));
      wrap.appendChild(el('p', {
        class: 'hint',
        text: `${field.state}${field.lastChanged ? ` · last changed ${field.lastChanged}${field.lastChangedBy ? ` by ${field.lastChangedBy}` : ''}` : ''} · source: ${field.source}. The value cannot be displayed.`
      }));
    } else {
      wrap.appendChild(el('input', { type: 'text', id: `f-${key}`, name: key, value: field.value ?? '' }));
      wrap.appendChild(el('p', { class: 'hint', text: `Source: ${field.source}${field.lastChanged ? ` · last changed ${field.lastChanged}` : ''}` }));
    }
    form.appendChild(wrap);
  }

  const save = el('button', { type: 'submit', text: 'Save configuration' });
  form.appendChild(el('div', { class: 'actions' }, [save, status]));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    save.disabled = true;
    const updates = {};
    for (const [k, v] of new FormData(form).entries()) if (String(v).trim() !== '') updates[k] = String(v).trim();
    const { ok, data } = await api('/api/admin/config', { method: 'POST', body: { updates } });
    save.disabled = false;
    status.textContent = ok
      ? `Saved: ${data.applied.join(', ') || 'no changes'}${data.rejected.length ? ` · rejected: ${data.rejected.join('; ')}` : ''}`
      : (data.message?.whatHappened || data.error || 'The configuration could not be saved.');
  });
  card.appendChild(form);

  const testTable = el('table');
  testTable.appendChild(el('caption', { text: 'Configuration test (no secret is exposed)' }));
  testTable.appendChild(el('tbody', {}, (test.checks || []).map((c) => el('tr', {}, [
    el('td', { text: c.name }), el('td', {}, [statusPill(c.ok ? 'Passed' : 'Failed')]), el('td', { text: c.detail })
  ]))));
  card.appendChild(el('div', { class: 'table-scroll' }, [testTable]));
  return card;
}

function endpointsCard(data) {
  const card = el('div', { class: 'card' });
  card.appendChild(el('h3', { text: 'Test endpoints' }));
  card.appendChild(el('p', {
    text: data.personalDataTestsAllowed
      ? 'This environment permits tests that may return young people’s information.'
      : 'Tests classified as high personal data risk cannot be enabled in this environment.'
  }));

  const table = el('table');
  table.appendChild(el('thead', {}, [el('tr', {}, [
    el('th', { scope: 'col', text: 'Test' }), el('th', { scope: 'col', text: 'Method and path' }),
    el('th', { scope: 'col', text: 'Risk' }), el('th', { scope: 'col', text: 'Last verified' }),
    el('th', { scope: 'col', text: 'Enabled' })
  ])]));
  table.appendChild(el('tbody', {}, data.endpoints.map((d) => {
    const toggle = el('button', { type: 'button', class: d.enabled ? 'danger' : 'secondary', text: d.enabled ? 'Disable' : 'Enable' });
    const cell = el('td', {}, [toggle]);
    toggle.addEventListener('click', async () => {
      toggle.disabled = true;
      const { ok, data: res } = await api(`/api/admin/endpoints/${encodeURIComponent(d.key)}`, { method: 'POST', body: { enabled: !d.enabled } });
      if (ok) { render(); return; }
      toggle.disabled = false;
      cell.appendChild(el('p', { role: 'alert', class: 'hint', text: res.error || 'That change was refused.' }));
    });
    return el('tr', {}, [
      el('td', {}, [el('strong', { text: d.name }), el('br'), el('code', { text: d.key })]),
      el('td', { text: `${d.method} ${d.path}${d.queryParams ? `?${d.queryParams}` : ''}` }),
      el('td', {}, [el('span', { class: `risk risk-${d.personalDataRisk}`, text: d.personalDataRisk })]),
      el('td', { text: d.lastVerifiedAt || 'never' }),
      cell
    ]);
  })));
  card.appendChild(el('div', { class: 'table-scroll' }, [table]));
  return card;
}

function overviewCard(data) {
  const card = el('div', { class: 'card' });
  card.appendChild(el('h3', { text: 'Application wide outcomes' }));
  card.appendChild(facts([
    ['Test outcomes', data.outcomes.map((o) => `${o.result}: ${o.n}`).join(' · ') || 'none recorded'],
    ['HTTP statuses seen', data.httpStatuses.map((s) => `${s.status}: ${s.n}`).join(' · ') || 'none recorded'],
    ['Most common message codes', data.messageCodes.slice(0, 8).map((c) => `${c.code} (${c.n})`).join(' · ') || 'none recorded'],
    ['Local rate counter', `${data.rateLimit.localCount} of ${data.rateLimit.localThreshold}`],
    ['Circuit breaker', statusPill(data.circuitBreaker.state === 'closed' ? 'Passed' : data.circuitBreaker.state === 'critical' ? 'Critical' : 'Warning')],
    ['Breaker reason', data.circuitBreaker.reason || 'none'],
    ['Local health', data.health.healthy ? 'All checks passed' : `Failed: ${data.health.failed.join(', ')}`],
    ['Diagnostic retention', `${data.retentionDays} days`]
  ]));

  const reasonInput = el('input', { type: 'text', id: 'breaker-reason', placeholder: 'Reason for clearing (recorded in the audit log)' });
  const clearBtn = el('button', { type: 'button', class: 'danger', text: 'Clear circuit breaker / blocked state' });
  const rateBtn = el('button', { type: 'button', class: 'secondary', text: 'Reset local rate counter' });
  const retentionBtn = el('button', { type: 'button', class: 'secondary', text: 'Run retention clean-up now' });
  const result = el('p', { role: 'status' });

  clearBtn.addEventListener('click', async () => {
    clearBtn.disabled = true;
    const { ok, data: res } = await api('/api/admin/breaker/clear', { method: 'POST', body: { reason: reasonInput.value } });
    result.textContent = ok ? `Circuit breaker cleared (was "${res.before.state}").` : (res.message?.whatHappened || res.error || 'That action was refused.');
    clearBtn.disabled = false;
  });
  rateBtn.addEventListener('click', async () => {
    const { ok, data: res } = await api('/api/admin/rate/reset', { method: 'POST', body: {} });
    result.textContent = ok ? 'Local rate counter reset. OSM-side limits are unaffected.' : (res.message?.whatHappened || res.error || 'That action was refused.');
  });
  retentionBtn.addEventListener('click', async () => {
    const { ok, data: res } = await api('/api/admin/retention/run', { method: 'POST', body: {} });
    result.textContent = ok ? `Removed ${res.removed} session(s) older than ${res.retentionDays} days.` : (res.message?.whatHappened || res.error || 'That action was refused.');
  });

  card.appendChild(el('div', { class: 'field' }, [el('label', { for: 'breaker-reason', text: 'Override reason' }), reasonInput]));
  card.appendChild(el('div', { class: 'actions' }, [clearBtn, rateBtn, retentionBtn]));
  card.appendChild(result);

  const users = el('table');
  users.appendChild(el('caption', { text: 'Test users' }));
  users.appendChild(el('thead', {}, [el('tr', {}, [
    el('th', { scope: 'col', text: 'Reference' }), el('th', { scope: 'col', text: 'Role' }),
    el('th', { scope: 'col', text: 'Last sign in' }), el('th', { scope: 'col', text: 'Last successful test' }),
    el('th', { scope: 'col', text: 'Change role' })
  ])]));
  users.appendChild(el('tbody', {}, data.users.map((u) => {
    const select = el('select', { 'aria-label': `Application role for ${u.reference}` });
    for (const role of ['tester', 'admin', 'developer', 'support']) {
      const opt = el('option', { value: role, text: role });
      if (role === u.role) opt.setAttribute('selected', '');
      select.appendChild(opt);
    }
    select.addEventListener('change', async () => {
      await api(`/api/admin/users/${u.id}/role`, { method: 'POST', body: { role: select.value } });
      result.textContent = `Role for ${u.reference} set to ${select.value}.`;
    });
    return el('tr', {}, [
      el('td', {}, [el('code', { text: u.reference || '—' })]),
      el('td', { text: u.role }),
      el('td', { text: u.lastSignIn || 'never' }),
      el('td', { text: u.lastSuccessfulTest || 'never' }),
      el('td', {}, [select])
    ]);
  })));
  card.appendChild(el('div', { class: 'table-scroll' }, [users]));
  return card;
}

function auditCard(data) {
  const card = el('div', { class: 'card' });
  card.appendChild(el('h3', { text: 'Audit log' }));
  card.appendChild(el('p', { class: 'hint', text: data.note }));
  const table = el('table');
  table.appendChild(el('thead', {}, [el('tr', {}, [
    el('th', { scope: 'col', text: 'When' }), el('th', { scope: 'col', text: 'User' }),
    el('th', { scope: 'col', text: 'Event' }), el('th', { scope: 'col', text: 'Outcome' }),
    el('th', { scope: 'col', text: 'Code' }), el('th', { scope: 'col', text: 'Correlation' }),
    el('th', { scope: 'col', text: 'Detail' })
  ])]));
  table.appendChild(el('tbody', {}, data.entries.map((e) => el('tr', {}, [
    el('td', { text: e.at || '—' }), el('td', { text: e.user }), el('td', { text: e.event }),
    el('td', { text: e.outcome || '—' }), el('td', {}, [el('code', { text: e.messageCode || '—' })]),
    el('td', {}, [el('code', { text: e.correlationId || '—' })]), el('td', { text: e.detail || '—' })
  ]))));
  card.appendChild(el('div', { class: 'table-scroll' }, [table]));
  return card;
}
