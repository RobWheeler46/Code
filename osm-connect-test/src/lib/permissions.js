// Interpretation of OSM section permissions (FRD 12.6).
//
// Safety rule: an unfamiliar category or value is reported as unknown and grants
// nothing. The application never treats a value it does not recognise as full
// access (FR-PERM-005, FR-PERM-006, AC-007).

// Categories observed in community documentation. This list exists so an
// unfamiliar category can be flagged - it is not a guarantee of what OSM returns.
const KNOWN_CATEGORIES = {
  badge: 'Badges',
  member: 'Members',
  user: 'Users',
  register: 'Attendance register',
  contact: 'Contact details',
  programme: 'Programme',
  events: 'Events',
  flexi: 'Flexi records',
  finance: 'Finance',
  quartermaster: 'Quartermaster',
  administration: 'Administration',
  accounts: 'Accounts'
};

// Numeric levels observed in community documentation.
const KNOWN_VALUES = new Map([
  [0, { level: 'none', label: 'No access', canRead: false, canWrite: false }],
  [10, { level: 'read', label: 'Read only', canRead: true, canWrite: false }],
  [20, { level: 'readwrite', label: 'Read and write', canRead: true, canWrite: true }],
  [100, { level: 'admin', label: 'Administrator', canRead: true, canWrite: true }]
]);

function interpretValue(raw) {
  if (raw === null || raw === undefined) {
    return { raw, known: false, level: 'unknown', label: 'Unknown permission value', canRead: false, canWrite: false, warning: 'No value was returned for this category.' };
  }
  const isNumber = typeof raw === 'number';
  const numeric = isNumber ? raw : Number(raw);

  if (!Number.isFinite(numeric)) {
    return {
      raw, known: false, level: 'unknown', label: 'Unknown permission value',
      canRead: false, canWrite: false,
      warning: 'The value is not numeric. It has not been interpreted as permission to access information.'
    };
  }

  const known = KNOWN_VALUES.get(numeric);
  if (!known) {
    return {
      raw, known: false, level: 'unknown', label: 'Unknown permission value',
      canRead: false, canWrite: false,
      warning: `Value ${numeric} is not a value this application recognises. For safety it grants no access.`,
      messageCode: 'OSM-PERM-004'
    };
  }

  // FR-PARSE-005: recognised value, unexpected type. Usable, but flagged.
  const typeWarning = isNumber ? null
    : 'The value was returned as text rather than a number. The type change has been recorded.';

  return {
    raw, known: true, level: known.level, label: known.label,
    canRead: known.canRead, canWrite: known.canWrite,
    warning: typeWarning,
    messageCode: typeWarning ? 'OSM-PARSE-005' : null
  };
}

function interpretCategory(category, raw) {
  const key = String(category).toLowerCase();
  const recognisedCategory = Object.prototype.hasOwnProperty.call(KNOWN_CATEGORIES, key);
  const value = interpretValue(raw);
  return {
    category,
    categoryLabel: recognisedCategory ? KNOWN_CATEGORIES[key] : 'Unknown permission category',
    categoryKnown: recognisedCategory,
    ...value,
    warning: !recognisedCategory
      ? `Unknown permission category. ${value.warning || 'The value has not been interpreted.'}`
      : value.warning
  };
}

/**
 * Interpret a whole permissions object as returned for one section.
 * Never assumes that every section returns the same fields (FR-PERM-004).
 */
function interpretSet(permissions) {
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) {
    return { entries: [], warnings: ['No permission information was returned for this section.'], unknownCategories: 0, unknownValues: 0 };
  }
  const entries = Object.entries(permissions).map(([k, v]) => interpretCategory(k, v));
  const warnings = entries.filter((e) => e.warning).map((e) => `${e.category}: ${e.warning}`);
  return {
    entries,
    warnings,
    unknownCategories: entries.filter((e) => !e.categoryKnown).length,
    unknownValues: entries.filter((e) => !e.known).length
  };
}

/**
 * Does this interpreted set grant read access to the named category?
 * An unfamiliar category counts as no access, in line with the FRD risk position
 * that unknown values default to no access.
 */
function hasRead(interpreted, category) {
  const entry = interpreted.entries.find((e) => String(e.category).toLowerCase() === String(category).toLowerCase());
  return !!(entry && entry.categoryKnown && entry.known && entry.canRead);
}

function summarise(interpreted) {
  if (!interpreted.entries.length) return 'No permissions returned';
  return interpreted.entries
    .map((e) => `${e.category}=${e.known ? e.level : 'unknown'}`)
    .join(', ');
}

module.exports = { interpretValue, interpretCategory, interpretSet, hasRead, summarise, KNOWN_CATEGORIES, KNOWN_VALUES };
