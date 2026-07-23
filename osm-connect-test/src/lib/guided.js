// The guided connection test (FRD 12.4).
//
// Stages run sequentially. A stage whose dependency failed is marked Skipped rather
// than Failed (FR-ERR-007), the first meaningful error is preserved as the primary
// failure (FR-ERR-006), and a cancelled stage is never described as a failure
// (FR-TEST-008).

const dns = require('node:dns').promises;
const db = require('../db');
const config = require('./config');
const audit = require('./audit');
const breaker = require('./breaker');
const messages = require('./messages');
const redact = require('./redact');
const correlation = require('./correlation');
const osmClient = require('./osmClient');
const endpoints = require('./endpoints');
const contextLib = require('./context');
const oauth = require('./oauth');
const health = require('./health');

const STATUS = {
  WAITING: 'Waiting',
  RUNNING: 'Running',
  PASSED: 'Passed',
  WARNING: 'Passed with warning',
  FAILED: 'Failed',
  SKIPPED: 'Skipped',
  CANCELLED: 'Cancelled'
};

const pass = (summary, extra = {}) => ({ status: STATUS.PASSED, summary, ...extra });
const warn = (summary, code, extra = {}) => ({ status: STATUS.WARNING, summary, messageCode: code, ...extra });
const fail = (summary, code, extra = {}) => ({ status: STATUS.FAILED, summary, messageCode: code, ...extra });

