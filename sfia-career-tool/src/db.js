const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'sfia-career-tool.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  account_status TEXT NOT NULL DEFAULT 'active' CHECK(account_status IN ('active','suspended','deleted')),
  email_verified INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_name TEXT NOT NULL UNIQUE,
  description TEXT,
  can_edit INTEGER NOT NULL DEFAULT 0,
  can_publish INTEGER NOT NULL DEFAULT 0,
  can_manage_admins INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_admin_roles (
  user_id INTEGER NOT NULL REFERENCES users(id),
  admin_role_id INTEGER NOT NULL REFERENCES admin_roles(id),
  assigned_by INTEGER REFERENCES users(id),
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, admin_role_id)
);

CREATE TABLE IF NOT EXISTS role_families (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS capability_areas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_family_id INTEGER NOT NULL REFERENCES role_families(id),
  name TEXT NOT NULL,
  description TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(role_family_id, name)
);

CREATE TABLE IF NOT EXISTS role_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_family_id INTEGER REFERENCES role_families(id),
  capability_area_id INTEGER REFERENCES capability_areas(id),
  title TEXT NOT NULL,
  summary TEXT,
  responsibilities TEXT,
  seniority_level TEXT,
  role_type TEXT NOT NULL DEFAULT 'Individual Contributor' CHECK(role_type IN ('Individual Contributor','Management','Hybrid')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','unpublished','archived')),
  owner_user_id INTEGER REFERENCES users(id),
  version_number INTEGER NOT NULL DEFAULT 1,
  effective_from TEXT,
  review_date TEXT,
  published_at TEXT,
  published_by INTEGER REFERENCES users(id),
  purpose_statement TEXT,
  role_at_a_glance TEXT,
  typical_outputs TEXT,
  day_in_the_life TEXT,
  success_indicators TEXT,
  progression_summary TEXT,
  display_tags TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sfia_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_name TEXT NOT NULL UNIQUE,
  description TEXT,
  effective_from TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','retired')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sfia_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sfia_version_id INTEGER NOT NULL REFERENCES sfia_versions(id),
  name TEXT NOT NULL,
  description TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  UNIQUE(sfia_version_id, name)
);

CREATE TABLE IF NOT EXISTS sfia_skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sfia_version_id INTEGER NOT NULL REFERENCES sfia_versions(id),
  sfia_category_id INTEGER REFERENCES sfia_categories(id),
  skill_code TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  short_description TEXT,
  full_description TEXT,
  source_reference TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(sfia_version_id, skill_code)
);

CREATE TABLE IF NOT EXISTS sfia_levels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level_number INTEGER NOT NULL UNIQUE CHECK(level_number BETWEEN 1 AND 7),
  level_name TEXT NOT NULL,
  description TEXT,
  level_full_description TEXT,
  source_reference TEXT,
  display_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sfia_skill_level_descriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sfia_version_id INTEGER NOT NULL REFERENCES sfia_versions(id),
  sfia_skill_id INTEGER NOT NULL REFERENCES sfia_skills(id),
  sfia_level_id INTEGER NOT NULL REFERENCES sfia_levels(id),
  skill_level_description TEXT NOT NULL,
  guidance_notes TEXT,
  source_reference TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(sfia_skill_id, sfia_level_id)
);

CREATE TABLE IF NOT EXISTS role_profile_skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_profile_id INTEGER NOT NULL REFERENCES role_profiles(id),
  sfia_skill_id INTEGER NOT NULL REFERENCES sfia_skills(id),
  required_sfia_level_id INTEGER NOT NULL REFERENCES sfia_levels(id),
  importance TEXT NOT NULL DEFAULT 'important' CHECK(importance IN ('core','important','optional')),
  rationale TEXT,
  role_specific_display_notes TEXT,
  show_full_description INTEGER NOT NULL DEFAULT 0,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(role_profile_id, sfia_skill_id)
);

