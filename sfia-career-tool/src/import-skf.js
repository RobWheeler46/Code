// Idempotent importer for the Skills & Knowledge Framework (FRD v0.28).
// Source: src/data/skf/{items,levels,questions}.json.gz — extracted from
// Skills_Knowledge_Framework_Interview_Bank_Import_v0_28.xlsx (750 items / 3000 item-levels / 15000
// strength-based questions). Committed gzipped (~0.4 MB) so it runs the same locally and in the Railway
// container. Upserts on each row's natural id, so re-running is safe.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const db = require('./db');

function loadGz(name) {
  const buf = fs.readFileSync(path.join(__dirname, 'data', 'skf', name));
  return JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
}

const items = loadGz('items.json.gz');
const levels = loadGz('levels.json.gz');
const questions = loadGz('questions.json.gz');

const upItem = db.prepare(`
  INSERT INTO framework_items (id, rank, demand_band, family, domain, item_type, technology_or_capability, short_description, indicative_priority, typical_role_families, status, framework_version)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    rank=excluded.rank, demand_band=excluded.demand_band, family=excluded.family, domain=excluded.domain,
    item_type=excluded.item_type, technology_or_capability=excluded.technology_or_capability,
    short_description=excluded.short_description, indicative_priority=excluded.indicative_priority,
    typical_role_families=excluded.typical_role_families, status=excluded.status, framework_version=excluded.framework_version
`);

const upLevel = db.prepare(`
  INSERT INTO framework_item_levels (id, framework_item_id, level_number, level_name, expectation, status)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    framework_item_id=excluded.framework_item_id, level_number=excluded.level_number,
    level_name=excluded.level_name, expectation=excluded.expectation, status=excluded.status
`);

const upQuestion = db.prepare(`
  INSERT INTO framework_questions (id, framework_item_level_id, framework_item_id, level_number, variant, strength_theme, question, alt_eligible, what_good_looks_like, evidence_expectation, randomisation_group_id, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    framework_item_level_id=excluded.framework_item_level_id, framework_item_id=excluded.framework_item_id,
    level_number=excluded.level_number, variant=excluded.variant, strength_theme=excluded.strength_theme,
    question=excluded.question, alt_eligible=excluded.alt_eligible, what_good_looks_like=excluded.what_good_looks_like,
    evidence_expectation=excluded.evidence_expectation, randomisation_group_id=excluded.randomisation_group_id,
    status=excluded.status
`);

db.exec('BEGIN');
try {
  for (const it of items) {
    upItem.run(it.id, it.rank ?? null, it.band ?? null, it.family ?? null, it.domain ?? null, it.type ?? null,
      it.tech, it.desc ?? null, it.priority ?? null, it.roleFamilies ?? null, it.status || 'Active', it.version ?? null);
  }
  for (const lv of levels) {
    upLevel.run(lv.id, lv.itemId, lv.level, lv.levelName ?? null, lv.expectation ?? null, lv.status || 'Active');
  }
  for (const q of questions) {
    const altOk = (q.altOk === 'Yes' || q.altOk === 1) ? 1 : 0;
    upQuestion.run(q.id, q.fil, q.itemId ?? null, q.level ?? null, q.variant ?? null, q.theme ?? null,
      q.q, altOk, q.good ?? null, q.evidence ?? null, q.rgroup ?? null, q.status || 'Active');
  }
  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  console.error('SKF import failed, rolled back:', e.message);
  process.exit(1);
}

const n = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
console.log(`Imported/updated: ${items.length} items, ${levels.length} item-levels, ${questions.length} questions.`);
console.log(`Bank now: framework_items=${n('framework_items')}, framework_item_levels=${n('framework_item_levels')}, framework_questions=${n('framework_questions')} (${db.prepare(`SELECT COUNT(DISTINCT family) AS n FROM framework_items`).get().n} families).`);
