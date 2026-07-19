// One-off (idempotent, re-runnable) importer for the strength-based interview question bank.
// Source: src/data/interview-questions.json (extracted from SFIA_9_Interview_Question_Bank_Import_v0_25.xlsx
// — 3360 strength-based questions, 5 variants A–E per SFIA skill+level). Upserts on external_id (the
// workbook's Question_ID) so running it twice, or locally and again in the Railway container, is safe.
//
// Variant → question_type: A/B/C become the primary strength-based pool, D/E the alternative pool, so the
// generator draws a randomised real question for both the primary and the alternative slot. Imported as
// 'approved' so the questions are immediately usable by the interview pack generator.
const db = require('./db');
const rows = require('./data/interview-questions.json');

const version = db.prepare(`SELECT id FROM sfia_versions WHERE version_name = 'SFIA 9'`).get()
  || db.prepare(`SELECT id FROM sfia_versions ORDER BY id LIMIT 1`).get();
const versionId = version ? version.id : null;

const skillByCode = {};
db.prepare(`SELECT id, skill_code FROM sfia_skills`).all().forEach(s => { skillByCode[s.skill_code] = s.id; });
const levelByNum = {};
db.prepare(`SELECT id, level_number FROM sfia_levels`).all().forEach(l => { levelByNum[l.level_number] = l.id; });

const upsert = db.prepare(`
  INSERT INTO interview_questions
    (external_id, sfia_version_id, sfia_skill_id, sfia_level_id, question_type, question_text, what_good_looks_like, probe_prompts, status, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', datetime('now'))
  ON CONFLICT(external_id) DO UPDATE SET
    sfia_version_id = excluded.sfia_version_id,
    sfia_skill_id   = excluded.sfia_skill_id,
    sfia_level_id   = excluded.sfia_level_id,
    question_type   = excluded.question_type,
    question_text   = excluded.question_text,
    what_good_looks_like = excluded.what_good_looks_like,
    probe_prompts   = excluded.probe_prompts,
    status          = 'approved',
    updated_at      = datetime('now')
`);

let imported = 0, skipped = 0;
const skippedCodes = new Set();

db.exec('BEGIN');
try {
  for (const r of rows) {
    const skillId = skillByCode[r.code];
    const levelId = levelByNum[r.level];
    if (!skillId || !levelId) { skipped++; if (!skillId) skippedCodes.add(r.code); continue; }
    const type = (r.variant === 'D' || r.variant === 'E') ? 'alternative' : 'strength_based';
    const whatGood = r.evidence ? `${r.good || ''}${r.good ? '\n\n' : ''}Evidence indicators: ${r.evidence}` : (r.good || null);
    upsert.run(r.id, versionId, skillId, levelId, type, r.text, whatGood, r.probes || null);
    imported++;
  }
  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  console.error('Import failed, rolled back:', e.message);
  process.exit(1);
}

const total = db.prepare(`SELECT COUNT(*) AS n FROM interview_questions`).get().n;
const approved = db.prepare(`SELECT COUNT(*) AS n FROM interview_questions WHERE status = 'approved'`).get().n;
const primary = db.prepare(`SELECT COUNT(*) AS n FROM interview_questions WHERE question_type = 'strength_based'`).get().n;
const alt = db.prepare(`SELECT COUNT(*) AS n FROM interview_questions WHERE question_type = 'alternative'`).get().n;
console.log(`Imported/updated: ${imported} | skipped: ${skipped}${skippedCodes.size ? ' (codes: ' + [...skippedCodes].join(', ') + ')' : ''}`);
console.log(`Bank now: ${total} total, ${approved} approved (${primary} primary + ${alt} alternative), SFIA version id ${versionId}.`);
