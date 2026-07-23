// Sanitised diagnostic report (FRD 17).
//
// The report is assembled from stored, already-sanitised records. Nothing in
// section 17.2 is read at all - there is no code path here that touches a token,
// the client secret, a raw response body or a member record. Before the report is
// returned it is checked once more against the configured secrets (AC-011).

const db = require('../db');
const config = require('./config');
const breaker = require('./breaker');
const health = require('./health');
const messages = require('./messages');
const { assertNoSecrets } = require('./redact');
const { ukFormat } = require('./times');

const APP_VERSION = require('../../package.json').version;

function environmentName() {
  return process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV || 'development';
}

function build(sessionRef, user) {
  const session = db.prepare('SELECT * FROM test_sessions WHERE session_ref = ?').get(sessionRef);
  if (!session) return null;
  // A Tester may only export their own session (FRD 9.1).
  if (user.role === 'tester' && session.app_user_id !== user.id) return null;

  const results = db.prepare('SELECT * FROM test_results WHERE test_session_id = ? ORDER BY display_order, id').all(session.id);
  const requests = db.prepare('SELECT * FROM request_log WHERE test_session_id = ? ORDER BY id').all(session.id);
  const connection = db.prepare('SELECT * FROM osm_connections WHERE app_user_id = ? ORDER BY id DESC LIMIT 1').get(session.app_user_id);
  const sections = connection
    ? db.prepare('SELECT * FROM osm_section_refs WHERE connection_id = ?').all(connection.id)
    : [];
  const selected = session.section_ref_id
    ? sections.find((s) => s.id === session.section_ref_id) || null
    : null;

  const refreshResult = results.find((r) => r.stage_key === 'refresh-capability');
  const tokenResult = results.find((r) => r.stage_key === 'token-available');

  const permissionCategories = [...new Set(sections.flatMap((s) => {
    try { return (JSON.parse(s.permission_summary)?.entries || []).map((e) => e.category); }
    catch { return []; }
  }))];

  const report = {
    reportFormatVersion: 1,
    sanitisation: 'Applied. Credentials, tokens, identifiers and personal information are removed or masked.',
    application: {
      name: 'OSM Connect Test Harness',
      version: APP_VERSION,
      environment: environmentName()
    },
    test: {
      sessionReference: session.session_ref,
      startedAt: session.started_at,
      startedAtUk: ukFormat(session.started_at),
      endedAt: session.ended_at,
      overallResult: session.overall_result || 'In progress',
      warningCount: session.warning_count,
      failureCount: session.failure_count,
      userRole: user.role
    },
    connection: {
      status: connection?.status || 'none',
      connectedAt: connection?.connected_at || null,
      lastSuccessAt: connection?.last_success_at || null,
      tokenAcquired: !!tokenResult && tokenResult.status === 'Passed',
      refreshAttempted: !!refreshResult && refreshResult.status !== 'Skipped',
      refreshSucceeded: !!refreshResult && refreshResult.message_code === 'OSM-TOKEN-006',
      scope: connection?.scope || null
    },
    access: {
      groupsFound: new Set(sections.map((s) => s.group_id_masked || s.group_name)).size,
      sectionsFound: sections.length,
      selectedSectionType: selected?.section_type || null,
      selectedSectionMaskedId: selected?.section_id_masked || null,
      maskedGroupIdentifiers: [...new Set(sections.map((s) => s.group_id_masked).filter(Boolean))],
      maskedSectionIdentifiers: sections.map((s) => s.section_id_masked).filter(Boolean),
      permissionCategories
    },
    stages: results.map((r) => ({
      stage: r.stage_name,
      status: r.status,
      startedAt: r.started_at,
      durationMs: r.duration_ms,
      messageCode: r.message_code,
      correlationId: r.correlation_id,
      summary: r.technical_summary
    })),
    requests: requests.map((r) => ({
      correlationId: r.correlation_id,
      attemptId: r.attempt_id,
      method: r.method,
      destination: r.destination,
      queryParameterNames: safeParse(r.query_param_names, []),
      httpStatus: r.response_status,
      contentType: r.response_content_type,
      responseBytes: r.response_bytes,
      durationMs: r.duration_ms,
      parseResult: r.parse_result,
      schemaResult: r.schema_result,
      headers: safeParse(r.response_headers, {}),
      redactionsApplied: r.redaction_count,
      truncated: !!r.truncated,
      messageCode: r.message_code
    })),
    rateLimit: breaker.rateSummary(),
    circuitBreaker: breaker.state(),
    deprecationWarnings: results.filter((r) => r.message_code === 'OSM-API-013').map((r) => r.technical_summary),
    blockIndicators: results.filter((r) => r.message_code === 'OSM-API-012').map((r) => r.technical_summary),
    messageCodesSeen: [...new Set(results.map((r) => r.message_code).filter(Boolean))],
    recommendedActions: recommendations(results),
    excluded: [
      'Passwords', 'Client secret', 'Access token', 'Refresh token', 'Authorisation code',
      'Security state value', 'Cookies', 'Full personal names', 'Dates of birth', 'Addresses',
      'Medical information', 'Contact details', 'Payment details', 'Free text member notes',
      'Full unredacted request or response bodies'
    ],
    generatedAt: new Date().toISOString(),
    generatedAtUk: ukFormat(new Date().toISOString())
  };

  // Final guard before the report leaves the server.
  if (!assertNoSecrets(report, config.secretValues())) {
    return { error: 'The report was withheld because a redaction check failed. Contact an administrator.' };
  }
  return report;
}

