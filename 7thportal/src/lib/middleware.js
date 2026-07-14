const db = require('../db');
const { isLeaderRole, isAdminRole } = require('./helpers');

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in.' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user || user.account_status !== 'active') return res.status(401).json({ error: 'Not logged in.' });
  req.user = user;
  next();
}

function requireParent(req, res, next) {
  if (req.user.portal_role !== 'parent') return res.status(403).json({ error: 'Parent/carer access required.' });
  next();
}

function requireLeader(req, res, next) {
  if (!isLeaderRole(req.user.portal_role)) return res.status(403).json({ error: 'Leader access required.' });
  next();
}

function requireAdmin(req, res, next) {
  if (!isAdminRole(req.user.portal_role)) return res.status(403).json({ error: 'Portal administrator access required.' });
  next();
}

module.exports = { requireAuth, requireParent, requireLeader, requireAdmin };
