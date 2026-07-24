// User records: local (password) accounts for parents, OSM accounts for
// leaders/admins, plus the seed data that makes the app usable on first boot.
const db = require('../db');
const config = require('./config');
const { hashPassword, verifyPassword, hashRef, maskId } = require('./crypto');

const byEmail = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)');
const byId = db.prepare('SELECT * FROM users WHERE id = ?');
const byOsmHash = db.prepare('SELECT * FROM users WHERE osm_user_hash = ?');
const insertLocal = db.prepare(`
  INSERT INTO users (email, password_hash, display_name, role, auth_source)
  VALUES (?, ?, ?, ?, 'local')
`);
const insertOsm = db.prepare(`
  INSERT INTO users (email, display_name, role, auth_source, osm_user_hash, osm_user_ref, last_login_at)
  VALUES (?, ?, ?, 'osm', ?, ?, datetime('now'))
`);
const touchLogin = db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?");
const updateOsm = db.prepare("UPDATE users SET last_login_at = datetime('now'), display_name = ?, role = ? WHERE id = ?");

function findByEmail(email) { return byEmail.get(email); }
function findById(id) { return byId.get(id); }

function createLocal({ email, password, displayName, role = 'parent' }) {
  const info = insertLocal.run(email.trim(), hashPassword(password), displayName.trim(), role);
  return byId.get(info.lastInsertRowid);
}

function authenticateLocal(email, password) {
  const user = byEmail.get(email);
  if (!user || user.auth_source !== 'local' || user.status !== 'active') return null;
  if (!verifyPassword(password, user.password_hash)) return null;
  touchLogin.run(user.id);
  return user;
}

// Admin role is granted to OSM identities listed in config; everyone else who
// signs in through OSM is a Leader (parents use local accounts).
function resolveOsmRole(osmUserId, email) {
  const lowerEmail = String(email || '').toLowerCase();
  if (
    (osmUserId && config.osm.adminUserIds.includes(String(osmUserId))) ||
    (lowerEmail && config.osm.adminEmails.includes(lowerEmail))
  ) return 'admin';
  return 'leader';
}

function upsertOsmUser({ osmUserId, email, name }) {
  const ref = osmUserId ?? email ?? 'unknown';
  const hash = hashRef(ref);
  const role = resolveOsmRole(osmUserId, email);
  const displayName = name || email || 'Leader';
  const existing = byOsmHash.get(hash);
  if (existing) {
    // Keep an existing admin admin even if the env list changes later.
    const finalRole = existing.role === 'admin' ? 'admin' : role;
    updateOsm.run(displayName, finalRole, existing.id);
    return byId.get(existing.id);
  }
  const info = insertOsm.run(
    email || `osm-${hash.slice(0, 10)}@osm.local`,
    displayName,
    role,
    hash,
    maskId(ref)
  );
  return byId.get(info.lastInsertRowid);
}

function toSession(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    role: user.role,
    authSource: user.auth_source
  };
}

function listAll() {
  return db.prepare('SELECT id, email, display_name, role, auth_source, status, created_at, last_login_at FROM users ORDER BY id').all();
}

function setRole(id, role) {
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
}
function setStatus(id, status) {
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, id);
}

// Seed demo accounts + a couple of notices/children so a fresh deployment is not
// an empty screen. Controlled by SEED_DEMO_USERS.
function seedDemo() {
  if (!config.seedDemoUsers) return;
  if (byEmail.get('admin@7thportal.local')) return; // already seeded

  const admin = createLocal({ email: 'admin@7thportal.local', password: 'portal-admin', displayName: 'Portal Admin', role: 'admin' });
  createLocal({ email: 'leader@7thportal.local', password: 'portal-leader', displayName: 'Sam Leader', role: 'leader' });
  const parent = createLocal({ email: 'parent@7thportal.local', password: 'portal-parent', displayName: 'Alex Parent', role: 'parent' });

  db.prepare('INSERT INTO children (parent_user_id, name, section, osm_link) VALUES (?, ?, ?, ?)')
    .run(parent.id, 'Jamie Parent', 'Cubs', 'https://www.onlinescoutmanager.co.uk/');
  db.prepare('INSERT INTO children (parent_user_id, name, section, osm_link) VALUES (?, ?, ?, ?)')
    .run(parent.id, 'Robin Parent', 'Beavers', 'https://www.onlinescoutmanager.co.uk/');

  const notice = db.prepare('INSERT INTO notices (title, body, audience, published, created_by) VALUES (?, ?, ?, 1, ?)');
  notice.run('Welcome to 7thPortal', 'This is the new home for group notices, your child’s information and leader documents. Parents sign in with the account we issue you; leaders sign in with OSM.', 'all', admin.id);
  notice.run('Summer camp kit list published', 'Leaders have added the summer camp kit list to the document library. Parents will receive a printed copy at the next meeting.', 'parents', admin.id);
  notice.run('Leaders: expenses policy updated', 'The multi-item expenses and mileage policy has been updated. Please read and acknowledge it in the document library.', 'leaders', admin.id);

  console.log('[seed] demo accounts created: admin@7thportal.local / leader@7thportal.local / parent@7thportal.local');
}

module.exports = {
  findByEmail, findById, createLocal, authenticateLocal,
  upsertOsmUser, toSession, listAll, setRole, setStatus, seedDemo
};
