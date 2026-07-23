// Tester-facing API: dashboard state, guided test, sections, individual tests,
// history, request inspection, diagnostic report, health and the message catalogue.

const express = require('express');
const router = express.Router();

const db = require('../db');
const config = require('../lib/config');
const messages = require('../lib/messages');
const breaker = require('../lib/breaker');
const guided = require('../lib/guided');
const endpoints = require('../lib/endpoints');
const oauth = require('../lib/oauth');
const osmClient = require('../lib/osmClient');
const report = require('../lib/report');
const audit = require('../lib/audit');
const redact = require('../lib/redact');
const correlation = require('../lib/correlation');
const permissions = require('../lib/permissions');
const { decrypt } = require('../lib/crypto');
const { requireUser } = require('../lib/middleware');
const { ukFormat } = require('../lib/times');

// --- connection state (FR-HOME-003) -----------------------------------------

function connectionState(user) {
  if (!config.isComplete()) return 'Application configuration incomplete';
  const b = breaker.state();
  if (b.state === 'critical') return 'Client blocked';
  if (!user) return 'Not connected';
  const conn = oauth.getConnection(user.id);
  if (!conn) return 'Not connected';
  if (conn.status === 'revoked') return 'Reconnection required';
  if (oauth.tokenExpired(conn)) return conn.refresh_token_enc ? 'Authentication expired' : 'Reconnection required';
  const rate = breaker.rateSummary();
  if (rate.nonEssentialDisabled) return 'Rate limited';
  if (b.state === 'open') return 'OSM unavailable';
  const sections = db.prepare('SELECT COUNT(*) AS n FROM osm_section_refs WHERE connection_id = ?').get(conn.id);
  if (!sections.n) return 'Connected with warnings';
  return 'Connected';
}

router.get('/state', (req, res) => {
  const user = req.session?.appUserId
    ? db.prepare('SELECT * FROM app_users WHERE id = ?').get(req.session.appUserId)
    : null;
  const conn = user ? oauth.getConnection(user.id) : null;
  const selected = conn?.selected_section_ref
    ? db.prepare('SELECT * FROM osm_section_refs WHERE id = ?').get(conn.selected_section_ref)
    : null;
  const state = connectionState(user);
  const sectionCount = conn
    ? db.prepare('SELECT COUNT(*) AS n FROM osm_section_refs WHERE connection_id = ?').get(conn.id).n
    : 0;

  res.json({
    connectionState: state,
    // FR-HOME-004 / FR-HOME-005
    primaryAction: state === 'Connected' || state === 'Connected with warnings'
      ? { label: 'Run guided test', href: '/guided.html' }
      : { label: 'Connect to OSM', href: '/oauth/connect' },
    configurationComplete: config.isComplete(),
    missingConfiguration: config.missingRequired(),
    user: user ? { reference: user.osm_user_masked, role: user.role, lastSignIn: ukFormat(user.last_sign_in_at) } : null,
    csrfToken: req.session?.csrfToken || null,
    connection: conn ? {
      connectedAt: ukFormat(conn.connected_at),
      lastSuccessAt: ukFormat(conn.last_success_at),
      // FR-HOME-006
      lastSuccessfulRequest: ukFormat(conn.last_success_at) || 'No successful request yet',
      scope: conn.scope,
      hasRefreshToken: !!conn.refresh_token_enc,
      expiresAt: ukFormat(conn.expires_at)
    } : null,
    // FR-HOME-007
    selectedSection: selected ? {
      id: selected.id, name: selected.section_name, type: selected.section_type,
      groupName: selected.group_name, maskedId: selected.section_id_masked
    } : null,
    sectionCount,
    // FR-HOME-008
    sectionWarning: conn && sectionCount === 0
      ? messages.build('OSM-PERM-002')
      : null,
    rateLimit: breaker.rateSummary(),
    circuitBreaker: breaker.state(),
    readOnly: true
  });
});

router.get('/health', (req, res) => {
  res.json(report.healthSnapshot());
});

router.get('/messages', (req, res) => {
  res.json({ messages: messages.list() });
});

router.get('/stages', (req, res) => {
  res.json({ stages: guided.stageDefinitions() });
});

// --- guided test -------------------------------------------------------------

