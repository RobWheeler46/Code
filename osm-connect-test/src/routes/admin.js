// Application Administrator functions (FRD 9.2, 12.3, 18).
//
// The client secret is write only: it can be replaced but never read back
// (FR-CONFIG-002, FR-CONFIG-003). Every change is audited (FR-CONFIG-007).

const express = require('express');
const router = express.Router();

const db = require('../db');
const config = require('../lib/config');
const audit = require('../lib/audit');
const breaker = require('../lib/breaker');
const endpoints = require('../lib/endpoints');
const messages = require('../lib/messages');
const report = require('../lib/report');
const { requireUser, requireRole, requireRecentAuth } = require('../lib/middleware');
const { ukFormat } = require('../lib/times');

router.use(requireUser, requireRole('admin'));

router.get('/config', (req, res) => {
  res.json({
    config: config.forDisplay(),
    complete: config.isComplete(),
    missing: config.missingRequired(),
    callbackCheck: config.callbackUrlIsValid(),
    personalDataTestsAllowed: config.personalDataTestsAllowed(),
    note: 'The client secret cannot be displayed once it has been saved. It can only be replaced.'
  });
});

router.post('/config', requireRecentAuth(30), (req, res) => {
  const updates = req.body?.updates;
  if (!updates || typeof updates !== 'object') return res.status(400).json({ error: 'No updates were supplied.' });

  const { applied, rejected } = config.applyUpdates(updates, req.user.osm_user_masked);

  audit.record({
    userId: req.user.id, event: 'config.changed', outcome: applied.length ? 'updated' : 'no-change',
    // The values themselves are never audited - only which settings changed.
    detail: `Changed: ${applied.join(', ') || 'none'}${rejected.length ? `; rejected: ${rejected.join('; ')}` : ''}`
  });

  res.json({ applied, rejected, config: config.forDisplay(), complete: config.isComplete() });
});

/** FR-CONFIG-006: a configuration test that does not expose the secret. */
router.get('/config/test', (req, res) => {
  res.json(config.configTest());
});

router.get('/endpoints', (req, res) => {
  res.json({
    endpoints: endpoints.all().map((d) => ({
      key: d.key, name: d.name, version: d.version, method: d.method, path: d.path,
      queryParams: d.query_params, requiresSection: !!d.requires_section,
      enabled: !!d.enabled, personalDataRisk: d.personal_data_risk,
      lastVerifiedAt: ukFormat(d.last_verified_at), notes: d.notes,
      mandatoryFields: d.mandatory_fields, optionalFields: d.optional_fields
    })),
    personalDataTestsAllowed: config.personalDataTestsAllowed()
  });
});

router.post('/endpoints/:key', requireRecentAuth(30), (req, res) => {
  const def = endpoints.byKey(req.params.key);
  if (!def) return res.status(404).json({ error: 'That test is not defined.' });
  const enabled = !!req.body?.enabled;

  if (enabled && def.personal_data_risk === 'high' && !config.personalDataTestsAllowed()) {
    return res.status(403).json({
      error: 'This test may return young people’s information. It can only be enabled where ALLOW_PERSONAL_DATA_TESTS is set for the environment.'
    });
  }
  if (enabled && !endpoints.APPROVED_METHODS.has(String(def.method).toUpperCase())) {
    return res.status(403).json({ error: 'This definition uses a method that is not an approved read operation. Release 1 is read only.' });
  }

  endpoints.setEnabled(def.key, enabled);
  audit.record({
    userId: req.user.id, event: 'endpoint.toggled', outcome: enabled ? 'enabled' : 'disabled',
    detail: `${def.key} (${def.personal_data_risk} personal data risk)`
  });
  res.json({ ok: true, key: def.key, enabled });
});

