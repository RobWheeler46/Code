// Central redaction (FR-REQ-003, FR-PRIV-006, AC-011).
//
// Everything that leaves the server for display, export or logging goes through
// here first. Redaction is deny-by-default on key name: an unrecognised key whose
// name resembles anything personal is redacted rather than shown.

const REDACTED = '[redacted]';
const REMOVED = '[removed: personal data]';

// Key-name patterns that must always be redacted.
const CREDENTIAL_KEYS = [
  /token/i, /secret/i, /password/i, /passwd/i, /\bpwd\b/i, /authoriz/i, /authoris/i,
  /\bcode\b/i, /cookie/i, /session/i, /\bstate\b/i, /bearer/i, /api[-_]?key/i,
  /credential/i, /signature/i, /security[-_]?answer/i
];

const PERSONAL_KEYS = [
  /first[-_]?name/i, /last[-_]?name/i, /sur[-_]?name/i, /full[-_]?name/i, /\bname\b/i,
  /dob/i, /date[-_]?of[-_]?birth/i, /birth/i, /age\b/i,
  /email/i, /phone/i, /mobile/i, /telephone/i, /contact/i,
  /address/i, /postcode/i, /post[-_]?code/i, /\bzip\b/i,
  /medical/i, /allerg/i, /dietary/i, /disabilit/i, /doctor/i, /nhs/i,
  /payment/i, /card/i, /iban/i, /sort[-_]?code/i, /account[-_]?number/i,
  /\bnotes?\b/i, /comment/i, /free[-_]?text/i, /photo/i, /avatar/i, /consent/i,
  /gender/i, /ethnic/i, /religio/i, /guardian/i, /parent/i, /emergency/i
];

// Keys that are safe and diagnostically useful, checked before the personal list so
// that e.g. "sectionname" and "groupname" survive the broad /name/ pattern.
const ALLOW_KEYS = [
  /^section_?name$/i, /^group_?name$/i, /^term_?name$/i, /^section_?type$/i,
  /^type$/i, /^status$/i, /^error$/i, /^message$/i, /^code$/i
];

// Identifier keys: kept but masked, because the shape of an id is diagnostic even
// when the value must not be shown (FR-PERM-003).
const ID_KEYS = [/^(section|group|term|scout|member|user|role|patrol|event|badge)_?id$/i, /^id$/i, /^scoutid$/i];

const VALUE_PATTERNS = [
  { re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, with: '[redacted email]' },
  { re: /\b(?:\+44|0)\s?\d{2,4}[\s-]?\d{3,4}[\s-]?\d{3,4}\b/g, with: '[redacted phone]' },
  { re: /\b\d{4}-\d{2}-\d{2}T?\b(?=.{0,12}(birth|dob))/gi, with: '[redacted date]' },
  { re: /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/g, with: '[redacted postcode]' },
  { re: /\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]+/g, with: '[redacted token]' }
];

function matchesAny(list, key) {
  return list.some((re) => re.test(key));
}

function classifyKey(key) {
  if (matchesAny(ALLOW_KEYS, key)) return 'allow';
  if (matchesAny(CREDENTIAL_KEYS, key)) return 'credential';
  if (matchesAny(ID_KEYS, key)) return 'identifier';
  if (matchesAny(PERSONAL_KEYS, key)) return 'personal';
  return 'allow';
}

function maskValue(value) {
  const s = String(value);
  if (s.length <= 2) return '*'.repeat(s.length);
  if (s.length <= 4) return `${s[0]}${'*'.repeat(s.length - 1)}`;
  return `${s.slice(0, 2)}${'*'.repeat(Math.max(3, s.length - 4))}${s.slice(-2)}`;
}

function scrubString(value, counter) {
  let out = String(value);
  for (const p of VALUE_PATTERNS) {
    out = out.replace(p.re, () => { counter.count += 1; return p.with; });
  }
  return out;
}

/**
 * Deep-sanitise an arbitrary parsed response.
 * Returns { value, redactions, truncated } - never mutates the input.
 */