router.post('/test/guided', requireUser, async (req, res) => {
  const gate = breaker.check();
  if (!gate.allowed) {
    return res.status(409).json({ message: messages.build(gate.code, { detail: gate.breaker.reason, retryAfter: gate.breaker.retryAfter }) });
  }
  if (!oauth.getConnection(req.user.id)) {
    return res.status(409).json({ message: messages.build('OSM-TOKEN-007') });
  }
  const proofEndpointKey = typeof req.body?.proofEndpointKey === 'string' ? req.body.proofEndpointKey : 'terms';
  const state = await guided.start(req.user, { proofEndpointKey });
  res.json(guided.snapshot(state));
});

router.get('/test/guided/:ref', requireUser, (req, res) => {
  const state = guided.get(req.params.ref);
  if (state && state.userId === req.user.id) return res.json(guided.snapshot(state));

  // Not in memory: fall back to the stored results (e.g. after a restart).
  const stored = storedSession(req.params.ref, req.user);
  if (!stored) return res.status(404).json({ error: 'That test session was not found.' });
  return res.json(stored);
});

router.post('/test/guided/:ref/cancel', requireUser, (req, res) => {
  const state = guided.cancel(req.params.ref, req.user.id);
  if (!state) return res.status(404).json({ error: 'That test session was not found.' });
  res.json(guided.snapshot(state));
});

function storedSession(ref, user) {
  const session = db.prepare('SELECT * FROM test_sessions WHERE session_ref = ?').get(ref);
  if (!session) return null;
  if (user.role === 'tester' && session.app_user_id !== user.id) return null;
  const rows = db.prepare('SELECT * FROM test_results WHERE test_session_id = ? ORDER BY display_order, id').all(session.id);
  return {
    sessionRef: session.session_ref,
    running: false,
    cancelled: session.overall_result === 'Cancelled',
    overall: session.overall_result,
    startedAt: session.started_at,
    correlationId: rows[0]?.correlation_id || null,
    message: session.overall_result ? messages.build(overallCode(session.overall_result)) : null,
    stages: rows.map((r) => ({
      key: r.stage_key, name: r.stage_name, status: r.status, startedAt: r.started_at,
      durationMs: r.duration_ms, summary: r.technical_summary, messageCode: r.message_code,
      message: r.message_code ? messages.build(r.message_code, { correlationId: r.correlation_id }) : null,
      technical: null
    }))
  };
}

function overallCode(overall) {
  return overall === 'Passed' ? 'OSM-TEST-001'
    : overall === 'Passed with warnings' ? 'OSM-TEST-002'
      : overall === 'Cancelled' ? 'OSM-TEST-004' : 'OSM-TEST-003';
}

// --- sections and permissions (FRD 12.6) ------------------------------------

router.get('/sections', requireUser, (req, res) => {
  const conn = oauth.getConnection(req.user.id);
  if (!conn) return res.json({ groups: [], sections: [], message: messages.build('OSM-TOKEN-007') });

  const rows = db.prepare('SELECT * FROM osm_section_refs WHERE connection_id = ? ORDER BY group_name, section_name').all(conn.id);
  const sections = rows.map((r) => {
    let perms = { summary: 'No permissions returned', entries: [] };
    try { perms = JSON.parse(r.permission_summary) || perms; } catch { /* keep the default */ }
    return {
      id: r.id,
      groupName: r.group_name,
      groupIdMasked: r.group_id_masked,
      sectionName: r.section_name,
      sectionIdMasked: r.section_id_masked,
      sectionType: r.section_type,
      isDefault: !!r.is_default,
      isSelected: conn.selected_section_ref === r.id,
      permissionSummary: perms.summary,
      permissions: perms.entries,
      interpretationWarnings: (perms.entries || []).filter((e) => e.warning).map((e) => `${e.category}: ${e.warning}`),
      retrievedAt: ukFormat(r.retrieved_at)
    };
  });

  const groups = [];
  for (const s of sections) {
    const key = `${s.groupIdMasked}|${s.groupName}`;
    let g = groups.find((x) => x.key === key);
    if (!g) { g = { key, groupName: s.groupName || 'Unnamed group', groupIdMasked: s.groupIdMasked, sections: [] }; groups.push(g); }
    g.sections.push(s);
  }

  res.json({
    groups,
    sections,
    selectedSectionId: conn.selected_section_ref,
    message: sections.length ? messages.build('OSM-PERM-001') : messages.build('OSM-PERM-002'),
    knownCategories: permissions.KNOWN_CATEGORIES
  });
});

