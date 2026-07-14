const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const db = require('./db');

const REQUESTER_GROUPS = [
  '7th Swindon Leaders',
  '7th Swindon Beavers',
  '7th Swindon Cubs',
  '7th Swindon Scouts',
  '7th Swindon Trustees',
  '7th Swindon Administrators'
];

const APPROVER_GROUPS = [
  '7th Swindon Activity Approvers',
  '7th Swindon Group Lead Volunteer',
  '7th Swindon Section Team Leaders',
  '7th Swindon Trustee Board'
];

function upsertGroup(name, type) {
  const existing = db.prepare('SELECT * FROM groups WHERE name = ?').get(name);
  if (existing) return existing;
  const result = db.prepare('INSERT INTO groups (name, type) VALUES (?, ?)').run(name, type);
  return db.prepare('SELECT * FROM groups WHERE id = ?').get(result.lastInsertRowid);
}

// Registers a user by OSM email only - no password. Required before they can log in at all;
// they then authenticate with that email's real OSM password (see src/routes/auth.js).
function registerUser(name, email, isAdmin) {
  const normalizedEmail = email.trim().toLowerCase();
  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) return existing;
  const result = db.prepare('INSERT INTO users (name, email, is_admin) VALUES (?, ?, ?)')
    .run(name, normalizedEmail, isAdmin ? 1 : 0);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
}

function addToGroup(userId, groupId) {
  db.prepare('INSERT OR IGNORE INTO user_groups (user_id, group_id) VALUES (?, ?)').run(userId, groupId);
}

function run() {
  const groupsByName = {};
  for (const name of REQUESTER_GROUPS) groupsByName[name] = upsertGroup(name, 'requester');
  for (const name of APPROVER_GROUPS) groupsByName[name] = upsertGroup(name, 'approver');

  let form = db.prepare("SELECT * FROM forms WHERE slug = 'activity-approval'").get();
  if (!form) {
    const result = db.prepare(`
      INSERT INTO forms (slug, name, description, archive_after_months, delete_after_years)
      VALUES ('activity-approval', '7th Swindon Scout Activity Approval Form',
        'Local activity approval for 7th Swindon Scout Group activities requiring review before proceeding.', 6, 7)
    `).run();
    form = db.prepare('SELECT * FROM forms WHERE id = ?').get(result.lastInsertRowid);
  }

  for (const name of REQUESTER_GROUPS) {
    db.prepare('INSERT OR IGNORE INTO form_requester_groups (form_id, group_id) VALUES (?, ?)')
      .run(form.id, groupsByName[name].id);
  }

  const existingStage = db.prepare('SELECT * FROM workflow_stages WHERE form_id = ? AND sequence = 1').get(form.id);
  if (!existingStage) {
    db.prepare('INSERT INTO workflow_stages (form_id, sequence, approver_group_id) VALUES (?, 1, ?)')
      .run(form.id, groupsByName['7th Swindon Activity Approvers'].id);
  }

  if (!process.env.ADMIN_EMAIL) {
    throw new Error('Set ADMIN_EMAIL in .env to the OSM email address of the first administrator.');
  }
  const adminEmail = process.env.ADMIN_EMAIL;
  const admin = registerUser('Administrator', adminEmail, true);
  addToGroup(admin.id, groupsByName['7th Swindon Administrators'].id);

  console.log('Seed complete.');
  console.log('');
  console.log(`Registered administrator: ${adminEmail}`);
  console.log('They can log in with their normal OSM email and password - no local password to set.');
  console.log('');
  console.log('Everyone else must be added in Admin > Users (by OSM email address) before they can log in -');
  console.log('a valid OSM login on its own is not enough to gain access. Assign requester/approver groups');
  console.log('there too.');
}

run();
