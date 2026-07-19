// Phase 2 personal routes (registered end users). Mounted at /api/user, all gated by requireUser.
const express = require('express');
const db = require('../db');
const crypto = require('crypto');
const { requireUser } = require('../lib/middleware');
const { hashPassword, verifyPassword, logAudit } = require('../lib/helpers');
const { learningResourcesForSkill } = require('../lib/gapAnalysis');
const { roleRequiredSkills, skillLevelOptions, computeReadiness, developmentPlanItems } = require('../lib/assessment');
const { HISTORY_DEPTH, POLICY_RULES, MIN_LENGTH, validatePasswordString } = require('../lib/passwordPolicy');

// Simple in-memory rate limiter for password-change attempts (per user). MemoryStore-friendly; resets on
// success or after the window. Deters brute-forcing the current password from a hijacked session.
const changePwAttempts = new Map();
const CHANGE_PW_MAX_ATTEMPTS = 5;
const CHANGE_PW_WINDOW_MS = 15 * 60 * 1000;

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

// ---- Guided self-assessment (FRD Part E) ----

function attemptOr404(req, res) {
  const attempt = db.prepare(`SELECT * FROM assessment_attempts WHERE id = ? AND user_id = ?`).get(req.params.id, req.user.id);
  if (!attempt) { res.status(404).json({ error: 'Assessment not found.' }); return null; }
  return attempt;
}

// List attempts (dashboard).
router.get('/assessments', (req, res) => {
  const rows = db.prepare(`
    SELECT a.id, a.role_profile_id, a.status, a.started_at, a.completed_at, rp.title, rp.grade
    FROM assessment_attempts a JOIN role_profiles rp ON rp.id = a.role_profile_id
    WHERE a.user_id = ? ORDER BY a.updated_at DESC
  `).all(req.user.id);
  res.json(rows.map(a => {
    const r = computeReadiness(a);
    return { ...a, readinessLabel: r.label, percent: r.percent, answered: r.total - r.unanswered, total: r.total };
  }));
});

// Start (or resume the existing in-progress attempt) for a role.
router.post('/assessments', (req, res) => {
  const { roleProfileId } = req.body || {};
  if (!roleProfileId) return res.status(400).json({ error: 'A role profile is required.' });
  const role = db.prepare(`SELECT id FROM role_profiles WHERE id = ? AND status = 'published'`).get(roleProfileId);
  if (!role) return res.status(404).json({ error: 'Role profile not found.' });
  if (roleRequiredSkills(roleProfileId).length === 0) return res.status(400).json({ error: 'This role has no SFIA skills mapped, so it cannot be assessed yet.' });
  const existing = db.prepare(`SELECT id FROM assessment_attempts WHERE user_id = ? AND role_profile_id = ? AND status = 'in_progress'`).get(req.user.id, roleProfileId);
  if (existing) return res.json({ ok: true, id: existing.id, resumed: true });
  const result = db.prepare(`INSERT INTO assessment_attempts (user_id, role_profile_id) VALUES (?, ?)`).run(req.user.id, roleProfileId);
  res.status(201).json({ ok: true, id: result.lastInsertRowid });
});

// Attempt detail with per-skill questions + any saved responses.
router.get('/assessments/:id', (req, res) => {
  const attempt = attemptOr404(req, res); if (!attempt) return;
  const role = db.prepare(`SELECT id, title, grade FROM role_profiles WHERE id = ?`).get(attempt.role_profile_id);
  const responses = Object.fromEntries(db.prepare(`SELECT sfia_skill_id, self_assessed_level_id, confidence, evidence_text FROM assessment_responses WHERE attempt_id = ?`).all(attempt.id).map(r => [r.sfia_skill_id, r]));
  const questions = roleRequiredSkills(attempt.role_profile_id).map(s => {
    const resp = responses[s.sfia_skill_id];
    return {
      sfiaSkillId: s.sfia_skill_id, skillCode: s.skill_code, skillName: s.skill_name, shortDescription: s.short_description,
      requiredLevel: { id: s.required_level_id, number: s.required_level_number, name: s.required_level_name },
      options: skillLevelOptions(s.sfia_skill_id),
      response: resp ? { selfAssessedLevelId: resp.self_assessed_level_id, confidence: resp.confidence, evidenceText: resp.evidence_text } : null
    };
  });
  res.json({ id: attempt.id, status: attempt.status, role, questions });
});