// FR-PERM-011 / FR-PERM-012: changing section needs no reconnection and changes nothing in OSM.
router.post('/sections/select', requireUser, (req, res) => {
  const conn = oauth.getConnection(req.user.id);
  if (!conn) return res.status(409).json({ message: messages.build('OSM-TOKEN-007') });
  const id = Number(req.body?.sectionId);
  const row = db.prepare('SELECT * FROM osm_section_refs WHERE id = ? AND connection_id = ?').get(id, conn.id);
  if (!row) return res.status(404).json({ error: 'That section is not available for this connection.' });

  db.prepare('UPDATE osm_connections SET selected_section_ref = ? WHERE id = ?').run(row.id, conn.id);
  audit.record({
    userId: req.user.id, event: 'section.selected', outcome: 'selected',
    sectionRef: row.section_id_masked, detail: `Section changed to ${row.section_name || 'unnamed'}. No OSM information was changed.`
  });
  res.json({ ok: true, selectedSectionId: row.id, readOnly: true });
});

// --- individual tests (FRD 12.7) --------------------------------------------

router.get('/tests', requireUser, (req, res) => {
  const list = endpoints.all().map((d) => ({
    key: d.key,
    name: d.name,
    version: d.version,
    method: d.method,
    path: d.path,
    queryParams: d.query_params,
    requiresSection: !!d.requires_section,
    enabled: !!d.enabled,
    personalDataRisk: d.personal_data_risk,
    // FR-API-001
    whatItTests: d.what_it_tests,
    whyUseful: d.why_useful,
    informationRequested: [d.path, d.query_params].filter(Boolean).join(' '),
    personalInformationPossible: d.personal_data_risk !== 'none',
    resultRetained: 'Only a sanitised summary, message code and timings are retained.',
    permissionRequired: d.permission_required,
    mandatoryFields: d.mandatory_fields,
    optionalFields: d.optional_fields,
    lastVerifiedAt: ukFormat(d.last_verified_at),
    notes: d.notes,
    blockedReason: endpoints.guard(d).allowed ? null : endpoints.guard(d).reason
  }));
  res.json({ tests: list, personalDataTestsAllowed: config.personalDataTestsAllowed() });
});

