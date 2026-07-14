const express = require('express');
const multer = require('multer');
const fs = require('fs');
const db = require('../db');
const osm = require('../lib/osm');
const gallery = require('../lib/gallery');
const { logAudit, isLeaderRole } = require('../lib/helpers');
const { requireAuth, requireParent, requireLeader, requireAdmin } = require('../lib/middleware');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

function requireGalleryEnabled(req, res, next) {
  if (!gallery.galleryEnabled()) return res.status(403).json({ error: 'The photo gallery is not enabled yet. Ask a Portal Administrator to turn it on in Admin Settings.' });
  next();
}

function serializeAlbum(album, photos) {
  return {
    id: album.id, title: album.title, groupingType: album.grouping_type, groupingLabel: album.grouping_label,
    sectionId: album.osm_section_id, sectionName: album.osm_section_name, visibilityScope: album.visibility_scope,
    status: album.status, watermarkEnabled: !!album.watermark_enabled, consentConfirmed: !!album.consent_confirmed,
    createdAt: album.created_at, approvedAt: album.approved_at,
    photos: (photos || []).map(p => ({ id: p.id, width: p.width, height: p.height })),
  };
}

// ── Parent-facing: view published albums only ─────────────────────────────

router.get('/api/gallery/albums', requireAuth, requireParent, requireGalleryEnabled, (req, res) => {
  const albums = db.prepare(`SELECT * FROM gallery_albums WHERE status = 'published' ORDER BY created_at DESC`).all();
  const eligible = albums.filter(a => gallery.parentEligibleForAlbum(req.user, a));
  res.json(eligible.map(a => serializeAlbum(a, db.prepare('SELECT * FROM gallery_photos WHERE album_id = ?').all(a.id))));
});

router.get('/api/gallery/albums/:id', requireAuth, requireParent, requireGalleryEnabled, (req, res) => {
  const album = db.prepare('SELECT * FROM gallery_albums WHERE id = ?').get(req.params.id);
  if (!album || !gallery.parentEligibleForAlbum(req.user, album)) return res.status(404).json({ error: 'Album not found.' });
  logAudit({ userId: req.user.id, action: 'gallery_view_album', entityType: 'gallery_album', entityId: String(album.id), ipAddress: req.ip });
  res.json(serializeAlbum(album, db.prepare('SELECT * FROM gallery_photos WHERE album_id = ?').all(album.id)));
});

// Shared authenticated image proxy (NFR-027) - never a public/static URL, and
// checked against the same permission rules as the album itself on every
// request (NFR-025). No download/share affordance is exposed - see FR-069.
router.get('/api/gallery/photos/:photoId/image', requireAuth, requireGalleryEnabled, (req, res) => {
  const photo = db.prepare('SELECT * FROM gallery_photos WHERE id = ?').get(req.params.photoId);
  if (!photo) return res.status(404).end();
  const album = db.prepare('SELECT * FROM gallery_albums WHERE id = ?').get(photo.album_id);
  if (!album || !gallery.canViewAlbum(req.user, album)) return res.status(403).end();
  const filePath = gallery.filePathFor(photo.storage_key);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.set('Cache-Control', 'private, no-store'); // NFR-029
  res.set('Content-Disposition', 'inline'); // never offered as a download
  res.type('image/jpeg').send(fs.readFileSync(filePath));
});

// ── Leader/admin: manage albums ────────────────────────────────────────────

router.get('/api/leader/gallery/sections', requireAuth, requireLeader, requireGalleryEnabled, (req, res) => {
  const roles = JSON.parse(req.user.osm_roles_json || '[]').filter(r => osm.YOUTH_SECTION_TYPES.includes(r.section));
  res.json(roles.map(r => ({ sectionId: r.sectionid, sectionName: r.sectionname })));
});

