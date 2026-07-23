// Interpretation of the OSM startup / user-context response (FRD 12.5).
//
// The response shape is not formally specified, so extraction is shape-tolerant:
// several observed layouts are attempted and anything unrecognised is reported as a
// missing field rather than guessed at. Personal fields are used only to determine
// presence and are then discarded (FR-START-006, FR-PRIV-006).

const permissions = require('./permissions');
const { maskValue } = require('./redact');

const MANDATORY = ['osmUserId'];
const OPTIONAL = ['userName', 'userEmail', 'groups', 'sections', 'sectionTypes', 'defaultSection', 'permissionCategories', 'terms'];

function firstDefined(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return undefined;
}

/** Unwrap the common OSM envelopes: { data: ... }, { result: ... }, bare payload. */
function unwrap(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  if (payload.data !== undefined && (typeof payload.data === 'object')) return payload.data;
  if (payload.result !== undefined && (typeof payload.result === 'object')) return payload.result;
  return payload;
}

/** Sections may arrive as an array, or as an object keyed by section id. */
function toSectionArray(candidate) {
  if (Array.isArray(candidate)) return candidate;
  if (candidate && typeof candidate === 'object') {
    return Object.entries(candidate).map(([key, value]) => (
      value && typeof value === 'object' ? { __key: key, ...value } : { __key: key, value }
    ));
  }
  return [];
}

function extractSections(root) {
  const candidates = [
    root?.sections, root?.roles, root?.userRoles, root?.user_roles,
    root?.section_roles, root?.sectionRoles, Array.isArray(root) ? root : undefined
  ];
  for (const c of candidates) {
    const arr = toSectionArray(c);
    if (arr.length) return arr;
  }
  return [];
}

function normaliseSection(raw) {
  const sectionId = firstDefined(raw, ['section_id', 'sectionid', 'sectionId', 'id', '__key']);
  const sectionName = firstDefined(raw, ['section_name', 'sectionname', 'sectionName', 'name', 'section']);
  const groupId = firstDefined(raw, ['group_id', 'groupid', 'groupId']);
  const groupName = firstDefined(raw, ['group_name', 'groupname', 'groupName', 'group']);
  const sectionType = firstDefined(raw, ['section_type', 'sectiontype', 'sectionType', 'type']);
  const isDefaultRaw = firstDefined(raw, ['default', 'isDefault', 'is_default', 'defaultSection']);
  const permsRaw = firstDefined(raw, ['permissions', 'permission', 'perms']);

  const interpreted = permissions.interpretSet(
    typeof permsRaw === 'string' ? safeJson(permsRaw) : permsRaw
  );

  return {
    sectionIdRaw: sectionId === undefined ? null : String(sectionId),
    sectionIdMasked: sectionId === undefined ? null : maskValue(sectionId),
    sectionName: sectionName === undefined ? null : String(sectionName),
    groupIdMasked: groupId === undefined ? null : maskValue(groupId),
    groupName: groupName === undefined ? null : String(groupName),
    sectionType: sectionType === undefined ? null : String(sectionType),
    isDefault: isDefaultRaw === true || isDefaultRaw === 1 || isDefaultRaw === '1' || isDefaultRaw === 'true',
    permissions: interpreted,
    permissionSummary: permissions.summarise(interpreted)
  };
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function extractTerms(root) {
  const terms = firstDefined(root, ['terms', 'currentTerms', 'current_terms', 'termsList']);
  if (!terms) return null;
  if (Array.isArray(terms)) return { count: terms.length };
  if (typeof terms === 'object') return { count: Object.keys(terms).length };
  return null;
}

/**
 * Extract everything the connection test needs from a startup/context payload.
 * Returns a result that carries its own warnings and failures rather than throwing.
 */
function extract(payload) {
  const root = unwrap(payload);
  const globals = (root && typeof root === 'object' && typeof root.globals === 'object') ? root.globals : root;

  const osmUserId = firstDefined(globals, ['user_id', 'userid', 'userId', 'id', 'osm_user_id'])
    ?? firstDefined(root, ['user_id', 'userid', 'userId']);
  const userName = firstDefined(globals, ['full_name', 'fullname', 'name', 'firstname', 'username']);
  const userEmail = firstDefined(globals, ['email', 'email_address', 'emailAddress']);

  const rawSections = extractSections(root).concat(root === globals ? [] : extractSections(globals));
  const sections = rawSections.map(normaliseSection)
    .filter((s) => s.sectionIdRaw !== null || s.sectionName !== null);

  const groups = [];
  for (const s of sections) {
    const key = `${s.groupIdMasked || ''}|${s.groupName || ''}`;
    if (!groups.some((g) => g.key === key)) {
      groups.push({ key, groupIdMasked: s.groupIdMasked, groupName: s.groupName || 'Unnamed group' });
    }
  }

  const permissionCategories = [...new Set(
    sections.flatMap((s) => s.permissions.entries.map((e) => e.category))
  )];

  const found = {
    osmUserId: osmUserId !== undefined ? String(osmUserId) : null,
    // Presence only. The values themselves are discarded (FR-START-006).
    userName: userName !== undefined,
    userEmail: userEmail !== undefined,
    groups,
    sections,
    sectionTypes: [...new Set(sections.map((s) => s.sectionType).filter(Boolean))],
    defaultSection: sections.find((s) => s.isDefault)?.sectionName ?? null,
    permissionCategories,
    terms: extractTerms(root)
  };

  const missingMandatory = MANDATORY.filter((k) => {
    const v = found[k];
    return v === null || v === undefined || (Array.isArray(v) && v.length === 0);
  });
  const missingOptional = OPTIONAL.filter((k) => {
    const v = found[k];
    if (typeof v === 'boolean') return v === false;
    return v === null || v === undefined || (Array.isArray(v) && v.length === 0);
  });

  const permissionWarnings = sections.flatMap((s) =>
    s.permissions.warnings.map((w) => `${s.sectionName || 'Unnamed section'}: ${w}`));

  return {
    // Raw id retained in memory only long enough to key the application user; it is
    // hashed before storage and never returned to the browser.
    osmUserIdRaw: osmUserId !== undefined ? String(osmUserId) : null,
    osmUserIdMasked: osmUserId !== undefined ? maskValue(osmUserId) : null,
    userNamePresent: found.userName,
    userEmailPresent: found.userEmail,
    userEmailRaw: userEmail !== undefined ? String(userEmail) : null,
    userNameRaw: userName !== undefined ? String(userName) : null,
    groups: found.groups,
    sections: found.sections,
    sectionTypes: found.sectionTypes,
    defaultSection: found.defaultSection,
    permissionCategories: found.permissionCategories,
    terms: found.terms,
    missingMandatory,
    missingOptional,
    permissionWarnings,
    unknownPermissionValues: sections.reduce((n, s) => n + s.permissions.unknownValues, 0),
    unknownPermissionCategories: sections.reduce((n, s) => n + s.permissions.unknownCategories, 0)
  };
}

module.exports = { extract, normaliseSection, unwrap, MANDATORY, OPTIONAL };
