const db = require('../db');
const { userPermissions } = require('./helpers');

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in.' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user || user.account_status !== 'active') return res.status(401).json({ error: 'Not logged in.' });
  req.user = user;
  req.permissions = userPermissions(user.id);
  if (!req.permissions.isAdmin) return res.status(403).json({ error: 'Administrator access required.' });
  next();
}

function requireEdit(req, res, next) {
  if (!req.permissions.canEdit) return res.status(403).json({ error: 'You do not have permission to edit content.' });
  next();
}

function requirePublish(req, res, next) {
  if (!req.permissions.canPublish) return res.status(403).json({ error: 'You do not have permission to publish content.' });
  next();
}

function requireManageAdmins(req, res, next) {
  if (!req.permissions.canManageAdmins) return res.status(403).json({ error: 'Only super administrators can manage admin users.' });
  next();
}

module.exports = { requireAuth, requireEdit, requirePublish, requireManageAdmins };
