const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const osm = require('../lib/osm');
const osmData = require('../lib/osmData');
const { logAudit, roleLabel, ROLE_LABELS, getServiceAccount, getVisibleSectionIds } = require('../lib/helpers');
const { requireAuth, requireAdmin } = require('../lib/middleware');
const { sendInviteEmail } = require('../lib/mailer');

const router = express.Router();
router.use('/api/admin', requireAuth, requireAdmin);

// ── Integration health ──────────────────────────────────────────────────
router.get('/api/admin/integration-health', (req, res) => {
  const service = getServiceAccount();
  res.json({
    osmConfigured: osm.isConfigured(),
    demoModeAllowed: osm.demoModeAllowed(),
    serviceAccount: service ? { name: `${service.first_name} ${service.last_name}`, connected: service.osm_access_token === 'demo' ? 'demo' : 'live', lastLoginAt: service.last_login_at } : null,
    osmUserCount: db.prepare(`SELECT COUNT(*) AS n FROM users WHERE auth_type = 'osm'`).get().n,
  });
});

router.get('/api/admin/osm/sections', async (req, res) => {
  const service = getServiceAccount() || req.user;
  const { token, unavailable, reason } = await osmData.readTokenFor({ ...service, portal_role: 'section_leader' });
  if (unavailable) return res.json({ available: false, reason, sections: [] });

  let sections;
  if (token === 'demo') {
    sections = Object.values(osm.demo.DEMO_SECTIONS).map(s => ({ sectionId: s.sectionid, sectionName: s.sectionname, sectionType: s.section }));
  } else {
    const roles = JSON.parse(service.osm_roles_json || '[]').filter(r => osm.YOUTH_SECTION_TYPES.includes(r.section));
    sections = roles.map(r => ({ sectionId: r.sectionid, sectionName: r.sectionname, sectionType: r.section }));
  }
  const visible = getVisibleSectionIds();
  res.json({ available: true, sections, visibleSectionIds: visible });
});

router.get('/api/admin/osm/sections/:sectionId/members', async (req, res) => {
  const service = getServiceAccount() || req.user;
  const { token, unavailable, reason } = await osmData.readTokenFor({ ...service, portal_role: 'section_leader' });
  if (unavailable) return res.json({ available: false, reason, members: [] });
  const data = await osmData.sectionMembers(token, req.params.sectionId);
  res.json(data);
});

router.get('/api/admin/settings', (req, res) => {
  const rows = db.prepare('SELECT * FROM settings').all();
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
  res.json({
    sessionTimeoutMinutes: Number(map.session_timeout_minutes || 720),
    auditRetentionDays: Number(map.audit_retention_days || 365),
    visibleSectionIds: map.visible_sections ? JSON.parse(map.visible_sections) : null,
    galleryEnabled: map.gallery_enabled === 'true',
    galleryWatermarkDefault: map.gallery_watermark_default === 'true',
    galleryRetentionDays: Number(map.gallery_retention_days || 365),
  });
});

router.put('/api/admin/settings', (req, res) => {
  const { sessionTimeoutMinutes, auditRetentionDays, visibleSectionIds, galleryEnabled, galleryWatermarkDefault, galleryRetentionDays } = req.body || {};
  const upsert = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  if (sessionTimeoutMinutes) upsert.run('session_timeout_minutes', String(sessionTimeoutMinutes));
  if (auditRetentionDays) upsert.run('audit_retention_days', String(auditRetentionDays));
  if (visibleSectionIds !== undefined) upsert.run('visible_sections', visibleSectionIds === null ? '' : JSON.stringify(visibleSectionIds));
  if (galleryEnabled !== undefined) upsert.run('gallery_enabled', galleryEnabled ? 'true' : 'false');
  if (galleryWatermarkDefault !== undefined) upsert.run('gallery_watermark_default', galleryWatermarkDefault ? 'true' : 'false');
  if (galleryRetentionDays) upsert.run('gallery_retention_days', String(galleryRetentionDays));
  logAudit({ userId: req.user.id, action: galleryEnabled !== undefined ? 'admin_toggle_gallery' : 'admin_update_settings', ipAddress: req.ip, details: req.body });
  res.json({ ok: true });
});

// ── Users and roles (FR-056, FR-061) ─────────────────────────────────────
router.get('/api/admin/users', (req, res) => {
  const users = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
  res.json(users.map(u => ({
    id: u.id, firstName: u.first_name, lastName: u.last_name, email: u.email,
    authType: u.auth_type, role: u.portal_role, roleLabel: roleLabel(u.portal_role),
    status: u.account_status, isServiceAccount: !!u.is_osm_service_account, lastLoginAt: u.last_login_at,
  })));
});

router.get('/api/admin/roles', (req, res) => {
  res.json(Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label })));
});