function sanitise(input, opts = {}) {
  const maxDepth = opts.maxDepth ?? 8;
  const maxArray = opts.maxArrayItems ?? 5;
  const maxStringLength = opts.maxStringLength ?? 400;
  const counter = { count: 0 };
  let truncated = false;

  function walk(node, depth) {
    if (node === null || node === undefined) return node;
    if (typeof node === 'number' || typeof node === 'boolean') return node;
    if (typeof node === 'string') {
      let s = scrubString(node, counter);
      if (s.length > maxStringLength) { truncated = true; s = `${s.slice(0, maxStringLength)}…[truncated]`; }
      return s;
    }
    if (depth >= maxDepth) { truncated = true; return '[truncated: maximum depth]'; }

    if (Array.isArray(node)) {
      const slice = node.slice(0, maxArray).map((item) => walk(item, depth + 1));
      if (node.length > maxArray) {
        truncated = true;
        slice.push(`[truncated: ${node.length - maxArray} further items of ${node.length}]`);
      }
      return slice;
    }

    if (typeof node === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(node)) {
        switch (classifyKey(k)) {
          case 'credential':
            out[k] = REDACTED; counter.count += 1; break;
          case 'personal':
            out[k] = REMOVED; counter.count += 1; break;
          case 'identifier':
            if (v === null || typeof v === 'object') out[k] = walk(v, depth + 1);
            else { out[k] = maskValue(v); counter.count += 1; }
            break;
          default:
            out[k] = walk(v, depth + 1);
        }
      }
      return out;
    }
    return String(node);
  }

  return { value: walk(input, 0), redactions: counter.count, truncated };
}

// Headers worth keeping for diagnosis, with everything else dropped rather than
// listed, so a new OSM header cannot leak a credential by default.
const SAFE_HEADER_PREFIXES = [
  'content-type', 'content-length', 'date', 'retry-after', 'x-ratelimit', 'ratelimit',
  'x-blocked', 'x-deprecated', 'deprecation', 'sunset', 'warning', 'cache-control',
  'x-request-id', 'server', 'x-powered-by', 'link'
];

function sanitiseHeaders(headers) {
  const out = {};
  const entries = typeof headers?.entries === 'function' ? [...headers.entries()] : Object.entries(headers || {});
  for (const [rawKey, rawValue] of entries) {
    const k = String(rawKey).toLowerCase();
    if (!SAFE_HEADER_PREFIXES.some((p) => k.startsWith(p))) continue;
    out[k] = String(rawValue).slice(0, 200);
  }
  return out;
}

// A URL is reduced to scheme, host and path. Query values are dropped entirely and
// only the parameter names are kept (FR-REQ-002).
function sanitiseUrl(url) {
  try {
    const u = new URL(url);
    return { destination: `${u.protocol}//${u.host}${u.pathname}`, queryParamNames: [...u.searchParams.keys()] };
  } catch {
    return { destination: '[unparsable url]', queryParamNames: [] };
  }
}

// Raw body preview, always sanitised before it is stored or displayed (FR-REQ-006).
function sanitiseBodyPreview(text, limit = 2000) {
  if (typeof text !== 'string') return { preview: '', redactions: 0, truncated: false };
  const counter = { count: 0 };
  let out = scrubString(text, counter);
  let truncated = false;
  if (out.length > limit) { out = `${out.slice(0, limit)}\n…[truncated]`; truncated = true; }
  return { preview: out, redactions: counter.count, truncated };
}

// Last line of defence for anything about to be written to a log or export.
function assertNoSecrets(serialised, secrets = []) {
  const text = typeof serialised === 'string' ? serialised : JSON.stringify(serialised);
  for (const secret of secrets) {
    if (secret && secret.length >= 8 && text.includes(secret)) return false;
  }
  return true;
}

module.exports = {
  sanitise, sanitiseHeaders, sanitiseUrl, sanitiseBodyPreview, assertNoSecrets, maskValue,
  REDACTED, REMOVED
};
