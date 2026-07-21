// Skills & Knowledge Framework interview pack generation (FRD v0.28). Given a role plus selected framework
// items and target levels, selects one primary + one different alternative strength-based question per
// item-level and builds a Microsoft Word interview pack.
const db = require('../db');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, PageBreak, BorderStyle
} = require('docx');

const BRAND = '2743C6';

// ---- Framework queries (used by the builder UI) ----

function frameworkFamilies() {
  return db.prepare(`
    SELECT family, COUNT(*) AS itemCount
    FROM framework_items WHERE status = 'Active'
    GROUP BY family ORDER BY family
  `).all();
}

function frameworkItems({ family, search } = {}) {
  let sql = `SELECT id, family, domain, item_type, technology_or_capability, demand_band, short_description, rank
             FROM framework_items WHERE status = 'Active'`;
  const params = [];
  if (family) { sql += ` AND family = ?`; params.push(family); }
  if (search) { sql += ` AND (technology_or_capability LIKE ? OR short_description LIKE ? OR family LIKE ?)`; const s = `%${search}%`; params.push(s, s, s); }
  sql += ` ORDER BY rank LIMIT 200`;
  return db.prepare(sql).all(...params);
}

function itemLevels(itemId) {
  return db.prepare(`
    SELECT id, level_number, level_name, expectation
    FROM framework_item_levels WHERE framework_item_id = ? AND status = 'Active'
    ORDER BY level_number
  `).all(itemId);
}

function roleForPack(roleProfileId) {
  return db.prepare(`
    SELECT rp.id, rp.title, rp.grade, rp.role_description, rp.summary, rp.sfia_version_id, v.version_name
    FROM role_profiles rp LEFT JOIN sfia_versions v ON v.id = rp.sfia_version_id
    WHERE rp.id = ?
  `).get(roleProfileId);
}

// A short SFIA context summary (skill code + level) for the role, included in the pack.
function roleSfiaContext(roleProfileId) {
  return db.prepare(`
    SELECT sk.skill_code, sk.skill_name, lv.level_number
    FROM role_profile_skills rps
    JOIN sfia_skills sk ON sk.id = rps.sfia_skill_id
    JOIN sfia_levels lv ON lv.id = rps.required_sfia_level_id
    WHERE rps.role_profile_id = ?
    ORDER BY rps.display_order, sk.skill_code
  `).all(roleProfileId);
}

// Pick one primary + one different alternative active question for an item-level, preferring lower usage.
function pickTwo(frameworkItemLevelId) {
  const rows = db.prepare(`
    SELECT * FROM framework_questions
    WHERE framework_item_level_id = ? AND status = 'Active'
    ORDER BY usage_count ASC, RANDOM()
  `).all(frameworkItemLevelId);
  if (rows.length === 0) return { primary: null, alternative: null };
  const primary = rows[0];
  const alternative = rows.find(r => r.id !== primary.id) || null;
  return { primary, alternative };
}

// Build the per-selection blocks. `selections` is [{ itemId, level }]. Returns blocks + used question ids.
function buildBlocks(selections) {
  const blocks = [];
  const usedIds = [];
  for (const sel of selections) {
    const item = db.prepare(`SELECT * FROM framework_items WHERE id = ?`).get(sel.itemId);
    if (!item) continue;
    const fil = db.prepare(`SELECT * FROM framework_item_levels WHERE framework_item_id = ? AND level_number = ?`).get(sel.itemId, sel.level);
    if (!fil) continue;
    const { primary, alternative } = pickTwo(fil.id);
    if (primary) usedIds.push(primary.id);
    if (alternative) usedIds.push(alternative.id);
    blocks.push({ item, level: fil, primary, alternative });
  }
  return { blocks, usedIds };
}

// ---- Word document ----

function labelled(label, value) {
  return new Paragraph({ spacing: { after: 80 }, children: [
    new TextRun({ text: label + ': ', bold: true }),
    new TextRun({ text: value == null || value === '' ? '—' : String(value) })
  ]});
}
function body(text, opts = {}) { return new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text, ...opts })] }); }

