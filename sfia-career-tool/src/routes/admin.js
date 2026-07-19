const express = require('express');
const db = require('../db');
const { requireAuth, requireEdit, requirePublish, requireManageAdmins } = require('../lib/middleware');
const { hashPassword, logAudit, recordVersion } = require('../lib/helpers');
const { computeReadiness } = require('../lib/assessment');
const { roleForPack, packSkills, selectQuestions, buildPackDocx } = require('../lib/interviewPack');

const router = express.Router();
router.use(requireAuth);

function auditCtx(req) {
  return { userId: req.user.id, ipAddress: req.ip, userAgent: req.get('user-agent') };
}

// Role families

router.get('/role-families', (req, res) => {
  res.json(db.prepare(`SELECT * FROM role_families ORDER BY display_order, name`).all());
});

router.post('/role-families', requireEdit, (req, res) => {
  const { name, description, displayOrder } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  const result = db.prepare(`INSERT INTO role_families (name, description, display_order) VALUES (?, ?, ?)`)
    .run(name, description || null, displayOrder || 0);
  logAudit({ ...auditCtx(req), action: 'create', entityType: 'role_family', entityId: result.lastInsertRowid });
  res.status(201).json(db.prepare(`SELECT * FROM role_families WHERE id = ?`).get(result.lastInsertRowid));
});