router.post('/tests/:key/run', requireUser, async (req, res) => {
  const def = endpoints.byKey(req.params.key);
  const guard = endpoints.guard(def);
  if (!guard.allowed) {
    return res.status(403).json({ message: messages.build(guard.code, { detail: guard.reason }) });
  }
  const gate = breaker.check();
  if (!gate.allowed) {
    return res.status(409).json({ message: messages.build(gate.code, { detail: gate.breaker.reason, retryAfter: gate.breaker.retryAfter }) });
  }

  const conn = oauth.getConnection(req.user.id);
  if (!conn) return res.status(409).json({ message: messages.build('OSM-TOKEN-007') });
  const accessToken = oauth.accessTokenFor(conn);
  if (!accessToken) return res.status(409).json({ message: messages.build('OSM-TOKEN-007') });

  let sectionId = null;
  if (def.requires_section) {
    // FR-PERM-008
    if (!conn.selected_section_ref) {
      return res.status(409).json({ message: messages.build('OSM-PERM-003', { detail: 'Select an active section before running this test.' }) });
    }
    const section = db.prepare('SELECT * FROM osm_section_refs WHERE id = ?').get(conn.selected_section_ref);
    sectionId = decrypt(section.section_id_enc);
  }

  const corrId = correlation.newCorrelationId();
  const sessionRef = correlation.newSessionRef('IT');
  db.prepare('INSERT INTO test_sessions (session_ref, app_user_id, kind, section_ref_id) VALUES (?, ?, ?, ?)')
    .run(sessionRef, req.user.id, 'individual', conn.selected_section_ref || null);
  const testSession = db.prepare('SELECT * FROM test_sessions WHERE session_ref = ?').get(sessionRef);

  const result = await osmClient.send({
    url: endpoints.buildUrl(def, { sectionId }),
    headers: { Authorization: `${conn.token_type || 'Bearer'} ${accessToken}` },
    correlationId: corrId,
    testSessionId: testSession.id,
    userId: req.user.id,
    label: def.name
  });

  const schema = result.ok ? endpoints.validateSchema(def, result.data) : { result: 'not-run', missing: [], present: [] };
  if (result.ok) endpoints.markVerified(def.key);
  if (result.outcome === 'removed') endpoints.markRemoved(def.key, 'Detected during an individual test.');

  const status = result.ok
    ? (schema.result === 'missing-fields' ? 'Passed with warning' : 'Passed')
    : 'Failed';
  const code = result.ok && schema.result === 'missing-fields' ? 'OSM-API-003' : result.code;

  db.prepare(`
    INSERT INTO test_results (test_session_id, stage_key, stage_name, status, started_at, duration_ms, message_code, correlation_id, technical_summary, display_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(testSession.id, def.key, def.name, status, new Date().toISOString(), result.durationMs, code, corrId,
    `HTTP ${result.httpStatus ?? 'none'} - ${result.parseResult}`);

  db.prepare('UPDATE test_sessions SET ended_at = ?, overall_result = ?, warning_count = ?, failure_count = ? WHERE id = ?')
    .run(new Date().toISOString(), status === 'Failed' ? 'Failed' : (status === 'Passed' ? 'Passed' : 'Passed with warnings'),
      status === 'Passed with warning' ? 1 : 0, status === 'Failed' ? 1 : 0, testSession.id);

  audit.record({
    userId: req.user.id, event: 'individual_test.run', outcome: status,
    correlationId: corrId, messageCode: code,
    sectionRef: conn.selected_section_ref ? String(conn.selected_section_ref) : null,
    detail: `${def.name} (${def.key})`
  });

  // FR-REQ-004 / FR-REQ-005: interpreted result shown separately from the sanitised raw response.
  const interpreted = result.data ? redact.sanitise(result.data) : { value: null, redactions: 0, truncated: false };

  res.json({
    sessionRef,
    test: { key: def.key, name: def.name, version: def.version, personalDataRisk: def.personal_data_risk },
    status,
    message: messages.build(code, { correlationId: corrId, retryAfter: result.retryAfter }),
    summary: {
      httpStatus: result.httpStatus,
      contentType: result.contentType,
      responseBytes: result.bytes,
      durationMs: result.durationMs,
      attempts: result.attempt,
      parseResult: result.parseResult,
      truncated: !!result.oversized
    },
    request: {
      method: def.method,
      ...redact.sanitiseUrl(endpoints.buildUrl(def, { sectionId })),
      timeoutMs: config.get('requestTimeoutMs')
    },
    responseHeaders: result.headers,
    interpreted: interpreted.value,
    rawPreview: result.preview,
    // FR-REQ-007
    sanitisation: {
      applied: true,
      fieldsRemoved: interpreted.redactions + (result.redactions || 0),
      truncated: interpreted.truncated || !!result.oversized,
      note: 'Credentials, identifiers and personal information have been removed or masked before display.'
    },
    schema,
    rateLimit: breaker.rateSummary(),
    deprecation: result.deprecation,
    timings: { durationMs: result.durationMs, slow: !!result.slow, warningThresholdMs: config.get('slowResponseWarningMs') },
    recommendations: messages.build(code).whatYouCanDo
  });
});

// --- history, requests and reports ------------------------------------------

router.get('/history', requireUser, (req, res) => {
  const rows = req.user.role === 'tester'
    ? db.prepare('SELECT * FROM test_sessions WHERE app_user_id = ? ORDER BY id DESC LIMIT 100').all(req.user.id)
    : db.prepare('SELECT * FROM test_sessions ORDER BY id DESC LIMIT 100').all();
  res.json({
    sessions: rows.map((r) => ({
      sessionRef: r.session_ref,
      kind: r.kind,
      startedAt: ukFormat(r.started_at),
      endedAt: ukFormat(r.ended_at),
      overallResult: r.overall_result || 'In progress',
      warningCount: r.warning_count,
      failureCount: r.failure_count,
      ownedByYou: r.app_user_id === req.user.id
    }))
  });
});

router.get('/requests/:ref', requireUser, (req, res) => {
  const session = db.prepare('SELECT * FROM test_sessions WHERE session_ref = ?').get(req.params.ref);
  if (!session) return res.status(404).json({ error: 'That test session was not found.' });
  if (req.user.role === 'tester' && session.app_user_id !== req.user.id) {
    return res.status(403).json({ message: messages.build('OSM-API-007', { detail: 'You can only inspect your own test sessions.' }) });
  }
  const rows = osmClient.requestLogFor(session.id);
  res.json({
    requests: rows.map((r) => ({
      correlationId: r.correlation_id,
      attemptId: r.attempt_id,
      at: ukFormat(r.created_at),
      method: r.method,
      destination: r.destination,
      queryParameterNames: safeParse(r.query_param_names, []),
      requestContentType: r.request_content_type,
      timeoutMs: r.timeout_ms,
      attempt: r.attempt_number,
      durationMs: r.duration_ms,
      httpStatus: r.response_status,
      responseContentType: r.response_content_type,
      responseHeaders: safeParse(r.response_headers, {}),
      responseBytes: r.response_bytes,
      parseResult: r.parse_result,
      schemaResult: r.schema_result,
      redactionsApplied: r.redaction_count,
      truncated: !!r.truncated,
      // FR-REQ-006: the raw view is always the sanitised copy.
      rawPreview: r.preview,
      messageCode: r.message_code,
      message: r.message_code ? messages.build(r.message_code, { correlationId: r.correlation_id }) : null
    })),
    sanitisationNote: 'Every value shown here was sanitised before it was stored.'
  });
});

router.get('/report/:ref', requireUser, (req, res) => {
  const built = report.build(req.params.ref, req.user);
  if (!built) return res.status(404).json({ error: 'That test session was not found.' });
  if (built.error) return res.status(500).json({ error: built.error });

  audit.record({ userId: req.user.id, event: 'report.exported', outcome: String(req.query.format || 'json'), detail: req.params.ref });

  if (req.query.format === 'text') {
    res.type('text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="osm-diagnostic-${req.params.ref}.txt"`);
    return res.send(report.toText(built));
  }
  if (req.query.download === '1') {
    res.setHeader('Content-Disposition', `attachment; filename="osm-diagnostic-${req.params.ref}.json"`);
  }
  return res.json(built);
});

