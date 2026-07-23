// Shared front-end helpers: navigation, message rendering, status pills and fetch.
// No member data is ever cached here (FR-PRIV-007) - every view is fetched fresh.

const NAV = [
  { href: '/index.html', label: 'Home' },
  { href: '/dashboard.html', label: 'Connection dashboard' },
  { href: '/guided.html', label: 'Guided test' },
  { href: '/tests.html', label: 'Individual tests' },
  { href: '/sections.html', label: 'Sections and permissions' },
  { href: '/history.html', label: 'Test history' },
  { href: '/health.html', label: 'Application health' },
  { href: '/admin.html', label: 'Administration', adminOnly: true },
  { href: '/privacy.html', label: 'Privacy and data handling' },
  { href: '/help.html', label: 'Help and messages' }
];

let csrfToken = null;

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

function slug(text) {
  return String(text || '').toLowerCase().replace(/[^a-z]/g, '');
}

// Every status carries a word and a symbol, so meaning never depends on colour
// alone (FRD 22.3). The symbol is aria-hidden; the word is the accessible label.
const SYMBOLS = {
  passed: '✓', success: '✓', passedwithwarning: '!', passedwithwarnings: '!',
  warning: '!', failed: '✕', error: '✕', critical: '✕',
  running: '▶', waiting: '–', skipped: '–', cancelled: '–', information: 'i',
  // Connection states from FR-HOME-003, and circuit breaker states.
  connected: '✓', closed: '✓',
  connectedwithwarnings: '!', ratelimited: '!', authenticationexpired: '!', open: '!',
  notconnected: '–', connecting: '▶',
  clientblocked: '✕', osmunavailable: '✕', reconnectionrequired: '✕',
  applicationconfigurationincomplete: '✕'
};

// Statuses that need a colour class different from their own slug.
const CLASS_ALIASES = {
  connected: 'passed', closed: 'passed',
  connectedwithwarnings: 'warning', ratelimited: 'warning', authenticationexpired: 'warning', open: 'warning',
  notconnected: 'waiting', connecting: 'running',
  clientblocked: 'failed', osmunavailable: 'failed', reconnectionrequired: 'failed',
  applicationconfigurationincomplete: 'failed'
};

function statusPill(status) {
  const key = slug(status);
  return el('span', { class: `status status-${CLASS_ALIASES[key] || key}` }, [
    el('span', { class: 'symbol', 'aria-hidden': 'true', text: SYMBOLS[key] || '•' }),
    el('span', { text: status })
  ]);
}

function renderMessage(message) {
  if (!message) return document.createComment('no message');
  const box = el('div', { class: `message message-${slug(message.status)}`, role: message.status === 'Error' || message.status === 'Critical' ? 'alert' : 'status' });
  box.appendChild(el('h3', {}, [statusPill(message.status), ' ', message.title]));
  box.appendChild(el('p', { text: message.whatHappened }));

  const facts = el('dl', { class: 'facts' });
  const addFact = (term, value) => {
    if (!value) return;
    facts.appendChild(el('dt', { text: term }));
    facts.appendChild(el('dd', { text: value }));
  };
  addFact('What this means', message.whatThisMeans);
  addFact('What has not happened', message.whatHasNotHappened);
  if (message.possibleCauses?.length) {
    facts.appendChild(el('dt', { text: 'Possible causes' }));
    facts.appendChild(el('dd', {}, [el('ul', {}, message.possibleCauses.map((c) => el('li', { text: c })))]));
  }
  if (message.whatYouCanDo?.length) {
    facts.appendChild(el('dt', { text: 'What you can do' }));
    facts.appendChild(el('dd', {}, [el('ul', {}, message.whatYouCanDo.map((c) => el('li', { text: c })))]));
  }
  addFact('Retrying', message.retryNote ? `${message.retryStatus}. ${message.retryNote}` : message.retryStatus);
  addFact('Retry allowed from', message.retryAfter);
  if (message.testStopped) addFact('Current test', 'Stopped.');
  if (message.laterStagesSkipped) addFact('Later stages', 'Skipped.');
  box.appendChild(facts);

  if (message.detail || message.technical) {
    const details = el('details');
    details.appendChild(el('summary', { text: 'Show technical details' }));
    if (message.detail) details.appendChild(el('p', { text: message.detail }));
    if (message.technical) details.appendChild(el('pre', { text: JSON.stringify(message.technical, null, 2) }));
    box.appendChild(details);
  }

  box.appendChild(el('p', {
    class: 'meta',
    text: `Message code: ${message.code}${message.correlationId ? `   Correlation identifier: ${message.correlationId}` : ''}   ${message.time}`
  }));
  return box;
}

async function api(path, options = {}) {
  const opts = { headers: { Accept: 'application/json' }, ...options };
  if (opts.body !== undefined && typeof opts.body !== 'string') {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  if (csrfToken && opts.method && opts.method !== 'GET') opts.headers['X-CSRF-Token'] = csrfToken;
  const res = await fetch(path, opts);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: 'The response could not be read.' }; }
  return { ok: res.ok, status: res.status, data };
}

function buildChrome(role) {
  const header = el('header', { class: 'masthead' });
  const inner = el('div', { class: 'masthead-inner' }, [
    el('h1', { text: 'OSM Connect Test Harness' }),
    el('p', { text: 'A read only diagnostic tool for the Online Scout Manager connection. It does not change information in OSM.' })
  ]);
  header.appendChild(inner);

  const nav = el('nav', { class: 'primary', 'aria-label': 'Primary' });
  const list = el('ul');
  const here = window.location.pathname.replace(/^\/$/, '/index.html');
  for (const item of NAV) {
    if (item.adminOnly && role !== 'admin') continue;
    const link = el('a', { href: item.href, text: item.label });
    if (item.href === here) link.setAttribute('aria-current', 'page');
    list.appendChild(el('li', {}, [link]));
  }
  const disconnect = el('a', { href: '/disconnect.html', text: 'Disconnect' });
  if (here === '/disconnect.html') disconnect.setAttribute('aria-current', 'page');
  list.appendChild(el('li', {}, [disconnect]));
  nav.appendChild(list);
  header.appendChild(nav);
  document.body.insertBefore(header, document.body.firstChild);

  const skip = el('a', { class: 'skip-link', href: '#main', text: 'Skip to main content' });
  document.body.insertBefore(skip, document.body.firstChild);

  document.body.appendChild(el('footer', { class: 'site' }, [
    '7th Swindon Scouts · OSM Connect Test Harness · read only diagnostics · ',
    el('a', { href: 'https://status.onlinescoutmanager.co.uk/', rel: 'noreferrer noopener', target: '_blank', text: 'OSM service status' })
  ]));
}

let cachedState = null;

async function loadState({ force = false } = {}) {
  if (cachedState && !force) return cachedState;
  const { data } = await api('/api/state');
  cachedState = data;
  csrfToken = data.csrfToken || csrfToken;
  return data;
}

async function initPage() {
  const state = await loadState();
  buildChrome(state.user?.role);
  const main = document.getElementById('main');
  if (main && !main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
  return state;
}

function busy(node, label = 'Loading…') {
  node.replaceChildren(el('p', { role: 'status', text: label }));
}

function formatList(values) {
  return (values || []).length ? values.join(', ') : 'none';
}

export { el, api, initPage, loadState, renderMessage, statusPill, buildChrome, busy, formatList, slug };