router.get('/api/leader/gallery/albums', requireAuth, requireLeader, requireGalleryEnabled, (req, res) => {
  const albums = db.prepare('SELECT * FROM gallery_albums ORDER BY created_at DESC').all();
  const visible = albums.filter(a => gallery.canManageAlbum(req.user, a) || req.user.portal_role === 'admin');
  res.json(visible.map(a => ({ ...serializeAlbum(a, []), photoCount: db.prepare('SELECT COUNT(*) AS n FROM gallery_photos WHERE album_id = ?').get(a.id).n })));
});

router.post('/api/leader/gallery/albums', requireAuth, requireLeader, requireGalleryEnabled, (req, res) => {
  const { title, groupingType, groupingLabel, sectionId, sectionName, visibilityScope } = req.body || {};
  if (!title) return res.status(400).json({ error: 'A title is required.' });
  const validGrouping = ['section', 'event', 'camp', 'activity', 'term'];
  const validScope = ['section', 'all_parents', 'selected_parents'];
  const info = db.prepare(`
    INSERT INTO gallery_albums (title, grouping_type, grouping_label, osm_section_id, osm_section_name, visibility_scope, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(title, validGrouping.includes(groupingType) ? groupingType : 'activity', groupingLabel || null,
    sectionId || null, sectionName || null, validScope.includes(visibilityScope) ? visibilityScope : 'section', req.user.id);
  logAudit({ userId: req.user.id, action: 'gallery_create_album', entityType: 'gallery_album', entityId: String(info.lastInsertRowid), ipAddress: req.ip });
  res.json(serializeAlbum(db.prepare('SELECT * FROM gallery_albums WHERE id = ?').get(info.lastInsertRowid), []));
});

function loadManagedAlbum(req, res) {
  const album = db.prepare('SELECT * FROM gallery_albums WHERE id = ?').get(req.params.id);
  if (!album || !gallery.canManageAlbum(req.user, album)) { res.status(404).json({ error: 'Album not found.' }); return null; }
  return album;
}

router.get('/api/leader/gallery/albums/:id', requireAuth, requireLeader, requireGalleryEnabled, (req, res) => {
  const album = loadManagedAlbum(req, res);
  if (!album) return;
  res.json(serializeAlbum(album, db.prepare('SELECT * FROM gallery_photos WHERE album_id = ?').all(album.id)));
});

router.patch('/api/leader/gallery/albums/:id', requireAuth, requireLeader, requireGalleryEnabled, (req, res) => {
  const album = loadManagedAlbum(req, res);
  if (!album) return;
  if (album.status !== 'draft') return res.status(400).json({ error: 'Only draft albums can be edited. Ask an administrator to unpublish it first.' });
  const { title, groupingType, groupingLabel, sectionId, sectionName, visibilityScope, watermarkEnabled, consentConfirmed } = req.body || {};
  const validGrouping = ['section', 'event', 'camp', 'activity', 'term'];
  const validScope = ['section', 'all_parents', 'selected_parents'];
  db.prepare(`
    UPDATE gallery_albums SET title = ?, grouping_type = ?, grouping_label = ?, osm_section_id = ?, osm_section_name = ?,
      visibility_scope = ?, watermark_enabled = ?, consent_confirmed = ?, consent_confirmed_by = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    title ?? album.title, validGrouping.includes(groupingType) ? groupingType : album.grouping_type,
    groupingLabel !== undefined ? groupingLabel : album.grouping_label,
    sectionId !== undefined ? sectionId : album.osm_section_id, sectionName !== undefined ? sectionName : album.osm_section_name,
    validScope.includes(visibilityScope) ? visibilityScope : album.visibility_scope,
    watermarkEnabled !== undefined ? (watermarkEnabled ? 1 : 0) : album.watermark_enabled,
    consentConfirmed !== undefined ? (consentConfirmed ? 1 : 0) : album.consent_confirmed,
    consentConfirmed ? req.user.id : album.consent_confirmed_by,
    album.id
  );
  logAudit({ userId: req.user.id, action: 'gallery_update_album', entityType: 'gallery_album', entityId: String(album.id), ipAddress: req.ip });
  res.json(serializeAlbum(db.prepare('SELECT * FROM gallery_albums WHERE id = ?').get(album.id), []));
});