const STAGES = [
  {
    key: 'local-health',
    name: 'Local application health',
    async run() {
      const result = health.check();
      if (result.healthy) return pass('Database, encryption and configuration store all responded.', { messageCode: 'OSM-APP-001', technical: result.checks });
      return fail(`Failed checks: ${result.failed.join(', ')}`, 'OSM-APP-002', { technical: result.checks });
    }
  },
  {
    key: 'config-present',
    name: 'OSM configuration present',
    dependsOn: ['local-health'],
    async run() {
      const missing = config.missingRequired();
      if (!missing.length) {
        return pass('Client identifier, secret, callback and OSM addresses are all configured.', {
          technical: { callbackHost: safeHost(config.get('callbackUrl')), apiBase: config.get('apiBase') }
        });
      }
      return fail(`Missing configuration: ${missing.join(', ')}`, 'OSM-CONN-003');
    }
  },
  {
    key: 'secure-session',
    name: 'Secure session available',
    dependsOn: ['config-present'],
    async run(ctx) {
      if (!ctx.user) return fail('No signed-in application session was found.', 'OSM-CONN-003');
      return pass(`Application session active for ${ctx.user.osm_user_masked || 'this user'} (role: ${ctx.user.role}).`);
    }
  },
  {
    key: 'token-available',
    name: 'Access token available',
    dependsOn: ['secure-session'],
    async run(ctx) {
      if (!ctx.connection) return fail('No stored OSM connection was found for this user.', 'OSM-TOKEN-007');
      ctx.accessToken = oauth.accessTokenFor(ctx.connection);
      if (!ctx.accessToken) return fail('A connection record exists but the stored token could not be read.', 'OSM-TOKEN-007');
      return pass('An encrypted access token is stored and could be decrypted on the server.');
    }
  },
  {
    key: 'token-validity',
    name: 'Access token validity check',
    dependsOn: ['token-available'],
    async run(ctx) {
      if (!ctx.connection.expires_at) {
        return warn('OSM did not supply an expiry time, so validity can only be proven by making a request.', 'OSM-PARSE-004');
      }
      if (oauth.tokenExpired(ctx.connection)) {
        ctx.tokenExpired = true;
        return warn('The stored access token has expired. One controlled refresh will be attempted.', 'OSM-TOKEN-005');
      }
      return pass(`The stored token is within its expiry time (expires ${ctx.connection.expires_at}).`);
    }
  },
  {
    key: 'refresh-capability',
    name: 'Refresh capability where applicable',
    dependsOn: ['token-available'],
    async run(ctx) {
      const hasRefresh = !!ctx.connection.refresh_token_enc;
      if (!ctx.tokenExpired) {
        return hasRefresh
          ? pass('A refresh token is stored. No refresh is needed because the access token is still valid.')
          : warn('No refresh token is stored. A new sign in will be required once the access token expires.', 'OSM-TOKEN-005');
      }
      if (!hasRefresh) return fail('The access token has expired and no refresh token is stored.', 'OSM-TOKEN-007');

      // FR-AUTH-014: at most one controlled refresh.
      const result = await oauth.refresh(ctx.connection, { userId: ctx.user.id, correlationId: ctx.correlationId });
      if (!result.ok) {
        oauth.disconnect(ctx.user.id);
        ctx.connection = null;
        return fail('OSM did not accept the stored refresh token. The unusable tokens have been removed.', result.code);
      }
      oauth.storeRefreshedTokens(ctx.connection.id, result.fields, ctx.connection.refresh_token_enc);
      ctx.connection = oauth.getConnection(ctx.user.id);
      ctx.accessToken = oauth.accessTokenFor(ctx.connection);
      audit.record({ userId: ctx.user.id, event: 'token.refreshed', outcome: 'success', correlationId: ctx.correlationId, messageCode: 'OSM-TOKEN-006' });
      return pass('OSM accepted the refresh request and issued replacement token information.', { messageCode: 'OSM-TOKEN-006' });
    }
  },
  {
    key: 'base-reachable',
    name: 'OSM base address reachable',
    dependsOn: ['config-present'],
    async run() {
      // Deliberately a DNS check rather than an HTTP call, so proving reachability
      // does not consume part of the OSM rate limit (FR-RATE-008).
      const base = config.get('apiBase');
      let host;
      try { host = new URL(base).hostname; } catch { return fail('The configured API base address is not a valid URL.', 'OSM-CONN-003'); }
      if (!config.allowedHosts().includes(host.toLowerCase())) {
        return fail(`${host} is not on the approved OSM hostname list.`, 'OSM-APP-006');
      }
      try {
        const addresses = await dns.lookup(host, { all: true });
        return pass(`${host} resolved to ${addresses.length} address${addresses.length === 1 ? '' : 'es'}.`);
      } catch (err) {
        return fail(`${host} could not be resolved (${err.code || 'lookup failed'}).`, 'OSM-NET-001');
      }
    }
  },
  {
    key: 'auth-request',
    name: 'Authenticated request accepted',
    dependsOn: ['token-available', 'base-reachable'],
    async run(ctx) {
      const def = endpoints.byKey('context');
      const guard = endpoints.guard(def);
      if (!guard.allowed) return fail(guard.reason, guard.code);

      const url = endpoints.buildUrl(def);
      ctx.contextResponse = await osmClient.send({
        url,
        headers: { Authorization: `${ctx.connection.token_type || 'Bearer'} ${ctx.accessToken}` },
        correlationId: ctx.correlationId,
        testSessionId: ctx.testSessionId,
        userId: ctx.user.id,
        label: def.name
      });
      const r = ctx.contextResponse;

      if (r.blocked?.blocked) { ctx.stopAll = 'blocked'; return fail('OSM reported that this client is blocked. All further requests have stopped.', 'OSM-API-012'); }
      if (r.outcome === 'rate-limited') { ctx.stopAll = 'rate-limited'; return fail('OSM reported that the request limit has been reached.', 'OSM-API-011', { retryAfter: r.retryAfter }); }
      if (r.outcome === 'removed') { endpoints.markRemoved('context', 'Detected during a guided test.'); return fail('OSM reported that this endpoint has been removed.', 'OSM-API-009'); }
      if (r.httpStatus === null) return fail(`No response was received (${r.outcome}).`, r.code);
      if (r.outcome !== 'success') return fail(`OSM returned HTTP ${r.httpStatus}.`, r.code);

      endpoints.markVerified('context');
      const slowNote = r.slow ? ' The response was slower than the warning threshold.' : '';
      const summary = `OSM accepted the authenticated request (HTTP ${r.httpStatus}, ${r.durationMs} ms).${slowNote}`;
      return r.slow ? warn(summary, 'OSM-API-002') : pass(summary);
    }
  },
  {
    key: 'context-response',
    name: 'Startup or user context response received',
    dependsOn: ['auth-request'],
    async run(ctx) {
      const r = ctx.contextResponse;
      if (!r.bytes) return fail('OSM returned a successful status but no response content.', 'OSM-API-004');
      if (r.oversized) return fail('The response exceeded the configured safe processing limit.', 'OSM-APP-005');
      return pass(`Received ${r.bytes} bytes of content.`);
    }
  },
  {
    key: 'content-type',
    name: 'Response content type recognised',
    dependsOn: ['context-response'],
    async run(ctx) {
      const ct = ctx.contextResponse.contentType || '';
      if (/json/i.test(ct)) return pass(`Content type: ${ct}`);
      if (ctx.contextResponse.parseResult === 'json-wrapped' || ctx.contextResponse.parseResult === 'json') {
        return warn(`Content type "${ct || 'not supplied'}" is not JSON, but the body could still be interpreted.`, 'OSM-API-005');
      }
      return fail(`Content type "${ct || 'not supplied'}" was not recognised.`, 'OSM-API-005');
    }
  },
  {
    key: 'parsed',
    name: 'Response parsed',
    dependsOn: ['content-type'],
    async run(ctx) {
      const r = ctx.contextResponse;
      if (r.parseResult === 'json') return pass('The response was parsed as valid JSON.', { messageCode: 'OSM-PARSE-001' });
      if (r.parseResult === 'json-wrapped') return warn('A non-standard wrapper was detected around the JSON and was removed before parsing.', 'OSM-PARSE-003');
      if (r.parseResult === 'invalid-json') return fail('The response claimed to be JSON but could not be parsed.', 'OSM-PARSE-002');
      if (r.parseResult === 'empty') return fail('The response was empty.', 'OSM-API-004');
      return fail(`The response could not be interpreted (${r.parseResult}).`, 'OSM-API-005');
    }
  },
  {
    key: 'required-fields',
    name: 'Required response fields found',
    dependsOn: ['parsed'],
    async run(ctx) {
      ctx.extracted = contextLib.extract(ctx.contextResponse.data);
      const e = ctx.extracted;
      if (e.missingMandatory.length) {
        return fail(`Mandatory field(s) missing: ${e.missingMandatory.join(', ')}.`, 'OSM-PARSE-004', {
          technical: { missingMandatory: e.missingMandatory, missingOptional: e.missingOptional }
        });
      }
      if (e.missingOptional.length) {
        return warn(`Optional field(s) missing: ${e.missingOptional.join(', ')}.`, 'OSM-PARSE-004', {
          technical: { missingOptional: e.missingOptional }
        });
      }
      return pass('All mandatory and optional fields declared for this endpoint were found.', { messageCode: 'OSM-PARSE-001' });
    }
  },
  {
    key: 'user-identified',
    name: 'OSM user identified',
    dependsOn: ['required-fields'],
    async run(ctx) {
      const e = ctx.extracted;
      if (!e.osmUserIdMasked) return fail('OSM did not return a user identifier.', 'OSM-PARSE-004');
      const notes = [];
      if (!e.userNamePresent) notes.push('no name returned');
      if (!e.userEmailPresent) notes.push('no email returned');
      const summary = `OSM identified the user as ${e.osmUserIdMasked}${notes.length ? ` (${notes.join(', ')})` : ''}. Personal fields were checked for presence only and then discarded.`;
      return notes.length ? warn(summary, 'OSM-PARSE-004') : pass(summary);
    }
  },
  {
    key: 'roles-found',
    name: 'OSM roles found',
    dependsOn: ['required-fields'],
    async run(ctx) {
      const count = ctx.extracted.sections.length;
      if (!count) return fail('OSM returned no roles or section memberships for this account.', 'OSM-PERM-002');
      return pass(`${count} role/section membership${count === 1 ? '' : 's'} returned.`);
    }
  },
  {
    key: 'groups-found',
    name: 'OSM groups found',
    dependsOn: ['roles-found'],
    async run(ctx) {
      const groups = ctx.extracted.groups;
      if (!groups.length) return warn('No group information was returned, although sections were found.', 'OSM-PARSE-004');
      return pass(`${groups.length} group${groups.length === 1 ? '' : 's'}: ${groups.map((g) => g.groupName).join(', ')}.`);
    }
  },
  {
    key: 'sections-found',
    name: 'OSM sections found',
    dependsOn: ['roles-found'],
    async run(ctx) {
      const sections = ctx.extracted.sections;
      if (!sections.length) return fail('No usable sections were returned.', 'OSM-PERM-002');
      ctx.persistSections = true;
      return pass(`${sections.length} section${sections.length === 1 ? '' : 's'}: ${sections.map((s) => s.sectionName || 'unnamed').join(', ')}.`, { messageCode: 'OSM-PERM-001' });
    }
  },
  {
    key: 'section-permissions',
    name: 'Section permissions found',
    dependsOn: ['sections-found'],
    async run(ctx) {
      const e = ctx.extracted;
      const withPerms = e.sections.filter((s) => s.permissions.entries.length).length;
      if (!withPerms) return fail('No permission information was returned for any section.', 'OSM-PERM-003');
      const issues = [];
      if (e.unknownPermissionCategories) issues.push(`${e.unknownPermissionCategories} unknown categor${e.unknownPermissionCategories === 1 ? 'y' : 'ies'}`);
      if (e.unknownPermissionValues) issues.push(`${e.unknownPermissionValues} unknown value${e.unknownPermissionValues === 1 ? '' : 's'}`);
      const summary = `Permissions returned for ${withPerms} of ${e.sections.length} sections${issues.length ? `. ${issues.join(', ')} - these grant no access.` : '.'}`;
      return issues.length
        ? warn(summary, 'OSM-PERM-004', { technical: { warnings: e.permissionWarnings.slice(0, 20) } })
        : pass(summary);
    }
  },
  {
    key: 'active-section',
    name: 'Active section selected',
    dependsOn: ['sections-found'],
    async run(ctx) {
      const stored = db.prepare('SELECT * FROM osm_section_refs WHERE connection_id = ? ORDER BY id').all(ctx.connection.id);
      const selectedId = ctx.connection.selected_section_ref;
      let chosen = stored.find((s) => s.id === selectedId) || null;
      let note = '';

      if (!chosen) {
        // FR-PERM-010 then FR-PERM-009: prefer the OSM default, otherwise auto-select
        // only when exactly one usable section exists, and say so.
        chosen = stored.find((s) => s.is_default) || null;
        if (chosen) note = ' OSM identified this as the default section, so it was selected automatically.';
        else if (stored.length === 1) { chosen = stored[0]; note = ' Only one usable section exists, so it was selected automatically.'; }
      }
      if (!chosen) {
        return warn(`No active section is selected. ${stored.length} sections are available - choose one before running section tests.`, 'OSM-PERM-003');
      }
      db.prepare('UPDATE osm_connections SET selected_section_ref = ? WHERE id = ?').run(chosen.id, ctx.connection.id);
      db.prepare('UPDATE test_sessions SET section_ref_id = ? WHERE id = ?').run(chosen.id, ctx.testSessionId);
      ctx.selectedSection = chosen;
      return pass(`Active section: ${chosen.section_name || 'unnamed'} (${chosen.section_id_masked}).${note}`);
    }
  },
  {
    key: 'readonly-test',
    name: 'Read only endpoint test completed',
    dependsOn: ['active-section'],
    async run(ctx) {
      const def = endpoints.byKey(ctx.proofEndpointKey || 'terms');
      const guard = endpoints.guard(def);
      if (!guard.allowed) return warn(`The proof test did not run: ${guard.reason}`, 'OSM-PERM-003');

      const url = endpoints.buildUrl(def, { sectionId: ctx.selectedSectionId });
      const r = await osmClient.send({
        url,
        headers: { Authorization: `${ctx.connection.token_type || 'Bearer'} ${ctx.accessToken}` },
        correlationId: ctx.correlationId,
        testSessionId: ctx.testSessionId,
        userId: ctx.user.id,
        label: def.name
      });
      ctx.proofResponse = r;

      if (r.blocked?.blocked) { ctx.stopAll = 'blocked'; return fail('OSM reported that this client is blocked.', 'OSM-API-012'); }
      if (r.outcome === 'rate-limited') { ctx.stopAll = 'rate-limited'; return fail('OSM reported that the request limit has been reached.', 'OSM-API-011'); }
      if (r.outcome === 'removed') { endpoints.markRemoved(def.key, 'Detected during a guided test.'); return fail(`${def.name}: OSM reported this operation has been removed.`, 'OSM-API-009'); }
      if (r.outcome === 'forbidden') return warn(`${def.name}: OSM refused this request. Your OSM role may not allow it for this section.`, 'OSM-API-007');
      if (r.outcome !== 'success') return fail(`${def.name}: ${r.httpStatus ? `HTTP ${r.httpStatus}` : r.outcome}.`, r.code);

      const schema = endpoints.validateSchema(def, r.data);
      endpoints.markVerified(def.key);
      if (schema.result === 'missing-fields') {
        return warn(`${def.name} responded, but expected field(s) were missing: ${schema.missing.join(', ')}.`, 'OSM-API-003', { technical: schema });
      }
      return pass(`${def.name} completed successfully (HTTP ${r.httpStatus}, ${r.durationMs} ms, ${r.bytes} bytes).`, { messageCode: 'OSM-API-002', technical: schema });
    }
  },
  {
    key: 'rate-limit',
    name: 'Rate limit information inspected',
    dependsOn: ['auth-request'],
    async run(ctx) {
      const summary = breaker.rateSummary();
      const last = ctx.proofResponse || ctx.contextResponse;
      if (!last?.rate?.present) {
        return warn(`OSM did not return rate limit headers. Local counter: ${summary.localCount} of ${summary.localThreshold}.`, 'OSM-TEST-002', { technical: summary });
      }
      if (summary.warningLevel) {
        return warn(`Rate limit ${summary.usedPercent}% of the local safety threshold used (OSM reports ${summary.reportedRemaining} of ${summary.reportedLimit} remaining).`, 'OSM-API-011', { technical: summary });
      }
      return pass(`OSM reports ${summary.reportedRemaining ?? 'an unknown number of'} of ${summary.reportedLimit ?? 'unknown'} requests remaining. Local counter: ${summary.localCount} of ${summary.localThreshold}.`, { technical: summary });
    }
  },
  {
    key: 'deprecation',
    name: 'Deprecation headers inspected',
    dependsOn: ['auth-request'],
    async run(ctx) {
      const responses = [ctx.contextResponse, ctx.proofResponse].filter(Boolean);
      const deprecated = responses.filter((r) => r.deprecation?.deprecated);
      if (!deprecated.length) return pass('No deprecation or sunset headers were returned.');
      return warn(`${deprecated.length} response(s) carried a deprecation or sunset header.`, 'OSM-API-013', {
        technical: deprecated.map((r) => ({ label: r.label, ...r.deprecation }))
      });
    }
  },
  {
    key: 'blocked',
    name: 'Blocked-client headers inspected',
    dependsOn: ['auth-request'],
    async run(ctx) {
      const responses = [ctx.contextResponse, ctx.proofResponse].filter(Boolean);
      const blocked = responses.find((r) => r.blocked?.blocked);
      if (blocked) return fail('A blocked-client indicator was returned. All further OSM requests have been stopped.', 'OSM-API-012');
      const state = breaker.state();
      if (state.state === 'critical') return fail('The application is in a blocked-client state from an earlier test.', 'OSM-API-012');
      return pass('No blocked-client indicator was returned.');
    }
  },
  {
    key: 'report',
    name: 'Diagnostic report prepared',
    dependsOn: [],
    async run(ctx) {
      const rows = db.prepare('SELECT COUNT(*) AS n FROM request_log WHERE test_session_id = ?').get(ctx.testSessionId);
      return pass(`A sanitised diagnostic report is available covering ${rows.n} recorded request${rows.n === 1 ? '' : 's'}.`);
    }
  }
];