function questionBlock(block, index) {
  const { item, level, primary, alternative } = block;
  const out = [];
  out.push(new Paragraph({
    spacing: { before: 240, after: 60 },
    border: { bottom: { color: BRAND, space: 2, style: BorderStyle.SINGLE, size: 6 } },
    children: [
      new TextRun({ text: `${index}. ${item.technology_or_capability} `, bold: true, size: 26, color: BRAND }),
      new TextRun({ text: `(${item.family} · ${level.level_name || 'Level ' + level.level_number})`, italics: true, size: 22 })
    ]
  }));
  if (level.expectation) out.push(new Paragraph({ spacing: { after: 100 }, children: [
    new TextRun({ text: 'Level expectation: ', bold: true }), new TextRun({ text: level.expectation })
  ]}));

  out.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: 'Strength-based question', bold: true, color: BRAND })] }));
  out.push(body(primary ? primary.question : 'No approved question available for this item and level.'));
  if (primary && primary.what_good_looks_like) {
    out.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: 'What good looks like', bold: true })] }));
    out.push(body(primary.what_good_looks_like));
  }
  if (primary && primary.evidence_expectation) out.push(body(primary.evidence_expectation, { italics: true }));
  if (alternative) {
    out.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: 'Alternative question', bold: true })] }));
    out.push(body(alternative.question));
  }
  out.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: 'Score & evidence notes', bold: true })] }));
  out.push(new Paragraph({ text: '', border: { bottom: { color: 'CCCCCC', space: 6, style: BorderStyle.SINGLE, size: 4 } } }));
  out.push(new Paragraph({ text: '', border: { bottom: { color: 'CCCCCC', space: 6, style: BorderStyle.SINGLE, size: 4 } } }));
  return out;
}

// Render a question block for one of the role's SFIA skills (selection shape from interviewPack.selectQuestions).
function sfiaQuestionBlock(sel, index) {
  const { skill, primary, alternative } = sel;
  const name = skill.skill_name && skill.skill_name !== skill.skill_code ? skill.skill_name : skill.skill_code;
  const levelLabel = `Level ${skill.level_number}${skill.level_name && skill.level_name !== 'Level ' + skill.level_number ? ' – ' + skill.level_name : ''}`;
  const out = [];
  out.push(new Paragraph({
    spacing: { before: 240, after: 60 },
    border: { bottom: { color: BRAND, space: 2, style: BorderStyle.SINGLE, size: 6 } },
    children: [
      new TextRun({ text: `${index}. ${skill.skill_code} – ${name} `, bold: true, size: 26, color: BRAND }),
      new TextRun({ text: `(${levelLabel})`, italics: true, size: 22 })
    ]
  }));
  if (skill.skill_level_description) out.push(new Paragraph({ spacing: { after: 100 }, children: [
    new TextRun({ text: 'SFIA skill at this level: ', bold: true }), new TextRun({ text: skill.skill_level_description })
  ]}));
  out.push(new Paragraph({ spacing: { after: 40 }, children: [
    new TextRun({ text: 'Strength-based question', bold: true, color: BRAND }),
    ...(primary && primary.generic ? [new TextRun({ text: '  [generic – pending curated question]', italics: true, size: 18, color: '888888' })] : [])
  ]}));
  out.push(body(primary ? primary.text : 'No question available for this skill and level.'));
  if (primary && primary.whatGood) {
    out.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: 'What good looks like', bold: true })] }));
    out.push(body(primary.whatGood));
  }
  if (alternative) {
    out.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: 'Alternative question', bold: true })] }));
    out.push(body(alternative.text));
  }
  if (primary && primary.probes) {
    out.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: 'Suggested probes', bold: true })] }));
    out.push(body(primary.probes, { italics: true }));
  }
  out.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: 'Score & evidence notes', bold: true })] }));
  out.push(new Paragraph({ text: '', border: { bottom: { color: 'CCCCCC', space: 6, style: BorderStyle.SINGLE, size: 4 } } }));
  out.push(new Paragraph({ text: '', border: { bottom: { color: 'CCCCCC', space: 6, style: BorderStyle.SINGLE, size: 4 } } }));
  return out;
}

