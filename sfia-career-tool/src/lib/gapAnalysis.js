const db = require('../db');

function loadRoleSkills(roleProfileId) {
  return db.prepare(`
    SELECT rps.sfia_skill_id, rps.importance, rps.rationale,
           sk.skill_code, sk.skill_name, sk.sfia_category_id,
           lv.id AS level_id, lv.level_number, lv.level_name
    FROM role_profile_skills rps
    JOIN sfia_skills sk ON sk.id = rps.sfia_skill_id
    JOIN sfia_levels lv ON lv.id = rps.required_sfia_level_id
    WHERE rps.role_profile_id = ?
  `).all(roleProfileId);
}

function gapSeverity(levelDiff) {
  if (levelDiff <= 0) return 'No gap';
  if (levelDiff === 1) return 'Minor gap';
  if (levelDiff === 2) return 'Moderate gap';
  return 'Significant gap';
}

function learningResourcesForSkill({ sfiaSkillId, targetLevelNumber, roleFamilyId, capabilityAreaId, gapType }) {
  const rows = db.prepare(`
    SELECT lrs.id AS mapping_id, lrs.priority, lrs.gap_type, lrs.role_family_id, lrs.capability_area_id,
           lv_min.level_number AS min_level_number, lv_max.level_number AS max_level_number,
           lr.id, lr.title, lr.description, lr.provider, lr.url, lr.resource_type,
           lr.delivery_method, lr.estimated_duration, lr.cost_type
    FROM learning_resource_skills lrs
    JOIN learning_resources lr ON lr.id = lrs.learning_resource_id AND lr.status = 'published'
    LEFT JOIN sfia_levels lv_min ON lv_min.id = lrs.min_sfia_level_id
    LEFT JOIN sfia_levels lv_max ON lv_max.id = lrs.max_sfia_level_id
    WHERE lrs.sfia_skill_id = ?
    ORDER BY CASE lrs.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, lr.title
  `).all(sfiaSkillId);

  return rows.filter(r => {
    if (r.min_level_number != null && targetLevelNumber != null && targetLevelNumber < r.min_level_number) return false;
    if (r.max_level_number != null && targetLevelNumber != null && targetLevelNumber > r.max_level_number) return false;
    if (r.role_family_id != null && roleFamilyId != null && r.role_family_id !== roleFamilyId) return false;
    if (r.capability_area_id != null && capabilityAreaId != null && r.capability_area_id !== capabilityAreaId) return false;
    if (r.gap_type != null && gapType != null && r.gap_type !== gapType) return false;
    return true;
  }).map(r => ({
    id: r.id,
    title: r.title,
    description: r.description,
    provider: r.provider,
    url: r.url,
    resourceType: r.resource_type,
    deliveryMethod: r.delivery_method,
    estimatedDuration: r.estimated_duration,
    costType: r.cost_type,
    priority: r.priority
  }));
}

function compareRoles(currentRoleProfile, aspirationalRoleProfile) {
  const currentSkills = loadRoleSkills(currentRoleProfile.id);
  const aspirationalSkills = loadRoleSkills(aspirationalRoleProfile.id);

  const currentBySkill = new Map(currentSkills.map(s => [s.sfia_skill_id, s]));
  const aspirationalBySkill = new Map(aspirationalSkills.map(s => [s.sfia_skill_id, s]));

  const details = [];

  for (const aspSkill of aspirationalSkills) {
    const curSkill = currentBySkill.get(aspSkill.sfia_skill_id);
    let gapStatus, gapSeverityLabel, levelDiff = null;

    if (!curSkill) {
      gapStatus = 'new_skill_required';
      gapSeverityLabel = 'New skill required';
    } else {
      levelDiff = aspSkill.level_number - curSkill.level_number;
      if (levelDiff <= 0) {
        gapStatus = 'no_gap';
      } else {
        gapStatus = 'level_uplift';
      }
      gapSeverityLabel = gapSeverity(levelDiff);
    }

    const gapType = gapStatus === 'new_skill_required' ? 'new_skill' : (gapStatus === 'level_uplift' ? 'level_uplift' : null);
    const learningResources = gapStatus === 'no_gap' ? [] : learningResourcesForSkill({
      sfiaSkillId: aspSkill.sfia_skill_id,
      targetLevelNumber: aspSkill.level_number,
      roleFamilyId: aspirationalRoleProfile.role_family_id,
      capabilityAreaId: aspirationalRoleProfile.capability_area_id,
      gapType
    });

    details.push({
      sfiaSkillId: aspSkill.sfia_skill_id,
      skillCode: aspSkill.skill_code,
      skillName: aspSkill.skill_name,
      importance: aspSkill.importance,
      currentLevel: curSkill ? { number: curSkill.level_number, name: curSkill.level_name } : null,
      aspirationalLevel: { number: aspSkill.level_number, name: aspSkill.level_name },
      levelDiff,
      gapStatus,
      gapSeverity: gapSeverityLabel,
      learningResources
    });
  }

  // Skills present on the current role but not required by the aspirational role.
  for (const curSkill of currentSkills) {
    if (aspirationalBySkill.has(curSkill.sfia_skill_id)) continue;
    details.push({
      sfiaSkillId: curSkill.sfia_skill_id,
      skillCode: curSkill.skill_code,
      skillName: curSkill.skill_name,
      importance: curSkill.importance,
      currentLevel: { number: curSkill.level_number, name: curSkill.level_name },
      aspirationalLevel: null,
      levelDiff: null,
      gapStatus: 'current_role_strength',
      gapSeverity: 'Not applicable',
      learningResources: []
    });
  }

  details.sort((a, b) => a.skillCode.localeCompare(b.skillCode));

  const summary = {
    totalGaps: details.filter(d => d.gapStatus === 'new_skill_required' || d.gapStatus === 'level_uplift').length,
    newSkillsRequired: details.filter(d => d.gapStatus === 'new_skill_required').length,
    levelUpliftRequired: details.filter(d => d.gapStatus === 'level_uplift').length,
    alignedSkills: details.filter(d => d.gapStatus === 'no_gap').length,
    currentRoleStrengths: details.filter(d => d.gapStatus === 'current_role_strength').length
  };

  return { summary, details };
}

function learningPreviewForRole(role, skills, limit = 4) {
  const ordered = [...skills].sort((a, b) => {
    const rank = { core: 0, important: 1, optional: 2 };
    return (rank[a.importance] ?? 3) - (rank[b.importance] ?? 3);
  });
  const seen = new Set();
  const preview = [];
  for (const skill of ordered) {
    if (preview.length >= limit) break;
    const matches = learningResourcesForSkill({
      sfiaSkillId: skill.sfia_skill_id,
      targetLevelNumber: skill.level_number,
      roleFamilyId: role.role_family_id,
      capabilityAreaId: role.capability_area_id,
      gapType: null
    });
    for (const m of matches) {
      if (preview.length >= limit || seen.has(m.id)) continue;
      seen.add(m.id);
      preview.push(m);
    }
  }
  return preview;
}

module.exports = { compareRoles, loadRoleSkills, learningResourcesForSkill, learningPreviewForRole, gapSeverity };
