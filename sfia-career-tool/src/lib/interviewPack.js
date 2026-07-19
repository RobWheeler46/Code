// Selected-user feature (FRD v0.24): Strength-Based Interview Pack Generator.
// Selects approved strength-based questions per role SFIA skill+level (with randomisation and a
// lower-usage preference), falling back to a generic strength-based question where the bank has none,
// then builds a Microsoft Word document suitable for interview planning and panel use.
const db = require('../db');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, PageBreak, BorderStyle
} = require('docx');

// Role header details used on the cover page and audit metadata.
function roleForPack(roleProfileId) {
  return db.prepare(`
    SELECT rp.id, rp.title, rp.grade, rp.role_description, rp.summary, rp.sfia_version_id,
           v.version_name
    FROM role_profiles rp
    LEFT JOIN sfia_versions v ON v.id = rp.sfia_version_id
    WHERE rp.id = ?
  `).get(roleProfileId);
}

// Each SFIA skill mapped to the role, with its required level and the skill-at-level description.
function packSkills(roleProfileId) {
  return db.prepare(`
    SELECT rps.sfia_skill_id, rps.required_sfia_level_id AS sfia_level_id,
           sk.skill_code, sk.skill_name, sk.short_description,
           lv.level_number, lv.level_name,
           sld.skill_level_description
    FROM role_profile_skills rps
    JOIN sfia_skills sk ON sk.id = rps.sfia_skill_id
    JOIN sfia_levels lv ON lv.id = rps.required_sfia_level_id
    LEFT JOIN sfia_skill_level_descriptions sld
      ON sld.sfia_skill_id = sk.id AND sld.sfia_level_id = lv.id AND sld.status = 'active'
    WHERE rps.role_profile_id = ?
    ORDER BY rps.display_order, sk.skill_code
  `).all(roleProfileId);
}

// Pick one approved question of a given type for a skill+level, preferring lower usage then random.
// Version match is lenient: questions with a NULL version or the role's version are both eligible.
function pickApproved(sfiaSkillId, sfiaLevelId, sfiaVersionId, questionType) {
  return db.prepare(`
    SELECT * FROM interview_questions
    WHERE sfia_skill_id = ? AND sfia_level_id = ? AND status = 'approved' AND question_type = ?
      AND (sfia_version_id IS NULL OR ? IS NULL OR sfia_version_id = ?)
    ORDER BY usage_count ASC, RANDOM()
    LIMIT 1
  `).get(sfiaSkillId, sfiaLevelId, questionType, sfiaVersionId, sfiaVersionId);
}

// Generic strength-based question derived from the skill + level, used when the bank has no approved
// question. Clearly flagged as generic so authors know to replace it with a curated one.
function genericQuestion(skill) {
  const name = skill.skill_name && skill.skill_name !== skill.skill_code ? skill.skill_name : skill.skill_code;
  const lvl = `Level ${skill.level_number}${skill.level_name && skill.level_name !== `Level ${skill.level_number}` ? ' (' + skill.level_name + ')' : ''}`;
  const good = `A strong answer shows evidence consistent with ${name} at ${lvl}: an appropriate level of ownership and autonomy for the level, sound judgement, good practice, and clear impact. Look for specific examples, the candidate's own contribution, and the outcome.`
    + (skill.skill_level_description ? ` For reference, this level is described as: "${skill.skill_level_description}"` : '');
  return {
    text: `Tell us about a time you applied ${name} in your work at a level of responsibility similar to ${lvl}. What made the challenge satisfying, and what was your specific contribution?`,
    whatGood: good,
    probes: 'What options did you consider? What trade-offs did you make? Who did you work with or influence? What changed as a result? What would you do differently next time?',
    generic: true,
    questionId: null
  };
}

function genericAlternative(skill) {
  const name = skill.skill_name && skill.skill_name !== skill.skill_code ? skill.skill_name : skill.skill_code;
  return {
    text: `Describe a recent situation that called for ${name}. How did you decide on your approach, and how did you know it was working?`,
    whatGood: null,
    probes: null,
    generic: true,
    questionId: null
  };
}

function toSelection(row, skill, kind) {
  if (!row) return kind === 'alternative' ? genericAlternative(skill) : genericQuestion(skill);
  return {
    text: row.question_text,
    whatGood: row.what_good_looks_like || null,
    probes: row.probe_prompts || null,
    generic: false,
    questionId: row.id
  };
}

// Build the per-skill question selection for a role. Returns selections plus the bank question ids used
// (for usage-count updates and pack reproducibility).
function selectQuestions(skills, sfiaVersionId) {
  const selections = [];
  const usedQuestionIds = [];
  for (const skill of skills) {
    const primaryRow = pickApproved(skill.sfia_skill_id, skill.sfia_level_id, sfiaVersionId, 'strength_based');
    const altRow = pickApproved(skill.sfia_skill_id, skill.sfia_level_id, sfiaVersionId, 'alternative');
    const primary = toSelection(primaryRow, skill, 'strength_based');
    const alternative = toSelection(altRow, skill, 'alternative');
    if (primary.questionId) usedQuestionIds.push(primary.questionId);
    if (alternative.questionId) usedQuestionIds.push(alternative.questionId);
    selections.push({ skill, primary, alternative });
  }
  return { selections, usedQuestionIds };
}

// ---- Word document construction ----

const BRAND = '2743C6';