// `sfiaSelections` = the role's SFIA skills with a chosen primary/alternative question (from
// interviewPack.selectQuestions). `blocks` = the optional selected framework items.
async function buildSkfPackDocx({ role, sfiaSelections = [], blocks = [], meta }) {
  const generatedDate = new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const cover = [
    new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: 'Career Explorer', bold: true, color: BRAND, size: 28 })] }),
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: 'Skills & Knowledge Interview Pack' })] }),
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: role.title + (role.grade ? ` – Grade ${role.grade}` : '') })] }),
    labelled('SFIA skills', sfiaSelections.length),
    labelled('Framework areas', blocks.length),
    labelled('Generated', generatedDate),
    labelled('Generated by', meta.generatedByName || 'Administrator'),
    labelled('Pack ID', meta.packId),
    new Paragraph({ spacing: { before: 160, after: 120 }, children: [new TextRun({
      text: 'Purpose: strength-based, evidence-focused interview questions for the selected technical skills. This is a structured aid – not an automated hiring decision.', italics: true })] })
  ];

  const overview = [
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'Role overview' })] }),
    body(role.role_description || role.summary || 'No role description recorded.'),
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: 'SFIA skills for this role' })] }),
    sfiaSelections.length
      ? new Paragraph({ children: [new TextRun({ text: sfiaSelections.map(s => `${s.skill.skill_code} L${s.skill.level_number}`).join('  ·  ') })] })
      : body('No SFIA skills mapped to this role.'),
    ...(blocks.length ? [
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: 'Skills & Knowledge areas covered' })] }),
      ...blocks.map(b => new Paragraph({ bullet: { level: 0 }, children: [
        new TextRun({ text: `${b.item.technology_or_capability} `, bold: true }),
        new TextRun({ text: `(${b.item.family} · ${b.level.level_name || 'Level ' + b.level.level_number})` })
      ]}))
    ] : [])
  ];

  const guidance = [
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'How to use this pack' })] }),
    body('Ask the strength-based question, then explore the evidence using follow-ups. Compare the response to "what good looks like" and the level expectation. Use the alternative question for a different angle or if the primary has been used recently. The hiring decision remains a human judgement based on the whole picture.')
  ];

  // Section A: the role's SFIA skills.
  const sfiaSection = [
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'SFIA skills for this role' })] })
  ];
  if (sfiaSelections.length === 0) {
    sfiaSection.push(body('No SFIA skills are mapped to this role.'));
  } else {
    sfiaSelections.forEach((s, i) => sfiaQuestionBlock(s, i + 1).forEach(p => sfiaSection.push(p)));
  }

  // Section B: the selected Skills & Knowledge Framework items (optional).
  const frameworkSection = [];
  if (blocks.length > 0) {
    frameworkSection.push(new Paragraph({ children: [new PageBreak()] }));
    frameworkSection.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'Skills & Knowledge Framework' })] }));
    blocks.forEach((b, i) => questionBlock(b, i + 1).forEach(p => frameworkSection.push(p)));
  }
  const questions = [...sfiaSection, ...frameworkSection];

  const footer = [
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'Version & audit' })] }),
    labelled('Role profile', role.title),
    labelled('Framework version', blocks[0] ? (blocks[0].item.framework_version || 'v0.28') : 'v0.28'),
    labelled('Pack generation ID', meta.packId),
    labelled('Generated at', generatedDate),
    labelled('Generated by', meta.generatedByName || 'Administrator')
  ];

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{ children: [...cover, ...overview, ...guidance, ...questions, ...footer] }]
  });
  return Packer.toBuffer(doc);
}

module.exports = { frameworkFamilies, frameworkItems, itemLevels, roleForPack, roleSfiaContext, buildBlocks, buildSkfPackDocx };
