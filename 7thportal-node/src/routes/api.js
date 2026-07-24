// Shared authenticated API: current user, parent dashboard and notice reading.
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../lib/middleware');

const router = express.Router();
router.use(requireAuth);

router.get('/me', (req, res) => res.json({ user: req.session.user }));

// Parent dashboard: the signed-in parent's children plus notices they can see.
router.get('/dashboard', (req, res) => {
  const user = req.session.user;
  const children = user.role === 'parent'
    ? db.prepare('SELECT id, name, section, osm_link FROM children WHERE parent_user_id = ? ORDER BY name').all(user.id)
    : [];
  const notices = visibleNotices(user.role).slice(0, 5);
  res.json({ children, notices });
});

// Notices visible to a role: everyone sees 'all'; parents also see 'parents';
// leaders/admins also see 'leaders'.
function visibleNotices(role) {
  const audiences = ['all'];
  if (role === 'parent') audiences.push('parents');
  if (role === 'leader' || role === 'admin') audiences.push('leaders');
  const placeholders = audiences.map(() => '?').join(',');
  return db.prepare(
    `SELECT id, title, body, audience, created_at FROM notices
     WHERE published = 1 AND audience IN (${placeholders})
     ORDER BY id DESC`
  ).all(...audiences);
}

router.get('/notices', (req, res) => {
  res.json({ notices: visibleNotices(req.session.user.role) });
});

module.exports = router;
module.exports.visibleNotices = visibleNotices;
