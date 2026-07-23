// Configurable endpoint definitions (FR-API-002, FRD 7.1).
//
// Endpoints live in the database so one can be disabled without releasing a new
// version (FRD 7.1). Every definition is GET only in release 1 - a definition with a
// write method is rejected on load (FR-API-004, FR-API-006).

const db = require('../db');
const config = require('./config');

const APPROVED_METHODS = new Set(['GET', 'HEAD']);

// Seeded from community-maintained documentation. Paths are observed behaviour, not
// a supported specification, so each carries a "last verified" date that starts empty.
const SEED = [
  {
    key: 'context',
    name: 'Authentication context',
    path: '/oauth/resource',
    requires_section: 0,
    personal_data_risk: 'low',
    enabled: 1,
    mandatory_fields: 'user identifier',
    optional_fields: 'name, email, groups, sections, permissions, terms',
    what_it_tests: 'That the stored access token is accepted and that OSM will describe the signed-in user.',
    why_useful: 'This is the smallest authenticated request. If it fails, no other test can be trusted.',
    permission_required: 'None beyond a valid OSM sign in.',
    notes: 'Primary startup/context endpoint. Personal fields are read for presence only and then discarded.',
    display_order: 1
  },
  {
    key: 'user-roles',
    name: 'Groups and sections (legacy user roles)',
    path: '/api.php',
    query_params: 'action=getUserRoles',
    requires_section: 0,
    personal_data_risk: 'low',
    enabled: 0,
    mandatory_fields: 'section identifier, section name',
    optional_fields: 'group name, permissions, default indicator',
    what_it_tests: 'An older route to the same group, section and permission information.',
    why_useful: 'Useful as a fallback when the context endpoint changes shape or is removed.',
    permission_required: 'Leader or administrator access to at least one section.',
    notes: 'Legacy. Enable only if the context endpoint stops returning sections.',
    display_order: 2
  },
  {
    key: 'terms',
    name: 'Terms',
    path: '/api.php',
    query_params: 'action=getTerms',
    requires_section: 0,
    personal_data_risk: 'none',
    enabled: 1,
    mandatory_fields: '(none - an empty result is a valid outcome)',
    optional_fields: 'term identifiers, term names, start and end dates',
    what_it_tests: 'A simple authenticated read that returns no personal information.',
    why_useful: 'This is the low-risk proof test: it demonstrates a working read without touching member data.',
    permission_required: 'Section access. No member permission is needed.',
    notes: 'Recommended initial proof test.',
    display_order: 3
  },
  {
    key: 'section-permissions',
    name: 'Section permissions',
    path: '/oauth/resource',
    requires_section: 1,
    personal_data_risk: 'low',
    enabled: 0,
    mandatory_fields: 'permissions',
    optional_fields: 'permission categories',
    what_it_tests: 'That the permissions returned for the selected section can be interpreted.',
    why_useful: 'Confirms which further tests are worth attempting for this account.',
    permission_required: 'Section access.',
    notes: 'Re-reads the context endpoint and re-interprets permissions for the active section only.',
    display_order: 4
  },
  {
    key: 'dashboard',
    name: 'Dashboard summary structure',
    path: '/ext/settings/dashboard/',
    query_params: 'action=getDashboardStatus',
    requires_section: 1,
    personal_data_risk: 'low',
    enabled: 0,
    mandatory_fields: '(none defined yet)',
    optional_fields: 'counts and status flags',
    what_it_tests: 'That a section-scoped extension endpoint responds in a recognised format.',
    why_useful: 'Proves the section identifier is accepted by an /ext/ route.',
    permission_required: 'Section access.',
    notes: 'Structure only. No member records are requested.',
    display_order: 5
  },
  {
    key: 'programme',
    name: 'Programme summary structure',
    path: '/ext/programme/',
    query_params: 'action=getProgrammeSummary',
    requires_section: 1,
    personal_data_risk: 'medium',
    enabled: 0,
    mandatory_fields: '(none defined yet)',
    optional_fields: 'meeting dates, titles',
    what_it_tests: 'The shape of a programme response for the selected section and term.',
    why_useful: 'Programme responses can include free-text notes, so this also exercises redaction.',
    permission_required: 'Programme read permission.',
    notes: 'Requires a term. Free text is redacted before display.',
    display_order: 6
  },
  {
    key: 'attendance',
    name: 'Attendance structure',
    path: '/ext/members/attendance/',
    query_params: 'action=get',
    requires_section: 1,
    personal_data_risk: 'high',
    enabled: 0,
    mandatory_fields: '(none defined yet)',
    optional_fields: 'attendance rows',
    what_it_tests: 'The shape of an attendance response.',
    why_useful: 'Confirms whether attendance can be read for the selected section.',
    permission_required: 'Attendance register read permission.',
    notes: 'May return young people’s information. Disabled unless explicitly allowed.',
    display_order: 7
  },
  {
    key: 'badges',
    name: 'Badge structure',
    path: '/ext/badges/records/',
    query_params: 'action=getBadgeStructureByPerson',
    requires_section: 1,
    personal_data_risk: 'high',
    enabled: 0,
    mandatory_fields: '(none defined yet)',
    optional_fields: 'badge definitions, per-person records',
    what_it_tests: 'The shape of a badge records response.',
    why_useful: 'Badge structures change often and are a good early warning of an OSM change.',
    permission_required: 'Badge read permission.',
    notes: 'May return young people’s information. Disabled unless explicitly allowed.',
    display_order: 8
  },
  {
    key: 'members',
    name: 'Member list structure',
    path: '/ext/members/contact/',
    query_params: 'action=getListOfMembers',
    requires_section: 1,
    personal_data_risk: 'high',
    enabled: 0,
    mandatory_fields: '(none defined yet)',
    optional_fields: 'member rows',
    what_it_tests: 'Whether a member list can be read, and in what shape.',
    why_useful: 'The highest-value test for a future integration, and the highest data-protection risk.',
    permission_required: 'Member read permission.',
    notes: 'Returns young people’s information. Only the field names and row count are retained.',
    display_order: 9
  }
];

