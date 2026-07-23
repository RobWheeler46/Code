// Circuit breaker (FRD 15.3) and local rate-limit tracking (FRD 16).
//
// Two distinct states matter:
//   open     - repeated transient failures. Testers see a cooldown and may be
//              allowed to override once it has elapsed.
//   critical - a blocked-client response. Requests stop immediately and a Tester
//              cannot override it (FR-ERR-017, AC-009).

const db = require('../db');
const config = require('./config');
const audit = require('./audit');
const { parseUtc } = require('./times');

const getBreaker = db.prepare('SELECT * FROM breaker_state WHERE id = 1');
const setBreaker = db.prepare(`
  UPDATE breaker_state SET state = ?, reason = ?, opened_at = ?, retry_after = ?,
    recent_failures = ?, overridable = ?, message_code = ? WHERE id = 1
`);

const getRate = db.prepare('SELECT * FROM rate_state WHERE id = 1');
const setRate = db.prepare(`
  UPDATE rate_state SET window_started_at = ?, local_count = ?, reported_limit = ?,
    reported_remaining = ?, reported_reset = ?, last_seen_at = ? WHERE id = 1
`);

function state() {
  const row = getBreaker.get();
  const now = Date.now();
  const retryAfterMs = row.retry_after ? parseUtc(row.retry_after) : null;
  const elapsed = row.state === 'open' && retryAfterMs !== null && now >= retryAfterMs;
  return {
    state: row.state,
    reason: row.reason,
    openedAt: row.opened_at,
    retryAfter: row.retry_after,
    recentFailures: row.recent_failures,
    overridable: !!row.overridable,
    messageCode: row.message_code,
    cooldownElapsed: elapsed
  };
}

/** Can a request be sent right now? */
function check() {
  const s = state();
  if (s.state === 'critical') {
    return { allowed: false, code: 'OSM-API-012', breaker: s };
  }
  if (s.state === 'open' && !s.cooldownElapsed) {
    return { allowed: false, code: 'OSM-APP-003', breaker: s };
  }
  return { allowed: true, breaker: s };
}

function recordSuccess() {
  const row = getBreaker.get();
  if (row.state === 'critical') return; // only an administrator clears a block
  if (row.recent_failures !== 0 || row.state !== 'closed') {
    setBreaker.run('closed', null, null, null, 0, 1, null);
  }
}

function recordFailure(reason, { userId = null, correlationId = null } = {}) {
  const row = getBreaker.get();
  if (row.state === 'critical') return state();
  const failures = row.recent_failures + 1;
  const threshold = config.get('breakerFailureThreshold') || 5;
  if (failures >= threshold) {
    const cooldown = (config.get('breakerCooldownSeconds') || 300) * 1000;
    const retryAfter = new Date(Date.now() + cooldown).toISOString();
    setBreaker.run('open', reason, new Date().toISOString(), retryAfter, failures, 1, 'OSM-APP-003');
    audit.record({ userId, event: 'breaker.opened', outcome: 'open', correlationId, messageCode: 'OSM-APP-003', detail: reason });
  } else {
    setBreaker.run(row.state, reason, row.opened_at, row.retry_after, failures, row.overridable, row.message_code);
  }
  return state();
}

/** A blocked-client response. Stops everything until an administrator clears it. */
function trip(reason, { userId = null, correlationId = null } = {}) {
  const row = getBreaker.get();
  setBreaker.run('critical', reason, new Date().toISOString(), null, row.recent_failures + 1, 0, 'OSM-API-012');
  audit.record({ userId, event: 'blocked_client.detected', outcome: 'critical', correlationId, messageCode: 'OSM-API-012', detail: reason });
  return state();
}

function clear({ userId = null, note = null } = {}) {
  setBreaker.run('closed', null, null, null, 0, 1, null);
  audit.record({ userId, event: 'breaker.cleared', outcome: 'closed', detail: note });
  return state();
}

// --- Rate limiting -----------------------------------------------------------

const WINDOW_MS = 60 * 60 * 1000; // local counter window

function rateState() {
  const row = getRate.get();
  const started = parseUtc(row.window_started_at) || Date.now();
  if (Date.now() - started > WINDOW_MS) {
    setRate.run(new Date().toISOString(), 0, row.reported_limit, row.reported_remaining, row.reported_reset, row.last_seen_at);
    return getRate.get();
  }
  return row;
}

function threshold() {
  return config.get('localRateLimitThreshold') || 60;
}

function rateSummary() {
  const row = rateState();
  const limit = threshold();
  const usedPercent = limit > 0 ? Math.round((row.local_count / limit) * 100) : 0;
  return {
    reportedLimit: row.reported_limit,
    reportedRemaining: row.reported_remaining,
    reportedReset: row.reported_reset,
    localCount: row.local_count,
    localThreshold: limit,
    usedPercent,
    // FR-RATE-004
    warningLevel: usedPercent >= 95 ? 95 : usedPercent >= 85 ? 85 : usedPercent >= 70 ? 70 : null,
    // FR-RATE-005
    nonEssentialDisabled: row.local_count >= limit
  };
}

function countRequest() {
  const row = rateState();
  setRate.run(row.window_started_at, row.local_count + 1, row.reported_limit, row.reported_remaining, row.reported_reset, row.last_seen_at);
}

function recordReported({ limit, remaining, reset }) {
  const row = rateState();
  setRate.run(
    row.window_started_at, row.local_count,
    limit ?? row.reported_limit, remaining ?? row.reported_remaining,
    reset ?? row.reported_reset, new Date().toISOString()
  );
}

function resetLocalCount() {
  const row = getRate.get();
  setRate.run(new Date().toISOString(), 0, row.reported_limit, row.reported_remaining, row.reported_reset, row.last_seen_at);
}

module.exports = {
  state, check, recordSuccess, recordFailure, trip, clear,
  rateSummary, countRequest, recordReported, resetLocalCount, threshold
};
