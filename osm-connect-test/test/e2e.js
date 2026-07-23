// End-to-end check of the connection flow against the mock OSM server.
//
// Each scenario boots a clean database, connects through the OAuth flow, runs the
// guided test and asserts the outcome, then confirms that no credential or personal
// value appears anywhere in the exported diagnostic report.
//
//   node test/e2e.js            run every scenario
//   node test/e2e.js happy      run one scenario

const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const mock = require('./mock-osm');

const APP_PORT = 3998;
const MOCK_PORT = 3999;
const DATA_DIR = path.join(__dirname, '..', 'data-test');

const CASES = [
  { scenario: 'happy', expect: ['Passed', 'Passed with warnings'], mustContainCodes: ['OSM-TOKEN-002'] },
  { scenario: 'no-sections', expect: ['Failed'], expectStageFailure: 'OSM roles found' },
  { scenario: 'unknown-permission', expect: ['Passed with warnings'], mustContainCodes: ['OSM-PERM-004'] },
  { scenario: 'rate-limited', expect: ['Failed'], expectStageFailure: 'Authenticated request accepted' },
  // The user-identification probe during the callback already sees the block, so the
  // guided test must be refused outright rather than sending more requests (AC-009).
  { scenario: 'blocked', expectGuidedRefusal: 'OSM-API-012' },
  { scenario: 'removed', expect: ['Failed'], expectStageFailure: 'Authenticated request accepted' },
  { scenario: 'forbidden', expect: ['Failed'], expectStageFailure: 'Authenticated request accepted' },
  { scenario: 'server-error', expect: ['Failed'], expectStageFailure: 'Authenticated request accepted' },
  { scenario: 'invalid-json', expect: ['Failed'], expectStageFailure: 'Response parsed' },
  { scenario: 'wrapped', expect: ['Failed', 'Passed with warnings'] },
  { scenario: 'empty', expect: ['Failed'] },
  { scenario: 'unsupported-type', expect: ['Failed'] },
  { scenario: 'missing-user', expect: ['Failed'], expectStageFailure: 'Required response fields found' },
  { scenario: 'deprecated', expect: ['Passed', 'Passed with warnings'] },
  { scenario: 'declined', connectOnly: true, expectMessage: 'OSM-CALLBACK-002' },
  { scenario: 'no-code', connectOnly: true, expectMessage: 'OSM-CALLBACK-003' },
  { scenario: 'bad-state', connectOnly: true, expectMessage: 'OSM-CALLBACK-004' },
  { scenario: 'token-rejected', connectOnly: true, expectMessage: 'OSM-TOKEN-003' }
];

// Values that must never appear in a diagnostic export (FRD 17.2).
const FORBIDDEN_IN_REPORT = ['mock-refresh-token', 'test-client-secret', 'leader@example.invalid', 'Test Leader'];

const jar = new Map();

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function storeCookies(res) {
  const set = res.headers.getSetCookie?.() || [];
  for (const c of set) {
    const [pair] = c.split(';');
    const idx = pair.indexOf('=');
    if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
}

async function call(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    redirect: 'manual',
    headers: { Accept: 'application/json', Cookie: cookieHeader(), ...(options.headers || {}) }
  });
  storeCookies(res);
  return res;
}

function wipeDatabase() {
  if (!fs.existsSync(DATA_DIR)) return;
  for (const f of fs.readdirSync(DATA_DIR)) {
    if (f.startsWith('osm-connect-test.db')) fs.rmSync(path.join(DATA_DIR, f), { force: true });
  }
}

function startApp(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    const onData = (chunk) => {
      out += chunk.toString();
      if (out.includes('listening on')) resolve(child);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (c) => { out += c.toString(); });
    child.on('exit', (code) => reject(new Error(`server exited early (${code}):\n${out}`)));
    setTimeout(() => reject(new Error(`server did not start:\n${out}`)), 15000);
  });
}

const APP_ENV = {
  PORT: String(APP_PORT),
  NODE_ENV: 'test',
  SESSION_SECRET: 'e2e-session-secret-value-long-enough',
  TOKEN_ENCRYPTION_KEY: '0'.repeat(64),
  OSM_CLIENT_ID: 'test-client-id',
  OSM_CLIENT_SECRET: 'test-client-secret',
  OSM_CALLBACK_URL: `http://localhost:${APP_PORT}/oauth/callback`,
  OSM_AUTHORIZE_URL: `http://localhost:${MOCK_PORT}/oauth/authorize`,
  OSM_TOKEN_URL: `http://localhost:${MOCK_PORT}/oauth/token`,
  OSM_API_BASE: `http://localhost:${MOCK_PORT}`,
  OSM_ALLOWED_HOSTS: 'localhost',
  ADMIN_EMAILS: 'leader@example.invalid',
  MAX_AUTOMATIC_RETRIES: '0',
  DATA_DIR,
  BREAKER_FAILURE_THRESHOLD: '99'
};

