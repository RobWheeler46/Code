// The OSM HTTP client.
//
// Every outbound call goes through `send`, which is where the FRD's safety rules
// live: approved hosts only (FR-SEC-010/011), no automatic redirect following
// (FR-SEC-012), read-only methods for API tests (FR-API-003/004/006), a size cap
// (FR-ERR-020), defensive parsing (FR-PARSE-003), rate-limit, deprecation and
// blocked-client inspection, and the retry rules in FRD 15.2.

const db = require('../db');
const config = require('./config');
const breaker = require('./breaker');
const redact = require('./redact');
const correlation = require('./correlation');

const READ_ONLY_METHODS = new Set(['GET', 'HEAD']);

const insertLog = db.prepare(`
  INSERT INTO request_log (
    correlation_id, attempt_id, test_session_id, method, destination, query_param_names,
    request_content_type, timeout_ms, attempt_number, duration_ms, response_status,
    response_content_type, response_headers, response_bytes, parse_result, schema_result,
    redaction_count, truncated, preview, message_code
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function hostAllowed(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') {
      const local = ['localhost', '127.0.0.1'].includes(u.hostname);
      if (!local) return false;
    }
    return config.allowedHosts().includes(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

// --- header inspection -------------------------------------------------------

function readRateLimitHeaders(headers) {
  const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
  const limit = num(headers.get('x-ratelimit-limit') ?? headers.get('ratelimit-limit'));
  const remaining = num(headers.get('x-ratelimit-remaining') ?? headers.get('ratelimit-remaining'));
  const resetRaw = headers.get('x-ratelimit-reset') ?? headers.get('ratelimit-reset');
  let reset = null;
  if (resetRaw) {
    const asNumber = Number(resetRaw);
    // OSM has been observed to report either epoch seconds or seconds remaining.
    if (Number.isFinite(asNumber)) {
      reset = asNumber > 1e9
        ? new Date(asNumber * 1000).toISOString()
        : new Date(Date.now() + asNumber * 1000).toISOString();
    } else {
      reset = String(resetRaw);
    }
  }
  return {
    limit: Number.isFinite(limit) ? limit : null,
    remaining: Number.isFinite(remaining) ? remaining : null,
    reset,
    present: limit !== null || remaining !== null || reset !== null
  };
}

function readRetryAfter(headers) {
  const raw = headers.get('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return new Date(Date.now() + seconds * 1000).toISOString();
  const asDate = Date.parse(raw);
  return Number.isNaN(asDate) ? null : new Date(asDate).toISOString();
}

function readDeprecation(headers) {
  const deprecation = headers.get('deprecation') || headers.get('x-deprecated') || null;
  const sunset = headers.get('sunset') || null;
  const warning = headers.get('warning') || null;
  const deprecated = !!(deprecation || sunset || (warning && /deprecat/i.test(warning)));
  return { deprecated, deprecation, sunset, warning };
}

function readBlocked(headers, bodyText) {
  const header = headers.get('x-blocked') || headers.get('x-osm-blocked') || null;
  if (header && !/^(0|false|no)$/i.test(String(header).trim())) {
    return { blocked: true, source: 'header', detail: String(header).slice(0, 200) };
  }
  if (typeof bodyText === 'string' && bodyText.length < 4000) {
    if (/\b(blocked|you have been blocked|client is blocked)\b/i.test(bodyText)) {
      return { blocked: true, source: 'body', detail: 'Response body reported that the client is blocked.' };
    }
  }
  return { blocked: false };
}

// --- parsing -----------------------------------------------------------------

/**
 * Defensive parse. Some OSM endpoints have historically returned JSON wrapped in
 * JavaScript, so a wrapper is detected and unwrapped rather than treated as invalid
 * (FR-PARSE-003).
 */
function parseBody(text, contentType) {
  if (text === null || text === undefined || text.trim() === '') {
    return { result: 'empty', data: null, wrapped: false, code: 'OSM-API-004' };
  }
  const looksJson = /json/i.test(contentType || '') || /^[\s﻿]*[[{]/.test(text);

  if (looksJson) {
    try {
      return { result: 'json', data: JSON.parse(text), wrapped: false, code: 'OSM-PARSE-001' };
    } catch {
      // fall through to wrapper detection
    }
  }

  // Wrapper forms observed in the wild: callback({...}); / var x = {...}; / stray
  // markup before or after the payload.
  const firstBrace = text.search(/[[{]/);
  const lastBrace = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = text.slice(firstBrace, lastBrace + 1);
    try {
      const data = JSON.parse(candidate);
      return { result: 'json-wrapped', data, wrapped: true, code: 'OSM-PARSE-003' };
    } catch {
      // not recoverable
    }
  }

  if (looksJson) return { result: 'invalid-json', data: null, wrapped: false, code: 'OSM-PARSE-002' };
  return { result: 'unsupported-content-type', data: null, wrapped: false, code: 'OSM-API-005' };
}

// --- status classification ---------------------------------------------------

function classifyStatus(status) {
  if (status >= 200 && status < 300) return { outcome: 'success', code: 'OSM-API-002', retryable: false };
  if (status === 400 || status === 422) return { outcome: 'validation', code: 'OSM-API-010', retryable: false };
  if (status === 401) return { outcome: 'unauthenticated', code: 'OSM-API-006', retryable: false };
  if (status === 403) return { outcome: 'forbidden', code: 'OSM-API-007', retryable: false };
  if (status === 404) return { outcome: 'not-found', code: 'OSM-API-008', retryable: false };
  if (status === 410) return { outcome: 'removed', code: 'OSM-API-009', retryable: false };
  if (status === 429) return { outcome: 'rate-limited', code: 'OSM-API-011', retryable: false };
  if (status === 500) return { outcome: 'server-error', code: 'OSM-API-014', retryable: true };
  if (status === 502 || status === 503 || status === 504) return { outcome: 'unavailable', code: 'OSM-API-015', retryable: true };
  if (status >= 300 && status < 400) return { outcome: 'redirect', code: 'OSM-API-005', retryable: false };
  return { outcome: 'unexpected', code: 'OSM-API-005', retryable: false };
}

function classifyNetworkError(err) {
  const code = err?.cause?.code || err?.code || '';
  const name = err?.name || '';
  const text = `${name} ${code} ${err?.message || ''}`;
  if (name === 'AbortError' || /timeout|ETIMEDOUT|UND_ERR_(HEADERS|BODY)_TIMEOUT|ConnectTimeout/i.test(text)) {
    return { outcome: 'timeout', code: 'OSM-NET-002', retryable: true };
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(text)) {
    return { outcome: 'dns', code: 'OSM-NET-001', retryable: true };
  }
  if (/CERT|TLS|SSL|DEPTH_ZERO|SELF_SIGNED|HANDSHAKE/i.test(text)) {
    return { outcome: 'tls', code: 'OSM-NET-003', retryable: false };
  }
  if (/ECONNRESET|ECONNREFUSED|EPIPE|socket hang up|UND_ERR_SOCKET/i.test(text)) {
    return { outcome: 'interrupted', code: 'OSM-NET-004', retryable: true };
  }
  return { outcome: 'network', code: 'OSM-NET-004', retryable: true };
}

// Retry is only ever considered for these outcomes, and never for anything in
// FR-ERR-011 (auth, validation, permission, 410, 429, blocked, schema, writes).
const RETRYABLE_OUTCOMES = new Set(['timeout', 'dns', 'interrupted', 'network', 'server-error', 'unavailable']);

function backoffMs(attempt) {
  const base = Math.min(2000 * 2 ** (attempt - 1), 8000);
  return base + Math.floor(Math.random() * 400); // short exponential delay with jitter (FR-ERR-013)
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- body reading with a hard size cap --------------------------------------

async function readCapped(response, maxBytes) {
  if (!response.body) return { text: '', bytes: 0, truncated: false };
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      chunks.push(value.slice(0, Math.max(0, value.byteLength - (bytes - maxBytes))));
      truncated = true;
      try { await reader.cancel(); } catch { /* already closed */ }
      bytes = maxBytes;
      break;
    }
    chunks.push(value);
  }
  const text = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
  return { text, bytes, truncated };
}

/**
 * Send one OSM request, including any permitted retry.
 *
 * @param {object} opts
 *   url             absolute URL (must be an approved host)
 *   method          GET/HEAD for API tests; POST only for the token endpoint
 *   headers         extra request headers
 *   body            URLSearchParams for the token endpoint
 *   allowWrite      set true only by the token exchange, never by an API test
 *   testSessionId   links the sanitised request log to a test session
 *   correlationId   reuse to group retries under one parent id (FR-ERR-014)
 *   userId          for audit
 */
async function send(opts) {
  const {
    url, method = 'GET', headers = {}, body = null, allowWrite = false,
    testSessionId = null, userId = null, label = null
  } = opts;

  const corrId = opts.correlationId || correlation.newCorrelationId();
  const timeout = config.get('requestTimeoutMs') || 15000;
  const maxBytes = config.get('maxResponseBytes') || 1048576;
  const maxRetries = Math.max(0, config.get('maxAutomaticRetries') ?? 1);

  const upperMethod = String(method).toUpperCase();
  if (!allowWrite && !READ_ONLY_METHODS.has(upperMethod)) {
    // FR-API-003 / FR-API-004 / FR-API-006 - release 1 cannot issue a write.
    return failure('OSM-APP-004', corrId, `Refused: ${upperMethod} is not an approved read operation for a test endpoint.`, { label });
  }
  if (!hostAllowed(url)) {
    return failure('OSM-APP-006', corrId, 'Destination host is not on the approved OSM hostname list.', { label });
  }

  const gate = breaker.check();
  if (!gate.allowed) {
    return failure(gate.code, corrId, gate.breaker.reason || 'OSM calls are currently suspended.', { label, breaker: gate.breaker, stopped: true });
  }

  const { destination, queryParamNames } = redact.sanitiseUrl(url);
  let attempt = 0;

  for (;;) {
    attempt += 1;
    const attemptId = correlation.newAttemptId(corrId, attempt);
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    let record;
    try {
      breaker.countRequest(); // local request counter feeds the rate-limit safety threshold
      const response = await fetch(url, {
        method: upperMethod,
        headers: { Accept: 'application/json', 'User-Agent': 'OSM-Connect-Test-Harness/1.0', ...headers },
        body,
        signal: controller.signal,
        redirect: 'manual' // FR-SEC-012 - a redirect is reported, never blindly followed
      });
      clearTimeout(timer);

      const { text, bytes, truncated } = await readCapped(response, maxBytes);
      const durationMs = Date.now() - startedAt;
      const contentType = response.headers.get('content-type') || '';

      const rate = readRateLimitHeaders(response.headers);
      if (rate.present) breaker.recordReported(rate);
      const retryAfter = readRetryAfter(response.headers);
      const deprecation = readDeprecation(response.headers);
      const blocked = readBlocked(response.headers, text);
      const status = classifyStatus(response.status);
      const parsed = parseBody(text, contentType);
      const preview = redact.sanitiseBodyPreview(text);
      const safeHeaders = redact.sanitiseHeaders(response.headers);

      record = {
        ok: status.outcome === 'success' && !blocked.blocked,
        correlationId: corrId,
        attemptId,
        attempt,
        durationMs,
        httpStatus: response.status,
        contentType,
        headers: safeHeaders,
        bytes,
        oversized: truncated,
        parseResult: parsed.result,
        wrapped: parsed.wrapped,
        data: parsed.data,
        rate,
        retryAfter,
        deprecation,
        blocked,
        outcome: status.outcome,
        code: blocked.blocked ? 'OSM-API-012' : (status.outcome === 'success' ? parsed.code : status.code),
        preview: preview.preview,
        redactions: preview.redactions,
        label,
        slow: durationMs > (config.get('slowResponseWarningMs') || 3000)
      };

      if (truncated) {
        record.ok = false;
        record.code = 'OSM-APP-005';
        record.parseResult = 'truncated';
      }
      if (status.outcome === 'redirect') {
        record.redirectLocation = redact.sanitiseUrl(response.headers.get('location') || '').destination;
      }

      logRequest(record, { testSessionId, destination, queryParamNames, timeout, method: upperMethod, requestContentType: headers['Content-Type'] || null });

      if (blocked.blocked) {
        breaker.trip(blocked.detail || 'OSM reported a blocked client.', { userId, correlationId: corrId });
        record.stopped = true;
        return record;
      }
      if (status.outcome === 'rate-limited') {
        breaker.recordReported({ ...rate, reset: retryAfter || rate.reset });
        record.stopped = true;
        return record;
      }
      if (record.ok) {
        breaker.recordSuccess();
        return record;
      }

      breaker.recordFailure(`HTTP ${response.status} from OSM`, { userId, correlationId: corrId });

      if (RETRYABLE_OUTCOMES.has(status.outcome) && attempt <= maxRetries) {
        await wait(backoffMs(attempt));
        continue;
      }
      return record;
    } catch (err) {
      clearTimeout(timer);
      const durationMs = Date.now() - startedAt;
      const net = classifyNetworkError(err);
      record = {
        ok: false,
        correlationId: corrId,
        attemptId,
        attempt,
        durationMs,
        httpStatus: null,
        contentType: null,
        headers: {},
        bytes: 0,
        parseResult: 'no-response',
        data: null,
        rate: { present: false },
        retryAfter: null,
        deprecation: { deprecated: false },
        blocked: { blocked: false },
        outcome: net.outcome,
        code: net.code,
        preview: '',
        redactions: 0,
        label,
        networkError: net.outcome
      };
      logRequest(record, { testSessionId, destination, queryParamNames, timeout, method: upperMethod, requestContentType: headers['Content-Type'] || null });
      breaker.recordFailure(`${net.outcome} contacting OSM`, { userId, correlationId: corrId });

      if (RETRYABLE_OUTCOMES.has(net.outcome) && attempt <= maxRetries) {
        await wait(backoffMs(attempt));
        continue;
      }
      return record;
    }
  }
}

function failure(code, correlationId, detail, extra = {}) {
  return {
    ok: false, correlationId, attempt: 0, durationMs: 0, httpStatus: null,
    contentType: null, headers: {}, bytes: 0, parseResult: 'not-sent', data: null,
    rate: { present: false }, retryAfter: null, deprecation: { deprecated: false },
    blocked: { blocked: code === 'OSM-API-012' }, outcome: 'not-sent', code,
    preview: '', redactions: 0, detail, ...extra
  };
}

function logRequest(record, meta) {
  try {
    insertLog.run(
      record.correlationId, record.attemptId || `${record.correlationId}#0`, meta.testSessionId,
      meta.method, meta.destination, JSON.stringify(meta.queryParamNames || []),
      meta.requestContentType, meta.timeout, record.attempt, record.durationMs,
      record.httpStatus, record.contentType, JSON.stringify(record.headers || {}),
      record.bytes, record.parseResult, record.schemaResult || null,
      record.redactions || 0, record.oversized ? 1 : 0, record.preview || '', record.code
    );
  } catch (err) {
    // FR-ERR-005 - a diagnostic logging failure must not expose the original response.
    console.error('[diagnostics] failed to store sanitised request record:', err.message);
  }
}

function requestLogFor(testSessionId) {
  return db.prepare('SELECT * FROM request_log WHERE test_session_id = ? ORDER BY id ASC').all(testSessionId);
}

function requestLogByCorrelation(correlationId) {
  return db.prepare('SELECT * FROM request_log WHERE correlation_id = ? ORDER BY id ASC').all(correlationId);
}

module.exports = {
  send, hostAllowed, parseBody, classifyStatus, classifyNetworkError,
  readRateLimitHeaders, readDeprecation, readBlocked, readRetryAfter,
  requestLogFor, requestLogByCorrelation
};
