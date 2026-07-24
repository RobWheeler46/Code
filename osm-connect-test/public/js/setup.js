import { el, api, initPage, statusPill } from './app.js';

await initPage();
const area = document.getElementById('setup-area');

// Fields that setup should offer, in a sensible order. This is a subset of the full
// configuration - the connection essentials plus the security-relevant hosts.
const SETUP_FIELDS = [
  'osmClientId', 'osmClientSecret', 'callbackUrl',
  'authorizeUrl', 'tokenUrl', 'apiBase', 'scopes', 'allowedHosts'
];

async function boot() {
  const { data } = await api('/api/setup/status');
  if (!data.available) return renderUnavailable();
  if (!data.authed) return renderKeyForm();
  return renderConfig();
}

function renderUnavailable() {
  area.replaceChildren(el('div', { class: 'card' }, [
    el('h3', { text: 'Setup mode is not enabled' }),
    el('p', { text: 'A setup key has not been configured for this deployment, so the browser setup screen is switched off.' }),
    el('p', {}, [
      'Set a ', el('code', { text: 'SETUP_KEY' }),
      ' environment variable (16 or more characters) and restart the application, then reload this page. ',
      'Alternatively, an administrator can configure the connection from the Administration screen after signing in.'
    ]),
    el('p', { class: 'hint', text: 'Once the connection has been configured you can remove the setup key to close this screen again.' })
  ]));
}

function renderKeyForm(errorText) {
  const input = el('input', { type: 'password', id: 'setup-key', autocomplete: 'off', 'aria-describedby': 'key-hint' });
  const status = el('p', { role: errorText ? 'alert' : 'status', text: errorText || '' });
  const form = el('form', {}, [
    el('div', { class: 'field' }, [
      el('label', { for: 'setup-key', text: 'Setup key' }),
      input,
      el('p', { id: 'key-hint', class: 'hint', text: 'This is the SETUP_KEY value from the server configuration, not an OSM credential.' })
    ]),
    el('div', { class: 'actions' }, [el('button', { type: 'submit', text: 'Continue' })]),
    status
  ]);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    status.textContent = 'Checking…';
    const { ok, data } = await api('/api/setup/login', { method: 'POST', body: { key: input.value } });
    if (ok) return renderConfig();
    status.textContent = data.error || 'That key was not accepted.';
  });
  area.replaceChildren(el('div', { class: 'card' }, [
    el('h3', { text: 'Enter the setup key' }),
    el('p', { text: 'This screen is protected so that only someone with the deployment’s setup key can enter the OSM connection settings.' }),
    form
  ]));
  input.focus();
}

async function renderConfig() {
  const { ok, data } = await api('/api/setup/config');
  if (!ok) return renderKeyForm(data.error);
  area.replaceChildren(configCard(data), testCard(data.test));
}

function configCard(data) {
  const card = el('div', { class: 'card' });
  card.appendChild(el('h3', { text: 'OSM connection settings' }));
  card.appendChild(el('p', {
    text: data.complete
      ? 'All required items are configured. You can adjust them below, then go to the home page and connect.'
      : `Still required: ${data.missing.join(', ')}`
  }));

  const form = el('form');
  const status = el('p', { role: 'status' });

  for (const key of SETUP_FIELDS) {
    const field = data.config[key];
    if (!field) continue;
    const wrap = el('div', { class: 'field' });
    wrap.appendChild(el('label', { for: `f-${key}`, text: field.label }));
    if (field.secret) {
      wrap.appendChild(el('input', { type: 'password', id: `f-${key}`, name: key, autocomplete: 'off', placeholder: 'Leave blank to keep the current secret' }));
      wrap.appendChild(el('p', { class: 'hint', text: `${field.state}. The value is stored encrypted and cannot be displayed again.` }));
    } else {
      wrap.appendChild(el('input', { type: 'text', id: `f-${key}`, name: key, value: field.value ?? '', autocomplete: 'off' }));
      wrap.appendChild(el('p', { class: 'hint', text: `Source: ${field.source}` }));
    }
    form.appendChild(wrap);
  }

  const save = el('button', { type: 'submit', text: 'Save settings' });
  form.appendChild(el('div', { class: 'actions' }, [
    save,
    el('a', { class: 'button secondary', href: '/index.html', text: 'Go to home page' })
  ]));
  form.appendChild(status);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    save.disabled = true;
    status.textContent = 'Saving…';
    const updates = {};
    for (const [k, v] of new FormData(form).entries()) if (String(v).trim() !== '') updates[k] = String(v).trim();
    const { ok, data: res } = await api('/api/setup/config', { method: 'POST', body: { updates } });
    save.disabled = false;
    if (!ok) { status.textContent = res.error || 'The settings could not be saved.'; return; }
    status.textContent = `Saved: ${res.applied.join(', ') || 'no changes'}${res.rejected.length ? ` · rejected: ${res.rejected.join('; ')}` : ''}`;
    // Re-render so the secret status and readiness checks reflect the new state.
    setTimeout(renderConfig, 400);
  });

  card.appendChild(form);
  return card;
}

function testCard(test) {
  const card = el('div', { class: 'card' });
  card.appendChild(el('h3', {}, ['Readiness check ', statusPill(test.allPassed ? 'Passed' : 'Warning')]));
  card.appendChild(el('p', { class: 'hint', text: 'This check never displays the client secret.' }));
  const table = el('table');
  table.appendChild(el('tbody', {}, test.checks.map((c) => el('tr', {}, [
    el('td', { text: c.name }),
    el('td', {}, [statusPill(c.ok ? 'Passed' : 'Failed')]),
    el('td', { text: c.detail })
  ]))));
  card.appendChild(el('div', { class: 'table-scroll' }, [table]));
  if (test.allPassed) {
    card.appendChild(el('div', { class: 'actions' }, [
      el('a', { class: 'button', href: '/oauth/connect', text: 'Connect to OSM now' })
    ]));
  }
  return card;
}

await boot();
