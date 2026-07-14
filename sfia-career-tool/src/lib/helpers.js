const crypto = require('crypto');
const db = require('../db');

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

function userAdminRoles(userId) {
  return db.prepare(`
    SELECT ar.* FROM admin_roles ar
    JOIN user_admin_roles uar ON uar.admin_role_id = ar.id
    WHERE uar.user_id = ?
  `).all(userId);
}

function userPermissions(userId) {
  const roles = userAdminRoles(userId);
  return {
    isAdmin: roles.length > 0,
    canEdit: roles.some(r => r.can_edit),
    canPublish: roles.some(r => r.can_publish),
    canManageAdmins: roles.some(r => r.can_manage_admins),
    roles: roles.map(r => r.role_name)
  };
}

function logAudit({ userId = null, action, entityType = null, entityId = null, ipAddress = null, userAgent = null, details = null }) {
  db.prepare(`
    INSERT INTO audit_log (user_id, action, entity_type, entity_id, ip_address, user_agent, details)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(userId, action, entityType, entityId, ipAddress, userAgent, details ? JSON.stringify(details) : null);
}

function recordVersion({ contentType, contentId, versionNumber, changeSummary = null, previousValue = null, newValue = null, changedBy = null }) {
  db.prepare(`
    INSERT INTO content_versions (content_type, content_id, version_number, change_summary, previous_value, new_value, changed_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(contentType, contentId, versionNumber, changeSummary, previousValue ? JSON.stringify(previousValue) : null, newValue ? JSON.stringify(newValue) : null, changedBy);
}

function logUsageEvent({ sessionId = null, eventType, roleProfileId = null, aspirationalRoleProfileId = null, metadata = null }) {
  db.prepare(`
    INSERT INTO usage_events (session_id, event_type, role_profile_id, aspirational_role_profile_id, metadata)
    VALUES (?, ?, ?, ?, ?)
  `).run(sessionId, eventType, roleProfileId, aspirationalRoleProfileId, metadata ? JSON.stringify(metadata) : null);
}

module.exports = {
  hashPassword,
  verifyPassword,
  userAdminRoles,
  userPermissions,
  logAudit,
  recordVersion,
  logUsageEvent
};
