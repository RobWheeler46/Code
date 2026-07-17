// Phase 2 personal routes (registered end users). Mounted at /api/user, all gated by requireUser.
const express = require('express');
const db = require('../db');
const { requireUser } = require('../lib/middleware');

const router = express.Router();
router.use(requireUser);

// ---- Saved roles ----

router.get('/saved-roles', (req, res) => {
  const rows = db.prepare(`
    SELECT sr.id, sr.role_profile_id, sr.created_at, rp.title, rp.grade
    FROM saved_roles sr
    JOIN role_profiles rp ON rp.id = sr.role_profile_id AND rp.status = 'published'
    WHERE sr.user_id = ?
    ORDER BY sr.created_at DESC
  `).all(req.user.id);
  res.json(rows);
});

router.post('/saved-roles', (req, res) => {
  const { roleProfileId } = req.body || {};
  if (!roleProfileId) return res.status(400).json({ error: 'A role profile is required.' });
  const role = db.prepare(`SELECT id FROM role_profiles WHERE id = ? AND status = 'published'`).get(roleProfileId);
  if (!role) return res.status(404).json({ error: 'Role profile not found.' });
  const existing = db.prepare(`SELECT id FROM saved_roles WHERE user_id = ? AND role_profile_id = ?`).get(req.user.id, roleProfileId);
  if (existing) return res.status(200).json({ ok: true, id: existing.id, alreadySaved: true });
  const result = db.prepare(`INSERT INTO saved_roles (user_id, role_profile_id) VALUES (?, ?)`).run(req.user.id, roleProfileId);
  res.status(201).json({ ok: true, id: result.lastInsertRowid });
});

router.delete('/saved-roles/:roleProfileId', (req, res) => {
  db.prepare(`DELETE FROM saved_roles WHERE user_id = ? AND role_profile_id = ?`).run(req.user.id, req.params.roleProfileId);
  res.json({ ok: true });
});

// ---- Saved comparisons ----

router.get('/saved-comparisons', (req, res) => {
  const rows = db.prepare(`
    SELECT sc.id, sc.current_role_profile_id, sc.aspirational_role_profile_id, sc.created_at,
           cur.title AS current_title, cur.grade AS current_grade,
           asp.title AS aspirational_title, asp.grade AS aspirational_grade
    FROM saved_comparisons sc
    JOIN role_profiles cur ON cur.id = sc.current_role_profile_id
    JOIN role_profiles asp ON asp.id = sc.aspirational_role_profile_id
    WHERE sc.user_id = ?
    ORDER BY sc.created_at DESC
  `).all(req.user.id);
  res.json(rows);
});

router.post('/saved-comparisons', (req, res) => {
  const { currentRoleId, aspirationalRoleId } = req.body || {};
  if (!currentRoleId || !aspirationalRoleId) return res.status(400).json({ error: 'Both roles are required.' });
  if (String(currentRoleId) === String(aspirationalRoleId)) return res.status(400).json({ error: 'Select two different roles.' });
  const both = db.prepare(`SELECT COUNT(*) AS n FROM role_profiles WHERE id IN (?, ?) AND status = 'published'`).get(currentRoleId, aspirationalRoleId);
  if (both.n !== 2) return res.status(404).json({ error: 'One or both role profiles could not be found.' });
  const existing = db.prepare(`SELECT id FROM saved_comparisons WHERE user_id = ? AND current_role_profile_id = ? AND aspirational_role_profile_id = ?`).get(req.user.id, currentRoleId, aspirationalRoleId);
  if (existing) return res.status(200).json({ ok: true, id: existing.id, alreadySaved: true });
  const result = db.prepare(`INSERT INTO saved_comparisons (user_id, current_role_profile_id, aspirational_role_profile_id) VALUES (?, ?, ?)`).run(req.user.id, currentRoleId, aspirationalRoleId);
  res.status(201).json({ ok: true, id: result.lastInsertRowid });
});

router.delete('/saved-comparisons/:id', (req, res) => {
  db.prepare(`DELETE FROM saved_comparisons WHERE user_id = ? AND id = ?`).run(req.user.id, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
