// Phase 2 personal routes (registered end users). Mounted at /api/user, all gated by requireUser.
const express = require('express');
const db = require('../db');
const { requireUser } = require('../lib/middleware');
const { learningResourcesForSkill } = require('../lib/gapAnalysis');

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

// The SFIA skills a role requires, with the user's required level for each.
function roleRequiredSkills(roleProfileId) {
  return db.prepare(`
    SELECT rps.sfia_skill_id, sk.skill_code, sk.skill_name, sk.short_description,
           rps.required_sfia_level_id AS required_level_id, lv.level_number AS required_level_number, lv.level_name AS required_level_name
    FROM role_profile_skills rps
    JOIN sfia_skills sk ON sk.id = rps.sfia_skill_id
    JOIN sfia_levels lv ON lv.id = rps.required_sfia_level_id
    WHERE rps.role_profile_id = ?
    ORDER BY rps.display_order, sk.skill_code
  `).all(roleProfileId);
}

// Level options for a skill's question: prefer the imported skill-at-level descriptions; fall back to
// the 7 generic levels (number + name) for skills that have no skill-at-level data (e.g. non-SFIA-9 codes).
function skillLevelOptions(sfiaSkillId) {
  const withDesc = db.prepare(`
    SELECT lv.id AS level_id, lv.level_number, lv.level_name, sld.skill_level_description
    FROM sfia_skill_level_descriptions sld
    JOIN sfia_levels lv ON lv.id = sld.sfia_level_id
    WHERE sld.sfia_skill_id = ? AND sld.status = 'active'
    ORDER BY lv.level_number
  `).all(sfiaSkillId);
  if (withDesc.length > 0) return withDesc;
  return db.prepare(`SELECT id AS level_id, level_number, level_name, NULL AS skill_level_description FROM sfia_levels ORDER BY level_number`).all();
}

function attemptOr404(req, res) {
  const attempt = db.prepare(`SELECT * FROM assessment_attempts WHERE id = ? AND user_id = ?`).get(req.params.id, req.user.id);
  if (!attempt) { res.status(404).json({ error: 'Assessment not found.' }); return null; }
  return attempt;
}

function computeReadiness(attempt) {
  const skills = roleRequiredSkills(attempt.role_profile_id);
  const responses = db.prepare(`SELECT r.sfia_skill_id, r.self_assessed_level_id, r.confidence, r.evidence_text, lv.level_number AS self_level_number, lv.level_name AS self_level_name
    FROM assessment_responses r LEFT JOIN sfia_levels lv ON lv.id = r.self_assessed_level_id WHERE r.attempt_id = ?`).all(attempt.id);
  const byskill = Object.fromEntries(responses.map(r => [r.sfia_skill_id, r]));
  let met = 0, gap = 0, unanswered = 0;
  const details = skills.map(s => {
    const resp = byskill[s.sfia_skill_id];
    let status, levelDiff = null;
    if (!resp || resp.self_assessed_level_id == null) { status = 'not_answered'; unanswered++; }
    else {
      levelDiff = s.required_level_number - resp.self_level_number;
      if (levelDiff <= 0) { status = 'met'; met++; } else { status = 'gap'; gap++; }
    }
    return {
      sfiaSkillId: s.sfia_skill_id, skillCode: s.skill_code, skillName: s.skill_name,
      requiredLevel: { number: s.required_level_number, name: s.required_level_name },
      selfLevel: resp && resp.self_assessed_level_id != null ? { number: resp.self_level_number, name: resp.self_level_name } : null,
      confidence: resp ? resp.confidence : null, evidenceText: resp ? resp.evidence_text : null,
      status, levelDiff
    };
  });
  const total = skills.length;
  const percent = total ? Math.round((met / total) * 100) : 0;
  let label;
  if (unanswered > 0 && attempt.status !== 'completed') label = 'In progress';
  else if (gap === 0) label = 'Ready for this role';
  else if (percent >= 60) label = 'Nearly there';
  else label = 'Development needed';
  return { total, met, gap, unanswered, percent, label, details };
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

module.exports = router;