router.patch('/role-families/:id', requireEdit, (req, res) => {
  const existing = db.prepare(`SELECT * FROM role_families WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Role family not found.' });
  const { name, description, displayOrder, status } = req.body || {};
  db.prepare(`
    UPDATE role_families SET name = ?, description = ?, display_order = ?, status = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(name ?? existing.name, description ?? existing.description, displayOrder ?? existing.display_order, status ?? existing.status, req.params.id);
  logAudit({ ...auditCtx(req), action: 'edit', entityType: 'role_family', entityId: req.params.id });
  res.json(db.prepare(`SELECT * FROM role_families WHERE id = ?`).get(req.params.id));
});

// Capability areas

router.get('/capability-areas', (req, res) => {
  const { roleFamilyId } = req.query;
  if (roleFamilyId) {
    return res.json(db.prepare(`SELECT * FROM capability_areas WHERE role_family_id = ? ORDER BY display_order, name`).all(roleFamilyId));
  }
  res.json(db.prepare(`SELECT * FROM capability_areas ORDER BY display_order, name`).all());
});

router.post('/capability-areas', requireEdit, (req, res) => {
  const { roleFamilyId, name, description, displayOrder } = req.body || {};
  if (!roleFamilyId || !name) return res.status(400).json({ error: 'Role family and name are required.' });
  const result = db.prepare(`INSERT INTO capability_areas (role_family_id, name, description, display_order) VALUES (?, ?, ?, ?)`)
    .run(roleFamilyId, name, description || null, displayOrder || 0);
  logAudit({ ...auditCtx(req), action: 'create', entityType: 'capability_area', entityId: result.lastInsertRowid });
  res.status(201).json(db.prepare(`SELECT * FROM capability_areas WHERE id = ?`).get(result.lastInsertRowid));
});

router.patch('/capability-areas/:id', requireEdit, (req, res) => {
  const existing = db.prepare(`SELECT * FROM capability_areas WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Capability area not found.' });
  const { name, description, displayOrder, status } = req.body || {};
  db.prepare(`
    UPDATE capability_areas SET name = ?, description = ?, display_order = ?, status = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(name ?? existing.name, description ?? existing.description, displayOrder ?? existing.display_order, status ?? existing.status, req.params.id);
  logAudit({ ...auditCtx(req), action: 'edit', entityType: 'capability_area', entityId: req.params.id });
  res.json(db.prepare(`SELECT * FROM capability_areas WHERE id = ?`).get(req.params.id));
});

// SFIA reference data: versions, categories, skills, levels

router.get('/sfia-versions', (req, res) => {
  res.json(db.prepare(`SELECT * FROM sfia_versions ORDER BY effective_from DESC`).all());
});

router.post('/sfia-versions', requireEdit, (req, res) => {
  const { versionName, description, effectiveFrom } = req.body || {};
  if (!versionName) return res.status(400).json({ error: 'Version name is required.' });
  const result = db.prepare(`INSERT INTO sfia_versions (version_name, description, effective_from) VALUES (?, ?, ?)`)
    .run(versionName, description || null, effectiveFrom || null);
  logAudit({ ...auditCtx(req), action: 'create', entityType: 'sfia_version', entityId: result.lastInsertRowid });
  res.status(201).json(db.prepare(`SELECT * FROM sfia_versions WHERE id = ?`).get(result.lastInsertRowid));
});

router.get('/sfia-categories', (req, res) => {
  const { sfiaVersionId } = req.query;
  if (sfiaVersionId) {
    return res.json(db.prepare(`SELECT * FROM sfia_categories WHERE sfia_version_id = ? ORDER BY display_order, name`).all(sfiaVersionId));
  }
  res.json(db.prepare(`SELECT * FROM sfia_categories ORDER BY display_order, name`).all());
});

router.post('/sfia-categories', requireEdit, (req, res) => {
  const { sfiaVersionId, name, description, displayOrder } = req.body || {};
  if (!sfiaVersionId || !name) return res.status(400).json({ error: 'SFIA version and name are required.' });
  const result = db.prepare(`INSERT INTO sfia_categories (sfia_version_id, name, description, display_order) VALUES (?, ?, ?, ?)`)
    .run(sfiaVersionId, name, description || null, displayOrder || 0);
  logAudit({ ...auditCtx(req), action: 'create', entityType: 'sfia_category', entityId: result.lastInsertRowid });
  res.status(201).json(db.prepare(`SELECT * FROM sfia_categories WHERE id = ?`).get(result.lastInsertRowid));
});

router.get('/sfia-levels', (req, res) => {
  res.json(db.prepare(`SELECT * FROM sfia_levels ORDER BY level_number`).all());
});

router.patch('/sfia-levels/:id', requireEdit, (req, res) => {
  const existing = db.prepare(`SELECT * FROM sfia_levels WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'SFIA level not found.' });
  const { levelName, description, levelFullDescription, sourceReference } = req.body || {};
  db.prepare(`
    UPDATE sfia_levels SET level_name = ?, description = ?, level_full_description = ?, source_reference = ?
    WHERE id = ?
  `).run(levelName ?? existing.level_name, description ?? existing.description,
    levelFullDescription ?? existing.level_full_description, sourceReference ?? existing.source_reference, req.params.id);
  logAudit({ ...auditCtx(req), action: 'edit', entityType: 'sfia_level', entityId: req.params.id });
  res.json(db.prepare(`SELECT * FROM sfia_levels WHERE id = ?`).get(req.params.id));
});

// SFIA skill-level descriptions (full description for a specific skill at a specific level)

router.get('/sfia-skill-level-descriptions', (req, res) => {
  const { sfiaSkillId } = req.query;
  let sql = `
    SELECT sld.*, sk.skill_code, sk.skill_name, lv.level_number, lv.level_name
    FROM sfia_skill_level_descriptions sld
    JOIN sfia_skills sk ON sk.id = sld.sfia_skill_id
    JOIN sfia_levels lv ON lv.id = sld.sfia_level_id
    WHERE 1=1
  `;
  const params = [];
  if (sfiaSkillId) { sql += ` AND sld.sfia_skill_id = ?`; params.push(sfiaSkillId); }
  sql += ` ORDER BY lv.level_number`;
  res.json(db.prepare(sql).all(...params));
});

router.post('/sfia-skill-level-descriptions', requireEdit, (req, res) => {
  const { sfiaVersionId, sfiaSkillId, sfiaLevelId, skillLevelDescription, guidanceNotes, sourceReference } = req.body || {};
  if (!sfiaVersionId || !sfiaSkillId || !sfiaLevelId || !skillLevelDescription) {
    return res.status(400).json({ error: 'SFIA version, skill, level and a description are required.' });
  }
  const duplicate = db.prepare(`SELECT id FROM sfia_skill_level_descriptions WHERE sfia_skill_id = ? AND sfia_level_id = ?`).get(sfiaSkillId, sfiaLevelId);
  if (duplicate) return res.status(409).json({ error: 'A description already exists for this skill at this level. Edit it instead.' });
  const result = db.prepare(`
    INSERT INTO sfia_skill_level_descriptions (sfia_version_id, sfia_skill_id, sfia_level_id, skill_level_description, guidance_notes, source_reference)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sfiaVersionId, sfiaSkillId, sfiaLevelId, skillLevelDescription, guidanceNotes || null, sourceReference || null);
  logAudit({ ...auditCtx(req), action: 'create', entityType: 'sfia_skill_level_description', entityId: result.lastInsertRowid });
  res.status(201).json(db.prepare(`SELECT * FROM sfia_skill_level_descriptions WHERE id = ?`).get(result.lastInsertRowid));
});

router.patch('/sfia-skill-level-descriptions/:id', requireEdit, (req, res) => {
  const existing = db.prepare(`SELECT * FROM sfia_skill_level_descriptions WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Skill-level description not found.' });
  const { skillLevelDescription, guidanceNotes, sourceReference, status } = req.body || {};
  db.prepare(`
    UPDATE sfia_skill_level_descriptions SET skill_level_description = ?, guidance_notes = ?, source_reference = ?, status = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(skillLevelDescription ?? existing.skill_level_description, guidanceNotes ?? existing.guidance_notes,
    sourceReference ?? existing.source_reference, status ?? existing.status, req.params.id);
  logAudit({ ...auditCtx(req), action: 'edit', entityType: 'sfia_skill_level_description', entityId: req.params.id });
  res.json(db.prepare(`SELECT * FROM sfia_skill_level_descriptions WHERE id = ?`).get(req.params.id));
});

router.get('/sfia-skills', (req, res) => {
  const { search, status } = req.query;
  let sql = `
    SELECT sk.*, sv.version_name, sc.name AS category_name
    FROM sfia_skills sk
    JOIN sfia_versions sv ON sv.id = sk.sfia_version_id
    LEFT JOIN sfia_categories sc ON sc.id = sk.sfia_category_id
    WHERE 1=1
  `;
  const params = [];
  if (search) {
    sql += ` AND (sk.skill_code LIKE ? OR sk.skill_name LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`);
  }
  if (status) {
    sql += ` AND sk.status = ?`;
    params.push(status);
  }
  sql += ` ORDER BY sk.skill_code`;
  res.json(db.prepare(sql).all(...params));
});

router.post('/sfia-skills', requireEdit, (req, res) => {
  const { sfiaVersionId, sfiaCategoryId, skillCode, skillName, shortDescription, fullDescription, sourceReference } = req.body || {};
  if (!sfiaVersionId || !skillCode || !skillName) {
    return res.status(400).json({ error: 'SFIA version, skill code and skill name are required.' });
  }
  const duplicate = db.prepare(`SELECT id FROM sfia_skills WHERE sfia_version_id = ? AND skill_code = ?`).get(sfiaVersionId, skillCode);
  if (duplicate) return res.status(409).json({ error: 'A skill with this code already exists for this SFIA version.' });
  const result = db.prepare(`
    INSERT INTO sfia_skills (sfia_version_id, sfia_category_id, skill_code, skill_name, short_description, full_description, source_reference)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(sfiaVersionId, sfiaCategoryId || null, skillCode, skillName, shortDescription || null, fullDescription || null, sourceReference || null);
  logAudit({ ...auditCtx(req), action: 'create', entityType: 'sfia_skill', entityId: result.lastInsertRowid });
  res.status(201).json(db.prepare(`SELECT * FROM sfia_skills WHERE id = ?`).get(result.lastInsertRowid));
});

router.patch('/sfia-skills/:id', requireEdit, (req, res) => {
  const existing = db.prepare(`SELECT * FROM sfia_skills WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'SFIA skill not found.' });
  const { sfiaCategoryId, skillName, shortDescription, fullDescription, sourceReference, status } = req.body || {};

  if (status === 'inactive' && existing.status === 'active') {
    const usedByPublished = db.prepare(`
      SELECT COUNT(*) AS n FROM role_profile_skills rps
      JOIN role_profiles rp ON rp.id = rps.role_profile_id
      WHERE rps.sfia_skill_id = ? AND rp.status = 'published'
    `).get(req.params.id).n;
    if (usedByPublished > 0 && !req.body.confirmDeactivate) {
      return res.status(409).json({
        error: `This skill is used by ${usedByPublished} published role profile(s). Confirm to deactivate anyway.`,
        requiresConfirmation: true
      });
    }
  }

  db.prepare(`
    UPDATE sfia_skills SET sfia_category_id = ?, skill_name = ?, short_description = ?, full_description = ?, source_reference = ?, status = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(sfiaCategoryId ?? existing.sfia_category_id, skillName ?? existing.skill_name, shortDescription ?? existing.short_description,
    fullDescription ?? existing.full_description, sourceReference ?? existing.source_reference, status ?? existing.status, req.params.id);
  logAudit({ ...auditCtx(req), action: 'edit', entityType: 'sfia_skill', entityId: req.params.id });
  res.json(db.prepare(`SELECT * FROM sfia_skills WHERE id = ?`).get(req.params.id));
});

// Role profiles

router.get('/role-profiles', (req, res) => {
  const { search, status } = req.query;
  let sql = `
    SELECT rp.*, rf.name AS role_family_name, ca.name AS capability_area_name
    FROM role_profiles rp
    LEFT JOIN role_families rf ON rf.id = rp.role_family_id
    LEFT JOIN capability_areas ca ON ca.id = rp.capability_area_id
    WHERE 1=1
  `;
  const params = [];
  if (search) {
    sql += ` AND rp.title LIKE ?`;
    params.push(`%${search}%`);
  }
  if (status) {
    sql += ` AND rp.status = ?`;
    params.push(status);
  }
  sql += ` ORDER BY rp.updated_at DESC`;
  res.json(db.prepare(sql).all(...params));
});

router.get('/role-profiles/:id', (req, res) => {
  const role = db.prepare(`SELECT * FROM role_profiles WHERE id = ?`).get(req.params.id);
  if (!role) return res.status(404).json({ error: 'Role profile not found.' });
  const skills = db.prepare(`
    SELECT rps.id AS mapping_id, rps.sfia_skill_id, rps.required_sfia_level_id, rps.importance, rps.rationale, rps.display_order,
           rps.role_specific_display_notes, rps.show_full_description,
           sk.skill_code, sk.skill_name, lv.level_number, lv.level_name
    FROM role_profile_skills rps
    JOIN sfia_skills sk ON sk.id = rps.sfia_skill_id
    JOIN sfia_levels lv ON lv.id = rps.required_sfia_level_id
    WHERE rps.role_profile_id = ?
    ORDER BY rps.display_order, sk.skill_code
  `).all(role.id);
  const versions = db.prepare(`SELECT * FROM content_versions WHERE content_type = 'role_profile' AND content_id = ? ORDER BY version_number DESC`).all(role.id);
  res.json({ ...role, skills, versions });
});

router.post('/role-profiles', requireEdit, (req, res) => {
  const {
    roleFamilyId, capabilityAreaId, title, grade, roleDescription, summary, responsibilities, seniorityLevel, roleType, effectiveFrom, reviewDate,
    purposeStatement, focusArea, typicalOutputs, dayInTheLife, successIndicators, progressionSummary, displayTags
  } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Role Name is required.' });
  // FRD v0.17 s.70: every role profile is pinned to a single SFIA version, defaulting to the current
  // published version - there is no version picker in the UI yet since only one version has ever existed.
  const activeVersion = db.prepare(`SELECT id FROM sfia_versions WHERE status = 'active' ORDER BY id DESC LIMIT 1`).get();
  const result = db.prepare(`
    INSERT INTO role_profiles (role_family_id, capability_area_id, title, grade, role_description, summary, responsibilities, seniority_level, role_type, owner_user_id, effective_from, review_date,
      purpose_statement, role_at_a_glance, typical_outputs, day_in_the_life, success_indicators, progression_summary, display_tags, sfia_version_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(roleFamilyId || null, capabilityAreaId || null, title, grade || null, roleDescription || null, summary || null, responsibilities || null, seniorityLevel || null, roleType || 'Individual Contributor', req.user.id, effectiveFrom || null, reviewDate || null,
    purposeStatement || null, focusArea ? JSON.stringify({ focusArea }) : null, typicalOutputs || null, dayInTheLife || null, successIndicators || null, progressionSummary || null,
    Array.isArray(displayTags) ? JSON.stringify(displayTags) : null, activeVersion ? activeVersion.id : null);
  logAudit({ ...auditCtx(req), action: 'create', entityType: 'role_profile', entityId: result.lastInsertRowid });
  res.status(201).json(db.prepare(`SELECT * FROM role_profiles WHERE id = ?`).get(result.lastInsertRowid));
});

router.patch('/role-profiles/:id', requireEdit, (req, res) => {
  const existing = db.prepare(`SELECT * FROM role_profiles WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Role profile not found.' });
  const {
    roleFamilyId, capabilityAreaId, title, grade, roleDescription, summary, responsibilities, seniorityLevel, roleType, effectiveFrom, reviewDate,
    purposeStatement, focusArea, typicalOutputs, dayInTheLife, successIndicators, progressionSummary, displayTags
  } = req.body || {};

  const newValues = {
    role_family_id: roleFamilyId ?? existing.role_family_id,
    capability_area_id: capabilityAreaId ?? existing.capability_area_id,
    title: title ?? existing.title,
    grade: grade ?? existing.grade,
    role_description: roleDescription ?? existing.role_description,
    summary: summary ?? existing.summary,
    responsibilities: responsibilities ?? existing.responsibilities,
    seniority_level: seniorityLevel ?? existing.seniority_level,
    role_type: roleType ?? existing.role_type,
    effective_from: effectiveFrom ?? existing.effective_from,
    review_date: reviewDate ?? existing.review_date,
    purpose_statement: purposeStatement ?? existing.purpose_statement,
    role_at_a_glance: focusArea !== undefined ? (focusArea ? JSON.stringify({ focusArea }) : null) : existing.role_at_a_glance,
    typical_outputs: typicalOutputs ?? existing.typical_outputs,
    day_in_the_life: dayInTheLife ?? existing.day_in_the_life,
    success_indicators: successIndicators ?? existing.success_indicators,
    progression_summary: progressionSummary ?? existing.progression_summary,
    display_tags: Array.isArray(displayTags) ? JSON.stringify(displayTags) : existing.display_tags
  };

  const wasPublished = existing.status === 'published';
  const nextVersion = wasPublished ? existing.version_number + 1 : existing.version_number;

  db.prepare(`
    UPDATE role_profiles SET role_family_id = ?, capability_area_id = ?, title = ?, grade = ?, role_description = ?, summary = ?, responsibilities = ?,
      seniority_level = ?, role_type = ?, effective_from = ?, review_date = ?, version_number = ?, updated_at = datetime('now'),
      purpose_statement = ?, role_at_a_glance = ?, typical_outputs = ?, day_in_the_life = ?, success_indicators = ?, progression_summary = ?, display_tags = ?
    WHERE id = ?
  `).run(newValues.role_family_id, newValues.capability_area_id, newValues.title, newValues.grade, newValues.role_description, newValues.summary, newValues.responsibilities,
    newValues.seniority_level, newValues.role_type, newValues.effective_from, newValues.review_date, nextVersion,
    newValues.purpose_statement, newValues.role_at_a_glance, newValues.typical_outputs, newValues.day_in_the_life,
    newValues.success_indicators, newValues.progression_summary, newValues.display_tags, req.params.id);

  if (wasPublished) {
    recordVersion({
      contentType: 'role_profile',
      contentId: existing.id,
      versionNumber: nextVersion,
      changeSummary: 'Edited published role profile',
      previousValue: existing,
      newValue: newValues,
      changedBy: req.user.id
    });
  }

  logAudit({ ...auditCtx(req), action: 'edit', entityType: 'role_profile', entityId: req.params.id });
  res.json(db.prepare(`SELECT * FROM role_profiles WHERE id = ?`).get(req.params.id));
});

router.post('/role-profiles/:id/publish', requirePublish, (req, res) => {
  const role = db.prepare(`SELECT * FROM role_profiles WHERE id = ?`).get(req.params.id);
  if (!role) return res.status(404).json({ error: 'Role profile not found.' });
  const skillCount = db.prepare(`SELECT COUNT(*) AS n FROM role_profile_skills WHERE role_profile_id = ?`).get(role.id).n;
  if (!role.title || skillCount === 0) {
    return res.status(400).json({ error: 'A role profile needs a title and at least one mapped SFIA skill before it can be published.' });
  }
  // FRD v0.17 SFIA-ROLE-VER-005: a role profile with mixed SFIA versions must not be published.
  if (role.sfia_version_id) {
    const crossVersion = db.prepare(`
      SELECT sk.skill_code FROM role_profile_skills rps
      JOIN sfia_skills sk ON sk.id = rps.sfia_skill_id
      WHERE rps.role_profile_id = ? AND sk.sfia_version_id != ?
    `).all(role.id, role.sfia_version_id);
    if (crossVersion.length > 0) {
      return res.status(400).json({
        error: `Cannot publish: ${crossVersion.length} mapped skill(s) belong to a different SFIA version than this role profile (${crossVersion.map(s => s.skill_code).join(', ')}). Remap them to the role's SFIA version first.`
      });
    }
  }
  db.prepare(`
    UPDATE role_profiles SET status = 'published', published_at = datetime('now'), published_by = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(req.user.id, role.id);
  logAudit({ ...auditCtx(req), action: 'publish', entityType: 'role_profile', entityId: role.id });
  res.json(db.prepare(`SELECT * FROM role_profiles WHERE id = ?`).get(role.id));
});

router.post('/role-profiles/:id/unpublish', requirePublish, (req, res) => {
  const role = db.prepare(`SELECT * FROM role_profiles WHERE id = ?`).get(req.params.id);
  if (!role) return res.status(404).json({ error: 'Role profile not found.' });
  db.prepare(`UPDATE role_profiles SET status = 'unpublished', updated_at = datetime('now') WHERE id = ?`).run(role.id);
  logAudit({ ...auditCtx(req), action: 'unpublish', entityType: 'role_profile', entityId: role.id });
  res.json(db.prepare(`SELECT * FROM role_profiles WHERE id = ?`).get(role.id));
});

router.post('/role-profiles/:id/archive', requirePublish, (req, res) => {
  const role = db.prepare(`SELECT * FROM role_profiles WHERE id = ?`).get(req.params.id);
  if (!role) return res.status(404).json({ error: 'Role profile not found.' });
  db.prepare(`UPDATE role_profiles SET status = 'archived', updated_at = datetime('now') WHERE id = ?`).run(role.id);
  logAudit({ ...auditCtx(req), action: 'archive', entityType: 'role_profile', entityId: role.id });
  res.json(db.prepare(`SELECT * FROM role_profiles WHERE id = ?`).get(role.id));
});

router.post('/role-profiles/:id/skills', requireEdit, (req, res) => {
  const role = db.prepare(`SELECT * FROM role_profiles WHERE id = ?`).get(req.params.id);
  if (!role) return res.status(404).json({ error: 'Role profile not found.' });
  const { sfiaSkillId, requiredSfiaLevelId, importance, rationale, displayOrder, roleSpecificDisplayNotes, showFullDescription } = req.body || {};
  if (!sfiaSkillId || !requiredSfiaLevelId) return res.status(400).json({ error: 'A SFIA skill and required level are required.' });
  const duplicate = db.prepare(`SELECT id FROM role_profile_skills WHERE role_profile_id = ? AND sfia_skill_id = ?`).get(role.id, sfiaSkillId);
  if (duplicate) return res.status(409).json({ error: 'This skill is already mapped to this role profile.' });
  // FRD v0.17 SFIA-ROLE-VER-002: every mapped skill must belong to the role profile's single SFIA version.
  if (role.sfia_version_id) {
    const skill = db.prepare(`SELECT sfia_version_id FROM sfia_skills WHERE id = ?`).get(sfiaSkillId);
    if (skill && skill.sfia_version_id !== role.sfia_version_id) {
      return res.status(400).json({ error: 'This SFIA skill belongs to a different SFIA version than this role profile.' });
    }
  }
  const result = db.prepare(`
    INSERT INTO role_profile_skills (role_profile_id, sfia_skill_id, required_sfia_level_id, importance, rationale, display_order, role_specific_display_notes, show_full_description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(role.id, sfiaSkillId, requiredSfiaLevelId, importance || 'important', rationale || null, displayOrder || 0,
    roleSpecificDisplayNotes || null, showFullDescription ? 1 : 0);
  logAudit({ ...auditCtx(req), action: 'add_skill_mapping', entityType: 'role_profile', entityId: role.id, details: { sfiaSkillId } });
  res.status(201).json(db.prepare(`SELECT * FROM role_profile_skills WHERE id = ?`).get(result.lastInsertRowid));
});

router.patch('/role-profiles/:id/skills/:mappingId', requireEdit, (req, res) => {
  const mapping = db.prepare(`SELECT * FROM role_profile_skills WHERE id = ? AND role_profile_id = ?`).get(req.params.mappingId, req.params.id);
  if (!mapping) return res.status(404).json({ error: 'Skill mapping not found.' });
  const { requiredSfiaLevelId, importance, rationale, roleSpecificDisplayNotes, showFullDescription } = req.body || {};
  db.prepare(`
    UPDATE role_profile_skills SET required_sfia_level_id = ?, importance = ?, rationale = ?, role_specific_display_notes = ?, show_full_description = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(requiredSfiaLevelId ?? mapping.required_sfia_level_id, importance ?? mapping.importance, rationale ?? mapping.rationale,
    roleSpecificDisplayNotes ?? mapping.role_specific_display_notes,
    showFullDescription !== undefined ? (showFullDescription ? 1 : 0) : mapping.show_full_description, mapping.id);
  logAudit({ ...auditCtx(req), action: 'edit_skill_mapping', entityType: 'role_profile', entityId: req.params.id, details: { mappingId: mapping.id } });
  res.json(db.prepare(`SELECT * FROM role_profile_skills WHERE id = ?`).get(mapping.id));
});

router.delete('/role-profiles/:id/skills/:mappingId', requireEdit, (req, res) => {
  const role = db.prepare(`SELECT * FROM role_profiles WHERE id = ?`).get(req.params.id);
  if (!role) return res.status(404).json({ error: 'Role profile not found.' });
  const mapping = db.prepare(`SELECT * FROM role_profile_skills WHERE id = ? AND role_profile_id = ?`).get(req.params.mappingId, role.id);
  if (!mapping) return res.status(404).json({ error: 'Skill mapping not found.' });
  const remaining = db.prepare(`SELECT COUNT(*) AS n FROM role_profile_skills WHERE role_profile_id = ?`).get(role.id).n;
  if (remaining === 1 && !req.body?.confirmRemove) {
    return res.status(409).json({ error: 'Removing this skill would leave the role with no skills. Confirm to remove anyway.', requiresConfirmation: true });
  }
  db.prepare(`DELETE FROM role_profile_skills WHERE id = ?`).run(mapping.id);
  logAudit({ ...auditCtx(req), action: 'remove_skill_mapping', entityType: 'role_profile', entityId: role.id, details: { sfiaSkillId: mapping.sfia_skill_id } });
  res.json({ ok: true });
});

// Learning resources

router.get('/learning-resources', (req, res) => {
  const { search, status } = req.query;
  let sql = `SELECT * FROM learning_resources WHERE 1=1`;
  const params = [];
  if (search) {
    sql += ` AND title LIKE ?`;
    params.push(`%${search}%`);
  }
  if (status) {
    sql += ` AND status = ?`;
    params.push(status);
  }
  sql += ` ORDER BY updated_at DESC`;
  res.json(db.prepare(sql).all(...params));
});

router.get('/learning-resources/:id', (req, res) => {
  const resource = db.prepare(`SELECT * FROM learning_resources WHERE id = ?`).get(req.params.id);
  if (!resource) return res.status(404).json({ error: 'Learning resource not found.' });
  const mappings = db.prepare(`
    SELECT lrs.*, sk.skill_code, sk.skill_name,
           lv_min.level_number AS min_level_number, lv_max.level_number AS max_level_number,
           rf.name AS role_family_name, ca.name AS capability_area_name
    FROM learning_resource_skills lrs
    JOIN sfia_skills sk ON sk.id = lrs.sfia_skill_id
    LEFT JOIN sfia_levels lv_min ON lv_min.id = lrs.min_sfia_level_id
    LEFT JOIN sfia_levels lv_max ON lv_max.id = lrs.max_sfia_level_id
    LEFT JOIN role_families rf ON rf.id = lrs.role_family_id
    LEFT JOIN capability_areas ca ON ca.id = lrs.capability_area_id
    WHERE lrs.learning_resource_id = ?
  `).all(resource.id);
  res.json({ ...resource, mappings });
});

router.post('/learning-resources', requireEdit, (req, res) => {
  const { title, description, provider, url, resourceType, deliveryMethod, estimatedDuration, costType, reviewDate } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Title is required.' });
  if (url) {
    try { new URL(url); } catch (e) { return res.status(400).json({ error: 'The provided URL is not valid.' }); }
  }
  const result = db.prepare(`
    INSERT INTO learning_resources (title, description, provider, url, resource_type, delivery_method, estimated_duration, cost_type, review_date, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(title, description || null, provider || null, url || null, resourceType || 'course', deliveryMethod || null, estimatedDuration || null, costType || 'free', reviewDate || null, req.user.id);
  logAudit({ ...auditCtx(req), action: 'create', entityType: 'learning_resource', entityId: result.lastInsertRowid });
  res.status(201).json(db.prepare(`SELECT * FROM learning_resources WHERE id = ?`).get(result.lastInsertRowid));
});

router.patch('/learning-resources/:id', requireEdit, (req, res) => {
  const existing = db.prepare(`SELECT * FROM learning_resources WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Learning resource not found.' });
  const { title, description, provider, url, resourceType, deliveryMethod, estimatedDuration, costType, reviewDate } = req.body || {};
  if (url) {
    try { new URL(url); } catch (e) { return res.status(400).json({ error: 'The provided URL is not valid.' }); }
  }
  db.prepare(`
    UPDATE learning_resources SET title = ?, description = ?, provider = ?, url = ?, resource_type = ?, delivery_method = ?,
      estimated_duration = ?, cost_type = ?, review_date = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(title ?? existing.title, description ?? existing.description, provider ?? existing.provider, url ?? existing.url,
    resourceType ?? existing.resource_type, deliveryMethod ?? existing.delivery_method, estimatedDuration ?? existing.estimated_duration,
    costType ?? existing.cost_type, reviewDate ?? existing.review_date, req.params.id);
  logAudit({ ...auditCtx(req), action: 'edit', entityType: 'learning_resource', entityId: req.params.id });
  res.json(db.prepare(`SELECT * FROM learning_resources WHERE id = ?`).get(req.params.id));
});

router.post('/learning-resources/:id/publish', requirePublish, (req, res) => {
  const resource = db.prepare(`SELECT * FROM learning_resources WHERE id = ?`).get(req.params.id);
  if (!resource) return res.status(404).json({ error: 'Learning resource not found.' });
  db.prepare(`UPDATE learning_resources SET status = 'published', updated_at = datetime('now') WHERE id = ?`).run(resource.id);
  logAudit({ ...auditCtx(req), action: 'publish', entityType: 'learning_resource', entityId: resource.id });
  res.json(db.prepare(`SELECT * FROM learning_resources WHERE id = ?`).get(resource.id));
});

router.post('/learning-resources/:id/archive', requirePublish, (req, res) => {
  const resource = db.prepare(`SELECT * FROM learning_resources WHERE id = ?`).get(req.params.id);
  if (!resource) return res.status(404).json({ error: 'Learning resource not found.' });
  db.prepare(`UPDATE learning_resources SET status = 'archived', updated_at = datetime('now') WHERE id = ?`).run(resource.id);
  logAudit({ ...auditCtx(req), action: 'archive', entityType: 'learning_resource', entityId: resource.id });
  res.json(db.prepare(`SELECT * FROM learning_resources WHERE id = ?`).get(resource.id));
});

router.post('/learning-resources/:id/skills', requireEdit, (req, res) => {
  const resource = db.prepare(`SELECT * FROM learning_resources WHERE id = ?`).get(req.params.id);
  if (!resource) return res.status(404).json({ error: 'Learning resource not found.' });
  const { sfiaSkillId, minSfiaLevelId, maxSfiaLevelId, roleFamilyId, capabilityAreaId, gapType, priority } = req.body || {};
  if (!sfiaSkillId) return res.status(400).json({ error: 'A SFIA skill is required.' });
  const result = db.prepare(`
    INSERT INTO learning_resource_skills (learning_resource_id, sfia_skill_id, min_sfia_level_id, max_sfia_level_id, role_family_id, capability_area_id, gap_type, priority)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(resource.id, sfiaSkillId, minSfiaLevelId || null, maxSfiaLevelId || null, roleFamilyId || null, capabilityAreaId || null, gapType || null, priority || 'medium');
  logAudit({ ...auditCtx(req), action: 'add_skill_mapping', entityType: 'learning_resource', entityId: resource.id, details: { sfiaSkillId } });
  res.status(201).json(db.prepare(`SELECT * FROM learning_resource_skills WHERE id = ?`).get(result.lastInsertRowid));
});

router.delete('/learning-resources/:id/skills/:mappingId', requireEdit, (req, res) => {
  const mapping = db.prepare(`SELECT * FROM learning_resource_skills WHERE id = ? AND learning_resource_id = ?`).get(req.params.mappingId, req.params.id);
  if (!mapping) return res.status(404).json({ error: 'Mapping not found.' });
  db.prepare(`DELETE FROM learning_resource_skills WHERE id = ?`).run(mapping.id);
  logAudit({ ...auditCtx(req), action: 'remove_skill_mapping', entityType: 'learning_resource', entityId: req.params.id });
  res.json({ ok: true });
});

// Career pathways

router.get('/career-pathways', (req, res) => {
  const { search, status } = req.query;
  let sql = `
    SELECT cp.*, rf.name AS role_family_name
    FROM career_pathways cp
    LEFT JOIN role_families rf ON rf.id = cp.role_family_id
    WHERE 1=1
  `;
  const params = [];
  if (search) { sql += ` AND cp.pathway_name LIKE ?`; params.push(`%${search}%`); }
  if (status) { sql += ` AND cp.status = ?`; params.push(status); }
  sql += ` ORDER BY cp.updated_at DESC`;
  res.json(db.prepare(sql).all(...params));
});

router.get('/career-pathways/:id', (req, res) => {
  const pathway = db.prepare(`SELECT * FROM career_pathways WHERE id = ?`).get(req.params.id);
  if (!pathway) return res.status(404).json({ error: 'Career pathway not found.' });
  const roles = db.prepare(`
    SELECT cpr.id AS pathway_role_id, cpr.role_profile_id, cpr.pathway_stage, cpr.display_label, cpr.is_starting_role, cpr.is_end_role,
           rp.title AS role_title
    FROM career_pathway_roles cpr
    JOIN role_profiles rp ON rp.id = cpr.role_profile_id
    WHERE cpr.career_pathway_id = ?
    ORDER BY cpr.pathway_stage
  `).all(pathway.id);
  const connections = db.prepare(`
    SELECT cpc.*, rf.title AS from_title, rt.title AS to_title
    FROM career_pathway_connections cpc
    JOIN role_profiles rf ON rf.id = cpc.from_role_profile_id
    JOIN role_profiles rt ON rt.id = cpc.to_role_profile_id
    WHERE cpc.career_pathway_id = ?
    ORDER BY cpc.display_order
  `).all(pathway.id);
  res.json({ ...pathway, roles, connections });
});

router.post('/career-pathways', requireEdit, (req, res) => {
  const { pathwayName, pathwayDescription, roleFamilyId, pathwayType, reviewDate } = req.body || {};
  if (!pathwayName) return res.status(400).json({ error: 'Pathway name is required.' });
  const result = db.prepare(`
    INSERT INTO career_pathways (pathway_name, pathway_description, role_family_id, pathway_type, owner_user_id, review_date)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(pathwayName, pathwayDescription || null, roleFamilyId || null, pathwayType || 'IC', req.user.id, reviewDate || null);
  logAudit({ ...auditCtx(req), action: 'create', entityType: 'career_pathway', entityId: result.lastInsertRowid });
  res.status(201).json(db.prepare(`SELECT * FROM career_pathways WHERE id = ?`).get(result.lastInsertRowid));
});

router.patch('/career-pathways/:id', requireEdit, (req, res) => {
  const existing = db.prepare(`SELECT * FROM career_pathways WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Career pathway not found.' });
  const { pathwayName, pathwayDescription, roleFamilyId, pathwayType, reviewDate } = req.body || {};
  db.prepare(`
    UPDATE career_pathways SET pathway_name = ?, pathway_description = ?, role_family_id = ?, pathway_type = ?, review_date = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(pathwayName ?? existing.pathway_name, pathwayDescription ?? existing.pathway_description, roleFamilyId ?? existing.role_family_id,
    pathwayType ?? existing.pathway_type, reviewDate ?? existing.review_date, req.params.id);
  logAudit({ ...auditCtx(req), action: 'edit', entityType: 'career_pathway', entityId: req.params.id });
  res.json(db.prepare(`SELECT * FROM career_pathways WHERE id = ?`).get(req.params.id));
});

router.post('/career-pathways/:id/publish', requirePublish, (req, res) => {
  const pathway = db.prepare(`SELECT * FROM career_pathways WHERE id = ?`).get(req.params.id);
  if (!pathway) return res.status(404).json({ error: 'Career pathway not found.' });
  const roleCount = db.prepare(`SELECT COUNT(*) AS n FROM career_pathway_roles WHERE career_pathway_id = ?`).get(pathway.id).n;
  if (roleCount === 0) return res.status(400).json({ error: 'A career pathway needs at least one role before it can be published.' });
  db.prepare(`UPDATE career_pathways SET status = 'published', published_at = datetime('now'), published_by = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(req.user.id, pathway.id);
  logAudit({ ...auditCtx(req), action: 'publish', entityType: 'career_pathway', entityId: pathway.id });
  res.json(db.prepare(`SELECT * FROM career_pathways WHERE id = ?`).get(pathway.id));
});

router.post('/career-pathways/:id/unpublish', requirePublish, (req, res) => {
  const pathway = db.prepare(`SELECT * FROM career_pathways WHERE id = ?`).get(req.params.id);
  if (!pathway) return res.status(404).json({ error: 'Career pathway not found.' });
  db.prepare(`UPDATE career_pathways SET status = 'draft', updated_at = datetime('now') WHERE id = ?`).run(pathway.id);
  logAudit({ ...auditCtx(req), action: 'unpublish', entityType: 'career_pathway', entityId: pathway.id });
  res.json(db.prepare(`SELECT * FROM career_pathways WHERE id = ?`).get(pathway.id));
});

router.post('/career-pathways/:id/archive', requirePublish, (req, res) => {
  const pathway = db.prepare(`SELECT * FROM career_pathways WHERE id = ?`).get(req.params.id);
  if (!pathway) return res.status(404).json({ error: 'Career pathway not found.' });
  db.prepare(`UPDATE career_pathways SET status = 'archived', updated_at = datetime('now') WHERE id = ?`).run(pathway.id);
  logAudit({ ...auditCtx(req), action: 'archive', entityType: 'career_pathway', entityId: pathway.id });
  res.json(db.prepare(`SELECT * FROM career_pathways WHERE id = ?`).get(pathway.id));
});

router.post('/career-pathways/:id/roles', requireEdit, (req, res) => {
  const pathway = db.prepare(`SELECT * FROM career_pathways WHERE id = ?`).get(req.params.id);
  if (!pathway) return res.status(404).json({ error: 'Career pathway not found.' });
  const { roleProfileId, pathwayStage, displayLabel, isStartingRole, isEndRole } = req.body || {};
  if (!roleProfileId || !pathwayStage) return res.status(400).json({ error: 'A role and a pathway stage are required.' });
  const duplicate = db.prepare(`SELECT id FROM career_pathway_roles WHERE career_pathway_id = ? AND role_profile_id = ?`).get(pathway.id, roleProfileId);
  if (duplicate) return res.status(409).json({ error: 'This role is already in the pathway.' });
  const result = db.prepare(`
    INSERT INTO career_pathway_roles (career_pathway_id, role_profile_id, pathway_stage, display_label, is_starting_role, is_end_role)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(pathway.id, roleProfileId, pathwayStage, displayLabel || null, isStartingRole ? 1 : 0, isEndRole ? 1 : 0);
  logAudit({ ...auditCtx(req), action: 'add_pathway_role', entityType: 'career_pathway', entityId: pathway.id, details: { roleProfileId } });
  res.status(201).json(db.prepare(`SELECT * FROM career_pathway_roles WHERE id = ?`).get(result.lastInsertRowid));
});

router.patch('/career-pathways/:id/roles/:pathwayRoleId', requireEdit, (req, res) => {
  const role = db.prepare(`SELECT * FROM career_pathway_roles WHERE id = ? AND career_pathway_id = ?`).get(req.params.pathwayRoleId, req.params.id);
  if (!role) return res.status(404).json({ error: 'Pathway role not found.' });
  const { pathwayStage, displayLabel, isStartingRole, isEndRole } = req.body || {};
  db.prepare(`
    UPDATE career_pathway_roles SET pathway_stage = ?, display_label = ?, is_starting_role = ?, is_end_role = ?
    WHERE id = ?
  `).run(pathwayStage ?? role.pathway_stage, displayLabel ?? role.display_label,
    isStartingRole !== undefined ? (isStartingRole ? 1 : 0) : role.is_starting_role,
    isEndRole !== undefined ? (isEndRole ? 1 : 0) : role.is_end_role, role.id);
  logAudit({ ...auditCtx(req), action: 'edit_pathway_role', entityType: 'career_pathway', entityId: req.params.id });
  res.json(db.prepare(`SELECT * FROM career_pathway_roles WHERE id = ?`).get(role.id));
});

router.delete('/career-pathways/:id/roles/:pathwayRoleId', requireEdit, (req, res) => {
  const role = db.prepare(`SELECT * FROM career_pathway_roles WHERE id = ? AND career_pathway_id = ?`).get(req.params.pathwayRoleId, req.params.id);
  if (!role) return res.status(404).json({ error: 'Pathway role not found.' });
  db.prepare(`
    DELETE FROM career_pathway_connections
    WHERE career_pathway_id = ? AND (from_role_profile_id = ? OR to_role_profile_id = ?)
  `).run(req.params.id, role.role_profile_id, role.role_profile_id);
  db.prepare(`DELETE FROM career_pathway_roles WHERE id = ?`).run(role.id);
  logAudit({ ...auditCtx(req), action: 'remove_pathway_role', entityType: 'career_pathway', entityId: req.params.id, details: { roleProfileId: role.role_profile_id } });
  res.json({ ok: true });
});

router.post('/career-pathways/:id/connections', requireEdit, (req, res) => {
  const pathway = db.prepare(`SELECT * FROM career_pathways WHERE id = ?`).get(req.params.id);
  if (!pathway) return res.status(404).json({ error: 'Career pathway not found.' });
  const { fromRoleProfileId, toRoleProfileId, connectionType, connectionDescription, displayOrder } = req.body || {};
  if (!fromRoleProfileId || !toRoleProfileId) return res.status(400).json({ error: 'A from-role and to-role are required.' });
  if (String(fromRoleProfileId) === String(toRoleProfileId)) return res.status(400).json({ error: 'A role cannot connect to itself.' });
  const duplicate = db.prepare(`
    SELECT id FROM career_pathway_connections WHERE career_pathway_id = ? AND from_role_profile_id = ? AND to_role_profile_id = ?
  `).get(pathway.id, fromRoleProfileId, toRoleProfileId);
  if (duplicate) return res.status(409).json({ error: 'A connection between these two roles already exists in this pathway. Edit or remove it instead.' });
  const result = db.prepare(`
    INSERT INTO career_pathway_connections (career_pathway_id, from_role_profile_id, to_role_profile_id, connection_type, connection_description, display_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(pathway.id, fromRoleProfileId, toRoleProfileId, connectionType || 'progression', connectionDescription || null, displayOrder || 0);
  logAudit({ ...auditCtx(req), action: 'add_pathway_connection', entityType: 'career_pathway', entityId: pathway.id });
  res.status(201).json(db.prepare(`SELECT * FROM career_pathway_connections WHERE id = ?`).get(result.lastInsertRowid));
});

router.patch('/career-pathways/:id/connections/:connectionId', requireEdit, (req, res) => {
  const conn = db.prepare(`SELECT * FROM career_pathway_connections WHERE id = ? AND career_pathway_id = ?`).get(req.params.connectionId, req.params.id);
  if (!conn) return res.status(404).json({ error: 'Connection not found.' });
  const { connectionType, connectionDescription, displayOrder, status } = req.body || {};
  db.prepare(`
    UPDATE career_pathway_connections SET connection_type = ?, connection_description = ?, display_order = ?, status = ?
    WHERE id = ?
  `).run(connectionType ?? conn.connection_type, connectionDescription ?? conn.connection_description,
    displayOrder ?? conn.display_order, status ?? conn.status, conn.id);
  logAudit({ ...auditCtx(req), action: 'edit_pathway_connection', entityType: 'career_pathway', entityId: req.params.id });
  res.json(db.prepare(`SELECT * FROM career_pathway_connections WHERE id = ?`).get(conn.id));
});

router.delete('/career-pathways/:id/connections/:connectionId', requireEdit, (req, res) => {
  const conn = db.prepare(`SELECT * FROM career_pathway_connections WHERE id = ? AND career_pathway_id = ?`).get(req.params.connectionId, req.params.id);
  if (!conn) return res.status(404).json({ error: 'Connection not found.' });
  db.prepare(`DELETE FROM career_pathway_connections WHERE id = ?`).run(conn.id);
  logAudit({ ...auditCtx(req), action: 'remove_pathway_connection', entityType: 'career_pathway', entityId: req.params.id });
  res.json({ ok: true });
});

// Admin users (super administrators only)

router.get('/admin-roles', (req, res) => {
  res.json(db.prepare(`SELECT * FROM admin_roles ORDER BY id`).all());
});

router.get('/users', requireManageAdmins, (req, res) => {
  const users = db.prepare(`SELECT id, first_name, last_name, email, account_status, last_login_at, created_at FROM users ORDER BY last_name, first_name`).all();
  const roleRows = db.prepare(`
    SELECT uar.user_id, ar.id AS role_id, ar.role_name FROM user_admin_roles uar
    JOIN admin_roles ar ON ar.id = uar.admin_role_id
  `).all();
  res.json(users.map(u => ({ ...u, roles: roleRows.filter(r => r.user_id === u.id).map(r => ({ id: r.role_id, name: r.role_name })) })));
});

router.post('/users', requireManageAdmins, (req, res) => {
  const { firstName, lastName, email, password, adminRoleId } = req.body || {};
  if (!firstName || !lastName || !email || !password || !adminRoleId) {
    return res.status(400).json({ error: 'First name, last name, email, password and an admin role are required.' });
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(normalizedEmail);
  if (existing) return res.status(409).json({ error: 'A user with this email already exists.' });
  const result = db.prepare(`
    INSERT INTO users (first_name, last_name, email, password_hash) VALUES (?, ?, ?, ?)
  `).run(firstName, lastName, normalizedEmail, hashPassword(password));
  db.prepare(`INSERT INTO user_admin_roles (user_id, admin_role_id, assigned_by) VALUES (?, ?, ?)`)
    .run(result.lastInsertRowid, adminRoleId, req.user.id);
  logAudit({ ...auditCtx(req), action: 'create', entityType: 'user', entityId: result.lastInsertRowid });
  res.status(201).json(db.prepare(`SELECT id, first_name, last_name, email, account_status FROM users WHERE id = ?`).get(result.lastInsertRowid));
});

router.patch('/users/:id', requireManageAdmins, (req, res) => {
  const existing = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'User not found.' });
  const { accountStatus, adminRoleId } = req.body || {};
  if (accountStatus) {
    db.prepare(`UPDATE users SET account_status = ?, updated_at = datetime('now') WHERE id = ?`).run(accountStatus, req.params.id);
  }
  if (adminRoleId) {
    db.prepare(`DELETE FROM user_admin_roles WHERE user_id = ?`).run(req.params.id);
    db.prepare(`INSERT INTO user_admin_roles (user_id, admin_role_id, assigned_by) VALUES (?, ?, ?)`).run(req.params.id, adminRoleId, req.user.id);
  }
  logAudit({ ...auditCtx(req), action: 'edit', entityType: 'user', entityId: req.params.id });
  res.json(db.prepare(`SELECT id, first_name, last_name, email, account_status FROM users WHERE id = ?`).get(req.params.id));
});

// End users (Phase 2): registered end-user accounts have no admin role. Admin-invite only - any
// admin can create/suspend end users (this is not the same as managing admin privileges, which stays
// super-admin-only via the /users routes above).

router.get('/end-users', (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.first_name, u.last_name, u.email, u.account_status, u.last_login_at, u.created_at
    FROM users u
    WHERE NOT EXISTS (SELECT 1 FROM user_admin_roles uar WHERE uar.user_id = u.id)
    ORDER BY u.last_name, u.first_name
  `).all();
  res.json(rows);
});

router.post('/end-users', (req, res) => {
  const { firstName, lastName, email, password } = req.body || {};
  if (!firstName || !lastName || !email || !password) {
    return res.status(400).json({ error: 'First name, last name, email and an initial password are required.' });
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(normalizedEmail);
  if (existing) return res.status(409).json({ error: 'A user with this email already exists.' });
  const result = db.prepare(`INSERT INTO users (first_name, last_name, email, password_hash) VALUES (?, ?, ?, ?)`)
    .run(firstName, lastName, normalizedEmail, hashPassword(password));
  logAudit({ ...auditCtx(req), action: 'create', entityType: 'end_user', entityId: result.lastInsertRowid });
  res.status(201).json(db.prepare(`SELECT id, first_name, last_name, email, account_status FROM users WHERE id = ?`).get(result.lastInsertRowid));
});

router.patch('/end-users/:id', (req, res) => {
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const isAdminUser = db.prepare(`SELECT 1 FROM user_admin_roles WHERE user_id = ?`).get(user.id);
  if (isAdminUser) return res.status(400).json({ error: 'This is an admin account - manage it via the Admin users section.' });
  const { accountStatus, password } = req.body || {};
  if (accountStatus) db.prepare(`UPDATE users SET account_status = ?, updated_at = datetime('now') WHERE id = ?`).run(accountStatus, user.id);
  if (password) db.prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`).run(hashPassword(password), user.id);
  logAudit({ ...auditCtx(req), action: 'edit', entityType: 'end_user', entityId: user.id });
  res.json(db.prepare(`SELECT id, first_name, last_name, email, account_status FROM users WHERE id = ?`).get(user.id));
});

// Audit log

router.get('/audit-log', (req, res) => {
  const { userId, action, entityType, from, to } = req.query;
  let sql = `
    SELECT al.*, u.first_name, u.last_name, u.email
    FROM audit_log al
    LEFT JOIN users u ON u.id = al.user_id
    WHERE 1=1
  `;
  const params = [];
  if (userId) { sql += ` AND al.user_id = ?`; params.push(userId); }
  if (action) { sql += ` AND al.action = ?`; params.push(action); }
  if (entityType) { sql += ` AND al.entity_type = ?`; params.push(entityType); }
  if (from) { sql += ` AND al.created_at >= ?`; params.push(from); }
  if (to) { sql += ` AND al.created_at <= ?`; params.push(to); }
  sql += ` ORDER BY al.created_at DESC LIMIT 500`;
  res.json(db.prepare(sql).all(...params));
});

// Content review dashboard

router.get('/content-review', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const roleProfiles = db.prepare(`
    SELECT id, title, status, review_date FROM role_profiles WHERE status != 'archived'
  `).all();
  const learningResources = db.prepare(`
    SELECT id, title, status, review_date FROM learning_resources WHERE status != 'archived'
  `).all();

  function bucket(items) {
    return {
      overdue: items.filter(i => i.review_date && i.review_date < today),
      dueSoon: items.filter(i => i.review_date && i.review_date >= today && i.review_date <= soon),
      noReviewDate: items.filter(i => !i.review_date)
    };
  }

  res.json({
    roleProfiles: bucket(roleProfiles),
    learningResources: bucket(learningResources)
  });
});

// Basic admin reporting

router.get('/reports', (req, res) => {
  const mostViewedRoles = db.prepare(`
    SELECT rp.id, rp.title, COUNT(*) AS views
    FROM usage_events ue JOIN role_profiles rp ON rp.id = ue.role_profile_id
    WHERE ue.event_type = 'view_role'
    GROUP BY rp.id ORDER BY views DESC LIMIT 10
  `).all();

  const mostComparedRoles = db.prepare(`
    SELECT rp.id, rp.title, COUNT(*) AS comparisons
    FROM usage_events ue JOIN role_profiles rp ON rp.id = ue.role_profile_id
    WHERE ue.event_type = 'compare_roles'
    GROUP BY rp.id ORDER BY comparisons DESC LIMIT 10
  `).all();

  const commonAspirationalRoles = db.prepare(`
    SELECT rp.id, rp.title, COUNT(*) AS times_selected
    FROM usage_events ue JOIN role_profiles rp ON rp.id = ue.aspirational_role_profile_id
    WHERE ue.event_type = 'compare_roles'
    GROUP BY rp.id ORDER BY times_selected DESC LIMIT 10
  `).all();

  const commonGaps = db.prepare(`
    SELECT ue.role_profile_id, ue.aspirational_role_profile_id, COUNT(*) AS n
    FROM usage_events ue
    WHERE ue.event_type = 'compare_roles'
    GROUP BY ue.role_profile_id, ue.aspirational_role_profile_id
    ORDER BY n DESC LIMIT 10
  `).all().map(row => ({
    current: db.prepare(`SELECT title FROM role_profiles WHERE id = ?`).get(row.role_profile_id)?.title || 'Unknown',
    aspirational: db.prepare(`SELECT title FROM role_profiles WHERE id = ?`).get(row.aspirational_role_profile_id)?.title || 'Unknown',
    count: row.n
  }));

  const counts = {
    rolePublished: db.prepare(`SELECT COUNT(*) AS n FROM role_profiles WHERE status = 'published'`).get().n,
    roleDraft: db.prepare(`SELECT COUNT(*) AS n FROM role_profiles WHERE status = 'draft'`).get().n,
    learningPublished: db.prepare(`SELECT COUNT(*) AS n FROM learning_resources WHERE status = 'published'`).get().n,
    skillsActive: db.prepare(`SELECT COUNT(*) AS n FROM sfia_skills WHERE status = 'active'`).get().n
  };

  res.json({ mostViewedRoles, mostComparedRoles, commonAspirationalRoles, commonGaps, counts });
});

// Organisational reporting (Phase 2): aggregated, privacy-preserving analytics over registered end-user
// activity. Everything returned here is an aggregate count or ranking - no individual end user is named
// or made identifiable. "End users" are accounts with no admin role.
router.get('/org-reports', (req, res) => {
  const endUserIds = `SELECT u.id FROM users u WHERE NOT EXISTS (SELECT 1 FROM user_admin_roles uar WHERE uar.user_id = u.id)`;
  const scalar = (sql) => db.prepare(sql).get().n;

  const summary = {
    endUsers: scalar(`SELECT COUNT(*) AS n FROM (${endUserIds})`),
    activeAccounts: scalar(`SELECT COUNT(*) AS n FROM users u WHERE u.account_status = 'active' AND u.id IN (${endUserIds})`),
    engagedUsers: scalar(`SELECT COUNT(*) AS n FROM (
        SELECT user_id FROM assessment_attempts
        UNION SELECT user_id FROM development_plan_items
        UNION SELECT user_id FROM evidence_items
        UNION SELECT user_id FROM saved_roles
      ) act WHERE act.user_id IN (${endUserIds})`),
    assessmentsCompleted: scalar(`SELECT COUNT(*) AS n FROM assessment_attempts WHERE status = 'completed' AND user_id IN (${endUserIds})`),
    assessmentsInProgress: scalar(`SELECT COUNT(*) AS n FROM assessment_attempts WHERE status = 'in_progress' AND user_id IN (${endUserIds})`),
    planItems: scalar(`SELECT COUNT(*) AS n FROM development_plan_items WHERE user_id IN (${endUserIds})`),
    usersWithPlan: scalar(`SELECT COUNT(DISTINCT user_id) AS n FROM development_plan_items WHERE user_id IN (${endUserIds})`),
    evidenceItems: scalar(`SELECT COUNT(*) AS n FROM evidence_items WHERE user_id IN (${endUserIds})`),
    savedRoles: scalar(`SELECT COUNT(*) AS n FROM saved_roles WHERE user_id IN (${endUserIds})`),
    savedComparisons: scalar(`SELECT COUNT(*) AS n FROM saved_comparisons WHERE user_id IN (${endUserIds})`)
  };

  // Derive role readiness and skill-gap frequency from completed assessments (reusing the shared
  // computeReadiness so admin figures match what each user sees).
  const completed = db.prepare(`SELECT * FROM assessment_attempts WHERE status = 'completed' AND user_id IN (${endUserIds})`).all();
  const roleTitle = {};
  const roleAgg = {};   // roleId -> { attempts, percentSum, gapSum }
  const gapAgg = {};    // skillId -> { code, name, assessed, gaps }
  for (const a of completed) {
    const r = computeReadiness(a);
    if (!roleTitle[a.role_profile_id]) roleTitle[a.role_profile_id] = db.prepare(`SELECT title FROM role_profiles WHERE id = ?`).get(a.role_profile_id)?.title || 'Unknown role';
    const ra = roleAgg[a.role_profile_id] || (roleAgg[a.role_profile_id] = { attempts: 0, percentSum: 0, gapSum: 0 });
    ra.attempts += 1; ra.percentSum += r.percent; ra.gapSum += r.gap;
    for (const d of r.details) {
      const g = gapAgg[d.sfiaSkillId] || (gapAgg[d.sfiaSkillId] = { code: d.skillCode, name: d.skillName, assessed: 0, gaps: 0 });
      g.assessed += 1;
      if (d.status === 'gap') g.gaps += 1;
    }
  }

  const roleReadiness = Object.entries(roleAgg).map(([id, a]) => ({
    roleId: Number(id), title: roleTitle[id], attempts: a.attempts,
    avgPercent: Math.round(a.percentSum / a.attempts), avgGaps: Math.round((a.gapSum / a.attempts) * 10) / 10
  })).sort((x, y) => y.attempts - x.attempts || y.avgPercent - x.avgPercent);

  const assessmentGaps = Object.values(gapAgg).filter(g => g.gaps > 0).map(g => ({
    skillCode: g.code, skillName: g.name, assessed: g.assessed, gaps: g.gaps,
    gapRate: Math.round((g.gaps / g.assessed) * 100)
  })).sort((x, y) => y.gaps - x.gaps || y.gapRate - x.gapRate).slice(0, 15);

  // Where the org is actively investing development effort (development-plan items by skill).
  const planFocus = db.prepare(`
    SELECT sk.skill_code, sk.skill_name,
           COUNT(*) AS items,
           COUNT(DISTINCT dpi.user_id) AS users,
           SUM(CASE WHEN dpi.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
           SUM(CASE WHEN dpi.status = 'done' THEN 1 ELSE 0 END) AS done
    FROM development_plan_items dpi
    JOIN sfia_skills sk ON sk.id = dpi.sfia_skill_id
    WHERE dpi.user_id IN (${endUserIds})
    GROUP BY dpi.sfia_skill_id
    ORDER BY items DESC, users DESC
    LIMIT 15
  `).all();

  res.json({ summary, roleReadiness, assessmentGaps, planFocus });
});

// ---- Interview pack generator (FRD v0.24 selected-user feature) ----
// Question bank management + Word pack generation. Selected users = admins in this MVP; bank editing is
// gated by canEdit and approval/retirement by canPublish, mapping onto existing content capabilities.

router.get('/interview-questions', (req, res) => {
  const { skillId, levelId, status } = req.query;
  let sql = `
    SELECT iq.*, sk.skill_code, sk.skill_name, lv.level_number, lv.level_name,
           cu.first_name AS created_by_first, cu.last_name AS created_by_last
    FROM interview_questions iq
    JOIN sfia_skills sk ON sk.id = iq.sfia_skill_id
    JOIN sfia_levels lv ON lv.id = iq.sfia_level_id
    LEFT JOIN users cu ON cu.id = iq.created_by
    WHERE 1=1
  `;
  const params = [];
  if (skillId) { sql += ` AND iq.sfia_skill_id = ?`; params.push(skillId); }
  if (levelId) { sql += ` AND iq.sfia_level_id = ?`; params.push(levelId); }
  if (status) { sql += ` AND iq.status = ?`; params.push(status); }
  sql += ` ORDER BY sk.skill_code, lv.level_number, iq.question_type, iq.id DESC`;
  res.json(db.prepare(sql).all(...params));
});

router.post('/interview-questions', requireEdit, (req, res) => {
  const { sfiaSkillId, sfiaLevelId, sfiaVersionId, questionType, questionText, whatGoodLooksLike, probePrompts } = req.body || {};
  if (!sfiaSkillId || !sfiaLevelId || !questionText) {
    return res.status(400).json({ error: 'A SFIA skill, level and question text are required.' });
  }
  const type = questionType === 'alternative' ? 'alternative' : 'strength_based';
  const result = db.prepare(`
    INSERT INTO interview_questions (sfia_version_id, sfia_skill_id, sfia_level_id, question_type, question_text, what_good_looks_like, probe_prompts, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(sfiaVersionId || null, sfiaSkillId, sfiaLevelId, type, questionText, whatGoodLooksLike || null, probePrompts || null, req.user.id);
  logAudit({ ...auditCtx(req), action: 'create', entityType: 'interview_question', entityId: result.lastInsertRowid });
  res.status(201).json(db.prepare(`SELECT * FROM interview_questions WHERE id = ?`).get(result.lastInsertRowid));
});

router.patch('/interview-questions/:id', requireEdit, (req, res) => {
  const q = db.prepare(`SELECT * FROM interview_questions WHERE id = ?`).get(req.params.id);
  if (!q) return res.status(404).json({ error: 'Question not found.' });
  const { questionText, whatGoodLooksLike, probePrompts, questionType } = req.body || {};
  db.prepare(`
    UPDATE interview_questions
    SET question_text = ?, what_good_looks_like = ?, probe_prompts = ?, question_type = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    questionText != null ? questionText : q.question_text,
    whatGoodLooksLike !== undefined ? whatGoodLooksLike : q.what_good_looks_like,
    probePrompts !== undefined ? probePrompts : q.probe_prompts,
    questionType === 'alternative' || questionType === 'strength_based' ? questionType : q.question_type,
    q.id
  );
  logAudit({ ...auditCtx(req), action: 'edit', entityType: 'interview_question', entityId: q.id });
  res.json(db.prepare(`SELECT * FROM interview_questions WHERE id = ?`).get(q.id));
});

router.post('/interview-questions/:id/approve', requirePublish, (req, res) => {
  const q = db.prepare(`SELECT id FROM interview_questions WHERE id = ?`).get(req.params.id);
  if (!q) return res.status(404).json({ error: 'Question not found.' });
  db.prepare(`UPDATE interview_questions SET status = 'approved', approved_by = ?, updated_at = datetime('now') WHERE id = ?`).run(req.user.id, q.id);
  logAudit({ ...auditCtx(req), action: 'approve', entityType: 'interview_question', entityId: q.id });
  res.json(db.prepare(`SELECT * FROM interview_questions WHERE id = ?`).get(q.id));
});

router.post('/interview-questions/:id/retire', requirePublish, (req, res) => {
  const q = db.prepare(`SELECT id FROM interview_questions WHERE id = ?`).get(req.params.id);
  if (!q) return res.status(404).json({ error: 'Question not found.' });
  db.prepare(`UPDATE interview_questions SET status = 'retired', updated_at = datetime('now') WHERE id = ?`).run(q.id);
  logAudit({ ...auditCtx(req), action: 'retire', entityType: 'interview_question', entityId: q.id });
  res.json(db.prepare(`SELECT * FROM interview_questions WHERE id = ?`).get(q.id));
});

// Generate a strength-based interview pack (.docx) for a published role profile.
router.post('/role-profiles/:id/interview-pack', async (req, res) => {
  try {
    const role = roleForPack(req.params.id);
    if (!role) return res.status(404).json({ error: 'Role profile not found.' });
    const published = db.prepare(`SELECT 1 FROM role_profiles WHERE id = ? AND status = 'published'`).get(role.id);
    if (!published) return res.status(400).json({ error: 'Interview packs can only be generated from published role profiles.' });

    const skills = packSkills(role.id);
    if (skills.length === 0) return res.status(400).json({ error: 'This role has no SFIA skills mapped, so no pack can be generated.' });

    const { selections, usedQuestionIds } = selectQuestions(skills, role.sfia_version_id);

    const packRow = db.prepare(`
      INSERT INTO generated_interview_packs (role_profile_id, sfia_version_id, generated_by, question_ids, skill_count)
      VALUES (?, ?, ?, ?, ?)
    `).run(role.id, role.sfia_version_id || null, req.user.id, JSON.stringify(usedQuestionIds), skills.length);
    const packId = packRow.lastInsertRowid;

    const generatedByName = `${req.user.first_name} ${req.user.last_name}`.trim();
    const buffer = await buildPackDocx({ role, selections, meta: { packId, generatedByName } });

    if (usedQuestionIds.length > 0) {
      const upd = db.prepare(`UPDATE interview_questions SET usage_count = usage_count + 1, last_used_at = datetime('now') WHERE id = ?`);
      for (const qid of usedQuestionIds) upd.run(qid);
    }
    logAudit({ ...auditCtx(req), action: 'generate', entityType: 'interview_pack', entityId: packId, details: { roleProfileId: role.id, skillCount: skills.length } });

    const safeTitle = String(role.title).replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'role';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="interview-pack_${safeTitle}_${packId}.docx"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate interview pack: ' + err.message });
  }
});

module.exports = router;
