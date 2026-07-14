const db = require('../db');

const STATUSES = [
  'Draft', 'Submitted', 'Under review', 'Approved', 'Rejected',
  'Resubmitted', 'Withdrawn', 'Completed', 'Archived', 'Deleted'
];

const ACTIVE_REVIEW_STATUSES = ['Submitted', 'Under review', 'Resubmitted'];

function userGroups(userId) {
  return db.prepare(`
    SELECT g.* FROM groups g
    JOIN user_groups ug ON ug.group_id = g.id
    WHERE ug.user_id = ?
  `).all(userId);
}

function userRoles(user) {
  const groups = userGroups(user.id);
  return {
    isRequester: groups.some(g => g.type === 'requester'),
    isApprover: groups.some(g => g.type === 'approver'),
    isAdmin: !!user.is_admin,
    groups
  };
}

function nextReference() {
  const year = new Date().getFullYear();
  const row = db.prepare(`
    SELECT COUNT(*) AS n FROM requests WHERE reference LIKE ?
  `).get(`SWN-${year}-%`);
  const seq = String(row.n + 1).padStart(4, '0');
  return `SWN-${year}-${seq}`;
}

function logAudit({ requestId = null, userId = null, action, detail = null, previousValue = null, newValue = null }) {
  db.prepare(`
    INSERT INTO audit_log (request_id, user_id, action, detail, previous_value, new_value)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(requestId, userId, action, detail, previousValue, newValue);
}

function notify(userId, requestId, message) {
  db.prepare(`
    INSERT INTO notifications (user_id, request_id, message) VALUES (?, ?, ?)
  `).run(userId, requestId, message);
}

function notifyGroup(groupId, requestId, message, excludeUserId = null) {
  const members = db.prepare(`
    SELECT u.id FROM users u
    JOIN user_groups ug ON ug.user_id = u.id
    WHERE ug.group_id = ? AND u.active = 1 AND u.id != COALESCE(?, -1)
  `).all(groupId, excludeUserId);
  for (const m of members) notify(m.id, requestId, message);
}

function getStage(formId, sequence) {
  return db.prepare(`
    SELECT * FROM workflow_stages WHERE form_id = ? AND sequence = ?
  `).get(formId, sequence);
}

function isMemberOfGroup(userId, groupId) {
  return !!db.prepare(`
    SELECT 1 FROM user_groups WHERE user_id = ? AND group_id = ?
  `).get(userId, groupId);
}

module.exports = {
  STATUSES,
  ACTIVE_REVIEW_STATUSES,
  userGroups,
  userRoles,
  nextReference,
  logAudit,
  notify,
  notifyGroup,
  getStage,
  isMemberOfGroup
};
