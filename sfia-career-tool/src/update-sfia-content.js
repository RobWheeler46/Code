// One-off content-update script (non-destructive UPDATE only, unlike import-career-paths.js).
//
// Populates real SFIA 9 names/descriptions for the 24 skill codes (out of the 37 used by the
// imported role profiles) that were verified against the official SFIA 9 source workbook
// (sfia-9_current-standard_en_260521.xlsx) supplied by the user. Text is extracted directly from
// that workbook's Skills, Attributes and Levels of responsibility sheets - the same source cited
// in the FRD's Part K. Also fills in the 7 generic level descriptions (essence + the 4 core SFIA
// attributes: Autonomy, Influence, Complexity, Knowledge - not the 12 business-skills/behavioural-
// factor attributes, which would make this field unreasonably long for its purpose here).
//
// Supersedes the first version of this script (which used text extracted from the official SFIA 9
// PDF reference, since the source workbook wasn't available yet) - the two sources agreed on every
// value checked, this version just adds guidance notes and real per-record source URLs.
//
// 13 codes used by the imported role profiles (BUAN, QUMT, VUIM, AUTH, OPSG, INAN, MLEN, SYAS,
// STRP, SADM, PLMT, STAD, STRT) do NOT exist in the official SFIA 9 workbook and are left
// untouched (skill_name stays as the raw code) - see README "Known gaps".
//
// Run locally:  node src/update-sfia-content.js
// Run on Railway: railway ssh node src/update-sfia-content.js

const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const LEVELS = require(path.join(__dirname, 'data', 'sfia-levels-content.json'));
const SKILLS = require(path.join(__dirname, 'data', 'sfia-skills-content.json'));

function main() {
  const dataDir = path.join(__dirname, '..', 'data');
  const db = new DatabaseSync(path.join(dataDir, 'sfia-career-tool.db'));

  const versionRow = db.prepare("SELECT id FROM sfia_versions WHERE status = 'active' ORDER BY id DESC LIMIT 1").get();
  if (!versionRow) throw new Error('No active sfia_versions row found');
  const versionId = versionRow.id;

  db.exec('BEGIN');
  try {
    const updateVersion = db.prepare('UPDATE sfia_versions SET description = ?, updated_at = datetime(\'now\') WHERE id = ?');
    updateVersion.run(
      "SFIA 9. Skill names, descriptions and level detail for codes verified against the official SFIA 9 source workbook (sfia-9_current-standard_en_260521.xlsx) are populated from that workbook. A subset of codes referenced by imported role profiles (BUAN, QUMT, VUIM, AUTH, OPSG, INAN, MLEN, SYAS, STRP, SADM, PLMT, STAD, STRT) do not match any official SFIA 9 code and are shown as their raw code pending review.",
      versionId
    );

    const updateLevel = db.prepare('UPDATE sfia_levels SET level_name = ?, level_full_description = ?, source_reference = ? WHERE level_number = ?');
    for (const [num, l] of Object.entries(LEVELS)) {
      updateLevel.run(l.name, l.text, l.sourceUrl, Number(num));
    }

    const updateSkill = db.prepare(`
      UPDATE sfia_skills
      SET skill_name = ?, short_description = ?, full_description = ?, source_reference = ?, updated_at = datetime('now')
      WHERE sfia_version_id = ? AND skill_code = ?
    `);
    const getSkillId = db.prepare('SELECT id FROM sfia_skills WHERE sfia_version_id = ? AND skill_code = ?');
    const getLevelId = db.prepare('SELECT id FROM sfia_levels WHERE level_number = ?');
    const upsertSkillLevel = db.prepare(`
      INSERT INTO sfia_skill_level_descriptions (sfia_version_id, sfia_skill_id, sfia_level_id, skill_level_description, source_reference)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(sfia_skill_id, sfia_level_id) DO UPDATE SET
        skill_level_description = excluded.skill_level_description,
        source_reference = excluded.source_reference,
        updated_at = datetime('now')
    `);

    let skillsUpdated = 0;
    let levelDescsUpserted = 0;
    const matchedCodes = Object.keys(SKILLS).sort();

    for (const code of matchedCodes) {
      const s = SKILLS[code];
      const result = updateSkill.run(s.name, s.overview, s.fullDescription, s.sourceUrl, versionId, code);
      if (result.changes === 0) {
        console.warn(`No sfia_skills row found for code ${code} in version ${versionId} - skipped`);
        continue;
      }
      skillsUpdated++;

      const skillRow = getSkillId.get(versionId, code);
      for (const [levelNum, text] of Object.entries(s.levels)) {
        const levelRow = getLevelId.get(Number(levelNum));
        if (!levelRow) continue;
        upsertSkillLevel.run(versionId, skillRow.id, levelRow.id, text, s.sourceUrl);
        levelDescsUpserted++;
      }
    }

    db.exec('COMMIT');
    console.log(`Updated 7 sfia_levels rows.`);
    console.log(`Updated ${skillsUpdated}/${matchedCodes.length} sfia_skills rows.`);
    console.log(`Upserted ${levelDescsUpserted} sfia_skill_level_descriptions rows.`);

    const allCodes = db.prepare('SELECT skill_code FROM sfia_skills WHERE sfia_version_id = ? ORDER BY skill_code').all(versionId).map(r => r.skill_code);
    const unmatched = allCodes.filter(c => !SKILLS[c]);
    console.log(`Unmatched codes left as-is (${unmatched.length}): ${unmatched.join(', ')}`);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

main();