router.post('/api/leader/gallery/albums/:id/photos', requireAuth, requireLeader, requireGalleryEnabled, upload.array('photos', 20), async (req, res) => {
  const album = loadManagedAlbum(req, res);
  if (!album) return;
  if (album.status !== 'draft') return res.status(400).json({ error: 'Photos can only be added while an album is in draft.' });
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No image files were received.' });

  const saved = [];
  const failed = [];
  for (const file of req.files) {
    try {
      const { buffer, width, height } = await gallery.processUpload(file.buffer, { watermark: !!album.watermark_enabled });
      const key = gallery.storageKey();
      gallery.saveFile(key, buffer);
      const info = db.prepare('INSERT INTO gallery_photos (album_id, storage_key, width, height, uploaded_by) VALUES (?, ?, ?, ?, ?)')
        .run(album.id, key, width, height, req.user.id);
      saved.push(info.lastInsertRowid);
    } catch (e) {
      failed.push(file.originalname || 'file');
    }
  }
  if (saved.length) logAudit({ userId: req.user.id, action: 'gallery_upload_photo', entityType: 'gallery_album', entityId: String(album.id), ipAddress: req.ip, details: { count: saved.length } });
  res.json({ saved: saved.length, failed });
});

router.delete('/api/leader/gallery/albums/:id/photos/:photoId', requireAuth, requireLeader, requireGalleryEnabled, (req, res) => {
  const album = loadManagedAlbum(req, res);
  if (!album) return;
  const photo = db.prepare('SELECT * FROM gallery_photos WHERE id = ? AND album_id = ?').get(req.params.photoId, album.id);
  if (!photo) return res.status(404).json({ error: 'Photo not found.' });
  gallery.deleteFile(photo.storage_key);
  db.prepare('DELETE FROM gallery_photos WHERE id = ?').run(photo.id);
  logAudit({ userId: req.user.id, action: 'gallery_delete_photo', entityType: 'gallery_photo', entityId: String(photo.id), ipAddress: req.ip });
  res.json({ ok: true });
});

router.post('/api/leader/gallery/albums/:id/submit', requireAuth, requireLeader, requireGalleryEnabled, (req, res) => {
  const album = loadManagedAlbum(req, res);
  if (!album) return;
  if (album.status !== 'draft') return res.status(400).json({ error: 'Only draft albums can be submitted.' });
  if (!album.consent_confirmed) return res.status(400).json({ error: 'Confirm photo consent for everyone in this album before submitting it (FRD FR-076).' });
  const photoCount = db.prepare('SELECT COUNT(*) AS n FROM gallery_photos WHERE album_id = ?').get(album.id).n;
  if (photoCount === 0) return res.status(400).json({ error: 'Add at least one photo before submitting.' });
  db.prepare(`UPDATE gallery_albums SET status = 'pending_approval', updated_at = datetime('now') WHERE id = ?`).run(album.id);
  logAudit({ userId: req.user.id, action: 'gallery_submit_album', entityType: 'gallery_album', entityId: String(album.id), ipAddress: req.ip });
  res.json({ ok: true });
});

router.delete('/api/leader/gallery/albums/:id', requireAuth, requireLeader, requireGalleryEnabled, (req, res) => {
  const album = db.prepare('SELECT * FROM gallery_albums WHERE id = ?').get(req.params.id);
  if (!album || !gallery.canTakeDownAlbum(req.user, album)) return res.status(404).json({ error: 'Album not found.' });
  const photos = db.prepare('SELECT storage_key FROM gallery_photos WHERE album_id = ?').all(album.id);
  photos.forEach(p => gallery.deleteFile(p.storage_key));
  db.prepare('DELETE FROM gallery_photos WHERE album_id = ?').run(album.id);
  db.prepare('DELETE FROM gallery_album_parents WHERE album_id = ?').run(album.id);
  db.prepare('DELETE FROM gallery_albums WHERE id = ?').run(album.id);
  logAudit({ userId: req.user.id, action: 'gallery_delete_album', entityType: 'gallery_album', entityId: String(album.id), ipAddress: req.ip });
  res.json({ ok: true });
});

