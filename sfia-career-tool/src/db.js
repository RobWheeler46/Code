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

module.exports = db;