function h(text, level) { return new Paragraph({ text, heading: level }); }
function p(text, opts = {}) {
  return new Paragraph({ children: [new TextRun({ text, ...opts })], spacing: { after: 120 }, ...(opts.para || {}) });
}
function labelled(label, value) {
  return new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text: label + ': ', bold: true }), new TextRun({ text: value == null || value === '' ? '—' : String(value) })]
  });
}

function questionBlock(sel, index) {
  const { skill, primary, alternative } = sel;
  const name = skill.skill_name && skill.skill_name !== skill.skill_code ? skill.skill_name : skill.skill_code;
  const levelLabel = `Level ${skill.level_number}${skill.level_name && skill.level_name !== `Level ${skill.level_number}` ? ' – ' + skill.level_name : ''}`;
  const out = [];
  out.push(new Paragraph({
    spacing: { before: 240, after: 60 },
    border: { bottom: { color: BRAND, space: 2, style: BorderStyle.SINGLE, size: 6 } },
    children: [
      new TextRun({ text: `${index}. ${skill.skill_code} – ${name} `, bold: true, size: 26, color: BRAND }),
      new TextRun({ text: `(${levelLabel})`, italics: true, size: 22 })
    ]
  }));
  if (skill.skill_level_description) {
    out.push(new Paragraph({ spacing: { after: 100 }, children: [
      new TextRun({ text: 'SFIA skill at this level: ', bold: true }),
      new TextRun({ text: skill.skill_level_description })
    ]}));
  }
  out.push(new Paragraph({ spacing: { after: 40 }, children: [
    new TextRun({ text: 'Strength-based question', bold: true, color: BRAND }),
    ...(primary.generic ? [new TextRun({ text: '  [generic – pending curated question]', italics: true, size: 18, color: '888888' })] : [])
  ]}));
  out.push(p(primary.text));
  if (primary.whatGood) {
    out.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: 'What good looks like', bold: true })] }));
    out.push(p(primary.whatGood));
  }
  if (alternative) {
    out.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: 'Alternative question', bold: true })] }));
    out.push(p(alternative.text));
  }
  const probes = primary.probes;
  if (probes) {
    out.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: 'Suggested probes', bold: true })] }));
    out.push(p(probes, { italics: true }));
  }
  out.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: 'Interviewer notes & evidence', bold: true })] }));
  out.push(new Paragraph({ text: '', border: { bottom: { color: 'CCCCCC', space: 6, style: BorderStyle.SINGLE, size: 4 } } }));
  out.push(new Paragraph({ text: '', border: { bottom: { color: 'CCCCCC', space: 6, style: BorderStyle.SINGLE, size: 4 } } }));
  return out;
}

// Build the full .docx as a Buffer. `meta` carries pack id / generated-by / date for the cover + audit.
async function buildPackDocx({ role, selections, meta }) {
  const generatedDate = new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const cover = [
    new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: 'Career Explorer', bold: true, color: BRAND, size: 28 })] }),
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: 'Strength-Based Interview Pack' })] }),
    h(role.title + (role.grade ? ` – Grade ${role.grade}` : ''), HeadingLevel.HEADING_2),
    labelled('SFIA version', role.version_name || 'SFIA 9'),
    labelled('Skills covered', selections.length),
    labelled('Generated', generatedDate),
    labelled('Generated by', meta.generatedByName || 'Administrator'),
    labelled('Pack ID', meta.packId),
    new Paragraph({ spacing: { before: 200, after: 120 }, children: [new TextRun({
      text: 'Purpose: this pack supports SFIA-aligned, strength-based interview planning. It is an aid to structured, evidence-based conversation – not an automated hiring decision.',
      italics: true })] })
  ];

  const overview = [
    new Paragraph({ children: [new PageBreak()] }),
    h('Role overview', HeadingLevel.HEADING_1),
    p(role.role_description || role.summary || 'No role description recorded.'),
    h('Assigned SFIA skills', HeadingLevel.HEADING_2),
    ...selections.map(s => new Paragraph({ bullet: { level: 0 }, children: [
      new TextRun({ text: `${s.skill.skill_code} – ${s.skill.skill_name} `, bold: true }),
      new TextRun({ text: `(Level ${s.skill.level_number})` })
    ]}))
  ];

  const guidance = [
    new Paragraph({ children: [new PageBreak()] }),
    h('How to use this pack', HeadingLevel.HEADING_1),
    p('Strength-based questions explore how a candidate naturally approaches work – what energises them, how they solve problems, collaborate, learn and demonstrate capability. Use them to invite evidence, not to run a checklist.'),
    p('For each skill, ask the strength-based question, then use the suggested probes to explore ownership, complexity, influence and outcome. Compare the response against "what good looks like" for the target SFIA level.'),
    p('Use the alternative question if the primary one has been used recently or the panel wants a different angle. Treat the pack as a structured aid; the hiring decision remains a human judgement based on the whole picture.')
  ];

  const questions = [
    new Paragraph({ children: [new PageBreak()] }),
    h('Question set', HeadingLevel.HEADING_1)
  ];
  selections.forEach((s, i) => questionBlock(s, i + 1).forEach(pr => questions.push(pr)));

  const footer = [
    new Paragraph({ children: [new PageBreak()] }),
    h('Version & audit', HeadingLevel.HEADING_1),
    labelled('Role profile', role.title),
    labelled('SFIA version', role.version_name || 'SFIA 9'),
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

module.exports = { roleForPack, packSkills, selectQuestions, buildPackDocx };