const insert = db.prepare(`
  INSERT OR IGNORE INTO endpoint_definitions
    (key, name, version, method, path, query_params, requires_section, expected_status,
     expected_content_type, mandatory_fields, optional_fields, personal_data_risk, enabled,
     what_it_tests, why_useful, permission_required, notes, display_order)
  VALUES (?, ?, '1', 'GET', ?, ?, ?, '200', 'application/json', ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function seed() {
  for (const e of SEED) {
    insert.run(
      e.key, e.name, e.path, e.query_params || null, e.requires_section,
      e.mandatory_fields || null, e.optional_fields || null, e.personal_data_risk,
      e.enabled, e.what_it_tests, e.why_useful, e.permission_required, e.notes, e.display_order
    );
  }
}

function all() {
  return db.prepare('SELECT * FROM endpoint_definitions ORDER BY display_order, id').all();
}

function byKey(key) {
  return db.prepare('SELECT * FROM endpoint_definitions WHERE key = ?').get(key) || null;
}

function setEnabled(key, enabled) {
  db.prepare('UPDATE endpoint_definitions SET enabled = ? WHERE key = ?').run(enabled ? 1 : 0, key);
}

function markVerified(key) {
  db.prepare("UPDATE endpoint_definitions SET last_verified_at = datetime('now') WHERE key = ?").run(key);
}

function markRemoved(key, note) {
  // FR-START-003 / FR-API-009: an endpoint that returns 410 is disabled, not retried.
  db.prepare('UPDATE endpoint_definitions SET enabled = 0, notes = ? WHERE key = ?')
    .run(`Removed by OSM (HTTP 410). ${note || ''}`.trim(), key);
}

/**
 * Is this definition safe to run? Rejects a non-approved method, an endpoint that has
 * been disabled, and a high-risk endpoint unless personal data tests are allowed.
 */
function guard(def) {
  if (!def) return { allowed: false, reason: 'The test is not defined.', code: 'OSM-APP-004' };
  if (!APPROVED_METHODS.has(String(def.method).toUpperCase())) {
    return { allowed: false, reason: `Method ${def.method} is not an approved read operation. Release 1 is read only.`, code: 'OSM-APP-004' };
  }
  if (!def.enabled) {
    return { allowed: false, reason: 'This test is disabled. An administrator can enable it.', code: 'OSM-APP-004' };
  }
  if (def.personal_data_risk === 'high' && !config.personalDataTestsAllowed()) {
    return { allowed: false, reason: 'This test may return young people’s information and is not permitted in this environment.', code: 'OSM-APP-004' };
  }
  return { allowed: true };
}

function buildUrl(def, { sectionId = null, termId = null } = {}) {
  const url = new URL(def.path, config.get('apiBase'));
  if (def.query_params) {
    for (const pair of String(def.query_params).split('&')) {
      const [k, v] = pair.split('=');
      if (k) url.searchParams.set(k, v ?? '');
    }
  }
  if (def.requires_section && sectionId) {
    url.searchParams.set('sectionid', sectionId);
    url.searchParams.set('section_id', sectionId);
  }
  if (termId) url.searchParams.set('termid', termId);
  return url.toString();
}

/**
 * High-level schema check (FR-ERR-019). Reports which declared fields were found
 * rather than asserting a strict schema, because the real shape is not specified.
 */
function validateSchema(def, data) {
  const declared = String(def.mandatory_fields || '')
    .split(',').map((s) => s.trim()).filter((s) => s && !s.startsWith('('));
  if (!declared.length) {
    return { result: data === null ? 'no-data' : 'not-defined', missing: [], present: [], typeIssues: [] };
  }
  const flatKeys = collectKeys(data);
  const missing = [];
  const present = [];
  for (const field of declared) {
    const needle = field.replace(/[^a-z]/gi, '').toLowerCase();
    const hit = flatKeys.find((k) => k.replace(/[^a-z]/gi, '').toLowerCase().includes(needle));
    if (hit) present.push(field); else missing.push(field);
  }
  return { result: missing.length ? 'missing-fields' : 'ok', missing, present, typeIssues: [] };
}

function collectKeys(node, depth = 0, acc = []) {
  if (depth > 5 || node === null || typeof node !== 'object') return acc;
  if (Array.isArray(node)) {
    if (node.length) collectKeys(node[0], depth + 1, acc);
    return acc;
  }
  for (const [k, v] of Object.entries(node)) {
    acc.push(k);
    collectKeys(v, depth + 1, acc);
  }
  return acc;
}

module.exports = { seed, all, byKey, setEnabled, markVerified, markRemoved, guard, buildUrl, validateSchema, APPROVED_METHODS };