CREATE TABLE IF NOT EXISTS learning_resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  provider TEXT,
  url TEXT,
  resource_type TEXT NOT NULL DEFAULT 'course',
  delivery_method TEXT,
  estimated_duration TEXT,
  cost_type TEXT NOT NULL DEFAULT 'free' CHECK(cost_type IN ('free','paid','internal')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
  review_date TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS learning_resource_skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  learning_resource_id INTEGER NOT NULL REFERENCES learning_resources(id),
  sfia_skill_id INTEGER NOT NULL REFERENCES sfia_skills(id),
  min_sfia_level_id INTEGER REFERENCES sfia_levels(id),
  max_sfia_level_id INTEGER REFERENCES sfia_levels(id),
  role_family_id INTEGER REFERENCES role_families(id),
  capability_area_id INTEGER REFERENCES capability_areas(id),
  gap_type TEXT CHECK(gap_type IN ('new_skill','level_uplift','evidence_required') OR gap_type IS NULL),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('high','medium','low')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS career_pathways (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pathway_name TEXT NOT NULL,
  pathway_description TEXT,
  role_family_id INTEGER REFERENCES role_families(id),
  pathway_type TEXT NOT NULL DEFAULT 'IC' CHECK(pathway_type IN ('IC','Management','Architecture','Specialist','Hybrid')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
  display_order INTEGER NOT NULL DEFAULT 0,
  owner_user_id INTEGER REFERENCES users(id),
  review_date TEXT,
  published_at TEXT,
  published_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS career_pathway_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  career_pathway_id INTEGER NOT NULL REFERENCES career_pathways(id),
  role_profile_id INTEGER NOT NULL REFERENCES role_profiles(id),
  pathway_stage INTEGER NOT NULL DEFAULT 1,
  display_label TEXT,
  is_starting_role INTEGER NOT NULL DEFAULT 0,
  is_end_role INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(career_pathway_id, role_profile_id)
);

CREATE TABLE IF NOT EXISTS career_pathway_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  career_pathway_id INTEGER NOT NULL REFERENCES career_pathways(id),
  from_role_profile_id INTEGER NOT NULL REFERENCES role_profiles(id),
  to_role_profile_id INTEGER NOT NULL REFERENCES role_profiles(id),
  connection_type TEXT NOT NULL DEFAULT 'progression' CHECK(connection_type IN ('progression','lateral','specialisation','management','architecture','stretch','alternative')),
  connection_description TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(career_pathway_id, from_role_profile_id, to_role_profile_id)
);

CREATE TABLE IF NOT EXISTS content_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_type TEXT NOT NULL,
  content_id INTEGER NOT NULL,
  version_number INTEGER NOT NULL,
  change_summary TEXT,
  previous_value TEXT,
  new_value TEXT,
  changed_by INTEGER REFERENCES users(id),
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  ip_address TEXT,
  user_agent TEXT,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  event_type TEXT NOT NULL,
  role_profile_id INTEGER REFERENCES role_profiles(id),
  aspirational_role_profile_id INTEGER REFERENCES role_profiles(id),
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_role_profiles_status ON role_profiles(status, role_family_id, capability_area_id);
CREATE INDEX IF NOT EXISTS idx_role_profiles_title ON role_profiles(title);
CREATE INDEX IF NOT EXISTS idx_sfia_skills_code ON sfia_skills(skill_code);
CREATE INDEX IF NOT EXISTS idx_sfia_skills_name ON sfia_skills(skill_name);
CREATE INDEX IF NOT EXISTS idx_role_profile_skills_lookup ON role_profile_skills(role_profile_id, sfia_skill_id);
CREATE INDEX IF NOT EXISTS idx_skill_level_desc_lookup ON sfia_skill_level_descriptions(sfia_skill_id, sfia_level_id, sfia_version_id);
CREATE INDEX IF NOT EXISTS idx_learning_resources_status ON learning_resources(status, resource_type);
CREATE INDEX IF NOT EXISTS idx_learning_resource_skills_lookup ON learning_resource_skills(sfia_skill_id, min_sfia_level_id, max_sfia_level_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_usage_events_type ON usage_events(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_career_pathways_status ON career_pathways(status, role_family_id, pathway_type);
CREATE INDEX IF NOT EXISTS idx_career_pathway_roles_lookup ON career_pathway_roles(career_pathway_id, role_profile_id);
CREATE INDEX IF NOT EXISTS idx_career_pathway_roles_role ON career_pathway_roles(role_profile_id);
CREATE INDEX IF NOT EXISTS idx_career_pathway_connections_lookup ON career_pathway_connections(career_pathway_id, from_role_profile_id);
`);

// Additive migration (FRD v0.17 s.70: every role profile must be pinned to a single SFIA version).
// Uses ALTER TABLE rather than a schema-in-place rewrite because, unlike earlier schema changes in
// this project, the production database now holds real imported content that must not be wiped.
const roleProfileColumns = db.prepare(`PRAGMA table_info(role_profiles)`).all().map(c => c.name);
if (!roleProfileColumns.includes('sfia_version_id')) {
  db.exec(`ALTER TABLE role_profiles ADD COLUMN sfia_version_id INTEGER REFERENCES sfia_versions(id)`);
  db.exec(`
    UPDATE role_profiles SET sfia_version_id = (
      SELECT id FROM sfia_versions WHERE status = 'active' ORDER BY id DESC LIMIT 1
    )
    WHERE sfia_version_id IS NULL
  `);
}

// Additive migration (FRD v0.19/v0.20: simplified role profile model - Role Name, Grade, Role
// Description and validated SFIA mappings only). Adds the two new fields without touching or
// dropping any existing columns/data - the richer "engaging content" fields (purpose_statement,
// day_in_the_life, etc.) stay in the database, just unused by the simplified admin form and public
// page, per the FRD's own "may be reintroduced later as optional enrichment" framing.
const roleProfileColumns2 = db.prepare(`PRAGMA table_info(role_profiles)`).all().map(c => c.name);
if (!roleProfileColumns2.includes('grade')) {
  db.exec(`ALTER TABLE role_profiles ADD COLUMN grade TEXT`);
}
if (!roleProfileColumns2.includes('role_description')) {
  db.exec(`ALTER TABLE role_profiles ADD COLUMN role_description TEXT`);
  // One-time backfill so existing published roles aren't left with a blank description on the new
  // simplified page - consolidates the narrative content that's already there, doesn't invent anything.
  const rolesNeedingBackfill = db.prepare(`
    SELECT id, purpose_statement, summary, responsibilities FROM role_profiles WHERE role_description IS NULL
  `).all();
  const updateDescription = db.prepare(`UPDATE role_profiles SET role_description = ? WHERE id = ?`);
  for (const r of rolesNeedingBackfill) {
    const parts = [r.purpose_statement, r.summary, r.responsibilities].filter(Boolean);
    if (parts.length > 0) updateDescription.run(parts.join('\n\n'), r.id);
  }
}

// Additive migration (FRD v0.21-v0.23 Part K: SFIA 9 source workbook import).
// Adds columns/tables needed to import the full official SFIA 9 reference dataset (147 skills,
// 672 skill-level descriptions, 16 attributes, 112 attribute-level descriptions, 7 levels) from
// the clean import template - see src/import-sfia-9-reference-data.js. Nothing here touches or
// drops existing columns/rows.
const sfiaSkillColumns = db.prepare(`PRAGMA table_info(sfia_skills)`).all().map(c => c.name);
if (!sfiaSkillColumns.includes('subcategory')) {
  db.exec(`ALTER TABLE sfia_skills ADD COLUMN subcategory TEXT`);
}
if (!sfiaSkillColumns.includes('guidance_notes')) {
  // Distinct from sfia_skill_level_descriptions.guidance_notes (per level) - this is the
  // skill-level overall guidance text from the SFIA source (FRD K4: Skills.Guidance notes).
  db.exec(`ALTER TABLE sfia_skills ADD COLUMN guidance_notes TEXT`);
}

db.exec(`
CREATE TABLE IF NOT EXISTS sfia_attributes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sfia_version_id INTEGER NOT NULL REFERENCES sfia_versions(id),
  attribute_code TEXT NOT NULL,
  attribute_name TEXT NOT NULL,
  attribute_type TEXT,
  overall_description TEXT,
  guidance_notes TEXT,
  source_reference TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(sfia_version_id, attribute_code)
);

CREATE TABLE IF NOT EXISTS sfia_attribute_level_descriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sfia_version_id INTEGER NOT NULL REFERENCES sfia_versions(id),
  sfia_attribute_id INTEGER NOT NULL REFERENCES sfia_attributes(id),
  sfia_level_id INTEGER NOT NULL REFERENCES sfia_levels(id),
  level_description TEXT NOT NULL,
  source_reference TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(sfia_attribute_id, sfia_level_id)
);

CREATE INDEX IF NOT EXISTS idx_sfia_attributes_code ON sfia_attributes(attribute_code);
CREATE INDEX IF NOT EXISTS idx_sfia_attribute_level_desc_lookup ON sfia_attribute_level_descriptions(sfia_attribute_id, sfia_level_id);
`);

// Phase 2 (registered end-user accounts): the first slice is personal saved items. End users reuse the
// existing `users` table (an end user is simply a users row with no admin_roles). These tables are
// additive and reference users(id); nothing existing is changed.
db.exec(`
CREATE TABLE IF NOT EXISTS saved_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  role_profile_id INTEGER NOT NULL REFERENCES role_profiles(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, role_profile_id)
);

