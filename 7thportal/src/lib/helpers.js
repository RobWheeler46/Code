const crypto = require('crypto');
const db = require('../db');
const osm = require('./osm');

const ROLE_LABELS = {
  parent: 'Parent/Carer',
  section_leader: 'Section Leader',
  assistant_leader: 'Assistant Leader or Section Volunteer',
  group_leadership: 'Group Leadership Team',
  trustee_viewer: 'Trustee Viewer',
  admin: 'Portal Administrator',
};
const LEADER_ROLES = ['section_leader', 'assistant_leader', 'group_leadership', 'trustee_viewer', 'admin'];

function roleLabel(role) { return ROLE_LABELS[role] || role; }
function isLeaderRole(role) { return LEADER_ROLES.includes(role); }
function isAdminRole(role) { return role === 'admin'; }
function canSeeSensitiveChildData(role) { return ['section_leader', 'admin'].includes(role); }

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(candidate, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function logAudit({ userId = null, action, entityType = null, entityId = null, ipAddress = null, details = null }) {
  db.prepare(`
    INSERT INTO audit_log (user_id, action, entity_type, entity_id, ip_address, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, action, entityType, entityId, ipAddress, details ? JSON.stringify(details) : null);
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    firstName: user.first_name,
    lastName: user.last_name,
    email: user.email,
    role: user.portal_role,
    roleLabel: roleLabel(user.portal_role),
    authType: user.auth_type,
  };
}

// Returns a live OSM access token for this user, refreshing if needed.
// Demo users get back the literal 'demo' sentinel that every osm.js data
// function treats as "serve mock data" - see osm.js header comment.
async function ensureFreshToken(user) {
  if (user.osm_access_token === 'demo') return 'demo';
  if (!user.osm_access_token) throw new Error('No OSM connection for this account.');
  if (user.osm_token_expires_at && Number(user.osm_token_expires_at) > Date.now() + 5000) {
    return user.osm_access_token;
  }
  const refreshed = await osm.refreshAccessToken(user.osm_refresh_token);
  db.prepare(`UPDATE users SET osm_access_token = ?, osm_refresh_token = ?, osm_token_expires_at = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(refreshed.accessToken, refreshed.refreshToken, String(refreshed.expiresAt), user.id);
  return refreshed.accessToken;
}

// The single account (real or demo) whose OSM token serves reads for parent
// dashboards, since parents have no OSM token of their own. See README
// "Integration model" for why this shared service-account design was chosen.
function getServiceAccount() {
  return db.prepare(`SELECT * FROM users WHERE is_osm_service_account = 1 AND account_status = 'active' LIMIT 1`).get();
}

// null = no restriction configured (all sections visible) - see admin FR-057.
function getVisibleSectionIds() {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'visible_sections'`).get();
  if (!row || !row.value) return null;
  try { return JSON.parse(row.value); } catch { return null; }
}

module.exports = {
  ROLE_LABELS, roleLabel, isLeaderRole, isAdminRole, canSeeSensitiveChildData,
  hashPassword, verifyPassword, logAudit, publicUser, ensureFreshToken, getServiceAccount, getVisibleSectionIds,
};