async function connect() {
  const connectRes = await call(`http://localhost:${APP_PORT}/oauth/connect`);
  const authorize = connectRes.headers.get('location');
  if (!authorize) throw new Error('no redirect to the authorisation endpoint');
  const authRes = await call(authorize);
  const callback = authRes.headers.get('location');
  if (!callback) throw new Error('mock OSM did not redirect back');
  await call(callback);
  const outcome = await call(`http://localhost:${APP_PORT}/oauth/outcome`);
  return (await outcome.json()).message;
}

async function runGuided() {
  const state = await (await call(`http://localhost:${APP_PORT}/api/state`)).json();
  const start = await call(`http://localhost:${APP_PORT}/api/test/guided`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrfToken },
    body: '{}'
  });
  if (!start.ok) {
    const body = await start.json().catch(() => ({}));
    return { refused: true, status: start.status, code: body.message?.code || null };
  }
  const { sessionRef } = await start.json();

  for (let i = 0; i < 120; i += 1) {
    await new Promise((r) => setTimeout(r, 250));
    const snap = await (await call(`http://localhost:${APP_PORT}/api/test/guided/${sessionRef}`)).json();
    if (!snap.running) return snap;
  }
  throw new Error('guided test did not finish within 30 seconds');
}

async function runCase(testCase) {
  jar.clear();
  wipeDatabase();
  const mockServer = await mock.start(MOCK_PORT, { scenario: testCase.scenario });
  const app = await startApp(APP_ENV);
  const problems = [];

  try {
    const message = await connect();

    if (testCase.connectOnly) {
      if (message.code !== testCase.expectMessage) {
        problems.push(`expected connection message ${testCase.expectMessage}, got ${message.code}`);
      }
      return problems;
    }
    if (message.code !== 'OSM-TOKEN-002') {
      problems.push(`connection did not complete: ${message.code} - ${message.title}`);
      return problems;
    }

    const snap = await runGuided();

    if (testCase.expectGuidedRefusal) {
      if (!snap.refused) problems.push('expected the guided test to be refused, but it ran');
      else if (snap.code !== testCase.expectGuidedRefusal) {
        problems.push(`expected refusal code ${testCase.expectGuidedRefusal}, got ${snap.code}`);
      }
      return problems;
    }
    if (snap.refused) {
      problems.push(`guided test was refused: ${snap.status} ${snap.code}`);
      return problems;
    }

    if (!testCase.expect.includes(snap.overall)) {
      problems.push(`expected overall ${testCase.expect.join(' or ')}, got ${snap.overall}`);
    }
    if (testCase.expectStageFailure) {
      const firstFail = snap.stages.find((s) => s.status === 'Failed');
      if (!firstFail || firstFail.name !== testCase.expectStageFailure) {
        problems.push(`expected first failure at "${testCase.expectStageFailure}", got "${firstFail?.name || 'none'}"`);
      }
    }
    for (const code of testCase.mustContainCodes || []) {
      const seen = snap.stages.some((s) => s.messageCode === code) || message.code === code;
      if (!seen) problems.push(`expected message code ${code} to appear`);
    }

    // No stage may be described as Failed purely because a dependency failed.
    const skipped = snap.stages.filter((s) => s.status === 'Skipped');
    const failed = snap.stages.filter((s) => s.status === 'Failed');
    if (failed.length > 1 && skipped.length === 0) {
      problems.push('multiple failures with no skipped stages - dependency skipping may not be working');
    }

    // Redaction check on the exported report (AC-011, FRD 17.2).
    const reportText = await (await call(`http://localhost:${APP_PORT}/api/report/${snap.sessionRef}?format=text`)).text();
    const reportJson = await (await call(`http://localhost:${APP_PORT}/api/report/${snap.sessionRef}`)).text();
    for (const forbidden of FORBIDDEN_IN_REPORT) {
      if (reportText.includes(forbidden)) problems.push(`text report leaked "${forbidden}"`);
      if (reportJson.includes(forbidden)) problems.push(`JSON report leaked "${forbidden}"`);
    }
    if (/mock-access-/.test(reportText) || /mock-access-/.test(reportJson)) {
      problems.push('report leaked an access token');
    }
    return problems;
  } finally {
    app.kill();
    await new Promise((r) => mockServer.close(r));
    await new Promise((r) => setTimeout(r, 150));
  }
}

(async () => {
  const only = process.argv[2];
  const cases = only ? CASES.filter((c) => c.scenario === only) : CASES;
  if (!cases.length) {
    console.error(`Unknown scenario "${only}". Available: ${CASES.map((c) => c.scenario).join(', ')}`);
    process.exit(2);
  }

  let failures = 0;
  for (const testCase of cases) {
    process.stdout.write(`${testCase.scenario.padEnd(20)} `);
    try {
      const problems = await runCase(testCase);
      if (problems.length) {
        failures += 1;
        console.log('FAIL');
        problems.forEach((p) => console.log(`    - ${p}`));
      } else {
        console.log('ok');
      }
    } catch (err) {
      failures += 1;
      console.log(`ERROR\n    - ${err.message}`);
    }
  }
  wipeDatabase();
  console.log(`\n${cases.length - failures} of ${cases.length} scenarios passed.`);
  process.exit(failures ? 1 : 0);
})();
