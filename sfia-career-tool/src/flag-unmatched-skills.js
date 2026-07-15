// One-off content-update script (non-destructive UPDATE only).
//
// The imported role profiles reference 13 skill codes that were checked against the complete
// official SFIA 9 source workbook (147 skills + 16 attributes) and don't match anything in it:
// BUAN, QUMT, VUIM, AUTH, OPSG, INAN, MLEN, SYAS, STRP, SADM, PLMT, STAD, STRT.
//
// This does not guess at what they should mean (no invented SFIA-sounding names/descriptions -
// see README "Known gaps"). It only replaces the generic "not yet populated" placeholder text
// with a clear statement that the code isn't in SFIA 9, so an admin/visitor sees an explicit
// explanation rather than a silently-unpopulated-looking entry.
//
// Run locally:  node src/flag-unmatched-skills.js
// Run on Railway: railway ssh node src/flag-unmatched-skills.js

const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const UNMATCHED_CODES = [
  'BUAN', 'QUMT', 'VUIM', 'AUTH', 'OPSG', 'INAN', 'MLEN', 'SYAS', 'STRP', 'SADM', 'PLMT', 'STAD', 'STRT'
];

const MESSAGE = 'Not an official SFIA 9 code. This code was checked against the complete SFIA 9 source '
  + 'workbook (147 professional skills and 16 attributes) and does not appear in it - likely a legacy '
  + 'SFIA version code or organisation-specific shorthand from the source spreadsheet '
  + '(EngineeringCareerPathsV3.xlsx). An admin should confirm the intended skill and update this record, '
  + 'or remap the role profiles that use it to the correct SFIA 9 code.';

function main() {
  const dataDir = path.join(__dirname, '..', 'data');
  const db = new DatabaseSync(path.join(dataDir, 'sfia-career-tool.db'));

  const versionRow = db.prepare("SELECT id FROM sfia_versions WHERE status = 'active' ORDER BY id DESC LIMIT 1").get();
  if (!versionRow) throw new Error('No active sfia_versions row found');
  const versionId = versionRow.id;

  const updateSkill = db.prepare(`
    UPDATE sfia_skills
    SET short_description = ?, updated_at = datetime('now')
    WHERE sfia_version_id = ? AND skill_code = ?
  `);

  let updated = 0;
  db.exec('BEGIN');
  try {
    for (const code of UNMATCHED_CODES) {
      const result = updateSkill.run(MESSAGE, versionId, code);
      if (result.changes > 0) updated++;
      else console.warn(`No sfia_skills row found for code ${code} in version ${versionId} - skipped`);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  console.log(`Updated ${updated}/${UNMATCHED_CODES.length} unmatched skill records with a clear "not SFIA 9" label.`);
}

main();