// Save/update one skill's response (autosave supports save & resume).
router.put('/assessments/:id/responses', (req, res) => {
  const attempt = attemptOr404(req, res); if (!attempt) return;
  if (attempt.status === 'completed') return res.status(409).json({ error: 'This assessment is already completed.' });
  const { sfiaSkillId, selfAssessedLevelId, confidence, evidenceText } = req.body || {};
  if (!sfiaSkillId) return res.status(400).json({ error: 'A skill is required.' });
  const isRequired = db.prepare(`SELECT 1 FROM role_profile_skills WHERE role_profile_id = ? AND sfia_skill_id = ?`).get(attempt.role_profile_id, sfiaSkillId);
  if (!isRequired) return res.status(400).json({ error: 'That skill is not part of this role assessment.' });
  db.prepare(`
    INSERT INTO assessment_responses (attempt_id, sfia_skill_id, self_assessed_level_id, confidence, evidence_text)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(attempt_id, sfia_skill_id) DO UPDATE SET
      self_assessed_level_id = excluded.self_assessed_level_id, confidence = excluded.confidence,
      evidence_text = excluded.evidence_text, updated_at = datetime('now')
  `).run(attempt.id, sfiaSkillId, selfAssessedLevelId || null, confidence || null, evidenceText || null);
  db.prepare(`UPDATE assessment_attempts SET updated_at = datetime('now') WHERE id = ?`).run(attempt.id);
  res.json({ ok: true });
});

// Complete - requires every skill answered.
router.post('/assessments/:id/complete', (req, res) => {
  const attempt = attemptOr404(req, res); if (!attempt) return;
  const readiness = computeReadiness(attempt);
  if (readiness.unanswered > 0) return res.status(400).json({ error: `Answer all ${readiness.total} skills before completing (${readiness.unanswered} left).` });
  db.prepare(`UPDATE assessment_attempts SET status = 'completed', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(attempt.id);
  res.json({ ok: true });
});

// Readiness results.
router.get('/assessments/:id/results', (req, res) => {
  const attempt = attemptOr404(req, res); if (!attempt) return;
  const role = db.prepare(`SELECT id, title, grade FROM role_profiles WHERE id = ?`).get(attempt.role_profile_id);
  res.json({ id: attempt.id, status: attempt.status, role, ...computeReadiness(attempt) });
});

router.delete('/assessments/:id', (req, res) => {
  const attempt = attemptOr404(req, res); if (!attempt) return;
  db.prepare(`DELETE FROM assessment_responses WHERE attempt_id = ?`).run(attempt.id);
  db.prepare(`DELETE FROM assessment_attempts WHERE id = ?`).run(attempt.id);
  res.json({ ok: true });
});

// ---- Personal development plan (FRD Phase-2 Development Plan) ----

router.get('/development-plan', (req, res) => {
  const items = db.prepare(`
    SELECT dpi.id, dpi.sfia_skill_id, dpi.target_role_profile_id, dpi.target_level_id, dpi.status, dpi.notes, dpi.created_at,
           sk.skill_code, sk.skill_name, rp.title AS target_role_title,
           lv.level_number AS target_level_number, lv.level_name AS target_level_name
    FROM development_plan_items dpi
    JOIN sfia_skills sk ON sk.id = dpi.sfia_skill_id
    LEFT JOIN role_profiles rp ON rp.id = dpi.target_role_profile_id
    LEFT JOIN sfia_levels lv ON lv.id = dpi.target_level_id
    WHERE dpi.user_id = ?
    ORDER BY CASE dpi.status WHEN 'in_progress' THEN 0 WHEN 'not_started' THEN 1 ELSE 2 END, dpi.created_at DESC
  `).all(req.user.id);
  // Attach up to 3 learning suggestions per item's skill (reuses the Phase-1 gap-analysis matcher).
  const withLearning = items.map(it => ({
    ...it,
    learning: learningResourcesForSkill({ sfiaSkillId: it.sfia_skill_id, targetLevelNumber: it.target_level_number, gapType: null }).slice(0, 3)
  }));
  res.json(withLearning);
});

router.post('/development-plan', (req, res) => {
  const { sfiaSkillId, targetRoleProfileId, targetLevelNumber, notes } = req.body || {};
  if (!sfiaSkillId) return res.status(400).json({ error: 'A SFIA skill is required.' });
  const skill = db.prepare(`SELECT id FROM sfia_skills WHERE id = ?`).get(sfiaSkillId);
  if (!skill) return res.status(404).json({ error: 'Skill not found.' });
  let targetLevelId = null;
  if (targetLevelNumber) {
    const lv = db.prepare(`SELECT id FROM sfia_levels WHERE level_number = ?`).get(targetLevelNumber);
    targetLevelId = lv ? lv.id : null;
  }
  const roleId = targetRoleProfileId || null;
  const existing = db.prepare(`SELECT id FROM development_plan_items WHERE user_id = ? AND sfia_skill_id = ? AND ${roleId === null ? 'target_role_profile_id IS NULL' : 'target_role_profile_id = ?'}`)
    .get(...(roleId === null ? [req.user.id, sfiaSkillId] : [req.user.id, sfiaSkillId, roleId]));
  if (existing) return res.status(200).json({ ok: true, id: existing.id, alreadyAdded: true });
  const result = db.prepare(`
    INSERT INTO development_plan_items (user_id, sfia_skill_id, target_role_profile_id, target_level_id, notes)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.user.id, sfiaSkillId, roleId, targetLevelId, notes || null);
  res.status(201).json({ ok: true, id: result.lastInsertRowid });
});

