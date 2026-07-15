const express = require('express');
const db = require('../db');
const { compareRoles, learningPreviewForRole } = require('../lib/gapAnalysis');
const { logUsageEvent } = require('../lib/helpers');

function parseJson(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch (e) { return null; }
}

function roleCardSummaries(roleIds) {
  if (roleIds.length === 0) return [];
  const placeholders = roleIds.map(() => '?').join(',');
  const roles = db.prepare(`
    SELECT rp.id, rp.title, rp.summary, rp.seniority_level, rp.role_type,
           rf.name AS role_family_name, ca.name AS capability_area_name
    FROM role_profiles rp
    LEFT JOIN role_families rf ON rf.id = rp.role_family_id
    LEFT JOIN capability_areas ca ON ca.id = rp.capability_area_id
    WHERE rp.id IN (${placeholders}) AND rp.status = 'published'
  `).all(...roleIds);

  const skillRows = db.prepare(`
    SELECT rps.role_profile_id, rps.importance, lv.level_number
    FROM role_profile_skills rps
    JOIN sfia_levels lv ON lv.id = rps.required_sfia_level_id
    WHERE rps.role_profile_id IN (${placeholders})
  `).all(...roleIds);

  const statsByRole = {};
  for (const row of skillRows) {
    const s = statsByRole[row.role_profile_id] || (statsByRole[row.role_profile_id] = { coreCount: 0, minLevel: null, maxLevel: null });
    if (row.importance === 'core') s.coreCount += 1;
    if (s.minLevel === null || row.level_number < s.minLevel) s.minLevel = row.level_number;
    if (s.maxLevel === null || row.level_number > s.maxLevel) s.maxLevel = row.level_number;
  }

  return roles.map(r => ({
    ...r,
    coreSkillCount: statsByRole[r.id]?.coreCount || 0,
    minLevel: statsByRole[r.id]?.minLevel ?? null,
    maxLevel: statsByRole[r.id]?.maxLevel ?? null
  }));
}

const router = express.Router();

router.get('/role-families', (req, res) => {
  const families = db.prepare(`SELECT * FROM role_families WHERE status = 'active' ORDER BY display_order, name`).all();
  res.json(families);
});

router.get('/capability-areas', (req, res) => {
  const { roleFamilyId } = req.query;
  let rows;
  if (roleFamilyId) {
    rows = db.prepare(`SELECT * FROM capability_areas WHERE status = 'active' AND role_family_id = ? ORDER BY display_order, name`).all(roleFamilyId);
  } else {
    rows = db.prepare(`SELECT * FROM capability_areas WHERE status = 'active' ORDER BY display_order, name`).all();
  }
  res.json(rows);
});

