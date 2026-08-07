// Shared assessment helpers (used by the authenticated /api/user routes and the public /api/shared view).
const db = require('../db');

// The SFIA skills a role requires, with the required level for each.
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

// Level options for a skill's assessment question: prefer imported skill-at-level descriptions; fall back
// to the 7 generic levels for skills without them (e.g. the non-SFIA-9 codes).
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

// Readiness derived from an attempt: self-assessed vs required level per skill.
function computeReadiness(attempt) {
  const skills = roleRequiredSkills(attempt.role_profile_id);
  const responses = db.prepare(`
    SELECT r.sfia_skill_id, r.self_assessed_level_id, r.confidence, r.evidence_text,
           lv.level_number AS self_level_number, lv.level_name AS self_level_name
    FROM assessment_responses r LEFT JOIN sfia_levels lv ON lv.id = r.self_assessed_level_id
    WHERE r.attempt_id = ?`).all(attempt.id);
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

// ---- FRD v0.35: business-role assessment also covers the Skills & Knowledge Framework items ----

// The framework items assigned to a business role, with the target level for each.
function businessRoleFrameworkItems(businessRoleProfileId) {
  return db.prepare(`
    SELECT bri.framework_item_id, bri.level_number AS target_level, fi.technology_or_capability, fi.family
    FROM business_role_framework_items bri
    JOIN framework_items fi ON fi.id = bri.framework_item_id
    WHERE bri.business_role_profile_id = ?
    ORDER BY fi.family, fi.technology_or_capability
  `).all(businessRoleProfileId);
}

// Level options (1-4) for a framework item assessment question, with each level's expectation text.
function frameworkItemLevelOptions(frameworkItemId) {
  const rows = db.prepare(`SELECT level_number, level_name, expectation FROM framework_item_levels WHERE framework_item_id = ? AND status = 'Active' ORDER BY level_number`).all(frameworkItemId);
  if (rows.length) return rows.map(r => ({ level_id: r.level_number, level_number: r.level_number, level_name: r.level_name, skill_level_description: r.expectation }));
  return [1, 2, 3, 4].map(n => ({ level_id: n, level_number: n, level_name: 'Level ' + n, skill_level_description: null }));
}

// Readiness over a business role's framework items (self-assessed level vs the target level). Null for a
// core-only attempt or a business role with no framework items.
function computeFrameworkReadiness(attempt) {
  if (!attempt.business_role_profile_id) return null;
  const items = businessRoleFrameworkItems(attempt.business_role_profile_id);
  if (items.length === 0) return null;
  const responses = Object.fromEntries(
    db.prepare(`SELECT framework_item_id, level_number, self_assessed_level, confidence, evidence_text FROM assessment_framework_responses WHERE attempt_id = ?`).all(attempt.id)
      .map(r => [r.framework_item_id + ':' + r.level_number, r])
  );
  let met = 0, gap = 0, unanswered = 0;
  const details = items.map(it => {
    const resp = responses[it.framework_item_id + ':' + it.target_level];
    let status, levelDiff = null;
    if (!resp || resp.self_assessed_level == null) { status = 'not_answered'; unanswered++; }
    else { levelDiff = it.target_level - resp.self_assessed_level; if (levelDiff <= 0) { status = 'met'; met++; } else { status = 'gap'; gap++; } }
    return {
      frameworkItemId: it.framework_item_id, tech: it.technology_or_capability, family: it.family,
      requiredLevel: { number: it.target_level }, selfLevel: (resp && resp.self_assessed_level != null) ? { number: resp.self_assessed_level } : null,
      confidence: resp ? resp.confidence : null, evidenceText: resp ? resp.evidence_text : null, status, levelDiff
    };
  });
  const total = items.length;
  const percent = total ? Math.round((met / total) * 100) : 0;
  let label;
  if (unanswered > 0 && attempt.status !== 'completed') label = 'In progress';
  else if (gap === 0) label = 'Ready for this role';
  else if (percent >= 60) label = 'Nearly there';
  else label = 'Development needed';
  return { total, met, gap, unanswered, percent, label, details };
}

// Average evidence confidence (1-5 ratings) across answered questions, normalised to 0-100.
function evidenceConfidencePercent(sfia, fw) {
  const vals = [];
  for (const d of sfia.details) if (d.confidence != null) vals.push(d.confidence);
  if (fw) for (const d of fw.details) if (d.confidence != null) vals.push(d.confidence);
  if (vals.length === 0) return 0;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length / 5) * 100);
}

// Combined readiness (FRD v0.36 scoring model): overall = 60% SFIA + 30% Skills & Knowledge + 10% evidence
// confidence, renormalised to whichever parts are present. Separate SFIA / SKF / overall 0-100 scores.
function overallReadiness(attempt) {
  const sfia = computeReadiness(attempt);
  const fw = computeFrameworkReadiness(attempt);
  const evidencePercent = evidenceConfidencePercent(sfia, fw);

  const parts = [{ pct: sfia.percent, w: 60 }, { pct: evidencePercent, w: 10 }];
  if (fw) parts.splice(1, 0, { pct: fw.percent, w: 30 });
  const totW = parts.reduce((a, p) => a + p.w, 0);
  const percent = Math.round(parts.reduce((a, p) => a + p.pct * p.w, 0) / totW);

  const total = sfia.total + (fw ? fw.total : 0);
  const met = sfia.met + (fw ? fw.met : 0);
  const gap = sfia.gap + (fw ? fw.gap : 0);
  const unanswered = sfia.unanswered + (fw ? fw.unanswered : 0);
  let label;
  if (unanswered > 0 && attempt.status !== 'completed') label = 'In progress';
  else if (gap === 0) label = 'Ready for this role';
  else if (percent >= 60) label = 'Nearly there';
  else label = 'Development needed';
  return { total, met, gap, unanswered, percent, label, evidencePercent, sfia, framework: fw };
}

// A user's development plan items (used by the dashboard and the shared read-only view).
function developmentPlanItems(userId) {
  return db.prepare(`
    SELECT dpi.id, dpi.sfia_skill_id, dpi.status, dpi.notes,
           sk.skill_code, sk.skill_name, rp.title AS target_role_title,
           lv.level_number AS target_level_number, lv.level_name AS target_level_name
    FROM development_plan_items dpi
    JOIN sfia_skills sk ON sk.id = dpi.sfia_skill_id
    LEFT JOIN role_profiles rp ON rp.id = dpi.target_role_profile_id
    LEFT JOIN sfia_levels lv ON lv.id = dpi.target_level_id
    WHERE dpi.user_id = ?
    ORDER BY CASE dpi.status WHEN 'in_progress' THEN 0 WHEN 'not_started' THEN 1 ELSE 2 END, dpi.created_at DESC
  `).all(userId);
}

module.exports = { roleRequiredSkills, skillLevelOptions, computeReadiness, developmentPlanItems, businessRoleFrameworkItems, frameworkItemLevelOptions, computeFrameworkReadiness, overallReadiness };