function safeHost(url) {
  try { return new URL(url).host; } catch { return '[unparsable]'; }
}

// --- session state -----------------------------------------------------------

const live = new Map(); // sessionRef -> in-flight state

const insertSession = db.prepare('INSERT INTO test_sessions (session_ref, app_user_id, kind) VALUES (?, ?, ?)');
const insertResult = db.prepare(`
  INSERT INTO test_results (test_session_id, stage_key, stage_name, status, started_at,
    duration_ms, message_code, correlation_id, technical_summary, display_order)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const finishSession = db.prepare('UPDATE test_sessions SET ended_at = ?, overall_result = ?, warning_count = ?, failure_count = ? WHERE id = ?');

function snapshot(state) {
  return {
    sessionRef: state.sessionRef,
    correlationId: state.correlationId,
    running: state.running,
    cancelled: state.cancelled,
    overall: state.overall,
    startedAt: state.startedAt,
    primaryFailure: state.primaryFailure,
    message: state.message,
    stages: state.stages.map((s) => ({
      key: s.key, name: s.name, status: s.status, startedAt: s.startedAt,
      durationMs: s.durationMs, summary: s.summary, messageCode: s.messageCode,
      message: s.messageCode ? messages.build(s.messageCode, { correlationId: state.correlationId }) : null,
      technical: s.technical
    }))
  };
}

function persistSections(ctx) {
  db.prepare('DELETE FROM osm_section_refs WHERE connection_id = ?').run(ctx.connection.id);
  const stmt = db.prepare(`
    INSERT INTO osm_section_refs (connection_id, group_id_masked, group_name, section_id_masked,
      section_id_enc, section_name, section_type, is_default, permission_summary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const { encrypt } = require('./crypto');
  for (const s of ctx.extracted.sections) {
    stmt.run(
      ctx.connection.id, s.groupIdMasked, s.groupName, s.sectionIdMasked,
      encrypt(s.sectionIdRaw), s.sectionName, s.sectionType, s.isDefault ? 1 : 0,
      JSON.stringify({ summary: s.permissionSummary, entries: s.permissions.entries })
    );
  }
}

async function start(user, { proofEndpointKey = 'terms' } = {}) {
  const sessionRef = correlation.newSessionRef();
  const correlationId = correlation.newCorrelationId();
  insertSession.run(sessionRef, user.id, 'guided');
  const row = db.prepare('SELECT * FROM test_sessions WHERE session_ref = ?').get(sessionRef);

  const state = {
    sessionRef,
    correlationId,
    testSessionId: row.id,
    userId: user.id,
    running: true,
    cancelled: false,
    overall: null,
    startedAt: new Date().toISOString(),
    primaryFailure: null,
    message: null,
    stages: STAGES.map((s) => ({
      key: s.key, name: s.name, status: STATUS.WAITING,
      startedAt: null, durationMs: null, summary: null, messageCode: null, technical: null
    }))
  };
  live.set(sessionRef, state);

  audit.record({ userId: user.id, event: 'guided_test.started', outcome: 'started', correlationId });

  // Run in the background so the browser can poll for progress.
  run(state, user, proofEndpointKey).catch((err) => {
    console.error('[guided] unhandled error:', err);
    state.running = false;
    state.overall = 'Failed';
    state.message = messages.build('OSM-APP-004', { correlationId, detail: 'The guided test stopped unexpectedly.' });
  });

  return state;
}

async function run(state, user, proofEndpointKey) {
  const ctx = {
    user,
    connection: oauth.getConnection(user.id),
    correlationId: state.correlationId,
    testSessionId: state.testSessionId,
    proofEndpointKey,
    selectedSectionId: null
  };

  const outcomeByKey = new Map();

  for (let i = 0; i < STAGES.length; i += 1) {
    const def = STAGES[i];
    const stage = state.stages[i];

    if (state.cancelled) { stage.status = STATUS.CANCELLED; continue; }

    // FR-ERR-007: a dependency that did not pass means Skipped, not Failed.
    const blockedBy = (def.dependsOn || []).find((k) => {
      const o = outcomeByKey.get(k);
      return !o || o === STATUS.FAILED || o === STATUS.SKIPPED || o === STATUS.CANCELLED;
    });
    if (blockedBy || ctx.stopAll) {
      stage.status = STATUS.SKIPPED;
      stage.summary = ctx.stopAll
        ? `Skipped because testing stopped (${ctx.stopAll}).`
        : `Skipped because "${STAGES.find((s) => s.key === blockedBy)?.name || blockedBy}" did not pass.`;
      outcomeByKey.set(def.key, STATUS.SKIPPED);
      persistStage(state, stage, i);
      continue;
    }

    stage.status = STATUS.RUNNING;
    stage.startedAt = new Date().toISOString();
    const t0 = Date.now();
    let outcome;
    try {
      outcome = await def.run(ctx);
    } catch (err) {
      // FR-ERR-002: an unexpected exception becomes a safe message; the technical
      // detail goes to protected server logging only (FR-ERR-003, FR-ERR-004).
      console.error(`[guided] stage ${def.key} threw:`, err);
      outcome = fail('The application encountered an unexpected condition during this stage.', 'OSM-APP-004');
    }
    stage.durationMs = Date.now() - t0;

    if (state.cancelled) {
      stage.status = STATUS.CANCELLED;
      stage.summary = 'Cancelled before the result was recorded.';
      outcomeByKey.set(def.key, STATUS.CANCELLED);
      persistStage(state, stage, i);
      continue;
    }

    stage.status = outcome.status;
    stage.summary = outcome.summary;
    stage.messageCode = outcome.messageCode || null;
    stage.technical = outcome.technical ? redact.sanitise(outcome.technical).value : null;
    outcomeByKey.set(def.key, outcome.status);

    if (outcome.status === STATUS.FAILED && !state.primaryFailure) {
      // FR-ERR-006: the first meaningful error is the primary failure.
      state.primaryFailure = { stage: def.name, code: outcome.messageCode, summary: outcome.summary };
    }
    persistStage(state, stage, i);

    // Persisting sections has to happen between the sections stage and the
    // active-section stage, which reads them back.
    if (def.key === 'sections-found' && ctx.persistSections) {
      persistSections(ctx);
      ctx.connection = oauth.getConnection(user.id);
    }
    if (def.key === 'active-section' && ctx.selectedSection) {
      const { decrypt } = require('./crypto');
      ctx.selectedSectionId = decrypt(ctx.selectedSection.section_id_enc);
    }
  }

  const counts = state.stages.reduce((acc, s) => {
    if (s.status === STATUS.WARNING) acc.warnings += 1;
    if (s.status === STATUS.FAILED) acc.failures += 1;
    if (s.status === STATUS.CANCELLED) acc.cancelled += 1;
    return acc;
  }, { warnings: 0, failures: 0, cancelled: 0 });

  // FR-TEST-009
  let overall;
  if (state.cancelled || counts.cancelled) overall = 'Cancelled';
  else if (counts.failures) overall = 'Failed';
  else if (counts.warnings) overall = 'Passed with warnings';
  else overall = 'Passed';

  const code = overall === 'Passed' ? 'OSM-TEST-001'
    : overall === 'Passed with warnings' ? 'OSM-TEST-002'
      : overall === 'Failed' ? 'OSM-TEST-003' : 'OSM-TEST-004';

  state.overall = overall;
  state.running = false;
  state.message = messages.build(code, {
    correlationId: state.correlationId,
    testStopped: overall === 'Failed' || overall === 'Cancelled',
    laterStagesSkipped: state.stages.some((s) => s.status === STATUS.SKIPPED)
  });

  finishSession.run(new Date().toISOString(), overall, counts.warnings, counts.failures, state.testSessionId);
  if (overall === 'Passed' || overall === 'Passed with warnings') {
    db.prepare("UPDATE app_users SET last_successful_test_at = datetime('now') WHERE id = ?").run(user.id);
    if (ctx.connection) oauth.touchSuccess.run(ctx.connection.id);
  }
  audit.record({
    userId: user.id, event: 'guided_test.completed', outcome: overall,
    correlationId: state.correlationId, messageCode: code
  });
}

function persistStage(state, stage, order) {
  try {
    insertResult.run(
      state.testSessionId, stage.key, stage.name, stage.status, stage.startedAt,
      stage.durationMs, stage.messageCode, state.correlationId,
      stage.summary ? String(stage.summary).slice(0, 1000) : null, order
    );
  } catch (err) {
    console.error('[guided] failed to persist stage result:', err.message);
  }
}

function get(sessionRef) {
  return live.get(sessionRef) || null;
}

/** FR-TEST-006/007: cancellation stops any request that has not yet been sent. */
function cancel(sessionRef, userId) {
  const state = live.get(sessionRef);
  if (!state || state.userId !== userId) return null;
  if (!state.running) return state;
  state.cancelled = true;
  return state;
}

function stageDefinitions() {
  return STAGES.map((s, i) => ({ key: s.key, name: s.name, order: i, dependsOn: s.dependsOn || [] }));
}

module.exports = { start, get, cancel, snapshot, stageDefinitions, STATUS, STAGES };
