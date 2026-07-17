// One-off reference-data import (FRD v0.21-v0.23 Part K / final appendix "SFIA 9 Workbook
// Re-check and Clean Import Template").
//
// Loads the full official SFIA 9 catalogue from SFIA_9_Clean_Import_Template_v0_23.xlsx - 147
// professional skills, 672 skill-at-level descriptions, 7 levels of responsibility, 16
// attributes/business skills and 112 attribute-at-level descriptions - and writes it into the
// live database. This supersedes the earlier hand-curated subset in update-sfia-content.js,
// which only covered the 24 (of 37) skill codes referenced by imported role profiles that could
// be manually verified before this structured source workbook was available.
//
// Safe to re-run: every write is an UPDATE-if-exists/INSERT-if-not against a stable natural key
// (skill_code, level_number, attribute_code), never a delete-and-recreate. Existing sfia_skills
// rows keep their id, so role_profile_skills foreign keys are never disturbed. The 13 skill codes
// used by role profiles that don't match any official SFIA 9 code (flagged by
// flag-unmatched-skills.js) are untouched, because they simply never match a row in the source
// workbook.
//
// Run locally:  node src/import-sfia-9-reference-data.js "C:\path\to\SFIA_9_Clean_Import_Template_v0_23.xlsx"
// Run on Railway: railway ssh node src/import-sfia-9-reference-data.js <path>

const XLSX = require('xlsx');
const db = require('./db'); // ensures schema/migrations (incl. this feature's new columns/tables) are applied first

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node src/import-sfia-9-reference-data.js <path to Clean Import Template xlsx>');
  process.exit(1);
}

function sheetRows(wb, name) {
  const sheet = wb.Sheets[name];
  if (!sheet) throw new Error(`Required worksheet "${name}" not found in workbook`);
  return XLSX.utils.sheet_to_json(sheet, { defval: null });
}