CREATE TABLE IF NOT EXISTS saved_comparisons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  current_role_profile_id INTEGER NOT NULL REFERENCES role_profiles(id),
  aspirational_role_profile_id INTEGER NOT NULL REFERENCES role_profiles(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, current_role_profile_id, aspirational_role_profile_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_roles_user ON saved_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_comparisons_user ON saved_comparisons(user_id);
`);

// Phase 2 feature: guided role-based SFIA self-assessment (FRD Part E). An attempt targets one role
// profile; the user self-rates their level for each SFIA skill the role requires (options come from the
// imported skill-at-level descriptions), optionally adding evidence + a confidence score. Readiness is
// derived by comparing the self-assessed level to the role's required level per skill. Additive tables.
db.exec(`
CREATE TABLE IF NOT EXISTS assessment_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  role_profile_id INTEGER NOT NULL REFERENCES role_profiles(id),
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress','completed')),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS assessment_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id INTEGER NOT NULL REFERENCES assessment_attempts(id),
  sfia_skill_id INTEGER NOT NULL REFERENCES sfia_skills(id),
  self_assessed_level_id INTEGER REFERENCES sfia_levels(id),
  confidence INTEGER,
  evidence_text TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(attempt_id, sfia_skill_id)
);

CREATE INDEX IF NOT EXISTS idx_assessment_attempts_user ON assessment_attempts(user_id, status);
CREATE INDEX IF NOT EXISTS idx_assessment_responses_attempt ON assessment_responses(attempt_id);
`);

// Phase 2 feature: personal development plan (FRD Phase-2 "Personal Development Plan" / "Development Plan
// Item"). Each user has one implicit plan made of items; an item is a SFIA skill the user wants to
// develop, optionally toward a target role and target level, with a status. Items are typically added
// from an assessment gap or a role comparison, or manually. Additive table.
db.exec(`
CREATE TABLE IF NOT EXISTS development_plan_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  sfia_skill_id INTEGER NOT NULL REFERENCES sfia_skills(id),
  target_role_profile_id INTEGER REFERENCES role_profiles(id),
  target_level_id INTEGER REFERENCES sfia_levels(id),
  status TEXT NOT NULL DEFAULT 'not_started' CHECK(status IN ('not_started','in_progress','done')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, sfia_skill_id, target_role_profile_id)
);