router.get('/roles', (req, res) => {
  const { search, roleFamilyId, capabilityAreaId, seniorityLevel } = req.query;
  let sql = `
    SELECT rp.id, rp.title, rp.summary, rp.seniority_level, rp.role_type,
           rf.id AS role_family_id, rf.name AS role_family_name,
           ca.id AS capability_area_id, ca.name AS capability_area_name
    FROM role_profiles rp
    LEFT JOIN role_families rf ON rf.id = rp.role_family_id
    LEFT JOIN capability_areas ca ON ca.id = rp.capability_area_id
    WHERE rp.status = 'published'
  `;
  const params = [];
  if (search) {
    sql += ` AND (rp.title LIKE ? OR rp.summary LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`);
  }
  if (roleFamilyId) {
    sql += ` AND rp.role_family_id = ?`;
    params.push(roleFamilyId);
  }
  if (capabilityAreaId) {
    sql += ` AND rp.capability_area_id = ?`;
    params.push(capabilityAreaId);
  }
  if (seniorityLevel) {
    sql += ` AND rp.seniority_level = ?`;
    params.push(seniorityLevel);
  }
  sql += ` ORDER BY rf.display_order, rp.title`;
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

router.get('/roles/:id', (req, res) => {
  const role = db.prepare(`
    SELECT rp.*, rf.name AS role_family_name, ca.name AS capability_area_name
    FROM role_profiles rp
    LEFT JOIN role_families rf ON rf.id = rp.role_family_id
    LEFT JOIN capability_areas ca ON ca.id = rp.capability_area_id
    WHERE rp.id = ? AND rp.status = 'published'
  `).get(req.params.id);
  if (!role) return res.status(404).json({ error: 'Role profile not found.' });

  const skills = db.prepare(`
    SELECT rps.importance, rps.rationale, rps.display_order, rps.role_specific_display_notes, rps.show_full_description,
           sk.id AS sfia_skill_id, sk.skill_code, sk.skill_name, sk.short_description, sk.full_description AS skill_full_description,
           sk.source_reference AS skill_source_reference, sc.name AS category_name,
           lv.id AS sfia_level_id, lv.level_number, lv.level_name, lv.level_full_description, lv.source_reference AS level_source_reference,
           sld.skill_level_description, sld.guidance_notes AS skill_level_guidance_notes, sld.source_reference AS skill_level_source_reference
    FROM role_profile_skills rps
    JOIN sfia_skills sk ON sk.id = rps.sfia_skill_id
    JOIN sfia_levels lv ON lv.id = rps.required_sfia_level_id
    LEFT JOIN sfia_categories sc ON sc.id = sk.sfia_category_id
    LEFT JOIN sfia_skill_level_descriptions sld ON sld.sfia_skill_id = sk.id AND sld.sfia_level_id = lv.id AND sld.status = 'active'
    WHERE rps.role_profile_id = ?
    ORDER BY rps.display_order, sk.skill_code
  `).all(role.id);

  const relatedRoles = db.prepare(`
    SELECT id, title, summary, seniority_level FROM role_profiles
    WHERE status = 'published' AND role_family_id = ? AND id != ?
    ORDER BY title LIMIT 5
  `).all(role.role_family_id, role.id);

  const coreSkillCount = skills.filter(s => s.importance === 'core').length;
  const learningPreview = learningPreviewForRole(role, skills);

  const sfiaVersions = db.prepare(`
    SELECT DISTINCT v.version_name
    FROM role_profile_skills rps
    JOIN sfia_skills sk ON sk.id = rps.sfia_skill_id
    JOIN sfia_versions v ON v.id = sk.sfia_version_id
    WHERE rps.role_profile_id = ?
  `).all(role.id).map(r => r.version_name);

  const pathways = db.prepare(`
    SELECT DISTINCT cp.id, cp.pathway_name
    FROM career_pathway_roles cpr
    JOIN career_pathways cp ON cp.id = cpr.career_pathway_id
    WHERE cpr.role_profile_id = ? AND cp.status = 'published'
    ORDER BY cp.pathway_name
  `).all(role.id);

  logUsageEvent({ sessionId: req.sessionID, eventType: 'view_role', roleProfileId: role.id });
  res.json({
    ...role,
    roleAtAGlance: parseJson(role.role_at_a_glance),
    displayTags: parseJson(role.display_tags) || [],
    skills,
    coreSkillCount,
    relatedRoles,
    learningPreview,
    pathways,
    sfiaVersions
  });
});

router.get('/pathways', (req, res) => {
  const { roleFamilyId, pathwayType } = req.query;
  let sql = `
    SELECT cp.id, cp.pathway_name, cp.pathway_description, cp.pathway_type,
           rf.id AS role_family_id, rf.name AS role_family_name
    FROM career_pathways cp
    LEFT JOIN role_families rf ON rf.id = cp.role_family_id
    WHERE cp.status = 'published'
  `;
  const params = [];
  if (roleFamilyId) { sql += ` AND cp.role_family_id = ?`; params.push(roleFamilyId); }
  if (pathwayType) { sql += ` AND cp.pathway_type = ?`; params.push(pathwayType); }
  sql += ` ORDER BY cp.display_order, cp.pathway_name`;
  res.json(db.prepare(sql).all(...params));
});

router.get('/pathways/:id', (req, res) => {
  const pathway = db.prepare(`
    SELECT cp.*, rf.name AS role_family_name
    FROM career_pathways cp
    LEFT JOIN role_families rf ON rf.id = cp.role_family_id
    WHERE cp.id = ? AND cp.status = 'published'
  `).get(req.params.id);
  if (!pathway) return res.status(404).json({ error: 'Career pathway not found.' });

  const pathwayRoles = db.prepare(`
    SELECT role_profile_id, pathway_stage, display_label, is_starting_role, is_end_role
    FROM career_pathway_roles
    WHERE career_pathway_id = ?
    ORDER BY pathway_stage
  `).all(pathway.id);

  const roleIds = pathwayRoles.map(r => r.role_profile_id);
  const roleSummaries = roleCardSummaries(roleIds);
  const roleById = Object.fromEntries(roleSummaries.map(r => [r.id, r]));

  const roles = pathwayRoles
    .filter(pr => roleById[pr.role_profile_id])
    .map(pr => ({ ...roleById[pr.role_profile_id], pathwayStage: pr.pathway_stage, displayLabel: pr.display_label, isStartingRole: !!pr.is_starting_role, isEndRole: !!pr.is_end_role }));

  const connections = roleIds.length > 0 ? db.prepare(`
    SELECT cpc.from_role_profile_id, cpc.to_role_profile_id, cpc.connection_type, cpc.connection_description
    FROM career_pathway_connections cpc
    WHERE cpc.career_pathway_id = ? AND cpc.status = 'active'
    ORDER BY cpc.display_order
  `).all(pathway.id) : [];

  res.json({ ...pathway, roles, connections });
});

router.post('/compare', (req, res) => {
  const { currentRoleId, aspirationalRoleId } = req.body || {};
  if (!currentRoleId || !aspirationalRoleId) {
    return res.status(400).json({ error: 'A current role and an aspirational role are both required.' });
  }
  if (String(currentRoleId) === String(aspirationalRoleId)) {
    return res.status(400).json({ error: 'Select two different role profiles to compare.' });
  }
  const currentRole = db.prepare(`SELECT * FROM role_profiles WHERE id = ? AND status = 'published'`).get(currentRoleId);
  const aspirationalRole = db.prepare(`SELECT * FROM role_profiles WHERE id = ? AND status = 'published'`).get(aspirationalRoleId);
  if (!currentRole || !aspirationalRole) return res.status(404).json({ error: 'One or both role profiles could not be found.' });

  const result = compareRoles(currentRole, aspirationalRole);
  logUsageEvent({
    sessionId: req.sessionID,
    eventType: 'compare_roles',
    roleProfileId: currentRole.id,
    aspirationalRoleProfileId: aspirationalRole.id
  });
  const versionName = (roleProfile) => {
    if (!roleProfile.sfia_version_id) return null;
    return db.prepare(`SELECT version_name FROM sfia_versions WHERE id = ?`).get(roleProfile.sfia_version_id)?.version_name || null;
  };

  res.json({
    currentRole: { id: currentRole.id, title: currentRole.title, sfiaVersion: versionName(currentRole) },
    aspirationalRole: { id: aspirationalRole.id, title: aspirationalRole.title, sfiaVersion: versionName(aspirationalRole) },
    ...result
  });
});

module.exports = router;
