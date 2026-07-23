// Audit logging (FRD 18). Audit records never contain secrets, tokens or personal
// member information (FR-AUDIT-003) - callers pass only codes, outcomes and masked
// references, and the detail field is sanitised here as a second line of defence.

const db = require('../db');
const config = require('./config');
const { assertNoSecrets } = require('./redact');

const EVENTS = [
  'connection.started', 'connection.completed', 'connection.failed',
  'token.refreshed', 'token.removed', 'user.disconnected',
  'guided_test.started', 'guided_test.completed', 'individual_test.run',
  'report.exported', 'config.changed', 'endpoint.toggled',
  'blocked_client.detected', 'rate_limit.reached', 'admin.override_attempted',
  'breaker.opened', 'breaker.cleared', 'section.selected', 'data.deleted'
];

const insert = db.prepare(`
  INSERT INTO audit_log (app_user_id, event_type, outcome, correlation_id, section_ref, message_code, detail)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

function record({ userId = null, event, outcome = null, correlationId = null, sectionRef = null, messageCode = null, detail = null }) {
  if (!EVENTS.includes(event)) {
    console.warn(`[audit] unknown event type: ${event}`);
  }
  let safeDetail = detail === null || detail === undefined ? null : String(detail).slice(0, 500);
  if (safeDetail && !assertNoSecrets(safeDetail, config.secretValues())) {
    // FR-ERR-005 / FR-SEC-005: never let a redaction slip become a stored secret.
    console.error('[security] audit detail contained a configured secret and was dropped.');
    safeDetail = '[dropped: redaction check failed]';
  }
  insert.run(userId, event, outcome, correlationId, sectionRef, messageCode, safeDetail);
}

function recent(limit = 200, userId = null) {
  if (userId) {
    return db.prepare(`
      SELECT a.*, u.osm_user_masked FROM audit_log a
      LEFT JOIN app_users u ON u.id = a.app_user_id
      WHERE a.app_user_id = ? ORDER BY a.id DESC LIMIT ?
    `).all(userId, limit);
  }
  return db.prepare(`
    SELECT a.*, u.osm_user_masked FROM audit_log a
    LEFT JOIN app_users u ON u.id = a.app_user_id
    ORDER BY a.id DESC LIMIT ?
  `).all(limit);
}

module.exports = { record, recent, EVENTS };