CREATE INDEX IF NOT EXISTS idx_development_plan_user ON development_plan_items(user_id, status);
`);

// Phase 2 feature: evidence capture (FRD Phase-2 "Evidence"). A personal, reusable portfolio of evidence
// items, each demonstrating a SFIA skill (e.g. a project, a review, a document). Referenced when
// self-assessing or building a development plan. Additive table.
db.exec(`
CREATE TABLE IF NOT EXISTS evidence_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  sfia_skill_id INTEGER NOT NULL REFERENCES sfia_skills(id),
  title TEXT NOT NULL,
  description TEXT,
  url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_evidence_user ON evidence_items(user_id, sfia_skill_id);
`);

// Phase 2 feature: read-only share links (FRD Phase-2 sharing with managers/mentors). A user mints an
// unguessable token that grants a read-only view of one assessment result, or of their development plan.
// Revoking simply deletes the row. Anyone with the link can view - the token IS the credential, so it is
// long and random. Additive table.
db.exec(`
CREATE TABLE IF NOT EXISTS share_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token TEXT NOT NULL UNIQUE,
  share_type TEXT NOT NULL CHECK(share_type IN ('assessment','plan')),
  resource_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_share_links_user ON share_links(user_id);
`);

// Selected-user feature (FRD v0.24): Strength-Based Interview Pack Generator. An approvable question bank
// holds strength-based interview questions aligned to a SFIA skill+level; a generated pack selects (with
// randomisation) an approved question per skill mapped to a role, and produces a Word document. Only
// approved (not draft/retired) questions are eligible; where none exists a generic fallback is used.
// Additive tables.
db.exec(`
CREATE TABLE IF NOT EXISTS interview_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sfia_version_id INTEGER REFERENCES sfia_versions(id),
  sfia_skill_id INTEGER NOT NULL REFERENCES sfia_skills(id),
  sfia_level_id INTEGER NOT NULL REFERENCES sfia_levels(id),
  question_type TEXT NOT NULL DEFAULT 'strength_based' CHECK(question_type IN ('strength_based','alternative')),
  question_text TEXT NOT NULL,
  what_good_looks_like TEXT,
  probe_prompts TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','retired')),
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  created_by INTEGER REFERENCES users(id),
  approved_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_interview_questions_lookup ON interview_questions(sfia_skill_id, sfia_level_id, status);

CREATE TABLE IF NOT EXISTS generated_interview_packs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_profile_id INTEGER NOT NULL REFERENCES role_profiles(id),
  sfia_version_id INTEGER REFERENCES sfia_versions(id),
  generated_by INTEGER REFERENCES users(id),
  question_ids TEXT,
  skill_count INTEGER,
  generated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_generated_packs_role ON generated_interview_packs(role_profile_id);
`);

module.exports = db;