router.patch('/development-plan/:id', (req, res) => {
  const item = db.prepare(`SELECT * FROM development_plan_items WHERE id = ? AND user_id = ?`).get(req.params.id, req.user.id);
  if (!item) return res.status(404).json({ error: 'Development plan item not found.' });
  const { status, notes } = req.body || {};
  if (status && !['not_started', 'in_progress', 'done'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  db.prepare(`UPDATE development_plan_items SET status = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(status ?? item.status, notes !== undefined ? notes : item.notes, item.id);
  res.json({ ok: true });
});

router.delete('/development-plan/:id', (req, res) => {
  db.prepare(`DELETE FROM development_plan_items WHERE id = ? AND user_id = ?`).run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// Active SFIA skills for pickers (e.g. the evidence skill selector). Lightweight, logged-in users only.
router.get('/skills', (req, res) => {
  res.json(db.prepare(`SELECT id, skill_code, skill_name FROM sfia_skills WHERE status = 'active' ORDER BY skill_code`).all());
});

// ---- Evidence portfolio (FRD Phase-2 Evidence) ----

router.get('/evidence', (req, res) => {
  res.json(db.prepare(`
    SELECT e.id, e.sfia_skill_id, e.title, e.description, e.url, e.created_at,
           sk.skill_code, sk.skill_name
    FROM evidence_items e JOIN sfia_skills sk ON sk.id = e.sfia_skill_id
    WHERE e.user_id = ?
    ORDER BY sk.skill_code, e.created_at DESC
  `).all(req.user.id));
});

router.post('/evidence', (req, res) => {
  const { sfiaSkillId, title, description, url } = req.body || {};
  if (!sfiaSkillId || !title) return res.status(400).json({ error: 'A skill and a title are required.' });
  const skill = db.prepare(`SELECT id FROM sfia_skills WHERE id = ?`).get(sfiaSkillId);
  if (!skill) return res.status(404).json({ error: 'Skill not found.' });
  const result = db.prepare(`INSERT INTO evidence_items (user_id, sfia_skill_id, title, description, url) VALUES (?, ?, ?, ?, ?)`)
    .run(req.user.id, sfiaSkillId, String(title).trim(), description || null, url || null);
  res.status(201).json({ ok: true, id: result.lastInsertRowid });
});

router.patch('/evidence/:id', (req, res) => {
  const item = db.prepare(`SELECT * FROM evidence_items WHERE id = ? AND user_id = ?`).get(req.params.id, req.user.id);
  if (!item) return res.status(404).json({ error: 'Evidence not found.' });
  const { title, description, url } = req.body || {};
  db.prepare(`UPDATE evidence_items SET title = ?, description = ?, url = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(title !== undefined ? String(title).trim() : item.title, description !== undefined ? description : item.description, url !== undefined ? url : item.url, item.id);
  res.json({ ok: true });
});

router.delete('/evidence/:id', (req, res) => {
  db.prepare(`DELETE FROM evidence_items WHERE id = ? AND user_id = ?`).run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// ---- Read-only share links (FRD Phase-2 sharing) ----

router.get('/share', (req, res) => {
  const rows = db.prepare(`
    SELECT sl.id, sl.token, sl.share_type, sl.resource_id, sl.created_at, rp.title AS assessment_role_title
    FROM share_links sl
    LEFT JOIN assessment_attempts a ON a.id = sl.resource_id AND sl.share_type = 'assessment'
    LEFT JOIN role_profiles rp ON rp.id = a.role_profile_id
    WHERE sl.user_id = ? ORDER BY sl.created_at DESC
  `).all(req.user.id);
  res.json(rows);
});

router.post('/share', (req, res) => {
  const { shareType, resourceId } = req.body || {};
  if (!['assessment', 'plan'].includes(shareType)) return res.status(400).json({ error: 'Invalid share type.' });
  let resId = null;
  if (shareType === 'assessment') {
    const attempt = db.prepare(`SELECT id FROM assessment_attempts WHERE id = ? AND user_id = ? AND status = 'completed'`).get(resourceId, req.user.id);
    if (!attempt) return res.status(404).json({ error: 'Completed assessment not found.' });
    resId = attempt.id;
  }
  // Reuse an existing active link for the same resource so links stay stable.
  const existing = db.prepare(`SELECT token FROM share_links WHERE user_id = ? AND share_type = ? AND ${resId === null ? 'resource_id IS NULL' : 'resource_id = ?'}`)
    .get(...(resId === null ? [req.user.id, shareType] : [req.user.id, shareType, resId]));
  if (existing) return res.json({ ok: true, token: existing.token, reused: true });
  const token = crypto.randomBytes(24).toString('hex');
  const result = db.prepare(`INSERT INTO share_links (user_id, token, share_type, resource_id) VALUES (?, ?, ?, ?)`).run(req.user.id, token, shareType, resId);
  res.status(201).json({ ok: true, id: result.lastInsertRowid, token });
});

router.delete('/share/:id', (req, res) => {
  db.prepare(`DELETE FROM share_links WHERE id = ? AND user_id = ?`).run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// ---- Change password (FRD v0.26) ----

// The policy rules to show the user (kept in sync with server enforcement via the shared policy module).
router.get('/password-policy', (req, res) => {
  res.json({ minLength: MIN_LENGTH, rules: POLICY_RULES });
});

router.post('/change-password', (req, res) => {
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.user.id);
  // Only local-credential accounts can change a password here (no external SSO in this build).
  if (!user || !user.password_hash) {
    return res.status(400).json({ error: 'This account is managed elsewhere and cannot change its password here.' });
  }

  // Rate limit repeated attempts (mostly guards the current-password check).
  const now = Date.now();
  const rl = changePwAttempts.get(user.id);
  if (rl && rl.count >= CHANGE_PW_MAX_ATTEMPTS && now < rl.resetAt) {
    return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
  }
  const recordFailure = () => {
    const cur = changePwAttempts.get(user.id);
    if (!cur || now >= cur.resetAt) changePwAttempts.set(user.id, { count: 1, resetAt: now + CHANGE_PW_WINDOW_MS });
    else cur.count += 1;
  };

  const { currentPassword, newPassword, confirmPassword } = req.body || {};

  if (!currentPassword || !verifyPassword(currentPassword, user.password_hash)) {
    recordFailure();
    logAudit({ userId: user.id, action: 'change_password_failed', entityType: 'user', entityId: user.id, ipAddress: req.ip, userAgent: req.get('user-agent'), details: { reason: 'current_password_incorrect' } });
    return res.status(400).json({ error: 'Your current password is incorrect.' });
  }
  if (!newPassword || newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'Your new password and confirmation do not match.' });
  }
  const check = validatePasswordString(newPassword, { email: user.email, firstName: user.first_name, lastName: user.last_name });
  if (!check.ok) return res.status(400).json({ error: check.error });
  if (verifyPassword(newPassword, user.password_hash)) {
    return res.status(400).json({ error: 'Your new password must be different from your current password.' });
  }
  // Reuse prevention against the last HISTORY_DEPTH passwords.
  const history = db.prepare(`SELECT password_hash FROM password_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`).all(user.id, HISTORY_DEPTH);
  if (history.some(h => verifyPassword(newPassword, h.password_hash))) {
    return res.status(400).json({ error: `Please choose a password you have not used in your last ${HISTORY_DEPTH} passwords.` });
  }

  // Apply: keep the outgoing hash in history, set the new one, trim history.
  const newHash = hashPassword(newPassword);
  db.prepare(`INSERT INTO password_history (user_id, password_hash) VALUES (?, ?)`).run(user.id, user.password_hash);
  db.prepare(`UPDATE users SET password_hash = ?, password_updated_at = datetime('now'), force_password_change = 0, updated_at = datetime('now') WHERE id = ?`).run(newHash, user.id);
  db.prepare(`DELETE FROM password_history WHERE user_id = ? AND id NOT IN (SELECT id FROM password_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?)`).run(user.id, user.id, HISTORY_DEPTH);

  changePwAttempts.delete(user.id);
  logAudit({ userId: user.id, action: 'change_password', entityType: 'user', entityId: user.id, ipAddress: req.ip, userAgent: req.get('user-agent') });
  // Notification: no email service is configured in this build, so the confirmation email is recorded as a
  // pending notification rather than sent. (FRD v0.26 requires a notification on success.)
  logAudit({ userId: user.id, action: 'notify_password_changed', entityType: 'user', entityId: user.id, details: { channel: 'email', status: 'not_sent_no_mailer' } });

  // Rotate the session id so the change invalidates the pre-change session, keeping the user signed in on
  // this device. (Enumerating and killing other devices' sessions isn't possible with the in-memory store.)
  const userId = user.id;
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Password changed, but refreshing your session failed. Please sign in again.' });
    req.session.userId = userId;
    req.session.save(() => res.json({ ok: true }));
  });
});

module.exports = router;