function recommendations(results) {
  const out = [];
  const firstFailure = results.find((r) => r.status === 'Failed');
  if (firstFailure) {
    out.push(`Investigate the first failed stage: ${firstFailure.stage_name} (${firstFailure.message_code || 'no code'}).`);
    const msg = firstFailure.message_code ? messages.build(firstFailure.message_code) : null;
    if (msg) out.push(...msg.whatYouCanDo);
  }
  for (const r of results.filter((x) => x.status === 'Passed with warning')) {
    const msg = r.message_code ? messages.build(r.message_code) : null;
    if (msg?.whatYouCanDo?.length) out.push(`${r.stage_name}: ${msg.whatYouCanDo[0]}`);
  }
  if (!out.length) out.push('No action required. The connection test completed without failures or warnings.');
  return [...new Set(out)];
}

function safeParse(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

/** Plain text support report (FRD 17.3). */
function toText(report) {
  const L = [];
  const rule = '='.repeat(70);
  L.push(rule, 'OSM CONNECT TEST HARNESS - SANITISED DIAGNOSTIC REPORT', rule, '');
  L.push(`Generated:          ${report.generatedAtUk}`);
  L.push(`Application:        ${report.application.name} v${report.application.version}`);
  L.push(`Environment:        ${report.application.environment}`);
  L.push(`Sanitisation:       ${report.sanitisation}`, '');

  L.push('-- TEST SESSION ' + '-'.repeat(54));
  L.push(`Session reference:  ${report.test.sessionReference}`);
  L.push(`Started:            ${report.test.startedAtUk}`);
  L.push(`Overall result:     ${report.test.overallResult}`);
  L.push(`Warnings / errors:  ${report.test.warningCount} / ${report.test.failureCount}`);
  L.push(`Reporting user:     role "${report.test.userRole}"`, '');

  L.push('-- OSM CONNECTION ' + '-'.repeat(52));
  L.push(`Status:             ${report.connection.status}`);
  L.push(`Token acquired:     ${yn(report.connection.tokenAcquired)}`);
  L.push(`Refresh attempted:  ${yn(report.connection.refreshAttempted)}`);
  L.push(`Refresh succeeded:  ${yn(report.connection.refreshSucceeded)}`);
  L.push(`Scope:              ${report.connection.scope || 'not reported'}`, '');

  L.push('-- ACCESS ' + '-'.repeat(60));
  L.push(`Groups found:       ${report.access.groupsFound}`);
  L.push(`Sections found:     ${report.access.sectionsFound}`);
  L.push(`Selected type:      ${report.access.selectedSectionType || 'none selected'}`);
  L.push(`Masked section ids: ${report.access.maskedSectionIdentifiers.join(', ') || 'none'}`);
  L.push(`Permission types:   ${report.access.permissionCategories.join(', ') || 'none returned'}`, '');

  L.push('-- STAGES ' + '-'.repeat(60));
  for (const s of report.stages) {
    L.push(`[${s.status.toUpperCase().padEnd(18)}] ${s.stage}`);
    if (s.summary) L.push(`    ${s.summary}`);
    if (s.messageCode) L.push(`    Message code: ${s.messageCode}   Correlation: ${s.correlationId}   ${s.durationMs ?? '-'} ms`);
  }
  L.push('');

  L.push('-- REQUESTS ' + '-'.repeat(58));
  if (!report.requests.length) L.push('No OSM requests were recorded for this session.');
  for (const r of report.requests) {
    L.push(`${r.attemptId}  ${r.method} ${r.destination}`);
    L.push(`    status=${r.httpStatus ?? 'none'}  type=${r.contentType || 'none'}  bytes=${r.responseBytes ?? 0}  ${r.durationMs ?? '-'} ms`);
    L.push(`    parse=${r.parseResult}  params=[${r.queryParameterNames.join(', ')}]  redactions=${r.redactionsApplied}  code=${r.messageCode}`);
  }
  L.push('');

  L.push('-- RATE LIMIT ' + '-'.repeat(56));
  L.push(`Reported limit:     ${report.rateLimit.reportedLimit ?? 'not returned'}`);
  L.push(`Reported remaining: ${report.rateLimit.reportedRemaining ?? 'not returned'}`);
  L.push(`Reported reset:     ${report.rateLimit.reportedReset ?? 'not returned'}`);
  L.push(`Local count:        ${report.rateLimit.localCount} of ${report.rateLimit.localThreshold}`);
  L.push(`Circuit breaker:    ${report.circuitBreaker.state}${report.circuitBreaker.reason ? ` (${report.circuitBreaker.reason})` : ''}`, '');

  L.push('-- RECOMMENDED NEXT ACTIONS ' + '-'.repeat(42));
  report.recommendedActions.forEach((a, i) => L.push(`${i + 1}. ${a}`));
  L.push('');

  L.push('-- EXCLUDED FROM THIS REPORT ' + '-'.repeat(41));
  L.push(report.excluded.join('; '));
  L.push('', rule);
  return L.join('\n');
}

function yn(v) { return v ? 'Yes' : 'No'; }

function healthSnapshot() {
  return { ...health.check(), environment: environmentName(), version: APP_VERSION };
}

module.exports = { build, toText, healthSnapshot, APP_VERSION, environmentName };