// ── Admin: approval workflow ────────────────────────────────────────────

router.get('/api/admin/gallery/albums', requireAuth, requireAdmin, requireGalleryEnabled, (req, res) => {
  const albums = db.prepare('SELECT * FROM gallery_albums ORDER BY created_at DESC').all();
  res.json(albums.map(a => ({ ...serializeAlbum(a, []), photoCount: db.prepare('SELECT COUNT(*) AS n FROM gallery_photos WHERE album_id = ?').get(a.id).n })));
});

router.post('/api/admin/gallery/albums/:id/approve', requireAuth, requireAdmin, requireGalleryEnabled, (req, res) => {
  const album = db.prepare('SELECT * FROM gallery_albums WHERE id = ?').get(req.params.id);
  if (!album || album.status !== 'pending_approval') return res.status(400).json({ error: 'Only albums pending approval can be published.' });
  db.prepare(`UPDATE gallery_albums SET status = 'published', approved_by = ?, approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(req.user.id, album.id);
  logAudit({ userId: req.user.id, action: 'gallery_approve_album', entityType: 'gallery_album', entityId: String(album.id), ipAddress: req.ip });
  res.json({ ok: true });
});

router.post('/api/admin/gallery/albums/:id/reject', requireAuth, requireAdmin, requireGalleryEnabled, (req, res) => {
  const album = db.prepare('SELECT * FROM gallery_albums WHERE id = ?').get(req.params.id);
  if (!album || album.status !== 'pending_approval') return res.status(400).json({ error: 'Only albums pending approval can be rejected back to draft.' });
  db.prepare(`UPDATE gallery_albums SET status = 'draft', updated_at = datetime('now') WHERE id = ?`).run(album.id);
  logAudit({ userId: req.user.id, action: 'gallery_reject_album', entityType: 'gallery_album', entityId: String(album.id), ipAddress: req.ip, details: { reason: req.body?.reason || null } });
  res.json({ ok: true });
});

router.post('/api/admin/gallery/albums/:id/unpublish', requireAuth, requireAdmin, requireGalleryEnabled, (req, res) => {
  const album = db.prepare('SELECT * FROM gallery_albums WHERE id = ?').get(req.params.id);
  if (!album || album.status !== 'published') return res.status(400).json({ error: 'Only published albums can be unpublished.' });
  db.prepare(`UPDATE gallery_albums SET status = 'archived', updated_at = datetime('now') WHERE id = ?`).run(album.id);
  logAudit({ userId: req.user.id, action: 'gallery_unpublish_album', entityType: 'gallery_album', entityId: String(album.id), ipAddress: req.ip });
  res.json({ ok: true });
});

router.delete('/api/admin/gallery/albums/:id', requireAuth, requireAdmin, requireGalleryEnabled, (req, res) => {
  const album = db.prepare('SELECT * FROM gallery_albums WHERE id = ?').get(req.params.id);
  if (!album) return res.status(404).json({ error: 'Album not found.' });
  const photos = db.prepare('SELECT storage_key FROM gallery_photos WHERE album_id = ?').all(album.id);
  photos.forEach(p => gallery.deleteFile(p.storage_key));
  db.prepare('DELETE FROM gallery_photos WHERE album_id = ?').run(album.id);
  db.prepare('DELETE FROM gallery_album_parents WHERE album_id = ?').run(album.id);
  db.prepare('DELETE FROM gallery_albums WHERE id = ?').run(album.id);
  logAudit({ userId: req.user.id, action: 'gallery_delete_album', entityType: 'gallery_album', entityId: String(album.id), ipAddress: req.ip });
  res.json({ ok: true });
});

module.exports = router;
