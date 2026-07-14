const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Jimp, JimpMime, loadFont } = require('jimp');
const { SANS_16_WHITE } = require('jimp/fonts');
const db = require('../db');
const { isLeaderRole, isAdminRole } = require('./helpers');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'data', 'gallery-uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_DIMENSION = 1600; // web-optimised copy, not the original (FR-070, NFR-028)

// Re-encoding through Jimp naturally strips EXIF (including GPS location -
// NFR-030) because the output is freshly built pixel data with no source
// metadata carried over. The caller's original upload buffer is never
// persisted to disk - only this processed copy is (FR-070 data table:
// "original should be deleted after processing").
async function processUpload(buffer, { watermark } = {}) {
  const img = await Jimp.read(buffer);
  if (img.bitmap.width > MAX_DIMENSION || img.bitmap.height > MAX_DIMENSION) {
    if (img.bitmap.width >= img.bitmap.height) img.resize({ w: MAX_DIMENSION });
    else img.resize({ h: MAX_DIMENSION });
  }
  if (watermark) {
    const font = await loadFont(SANS_16_WHITE);
    img.print({ font, x: 10, y: img.bitmap.height - 26, text: '7th Swindon Scouts - private, do not share' });
  }
  const outBuffer = await img.getBuffer(JimpMime.jpeg);
  return { buffer: outBuffer, width: img.bitmap.width, height: img.bitmap.height };
}

function storageKey() {
  return crypto.randomBytes(20).toString('hex');
}

function filePathFor(key) {
  return path.join(UPLOAD_DIR, `${key}.jpg`);
}

function saveFile(key, buffer) {
  fs.writeFileSync(filePathFor(key), buffer);
}

function deleteFile(key) {
  const p = filePathFor(key);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

// ── Permissions ─────────────────────────────────────────────────────────

function userOwnSectionIds(user) {
  return JSON.parse(user.osm_roles_json || '[]').map(r => r.sectionid).filter(Boolean);
}

// Leaders/admins who may create photos, edit metadata, upload, and manage a
// draft/pending album. Once published, only the creator or an admin may
// unpublish/delete (FR-073 - published content take-down is admin-gated).
function canManageAlbum(user, album) {
  if (isAdminRole(user.portal_role)) return true;
  if (!isLeaderRole(user.portal_role)) return false;
  if (album.created_by === user.id) return true;
  if (album.status === 'published' || album.status === 'archived') return false;
  return album.osm_section_id && userOwnSectionIds(user).includes(album.osm_section_id);
}

function canTakeDownAlbum(user, album) {
  if (isAdminRole(user.portal_role)) return true;
  return album.created_by === user.id;
}

// Parents can only ever see published albums they're eligible for (FR-068).
function parentEligibleForAlbum(user, album) {
  if (album.status !== 'published') return false;
  if (album.visibility_scope === 'all_parents') return true;
  if (album.visibility_scope === 'section') {
    const sectionIds = db.prepare('SELECT DISTINCT osm_section_id FROM parent_child_links WHERE parent_user_id = ?').all(user.id).map(r => r.osm_section_id);
    return sectionIds.includes(album.osm_section_id);
  }
  if (album.visibility_scope === 'selected_parents') {
    return !!db.prepare('SELECT 1 FROM gallery_album_parents WHERE album_id = ? AND parent_user_id = ?').get(album.id, user.id);
  }
  return false;
}

function canViewAlbum(user, album) {
  if (user.portal_role === 'parent') return parentEligibleForAlbum(user, album);
  return canManageAlbum(user, album);
}

function galleryEnabled() {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'gallery_enabled'`).get();
  return row?.value === 'true';
}

// Delete archived albums past the configured retention period (FRD 13.1
// mitigation "define automatic archive and deletion rules" - Phase 3 in the
// FRD's own roadmap; this covers the archived-cleanup slice of that only).
function pruneArchivedAlbums() {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'gallery_retention_days'`).get();
  const days = Number(row?.value || 365);
  const stale = db.prepare(`SELECT id FROM gallery_albums WHERE status = 'archived' AND updated_at < datetime('now', ?)`).all(`-${days} days`);
  for (const album of stale) {
    const photos = db.prepare('SELECT storage_key FROM gallery_photos WHERE album_id = ?').all(album.id);
    photos.forEach(p => deleteFile(p.storage_key));
    db.prepare('DELETE FROM gallery_photos WHERE album_id = ?').run(album.id);
    db.prepare('DELETE FROM gallery_album_parents WHERE album_id = ?').run(album.id);
    db.prepare('DELETE FROM gallery_albums WHERE id = ?').run(album.id);
  }
}

// One-time demo fixture so "Demo: Parent view" has something to show once an
// admin flips gallery_enabled on - solid-colour placeholders, not real photos.
async function seedDemoAlbumIfMissing(createdByUserId) {
  const existing = db.prepare(`SELECT id FROM gallery_albums WHERE title = 'Cubs Summer Camp 2026'`).get();
  if (existing) return;
  const info = db.prepare(`
    INSERT INTO gallery_albums (title, grouping_type, grouping_label, osm_section_id, osm_section_name,
      visibility_scope, status, watermark_enabled, consent_confirmed, consent_confirmed_by, created_by, approved_by, approved_at)
    VALUES ('Cubs Summer Camp 2026', 'camp', 'Youlbury Scout Camp', 's101', 'Cubs', 'section', 'published', 1, 1, ?, ?, ?, datetime('now'))
  `).run(createdByUserId, createdByUserId, createdByUserId);
  const albumId = info.lastInsertRowid;
  const colours = [0x5c2d91ff, 0x1f7a3dff];
  for (let i = 0; i < colours.length; i++) {
    const img = new Jimp({ width: 1200, height: 800, color: colours[i] });
    const font = await loadFont(SANS_16_WHITE);
    img.print({ font, x: 20, y: 20, text: `Demo photo ${i + 1} - Youlbury Scout Camp` });
    img.print({ font, x: 20, y: 754, text: '7th Swindon Scouts - private, do not share' });
    const buffer = await img.getBuffer(JimpMime.jpeg);
    const key = storageKey();
    saveFile(key, buffer);
    db.prepare('INSERT INTO gallery_photos (album_id, storage_key, width, height, uploaded_by) VALUES (?, ?, 1200, 800, ?)').run(albumId, key, createdByUserId);
  }
}

module.exports = {
  UPLOAD_DIR, MAX_DIMENSION, processUpload, storageKey, filePathFor, saveFile, deleteFile,
  canManageAlbum, canTakeDownAlbum, canViewAlbum, parentEligibleForAlbum, galleryEnabled, pruneArchivedAlbums,
  seedDemoAlbumIfMissing,
};
