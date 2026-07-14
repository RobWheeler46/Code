const express = require('express');
const db = require('../db');
const { logAudit, isLeaderRole } = require('../lib/helpers');
const { requireAuth, requireAdmin } = require('../lib/middleware');

const router = express.Router();

function activeNoticesRaw() {
  return db.prepare(`
    SELECT * FROM notices
    WHERE status = 'published' AND date(start_date) <= date('now')
      AND (end_date IS NULL OR date(end_date) >= date('now'))
    ORDER BY start_date DESC
  `).all();
}

function listNoticesForUser(user, sectionIds = []) {
  const leader = isLeaderRole(user.portal_role);
  return activeNoticesRaw().filter(n => {
    if (n.audience === 'all') return true;
    if (n.audience === 'parents') return user.portal_role === 'parent';
    if (n.audience === 'leaders') return leader;
    if (n.audience === 'section') return sectionIds.includes(n.osm_section_id);
    return false;
  });
}

function serializeNotice(n) {
  return {
    id: n.id, title: n.title, body: n.body, audience: n.audience,
    sectionName: n.section_name, startDate: n.start_date, endDate: n.end_date, status: n.status,
  };
}

router.get('/api/notices', requireAuth, (req, res) => {
  let sectionIds = [];
  if (req.user.portal_role === 'parent') {
    sectionIds = db.prepare('SELECT DISTINCT osm_section_id FROM parent_child_links WHERE parent_user_id = ?').all(req.user.id).map(r => r.osm_section_id);
  } else {
    sectionIds = (JSON.parse(req.user.osm_roles_json || '[]')).map(r => r.sectionid).filter(Boolean);
  }
  res.json(listNoticesForUser(req.user, sectionIds).map(serializeNotice));
});

router.get('/api/admin/notices', requireAuth, requireAdmin, (req, res) => {
  const notices = db.prepare('SELECT * FROM notices ORDER BY created_at DESC').all();
  res.json(notices.map(serializeNotice));
});

router.post('/api/admin/notices', requireAuth, requireAdmin, (req, res) => {
  const { title, body, audience, sectionId, sectionName, startDate, endDate } = req.body || {};
  if (!title || !body || !startDate) return res.status(400).json({ error: 'Title, body and start date are required.' });
  const validAudiences = ['all', 'parents', 'leaders', 'section'];
  const aud = validAudiences.includes(audience) ? audience : 'all';
  const info = db.prepare(`
    INSERT INTO notices (title, body, audience, osm_section_id, section_name, start_date, end_date, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?)
  `).run(title, body, aud, aud === 'section' ? (sectionId || null) : null, aud === 'section' ? (sectionName || null) : null, startDate, endDate || null, req.user.id);
  logAudit({ userId: req.user.id, action: 'admin_create_notice', entityType: 'notice', entityId: String(info.lastInsertRowid), ipAddress: req.ip });
  res.json(serializeNotice(db.prepare('SELECT * FROM notices WHERE id = ?').get(info.lastInsertRowid)));
});

router.patch('/api/admin/notices/:id', requireAuth, requireAdmin, (req, res) => {
  const notice = db.prepare('SELECT * FROM notices WHERE id = ?').get(req.params.id);
  if (!notice) return res.status(404).json({ error: 'Notice not found.' });
  const { title, body, audience, sectionId, sectionName, startDate, endDate, status } = req.body || {};
  const validAudiences = ['all', 'parents', 'leaders', 'section'];
  const aud = validAudiences.includes(audience) ? audience : notice.audience;
  db.prepare(`
    UPDATE notices SET title = ?, body = ?, audience = ?, osm_section_id = ?, section_name = ?,
      start_date = ?, end_date = ?, status = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    title ?? notice.title, body ?? notice.body, aud,
    aud === 'section' ? (sectionId ?? notice.osm_section_id) : null,
    aud === 'section' ? (sectionName ?? notice.section_name) : null,
    startDate ?? notice.start_date, endDate !== undefined ? endDate : notice.end_date,
    ['draft', 'published'].includes(status) ? status : notice.status,
    notice.id
  );
  logAudit({ userId: req.user.id, action: status === 'published' ? 'admin_publish_notice' : 'admin_update_notice', entityType: 'notice', entityId: String(notice.id), ipAddress: req.ip });
  res.json(serializeNotice(db.prepare('SELECT * FROM notices WHERE id = ?').get(notice.id)));
});

router.delete('/api/admin/notices/:id', requireAuth, requireAdmin, (req, res) => {
  const notice = db.prepare('SELECT * FROM notices WHERE id = ?').get(req.params.id);
  if (!notice) return res.status(404).json({ error: 'Notice not found.' });
  db.prepare('DELETE FROM notices WHERE id = ?').run(notice.id);
  logAudit({ userId: req.user.id, action: 'admin_delete_notice', entityType: 'notice', entityId: String(notice.id), ipAddress: req.ip });
  res.json({ ok: true });
});

module.exports = { router, listNoticesForUser, serializeNotice };