// --- privacy (FR-PRIV-009) ---------------------------------------------------

router.post('/privacy/delete', requireUser, (req, res) => {
  const conn = oauth.getConnection(req.user.id);
  const sessions = db.prepare('SELECT id FROM test_sessions WHERE app_user_id = ?').all(req.user.id);
  for (const s of sessions) {
    db.prepare('DELETE FROM request_log WHERE test_session_id = ?').run(s.id);
    db.prepare('DELETE FROM test_results WHERE test_session_id = ?').run(s.id);
  }
  db.prepare('DELETE FROM test_sessions WHERE app_user_id = ?').run(req.user.id);
  if (conn) {
    db.prepare('UPDATE osm_connections SET selected_section_ref = NULL WHERE id = ?').run(conn.id);
    db.prepare('DELETE FROM osm_section_refs WHERE connection_id = ?').run(conn.id);
  }
  oauth.disconnect(req.user.id);
  audit.record({
    userId: req.user.id, event: 'data.deleted', outcome: 'deleted',
    detail: 'Test history, section references and stored tokens removed at the user’s request. Audit records retained for security.'
  });
  req.session.destroy(() => res.json({
    ok: true,
    note: 'Your test history, stored section references and OSM tokens have been removed. Audit records are retained as required for security.'
  }));
});

// --- disconnect (FR-AUTH-018..020) ------------------------------------------

router.post('/disconnect', requireUser, (req, res) => {
  oauth.disconnect(req.user.id);
  req.session.destroy(() => {
    res.json({
      ok: true,
      message: messages.build('OSM-TOKEN-007', {
        detail: 'Locally stored access and refresh tokens have been removed and your application session has ended.',
        actions: ['Select Connect to OSM when you want to test again.']
      }),
      note: 'Disconnecting here removes the tokens held by this application. It may not remove any authorisation recorded within OSM itself - review that in OSM if you need to.'
    });
  });
});

function safeParse(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

module.exports = router;