function main() {
  const wb = XLSX.readFile(filePath);
  const skillsRows = sheetRows(wb, 'SFIA_Skills');
  const skillLevelRows = sheetRows(wb, 'Skill_Level_Descriptions');
  const levelRows = sheetRows(wb, 'SFIA_Levels');
  const attributeRows = sheetRows(wb, 'SFIA_Attributes');
  const attributeLevelRows = sheetRows(wb, 'Attribute_Level_Descriptions');

  const versionRow = db.prepare("SELECT id FROM sfia_versions WHERE version_name = 'SFIA 9' AND status = 'active'").get();
  if (!versionRow) throw new Error('No active "SFIA 9" row found in sfia_versions - run src/seed.js first');
  const versionId = versionRow.id;

  const stats = { categories: 0, skillsInserted: 0, skillsUpdated: 0, levelsUpdated: 0, skillLevelDescUpserted: 0, attributesUpserted: 0, attributeLevelDescUpserted: 0 };

  const getCategory = db.prepare('SELECT id FROM sfia_categories WHERE sfia_version_id = ? AND name = ?');
  const insertCategory = db.prepare('INSERT INTO sfia_categories (sfia_version_id, name) VALUES (?, ?)');
  function categoryId(name) {
    if (!name) return null;
    const existing = getCategory.get(versionId, name);
    if (existing) return existing.id;
    stats.categories++;
    return insertCategory.run(versionId, name).lastInsertRowid;
  }

  const getSkill = db.prepare('SELECT id FROM sfia_skills WHERE sfia_version_id = ? AND skill_code = ?');
  const insertSkill = db.prepare(`
    INSERT INTO sfia_skills (sfia_version_id, sfia_category_id, skill_code, skill_name, subcategory, short_description, full_description, guidance_notes, source_reference)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateSkill = db.prepare(`
    UPDATE sfia_skills SET sfia_category_id = ?, skill_name = ?, subcategory = ?, short_description = ?, full_description = ?, guidance_notes = ?, source_reference = ?, updated_at = datetime('now')
    WHERE id = ?
  `);

  const getLevelByNumber = db.prepare('SELECT id FROM sfia_levels WHERE level_number = ?');
  const updateLevel = db.prepare(`
    UPDATE sfia_levels SET level_name = ?, description = ?, level_full_description = ?, source_reference = ?
    WHERE level_number = ?
  `);

  const upsertSkillLevelDesc = db.prepare(`
    INSERT INTO sfia_skill_level_descriptions (sfia_version_id, sfia_skill_id, sfia_level_id, skill_level_description, source_reference)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(sfia_skill_id, sfia_level_id) DO UPDATE SET
      skill_level_description = excluded.skill_level_description,
      source_reference = excluded.source_reference,
      updated_at = datetime('now')
  `);

  const getAttribute = db.prepare('SELECT id FROM sfia_attributes WHERE sfia_version_id = ? AND attribute_code = ?');
  const insertAttribute = db.prepare(`
    INSERT INTO sfia_attributes (sfia_version_id, attribute_code, attribute_name, attribute_type, overall_description, source_reference)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const updateAttribute = db.prepare(`
    UPDATE sfia_attributes SET attribute_name = ?, attribute_type = ?, overall_description = ?, source_reference = ?, updated_at = datetime('now')
    WHERE id = ?
  `);

  const upsertAttributeLevelDesc = db.prepare(`
    INSERT INTO sfia_attribute_level_descriptions (sfia_version_id, sfia_attribute_id, sfia_level_id, level_description, source_reference)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(sfia_attribute_id, sfia_level_id) DO UPDATE SET
      level_description = excluded.level_description,
      source_reference = excluded.source_reference,
      updated_at = datetime('now')
  `);

  db.exec('BEGIN');
  try {
    // 1. Skills
    for (const row of skillsRows) {
      const code = row.sfia_skill_code;
      if (!code) continue;
      const catId = categoryId(row.category);
      const shortDesc = row.overall_description || null;
      const fullDesc = row.guidance_notes ? `${row.overall_description || ''}\n\nGuidance notes:\n${row.guidance_notes}`.trim() : row.overall_description;
      const existing = getSkill.get(versionId, code);
      if (existing) {
        updateSkill.run(catId, row.skill_name, row.subcategory, shortDesc, fullDesc, row.guidance_notes, row.source_url, existing.id);
        stats.skillsUpdated++;
      } else {
        insertSkill.run(versionId, catId, code, row.skill_name, row.subcategory, shortDesc, fullDesc, row.guidance_notes, row.source_url);
        stats.skillsInserted++;
      }
    }

    // 2. Levels
    for (const row of levelRows) {
      const result = updateLevel.run(row.guiding_phrase, row.essence_of_level, row.essence_of_level, row.source_url, row.sfia_level);
      if (result.changes > 0) stats.levelsUpdated++;
    }

    // 3. Skill-level descriptions
    for (const row of skillLevelRows) {
      const skill = getSkill.get(versionId, row.sfia_skill_code);
      const level = getLevelByNumber.get(row.sfia_level);
      if (!skill || !level) { console.warn(`Skipping skill-level row: ${row.sfia_skill_code} L${row.sfia_level} - skill or level not found`); continue; }
      upsertSkillLevelDesc.run(versionId, skill.id, level.id, row.level_description, row.source_url);
      stats.skillLevelDescUpserted++;
    }

    // 4. Attributes
    for (const row of attributeRows) {
      const code = row.attribute_code;
      if (!code) continue;
      const existing = getAttribute.get(versionId, code);
      if (existing) {
        updateAttribute.run(row.attribute_name, row.attribute_type, row.overall_description, row.source_url, existing.id);
      } else {
        insertAttribute.run(versionId, code, row.attribute_name, row.attribute_type, row.overall_description, row.source_url);
      }
      stats.attributesUpserted++;
    }

    // 5. Attribute-level descriptions
    for (const row of attributeLevelRows) {
      const attribute = getAttribute.get(versionId, row.attribute_code);
      const level = getLevelByNumber.get(row.sfia_level);
      if (!attribute || !level) { console.warn(`Skipping attribute-level row: ${row.attribute_code} L${row.sfia_level} - attribute or level not found`); continue; }
      upsertAttributeLevelDesc.run(versionId, attribute.id, level.id, row.level_description, row.source_url);
      stats.attributeLevelDescUpserted++;
    }

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  console.log('SFIA 9 reference data import complete:');
  console.log(`  Categories created: ${stats.categories}`);
  console.log(`  Skills inserted: ${stats.skillsInserted}, updated: ${stats.skillsUpdated}`);
  console.log(`  Levels updated: ${stats.levelsUpdated}`);
  console.log(`  Skill-level descriptions upserted: ${stats.skillLevelDescUpserted}`);
  console.log(`  Attributes upserted: ${stats.attributesUpserted}`);
  console.log(`  Attribute-level descriptions upserted: ${stats.attributeLevelDescUpserted}`);
}

main();
