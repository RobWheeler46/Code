const db = require('../db');
const { userRoles } = require('./helpers');

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in.' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user || !user.active) return res.status(401).json({ error: 'Not logged in.' });
  req.user = user;
  req.userRoles = userRoles(user);
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || !req.userRoles.isAdmin) return res.status(403).json({ error: 'Administrator access required.' });
  next();
}

module.exports = { requireAuth, requireAdmin };
