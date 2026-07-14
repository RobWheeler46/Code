// One-off content-update script (non-destructive UPDATE only, unlike import-career-paths.js).
//
// Populates real SFIA 9 names/descriptions for the 24 skill codes (out of the 37 used by the
// imported role profiles) that were verified against the official SFIA 9 framework reference PDF
// supplied by the user. Text is transcribed/extracted from that PDF's skill and level-descriptor
// pages. Also fills in the 7 generic level descriptions.
//
// 13 codes used by the imported role profiles (BUAN, QUMT, VUIM, AUTH, OPSG, INAN, MLEN, SYAS,
// STRP, SADM, PLMT, STAD, STRT) do NOT exist in the official SFIA 9 reference and are left
// untouched (skill_name stays as the raw code) - see README "Known gaps".
//
// Run locally:  node src/update-sfia-content.js
// Run on Railway: railway ssh node src/update-sfia-content.js

const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const SOURCE = 'SFIA 9 official framework reference (sfia_9_framework_reference_250129.pdf), supplied by organisation';

const LEVELS = {
  1: {
    name: 'Follow',
    text: `Essence of the level: Performs routine tasks under close supervision, follows instructions, and requires guidance to complete their work. Learns and applies basic skills and knowledge.

Autonomy: Follows instructions and works under close direction. Receives specific instructions and guidance, has work closely reviewed.

Influence: When required, contributes to team discussions with immediate colleagues.

Complexity: Performs routine activities in a structured environment.

Knowledge: Applies basic knowledge to perform routine, well-defined, predictable role-specific tasks.`
  },
  2: {
    name: 'Assist',
    text: `Essence of the level: Provides assistance to others, works under routine supervision, and uses their discretion to address routine problems. Actively learns through training and on-the-job experiences.

Autonomy: Works under routine direction. Receives instructions and guidance, has work regularly reviewed.

Influence: Is expected to contribute to team discussions with immediate team members. Works alongside team members, contributing to team decisions. When the role requires, interacts with people outside their team, including internal colleagues and external contacts.

Complexity: Performs a range of work activities in varied environments.

Knowledge: Applies knowledge of common workplace tasks and practices to support team activities under guidance.`
  },
  3: {
    name: 'Apply',
    text: `Essence of the level: Performs varied tasks, sometimes complex and non-routine, using standard methods and procedures. Works under general direction, exercises discretion, and manages own work within deadlines. Proactively enhances skills and impact in the workplace.

Autonomy: Works under general direction to complete assigned tasks. Receives guidance and has work reviewed at agreed milestones. When required, delegates routine tasks to others within own team.

Influence: Works with and influences team decisions. Has a transactional level of contact with people outside their team, including internal colleagues and external contacts.

Complexity: Performs a range of work, sometimes complex and non-routine, in varied environments.

Knowledge: Applies knowledge of a range of role-specific practices to complete tasks within defined boundaries and has an appreciation of how this knowledge applies to the wider business context.`
  },
  4: {
    name: 'Enable',
    text: `Essence of the level: Performs diverse complex activities, supports and guides others, delegates tasks when appropriate, works autonomously under general direction, and contributes expertise to deliver team objectives.

Autonomy: Works under general direction within a clear framework of accountability. Exercises considerable personal responsibility and autonomy. When required, plans, schedules, and delegates work to others, typically within own team.

Influence: Influences projects and team objectives. Has a tactical level of contact with people outside their team, including internal colleagues and external contacts.

Complexity: Work includes a broad range of complex technical or professional activities in varied contexts.

Knowledge: Applies knowledge across different areas in their field, integrating this knowledge to perform complex and diverse tasks. Applies a working knowledge of the organisation's domain.`
  },
  5: {
    name: 'Ensure, advise',
    text: `Essence of the level: Provides authoritative guidance in their field and works under broad direction. Accountable for delivering significant work outcomes, from analysis through execution to evaluation.

Autonomy: Works under broad direction. Work is self-initiated, consistent with agreed operational and budgetary requirements for meeting allocated technical and/or group objectives. Defines tasks and delegates work to teams and individuals within area of responsibility.

Influence: Influences critical decisions in their domain. Has operational level contact impacting execution and implementation with internal colleagues and external contacts. Has significant influence over the allocation and management of resources required to deliver projects.

Complexity: Performs an extensive range of complex technical and/or professional work activities, requiring the application of fundamental principles in a range of unpredictable contexts.

Knowledge: Applies knowledge to interpret complex situations and offer authoritative advice. Applies in-depth expertise in specific fields, with a broader understanding across industry/business.`
  },
  6: {
    name: 'Initiate, influence',
    text: `Essence of the level: Has significant organisational influence, makes high-level decisions, shapes policies, demonstrates leadership, promotes organisational collaboration, and accepts accountability in key areas.

Autonomy: Guides high level decisions and strategies within the organisation's overall policies and objectives. Has defined authority and accountability for actions and decisions within a significant area of work, including technical, financial and quality aspects. Delegates responsibility for operational objectives.

Influence: Influences the formation of strategy and the execution of business plans. Has a significant management level of contact with internal colleagues and external contacts. Has organisational leadership and influence over the appointment and management of resources related to the implementation of strategic initiatives.

Complexity: Performs highly complex work activities covering technical, financial and quality aspects.

Knowledge: Applies broad business knowledge to enable strategic leadership and decision-making across various domains.`
  },
  7: {
    name: 'Set strategy, inspire, mobilise',
    text: `Essence of the level: Operates at the highest organisational level, determines overall organisational vision and strategy, and assumes accountability for overall success.

Autonomy: Defines and leads the organisation's vision and strategy within over-arching business objectives. Is fully accountable for actions taken and decisions made, both by self and others to whom responsibilities have been assigned. Delegates authority and responsibility for strategic business objectives.

Influence: Directs, influences and inspires the strategic direction and development of the organisation. Has an extensive leadership level of contact with internal colleagues and external contacts. Authorises the appointment of required resources.

Complexity: Performs extensive strategic leadership in delivering business value through vision, governance and executive management.

Knowledge: Applies strategic and broad-based knowledge to shape organisational strategy, anticipate future industry trends, and prepare the organisation to adapt and lead.`
  }
};

// Real names, overviews (used as skill_name / short_description+full_description) and per-level
// skill-specific text, transcribed/extracted from the official SFIA 9 reference PDF.
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
      "SFIA 9. Skill names and descriptions for codes verified against the official SFIA 9 framework reference are populated from that document. A subset of codes referenced by imported role profiles (BUAN, QUMT, VUIM, AUTH, OPSG, INAN, MLEN, SYAS, STRP, SADM, PLMT, STAD, STRT) do not match any official SFIA 9 code and are shown as their raw code pending review.",
      versionId
    );

    const updateLevel = db.prepare('UPDATE sfia_levels SET level_name = ?, level_full_description = ?, source_reference = ? WHERE level_number = ?');
    for (const [num, l] of Object.entries(LEVELS)) {
      updateLevel.run(l.name, l.text, SOURCE, Number(num));
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
      const result = updateSkill.run(s.name, s.overview, s.overview, SOURCE, versionId, code);
      if (result.changes === 0) {
        console.warn(`No sfia_skills row found for code ${code} in version ${versionId} - skipped`);
        continue;
      }
      skillsUpdated++;

      const skillRow = getSkillId.get(versionId, code);
      for (const [levelNum, text] of Object.entries(s.levels)) {
        const levelRow = getLevelId.get(Number(levelNum));
        if (!levelRow) continue;
        upsertSkillLevel.run(versionId, skillRow.id, levelRow.id, text, SOURCE);
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
