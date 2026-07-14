const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const crypto = require('crypto');
const db = require('./db');
const { hashPassword } = require('./lib/helpers');

// All SFIA framework content below (versions, categories, skill codes/names, level labels) is
// fictional placeholder data for demonstration only - it is not the real, licensed SFIA
// catalogue. Replace it with real content once a SFIA licence is confirmed (see FRD Assumption 2).

const ADMIN_ROLES = [
  { role_name: 'Super Admin', description: 'Full access, including managing admin users.', can_edit: 1, can_publish: 1, can_manage_admins: 1 },
  { role_name: 'Admin', description: 'Can create, edit, publish and archive content.', can_edit: 1, can_publish: 1, can_manage_admins: 0 },
  { role_name: 'Content Editor', description: 'Can create and edit content but not publish it.', can_edit: 1, can_publish: 0, can_manage_admins: 0 },
  { role_name: 'Viewer', description: 'Read-only access to the admin backend.', can_edit: 0, can_publish: 0, can_manage_admins: 0 }
];

const LEVELS = [
  { level_number: 1, level_name: 'Level 1', description: 'Placeholder description for level 1 of responsibility.', full: 'Placeholder full responsibility description for level 1: works under close supervision, follows simple instructions, learns basic skills.' },
  { level_number: 2, level_name: 'Level 2', description: 'Placeholder description for level 2 of responsibility.', full: 'Placeholder full responsibility description for level 2: works under routine supervision, uses discretion in resolving simple queries.' },
  { level_number: 3, level_name: 'Level 3', description: 'Placeholder description for level 3 of responsibility.', full: 'Placeholder full responsibility description for level 3: works under general direction, exercises independent judgement, plans own work.' },
  { level_number: 4, level_name: 'Level 4', description: 'Placeholder description for level 4 of responsibility.', full: 'Placeholder full responsibility description for level 4: works under broad direction, is fully accountable for own technical work, may supervise others.' },
  { level_number: 5, level_name: 'Level 5', description: 'Placeholder description for level 5 of responsibility.', full: 'Placeholder full responsibility description for level 5: works under broad direction with a large degree of autonomy, accountable for significant areas of work.' },
  { level_number: 6, level_name: 'Level 6', description: 'Placeholder description for level 6 of responsibility.', full: 'Placeholder full responsibility description for level 6: has significant organisational responsibility, defines standards and policies.' },
  { level_number: 7, level_name: 'Level 7', description: 'Placeholder description for level 7 of responsibility.', full: 'Placeholder full responsibility description for level 7: has highest-level organisational responsibility, sets strategy and inspires others.' }
];

function upsertAdminRole(role) {
  const existing = db.prepare('SELECT * FROM admin_roles WHERE role_name = ?').get(role.role_name);
  if (existing) return existing;
  const result = db.prepare(`
    INSERT INTO admin_roles (role_name, description, can_edit, can_publish, can_manage_admins)
    VALUES (?, ?, ?, ?, ?)
  `).run(role.role_name, role.description, role.can_edit, role.can_publish, role.can_manage_admins);
  return db.prepare('SELECT * FROM admin_roles WHERE id = ?').get(result.lastInsertRowid);
}

function upsertLevel(level) {
  const existing = db.prepare('SELECT * FROM sfia_levels WHERE level_number = ?').get(level.level_number);
  if (existing) return existing;
  const result = db.prepare(`
    INSERT INTO sfia_levels (level_number, level_name, description, level_full_description, source_reference, display_order) VALUES (?, ?, ?, ?, ?, ?)
  `).run(level.level_number, level.level_name, level.description, level.full, 'Placeholder source - not the official SFIA level description.', level.level_number);
  return db.prepare('SELECT * FROM sfia_levels WHERE id = ?').get(result.lastInsertRowid);
}

function upsertVersion(name, description) {
  const existing = db.prepare('SELECT * FROM sfia_versions WHERE version_name = ?').get(name);
  if (existing) return existing;
  const result = db.prepare(`
    INSERT INTO sfia_versions (version_name, description, effective_from, status) VALUES (?, ?, date('now'), 'active')
  `).run(name, description);
  return db.prepare('SELECT * FROM sfia_versions WHERE id = ?').get(result.lastInsertRowid);
}