router.patch('/api/admin/users/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const { role, status } = req.body || {};

  if (role && !Object.keys(ROLE_LABELS).includes(role)) return res.status(400).json({ error: 'Unknown role.' });
  if (user.portal_role === 'admin' && role && role !== 'admin') {
    const otherAdmins = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE portal_role = 'admin' AND id != ? AND account_status = 'active'`).get(user.id).n;
    if (otherAdmins === 0) return res.status(400).json({ error: 'At least one active Portal Administrator is required.' });
  }
  if (user.portal_role === 'admin' && status && status !== 'active') {
    const otherAdmins = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE portal_role = 'admin' AND id != ? AND account_status = 'active'`).get(user.id).n;
    if (otherAdmins === 0) return res.status(400).json({ error: 'At least one active Portal Administrator is required.' });
  }

  db.prepare(`UPDATE users SET portal_role = ?, account_status = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(role || user.portal_role, status || user.account_status, user.id);
  logAudit({ userId: req.user.id, action: status && status !== 'active' ? 'admin_disable_user' : 'admin_change_role', entityType: 'user', entityId: String(user.id), ipAddress: req.ip, details: { role, status } });
  res.json({ ok: true });
});

// ── Parent accounts and child links (data area: user identity / parent-child links) ─
router.get('/api/admin/parents', (req, res) => {
  const parents = db.prepare(`SELECT * FROM users WHERE portal_role = 'parent' ORDER BY created_at DESC`).all();
  const links = db.prepare('SELECT * FROM parent_child_links').all();
  res.json(parents.map(p => ({
    id: p.id, firstName: p.first_name, lastName: p.last_name, email: p.email, status: p.account_status,
    hasSetPassword: !!p.password_hash, lastLoginAt: p.last_login_at,
    children: links.filter(l => l.parent_user_id === p.id).map(l => ({ linkId: l.id, name: l.child_display_name, sectionName: l.osm_section_name })),
  })));
});

router.post('/api/admin/parents', async (req, res) => {
  const { firstName, lastName, email } = req.body || {};
  if (!firstName || !lastName || !email) return res.status(400).json({ error: 'First name, last name and email are required.' });
  const normalizedEmail = String(email).trim().toLowerCase();
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail)) {
    return res.status(409).json({ error: 'A user with this email already exists.' });
  }
  const inviteToken = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  const info = db.prepare(`
    INSERT INTO users (auth_type, email, first_name, last_name, portal_role, invite_token, invite_expires_at)
    VALUES ('local', ?, ?, ?, 'parent', ?, ?)
  `).run(normalizedEmail, firstName, lastName, inviteToken, expires);

  const setupUrl = `${req.protocol}://${req.get('host')}/set-password.html?token=${inviteToken}`;
  const emailed = await sendInviteEmail(normalizedEmail, firstName, setupUrl).catch(() => false);
  logAudit({ userId: req.user.id, action: 'admin_create_parent', entityType: 'user', entityId: String(info.lastInsertRowid), ipAddress: req.ip });
  res.json({ id: info.lastInsertRowid, setupUrl, emailed });
});

router.post('/api/admin/parents/:id/children', (req, res) => {
  const parent = db.prepare(`SELECT * FROM users WHERE id = ? AND portal_role = 'parent'`).get(req.params.id);
  if (!parent) return res.status(404).json({ error: 'Parent account not found.' });
  const { osmMemberId, osmSectionId, osmSectionName, osmSectionType, childDisplayName } = req.body || {};
  if (!osmMemberId || !childDisplayName) return res.status(400).json({ error: 'osmMemberId and childDisplayName are required.' });
  try {
    const info = db.prepare(`
      INSERT INTO parent_child_links (parent_user_id, osm_member_id, osm_section_id, osm_section_name, osm_section_type, child_display_name, linked_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(parent.id, osmMemberId, osmSectionId || null, osmSectionName || null, osmSectionType || null, childDisplayName, req.user.id);
    logAudit({ userId: req.user.id, action: 'admin_link_child', entityType: 'parent_child_link', entityId: String(info.lastInsertRowid), ipAddress: req.ip });
    res.json({ ok: true, linkId: info.lastInsertRowid });
  } catch (e) {
    res.status(409).json({ error: 'This child is already linked to this parent account.' });
  }
});

router.delete('/api/admin/parents/:parentId/children/:linkId', (req, res) => {
  const link = db.prepare('SELECT * FROM parent_child_links WHERE id = ? AND parent_user_id = ?').get(req.params.linkId, req.params.parentId);
  if (!link) return res.status(404).json({ error: 'Link not found.' });
  db.prepare('DELETE FROM parent_child_links WHERE id = ?').run(link.id);
  logAudit({ userId: req.user.id, action: 'admin_unlink_child', entityType: 'parent_child_link', entityId: String(link.id), ipAddress: req.ip });
  res.json({ ok: true });
});

// ── Audit log (FR-059) ────────────────────────────────────────────────────
router.get('/api/admin/audit-log', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const rows = db.prepare(`
    SELECT a.*, u.first_name, u.last_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.id DESC LIMIT ?
  `).all(limit);
  res.json(rows.map(r => ({
    id: r.id, action: r.action, entityType: r.entity_type, entityId: r.entity_id,
    userName: r.user_id ? `${r.first_name} ${r.last_name}` : 'Unknown/anonymous',
    ipAddress: r.ip_address, details: r.details ? JSON.parse(r.details) : null, createdAt: r.created_at,
  })));
});

module.exports = router;