router.get('/overview', (req, res) => {
  const outcomes = db.prepare(`
    SELECT overall_result AS result, COUNT(*) AS n FROM test_sessions
    WHERE overall_result IS NOT NULL GROUP BY overall_result
  `).all();
  const codes = db.prepare(`
    SELECT message_code AS code, COUNT(*) AS n FROM test_results
    WHERE message_code IS NOT NULL GROUP BY message_code ORDER BY n DESC LIMIT 20
  `).all();
  const statuses = db.prepare(`
    SELECT response_status AS status, COUNT(*) AS n FROM request_log
    WHERE response_status IS NOT NULL GROUP BY response_status ORDER BY n DESC
  `).all();
  const users = db.prepare('SELECT id, osm_user_masked, role, account_status, created_at, last_sign_in_at, last_successful_test_at FROM app_users ORDER BY id').all();

  res.json({
    outcomes,
    messageCodes: codes,
    httpStatuses: statuses,
    users: users.map((u) => ({
      id: u.id, reference: u.osm_user_masked, role: u.role, status: u.account_status,
      created: ukFormat(u.created_at), lastSignIn: ukFormat(u.last_sign_in_at),
      lastSuccessfulTest: ukFormat(u.last_successful_test_at)
    })),
    rateLimit: breaker.rateSummary(),
    circuitBreaker: breaker.state(),
    health: report.healthSnapshot(),
    retentionDays: config.get('retentionDays')
  });
});

router.get('/audit', (req, res) => {
  const rows = audit.recent(Number(req.query.limit) || 200);
  res.json({
    entries: rows.map((r) => ({
      at: ukFormat(r.created_at),
      user: r.osm_user_masked || 'unauthenticated',
      event: r.event_type,
      outcome: r.outcome,
      correlationId: r.correlation_id,
      sectionRef: r.section_ref,
      messageCode: r.message_code,
      detail: r.detail
    })),
    note: 'Audit records contain no secrets, tokens or member information.'
  });
});

/** Only an administrator can clear a blocked-client state (FR-ERR-017). */
router.post('/breaker/clear', requireRecentAuth(15), (req, res) => {
  const before = breaker.state();
  audit.record({
    userId: req.user.id, event: 'admin.override_attempted', outcome: before.state,
    messageCode: before.messageCode, detail: `Administrator cleared the ${before.state} state. Reason given: ${String(req.body?.reason || 'none').slice(0, 200)}`
  });
  const after = breaker.clear({ userId: req.user.id, note: String(req.body?.reason || '').slice(0, 200) });
  res.json({ before, after, message: messages.build('OSM-CONN-001') });
});

router.post('/rate/reset', requireRecentAuth(15), (req, res) => {
  breaker.resetLocalCount();
  audit.record({ userId: req.user.id, event: 'admin.override_attempted', outcome: 'rate-counter-reset', detail: 'Local rate counter reset. OSM-side limits are unaffected.' });
  res.json({ ok: true, rateLimit: breaker.rateSummary() });
});

router.post('/users/:id/role', requireRecentAuth(30), (req, res) => {
  const role = String(req.body?.role || '');
  if (!['tester', 'admin', 'developer', 'support'].includes(role)) {
    return res.status(400).json({ error: 'Unknown application role.' });
  }
  const target = db.prepare('SELECT * FROM app_users WHERE id = ?').get(Number(req.params.id));
  if (!target) return res.status(404).json({ error: 'That user was not found.' });
  db.prepare('UPDATE app_users SET role = ? WHERE id = ?').run(role, target.id);
  audit.record({ userId: req.user.id, event: 'config.changed', outcome: 'role-changed', detail: `${target.osm_user_masked} -> ${role}` });
  res.json({ ok: true });
});

/** Diagnostic retention (FR-PRIV-008, FR-AUDIT-004). */
router.post('/retention/run', requireRecentAuth(30), (req, res) => {
  const days = config.get('retentionDays') || 30;
  const cutoff = `-${days} days`;
  const sessions = db.prepare("SELECT id FROM test_sessions WHERE started_at < datetime('now', ?)").all(cutoff);
  for (const s of sessions) {
    db.prepare('DELETE FROM request_log WHERE test_session_id = ?').run(s.id);
    db.prepare('DELETE FROM test_results WHERE test_session_id = ?').run(s.id);
  }
  db.prepare("DELETE FROM test_sessions WHERE started_at < datetime('now', ?)").run(cutoff);
  audit.record({ userId: req.user.id, event: 'data.deleted', outcome: 'retention', detail: `Removed ${sessions.length} test session(s) older than ${days} days.` });
  res.json({ ok: true, removed: sessions.length, retentionDays: days });
});

module.exports = router;