function upsertCategory(versionId, name, description) {
  const existing = db.prepare('SELECT * FROM sfia_categories WHERE sfia_version_id = ? AND name = ?').get(versionId, name);
  if (existing) return existing;
  const result = db.prepare(`
    INSERT INTO sfia_categories (sfia_version_id, name, description) VALUES (?, ?, ?)
  `).run(versionId, name, description);
  return db.prepare('SELECT * FROM sfia_categories WHERE id = ?').get(result.lastInsertRowid);
}

function upsertSkill(versionId, categoryId, code, name, description, fullDescription) {
  const existing = db.prepare('SELECT * FROM sfia_skills WHERE sfia_version_id = ? AND skill_code = ?').get(versionId, code);
  if (existing) return existing;
  const result = db.prepare(`
    INSERT INTO sfia_skills (sfia_version_id, sfia_category_id, skill_code, skill_name, short_description, full_description, source_reference)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(versionId, categoryId, code, name, description, fullDescription, 'Placeholder source - not the official SFIA skill description.');
  return db.prepare('SELECT * FROM sfia_skills WHERE id = ?').get(result.lastInsertRowid);
}

function upsertSkillLevelDescription(versionId, skillId, levelId, description, guidanceNotes) {
  const existing = db.prepare('SELECT * FROM sfia_skill_level_descriptions WHERE sfia_skill_id = ? AND sfia_level_id = ?').get(skillId, levelId);
  if (existing) return existing;
  const result = db.prepare(`
    INSERT INTO sfia_skill_level_descriptions (sfia_version_id, sfia_skill_id, sfia_level_id, skill_level_description, guidance_notes, source_reference)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(versionId, skillId, levelId, description, guidanceNotes, 'Placeholder source - not the official SFIA skill-at-level description.');
  return db.prepare('SELECT * FROM sfia_skill_level_descriptions WHERE id = ?').get(result.lastInsertRowid);
}

function upsertRoleFamily(name, description) {
  const existing = db.prepare('SELECT * FROM role_families WHERE name = ?').get(name);
  if (existing) return existing;
  const result = db.prepare(`INSERT INTO role_families (name, description) VALUES (?, ?)`).run(name, description);
  return db.prepare('SELECT * FROM role_families WHERE id = ?').get(result.lastInsertRowid);
}

function upsertCapabilityArea(roleFamilyId, name, description) {
  const existing = db.prepare('SELECT * FROM capability_areas WHERE role_family_id = ? AND name = ?').get(roleFamilyId, name);
  if (existing) return existing;
  const result = db.prepare(`INSERT INTO capability_areas (role_family_id, name, description) VALUES (?, ?, ?)`).run(roleFamilyId, name, description);
  return db.prepare('SELECT * FROM capability_areas WHERE id = ?').get(result.lastInsertRowid);
}

function upsertRoleProfile(profile, ownerId) {
  const existing = db.prepare('SELECT * FROM role_profiles WHERE title = ?').get(profile.title);
  if (existing) return existing;
  const result = db.prepare(`
    INSERT INTO role_profiles (role_family_id, capability_area_id, title, summary, responsibilities, seniority_level, role_type,
      status, owner_user_id, effective_from, review_date, published_at, published_by,
      purpose_statement, role_at_a_glance, typical_outputs, day_in_the_life, success_indicators, progression_summary, display_tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?, date('now'), date('now', '+1 year'), datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(profile.role_family_id, profile.capability_area_id, profile.title, profile.summary, profile.responsibilities,
    profile.seniority_level, profile.role_type, ownerId, ownerId,
    profile.purpose_statement || null,
    profile.focus_area ? JSON.stringify({ focusArea: profile.focus_area }) : null,
    profile.typical_outputs || null,
    profile.day_in_the_life || null,
    profile.success_indicators || null,
    profile.progression_summary || null,
    profile.display_tags ? JSON.stringify(profile.display_tags) : null);
  return db.prepare('SELECT * FROM role_profiles WHERE id = ?').get(result.lastInsertRowid);
}

function upsertRoleSkill(roleProfileId, sfiaSkillId, levelId, importance, rationale, options) {
  const existing = db.prepare('SELECT * FROM role_profile_skills WHERE role_profile_id = ? AND sfia_skill_id = ?').get(roleProfileId, sfiaSkillId);
  if (existing) return existing;
  const opts = options || {};
  const result = db.prepare(`
    INSERT INTO role_profile_skills (role_profile_id, sfia_skill_id, required_sfia_level_id, importance, rationale, role_specific_display_notes, show_full_description)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(roleProfileId, sfiaSkillId, levelId, importance, rationale, opts.displayNotes || null, opts.showFullDescription ? 1 : 0);
  return db.prepare('SELECT * FROM role_profile_skills WHERE id = ?').get(result.lastInsertRowid);
}

function upsertLearningResource(resource, ownerId) {
  const existing = db.prepare('SELECT * FROM learning_resources WHERE title = ?').get(resource.title);
  if (existing) return existing;
  const result = db.prepare(`
    INSERT INTO learning_resources (title, description, provider, url, resource_type, delivery_method, estimated_duration, cost_type, status, review_date, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'published', date('now', '+1 year'), ?)
  `).run(resource.title, resource.description, resource.provider, resource.url, resource.resource_type,
    resource.delivery_method, resource.estimated_duration, resource.cost_type, ownerId);
  return db.prepare('SELECT * FROM learning_resources WHERE id = ?').get(result.lastInsertRowid);
}

function upsertLearningSkill(resourceId, skillId, minLevelId, maxLevelId, gapType, priority) {
  const existing = db.prepare('SELECT * FROM learning_resource_skills WHERE learning_resource_id = ? AND sfia_skill_id = ?').get(resourceId, skillId);
  if (existing) return existing;
  db.prepare(`
    INSERT INTO learning_resource_skills (learning_resource_id, sfia_skill_id, min_sfia_level_id, max_sfia_level_id, gap_type, priority)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(resourceId, skillId, minLevelId, maxLevelId, gapType, priority);
}

function upsertPathway(pathway, ownerId) {
  const existing = db.prepare('SELECT * FROM career_pathways WHERE pathway_name = ?').get(pathway.pathway_name);
  if (existing) return existing;
  const result = db.prepare(`
    INSERT INTO career_pathways (pathway_name, pathway_description, role_family_id, pathway_type, status, owner_user_id, published_at, published_by)
    VALUES (?, ?, ?, ?, 'published', ?, datetime('now'), ?)
  `).run(pathway.pathway_name, pathway.pathway_description, pathway.role_family_id, pathway.pathway_type, ownerId, ownerId);
  return db.prepare('SELECT * FROM career_pathways WHERE id = ?').get(result.lastInsertRowid);
}

function upsertPathwayRole(pathwayId, roleProfileId, stage, options) {
  const existing = db.prepare('SELECT * FROM career_pathway_roles WHERE career_pathway_id = ? AND role_profile_id = ?').get(pathwayId, roleProfileId);
  if (existing) return existing;
  const opts = options || {};
  const result = db.prepare(`
    INSERT INTO career_pathway_roles (career_pathway_id, role_profile_id, pathway_stage, display_label, is_starting_role, is_end_role)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(pathwayId, roleProfileId, stage, opts.displayLabel || null, opts.isStartingRole ? 1 : 0, opts.isEndRole ? 1 : 0);
  return db.prepare('SELECT * FROM career_pathway_roles WHERE id = ?').get(result.lastInsertRowid);
}

function upsertPathwayConnection(pathwayId, fromRoleId, toRoleId, connectionType, description) {
  const existing = db.prepare('SELECT * FROM career_pathway_connections WHERE career_pathway_id = ? AND from_role_profile_id = ? AND to_role_profile_id = ?')
    .get(pathwayId, fromRoleId, toRoleId);
  if (existing) return existing;
  const result = db.prepare(`
    INSERT INTO career_pathway_connections (career_pathway_id, from_role_profile_id, to_role_profile_id, connection_type, connection_description)
    VALUES (?, ?, ?, ?, ?)
  `).run(pathwayId, fromRoleId, toRoleId, connectionType, description || null);
  return db.prepare('SELECT * FROM career_pathway_connections WHERE id = ?').get(result.lastInsertRowid);
}

function run() {
  const roles = {};
  for (const r of ADMIN_ROLES) roles[r.role_name] = upsertAdminRole(r);

  const levels = {};
  for (const l of LEVELS) levels[l.level_number] = upsertLevel(l);

  if (!process.env.ADMIN_EMAIL) {
    throw new Error('Set ADMIN_EMAIL in .env to the email address of the first super administrator.');
  }
  const adminEmail = process.env.ADMIN_EMAIL.trim().toLowerCase();
  let admin = db.prepare('SELECT * FROM users WHERE email = ?').get(adminEmail);
  let generatedPassword = null;
  if (!admin) {
    generatedPassword = crypto.randomBytes(9).toString('base64url');
    const result = db.prepare(`
      INSERT INTO users (first_name, last_name, email, password_hash) VALUES (?, ?, ?, ?)
    `).run('Admin', 'User', adminEmail, hashPassword(generatedPassword));
    admin = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    db.prepare('INSERT INTO user_admin_roles (user_id, admin_role_id) VALUES (?, ?)').run(admin.id, roles['Super Admin'].id);
  }

  const version = upsertVersion('Example Framework v1 (placeholder)', 'Fictional placeholder skill framework used for demonstration only - not the real licensed SFIA catalogue.');
  const catDev = upsertCategory(version.id, 'Example Category: Development & Implementation', 'Placeholder category covering software delivery skills.');
  const catStrategy = upsertCategory(version.id, 'Example Category: Strategy & Architecture', 'Placeholder category covering architecture and strategy skills.');
  const catOps = upsertCategory(version.id, 'Example Category: Delivery & Operations', 'Placeholder category covering delivery and operational skills.');

  const skProg = upsertSkill(version.id, catDev.id, 'EX-PROG', 'Example: Programming / Software Development', 'Placeholder skill representing software development capability.',
    'Placeholder full description: the design, creation, testing and documentation of new and amended programs and software configurations, from specifications agreed with stakeholders.');
  const skArch = upsertSkill(version.id, catStrategy.id, 'EX-ARCH', 'Example: Solution Architecture', 'Placeholder skill representing solution architecture capability.',
    'Placeholder full description: the design and communication of high-level structures to enable and guide the design and development of integrated solutions that meet current and future business needs.');
  const skCloud = upsertSkill(version.id, catStrategy.id, 'EX-CLDT', 'Example: Cloud Platform Engineering', 'Placeholder skill representing cloud platform capability.',
    'Placeholder full description: the design, configuration and management of cloud-based infrastructure and platform services to support reliable, scalable delivery.');
  const skSecurity = upsertSkill(version.id, catDev.id, 'EX-SCTY', 'Example: Security', 'Placeholder skill representing information security capability.',
    'Placeholder full description: the application of tools, techniques and processes to identify, assess and mitigate risks to the confidentiality, integrity and availability of information.');
  const skData = upsertSkill(version.id, catDev.id, 'EX-DTAN', 'Example: Data Analysis', 'Placeholder skill representing data analysis capability.',
    'Placeholder full description: the investigation, evaluation, interpretation and classification of data to define and clarify business questions and support decision-making.');
  const skDelivery = upsertSkill(version.id, catOps.id, 'EX-PJMT', 'Example: Delivery Management', 'Placeholder skill representing project and delivery management capability.',
    'Placeholder full description: the planning, organisation, monitoring and control of projects or delivery workstreams from initiation through to closure.');
  const skRisk = upsertSkill(version.id, catOps.id, 'EX-BURM', 'Example: Business Risk Management', 'Placeholder skill representing business risk management capability.',
    'Placeholder full description: the identification, assessment and prioritisation of business risks, and the coordination of activity to monitor and control them.');

  upsertSkillLevelDescription(version.id, skProg.id, levels[3].id,
    'Placeholder skill-at-level: designs, codes, tests and documents small to medium programs under general direction, with growing independence.',
    'Admin guidance: this is the level expected of an Engineer-grade individual contributor.');
  upsertSkillLevelDescription(version.id, skProg.id, levels[4].id,
    'Placeholder skill-at-level: takes full technical accountability for complex programs, and reviews the work of less experienced developers.',
    'Admin guidance: this is the level expected of a Senior Engineer.');
  upsertSkillLevelDescription(version.id, skArch.id, levels[2].id,
    'Placeholder skill-at-level: contributes to architecture discussions and understands the rationale behind design decisions, without leading them.', null);
  upsertSkillLevelDescription(version.id, skArch.id, levels[3].id,
    'Placeholder skill-at-level: designs the architecture for a component or well-defined subsystem, within constraints set by others.', null);
  upsertSkillLevelDescription(version.id, skArch.id, levels[5].id,
    'Placeholder skill-at-level: sets architecture direction across multiple systems and teams, balancing technical and business risk at an organisational level.',
    'Admin guidance: this is the level expected of a Principal Engineer or Architect.');
  upsertSkillLevelDescription(version.id, skCloud.id, levels[2].id,
    'Placeholder skill-at-level: uses existing cloud platform services competently under guidance, following established patterns.', null);
  upsertSkillLevelDescription(version.id, skCloud.id, levels[3].id,
    'Placeholder skill-at-level: configures and operates cloud infrastructure for a service or team, exercising independent judgement on routine matters.', null);
  upsertSkillLevelDescription(version.id, skCloud.id, levels[4].id,
    'Placeholder skill-at-level: owns cloud platform strategy for a wider set of services, setting standards others follow.', null);
  upsertSkillLevelDescription(version.id, skSecurity.id, levels[2].id,
    'Placeholder skill-at-level: applies secure coding practices to own work and recognises common vulnerability classes.', null);
  upsertSkillLevelDescription(version.id, skSecurity.id, levels[3].id,
    'Placeholder skill-at-level: identifies and mitigates security risks in designs, and advises colleagues on secure practice.', null);
  upsertSkillLevelDescription(version.id, skData.id, levels[3].id,
    'Placeholder skill-at-level: analyses and models moderately complex datasets to answer defined business questions.', null);
  upsertSkillLevelDescription(version.id, skRisk.id, levels[3].id,
    'Placeholder skill-at-level: identifies and escalates technical and delivery risks within own area of work.', null);

  const familyEng = upsertRoleFamily('Software Engineering', 'Roles focused on building and operating software systems.');
  const familyData = upsertRoleFamily('Data & Analytics', 'Roles focused on data engineering and analysis.');
  const areaBackend = upsertCapabilityArea(familyEng.id, 'Backend Engineering', 'Server-side application development.');
  const areaPlatform = upsertCapabilityArea(familyEng.id, 'Platform Engineering', 'Infrastructure and platform capability.');
  const areaDataEng = upsertCapabilityArea(familyData.id, 'Data Engineering', 'Data pipelines and analytics infrastructure.');

  const roleEngineer = upsertRoleProfile({
    role_family_id: familyEng.id, capability_area_id: areaBackend.id,
    title: 'Software Engineer', summary: 'Builds and maintains backend services under guidance from senior engineers.',
    responsibilities: 'Implements features, fixes defects, writes tests, participates in code review.',
    seniority_level: 'Engineer', role_type: 'Individual Contributor',
    purpose_statement: 'Placeholder purpose: turns agreed designs into working, tested software that keeps our backend services reliable.',
    focus_area: 'Backend feature delivery',
    typical_outputs: 'Placeholder examples: a shipped feature behind a flag, a fixed production bug with a regression test, a reviewed pull request.',
    day_in_the_life: 'Placeholder example: standup, a few hours implementing a ticket, a code review for a teammate, pairing on a tricky bug.',
    success_indicators: 'Placeholder examples: code review feedback is mostly minor, features ship with few post-release defects, estimates are broadly accurate.',
    progression_summary: 'Placeholder: typically progresses to Senior Software Engineer, then Principal Engineer or a management pathway.',
    display_tags: ['technical', 'delivery']
  }, admin.id);
  upsertRoleSkill(roleEngineer.id, skProg.id, levels[3].id, 'core', 'Day-to-day feature development.', { showFullDescription: true });
  upsertRoleSkill(roleEngineer.id, skArch.id, levels[2].id, 'optional', 'Exposure to design decisions, not leading them.');
  upsertRoleSkill(roleEngineer.id, skSecurity.id, levels[2].id, 'important', 'Secure coding awareness.');

  const roleSenior = upsertRoleProfile({
    role_family_id: familyEng.id, capability_area_id: areaBackend.id,
    title: 'Senior Software Engineer', summary: 'Leads design and delivery of complex backend features with limited supervision.',
    responsibilities: 'Owns technical design for features, mentors engineers, contributes to architecture decisions.',
    seniority_level: 'Senior', role_type: 'Individual Contributor',
    purpose_statement: 'Placeholder purpose: takes ambiguous problems and turns them into a technical plan the team can execute against.',
    focus_area: 'Complex feature design & delivery',
    typical_outputs: 'Placeholder examples: a design doc for a new subsystem, a mentoring relationship with a junior engineer, a resolved production incident.',
    day_in_the_life: 'Placeholder example: reviewing a design proposal, unblocking a teammate, writing a tricky piece of the system yourself.',
    success_indicators: 'Placeholder examples: designs hold up under review, the team ships complex work with fewer surprises, junior engineers grow faster.',
    progression_summary: 'Placeholder: typically progresses to Principal Engineer, or into an engineering management pathway.',
    display_tags: ['technical', 'leadership']
  }, admin.id);
  upsertRoleSkill(roleSenior.id, skProg.id, levels[4].id, 'core', 'Leads implementation of complex features.', { showFullDescription: true });
  upsertRoleSkill(roleSenior.id, skArch.id, levels[3].id, 'important', 'Contributes to component-level design decisions.', { showFullDescription: true });
  upsertRoleSkill(roleSenior.id, skSecurity.id, levels[3].id, 'important', 'Applies secure design practices.');
  upsertRoleSkill(roleSenior.id, skCloud.id, levels[3].id, 'optional', 'Familiarity with deployment platform.');

  const rolePrincipal = upsertRoleProfile({
    role_family_id: familyEng.id, capability_area_id: areaPlatform.id,
    title: 'Principal Engineer', summary: 'Sets technical direction across multiple teams and systems.',
    responsibilities: 'Owns architecture strategy, evaluates technical risk, drives cross-team standards.',
    seniority_level: 'Principal', role_type: 'Individual Contributor',
    purpose_statement: 'Placeholder purpose: ensures the systems multiple teams depend on remain coherent, scalable and well understood.',
    focus_area: 'Cross-team architecture strategy',
    typical_outputs: 'Placeholder examples: an architecture decision record adopted org-wide, a platform roadmap, a risk assessment for a major initiative.',
    day_in_the_life: 'Placeholder example: an architecture review, a 1:1 with a senior engineer on their design, deep work on a strategic problem.',
    success_indicators: 'Placeholder examples: fewer conflicting technical decisions across teams, platform incidents trend down, other engineers seek your input early.',
    progression_summary: 'Placeholder: a senior individual-contributor destination role, with lateral moves into engineering leadership possible.',
    display_tags: ['technical', 'architecture', 'strategy']
  }, admin.id);
  upsertRoleSkill(rolePrincipal.id, skProg.id, levels[4].id, 'important', 'Still hands-on when needed.');
  upsertRoleSkill(rolePrincipal.id, skArch.id, levels[5].id, 'core', 'Sets architecture direction organisation-wide.', { showFullDescription: true });
  upsertRoleSkill(rolePrincipal.id, skCloud.id, levels[4].id, 'core', 'Owns platform strategy.', { showFullDescription: true });
  upsertRoleSkill(rolePrincipal.id, skRisk.id, levels[3].id, 'important', 'Evaluates technical and delivery risk.');

  const roleDataEngineer = upsertRoleProfile({
    role_family_id: familyData.id, capability_area_id: areaDataEng.id,
    title: 'Data Engineer', summary: 'Builds and maintains data pipelines and analytics infrastructure.',
    responsibilities: 'Designs data pipelines, ensures data quality, supports analytics consumers.',
    seniority_level: 'Engineer', role_type: 'Individual Contributor',
    purpose_statement: 'Placeholder purpose: makes trustworthy data available to the people and systems that need it.',
    focus_area: 'Data pipeline delivery',
    typical_outputs: 'Placeholder examples: a new ingestion pipeline, a data quality check that catches bad records before they reach reporting.',
    day_in_the_life: 'Placeholder example: debugging a failed pipeline run, adding a new data source, reviewing a data model with an analyst.',
    success_indicators: 'Placeholder examples: pipelines run reliably with few manual fixes, downstream consumers trust the data.',
    progression_summary: 'Placeholder: typically progresses to Senior Data Engineer or Data Platform Engineer.',
    display_tags: ['technical', 'data']
  }, admin.id);
  upsertRoleSkill(roleDataEngineer.id, skProg.id, levels[3].id, 'core', 'Builds pipeline code.');
  upsertRoleSkill(roleDataEngineer.id, skData.id, levels[3].id, 'core', 'Analyses and models data.', { showFullDescription: true });
  upsertRoleSkill(roleDataEngineer.id, skCloud.id, levels[2].id, 'important', 'Uses cloud data platform services.');

  const resArch = upsertLearningResource({
    title: 'Example: Solution Architecture Workshop', description: 'Placeholder course covering architecture decision-making.',
    provider: 'Example Learning Provider', url: 'https://example.com/courses/solution-architecture',
    resource_type: 'course', delivery_method: 'blended', estimated_duration: '3 days', cost_type: 'paid'
  }, admin.id);
  upsertLearningSkill(resArch.id, skArch.id, levels[3].id, levels[5].id, 'level_uplift', 'high');

  const resCloud = upsertLearningResource({
    title: 'Example: Cloud Platform Fundamentals', description: 'Placeholder course covering core cloud platform concepts.',
    provider: 'Example Learning Provider', url: 'https://example.com/courses/cloud-fundamentals',
    resource_type: 'course', delivery_method: 'online', estimated_duration: '8 hours', cost_type: 'free'
  }, admin.id);
  upsertLearningSkill(resCloud.id, skCloud.id, levels[2].id, levels[4].id, null, 'medium');

  const resSecurity = upsertLearningResource({
    title: 'Example: Secure Coding Practices', description: 'Placeholder video series on secure coding fundamentals.',
    provider: 'Example Learning Provider', url: 'https://example.com/videos/secure-coding',
    resource_type: 'video', delivery_method: 'online', estimated_duration: '2 hours', cost_type: 'free'
  }, admin.id);
  upsertLearningSkill(resSecurity.id, skSecurity.id, levels[2].id, levels[3].id, null, 'medium');

  const resShadow = upsertLearningResource({
    title: 'Example: Shadow a Solution Architect', description: 'Placeholder practical development suggestion - arrange to shadow an architect on a live project.',
    provider: null, url: null,
    resource_type: 'stretch_assignment', delivery_method: 'project-based', estimated_duration: 'Ongoing', cost_type: 'internal'
  }, admin.id);
  upsertLearningSkill(resShadow.id, skArch.id, levels[3].id, levels[5].id, 'level_uplift', 'medium');

  const resNewSkillArch = upsertLearningResource({
    title: 'Example: Intro to Solution Architecture', description: 'Placeholder introductory resource for engineers with no architecture exposure yet.',
    provider: 'Example Learning Provider', url: 'https://example.com/courses/intro-architecture',
    resource_type: 'course', delivery_method: 'online', estimated_duration: '4 hours', cost_type: 'free'
  }, admin.id);
  upsertLearningSkill(resNewSkillArch.id, skArch.id, levels[1].id, levels[3].id, 'new_skill', 'high');

  const pathwaySoftwareEng = upsertPathway({
    pathway_name: 'Software Engineering Career Pathway',
    pathway_description: 'Placeholder pathway showing a typical individual-contributor route through software engineering, with an alternative branch into data engineering.',
    role_family_id: familyEng.id,
    pathway_type: 'IC'
  }, admin.id);
  upsertPathwayRole(pathwaySoftwareEng.id, roleEngineer.id, 1, { isStartingRole: true });
  upsertPathwayRole(pathwaySoftwareEng.id, roleSenior.id, 2);
  upsertPathwayRole(pathwaySoftwareEng.id, rolePrincipal.id, 3, { isEndRole: true });
  upsertPathwayRole(pathwaySoftwareEng.id, roleDataEngineer.id, 2, { displayLabel: 'Alternative data-focused branch' });
  upsertPathwayConnection(pathwaySoftwareEng.id, roleEngineer.id, roleSenior.id, 'progression', 'Typical next step after building a track record of independent feature delivery.');
  upsertPathwayConnection(pathwaySoftwareEng.id, roleSenior.id, rolePrincipal.id, 'progression', 'Requires demonstrated architecture and cross-team technical leadership.');
  upsertPathwayConnection(pathwaySoftwareEng.id, roleEngineer.id, roleDataEngineer.id, 'alternative', 'A related route for engineers who want to specialise in data pipelines rather than backend services.');

  console.log('Seed complete.');
  console.log('');
  console.log(`Super administrator: ${adminEmail}`);
  if (generatedPassword) {
    console.log(`Generated password (shown once): ${generatedPassword}`);
    console.log('Change this after first login - there is no password reset flow yet.');
  } else {
    console.log('Account already existed - password unchanged.');
  }
  console.log('');
  console.log('Seeded placeholder SFIA framework data, role families, role profiles and learning resources.');
  console.log('This is fictional example content, not the real licensed SFIA catalogue.');
}

run();
