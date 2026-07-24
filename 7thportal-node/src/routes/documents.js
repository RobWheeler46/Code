// Leader-only document library (wireframes 48-51): store, version, acknowledge
// and download leader policies, templates and guidance. Files are uploaded as
// base64 in JSON (no multipart dependency) and stored on disk under DATA_DIR.
const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { documentsDir } = require('../db');
const { requireRole } = require('../lib/middleware');
const { randomToken } = require('../lib/crypto');
const audit = require('../lib/audit');

const router = express.Router();
// Leaders and admins only; parents never reach the library.
router.use(requireRole('leader', 'admin'));
// Documents (esp. PDFs) can be a few MB; allow generous base64 bodies here.
router.use(express.json({ limit: '30mb' }));

const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png', 'image/jpeg', 'text/plain'
]);

function canSee(role, audience) {
  if (role === 'admin') return true;
  return audience === 'leaders'; // leaders don't see trustee/admin-only docs
}

function latestVersion(documentId) {
  return db.prepare('SELECT * FROM document_versions WHERE document_id = ? ORDER BY version_number DESC LIMIT 1').get(documentId);
}

// Decode a base64 upload payload, validate and write it to disk.
function storeFile(payload) {
  const { fileName, mimeType, dataBase64 } = payload || {};
  if (!fileName || !dataBase64) return { error: 'A file is required.' };
  if (mimeType && !ALLOWED_MIME.has(mimeType)) return { error: 'That file type is not allowed.' };
  const buf = Buffer.from(String(dataBase64).replace(/^data:[^,]+,/, ''), 'base64');
  if (buf.length === 0) return { error: 'The uploaded file was empty.' };
  if (buf.length > MAX_BYTES) return { error: 'The file is larger than the 20 MB limit.' };
  const ext = path.extname(fileName).slice(0, 12).replace(/[^A-Za-z0-9.]/g, '');
  const storedName = randomToken(16) + ext;
  fs.writeFileSync(path.join(documentsDir, storedName), buf);
  return { storedName, fileName: String(fileName).slice(0, 255), mimeType: mimeType || 'application/octet-stream', size: buf.length };
}

// List documents visible to the current user, with optional search/category.
router.get('/', (req, res) => {
  const { q, category } = req.query;
  const rows = db.prepare(`
    SELECT d.*, u.display_name AS owner_name,
      (SELECT max(version_number) FROM document_versions v WHERE v.document_id = d.id) AS latest_version,
      (SELECT count(*) FROM document_versions v WHERE v.document_id = d.id) AS version_count
    FROM documents d LEFT JOIN users u ON u.id = d.owner_user_id
    WHERE d.status != 'archived'
    ORDER BY d.updated_at DESC, d.id DESC
  `).all();
  const role = req.session.user.role;
  const filtered = rows.filter((d) => canSee(role, d.audience))
    .filter((d) => !category || d.category === category)
    .filter((d) => !q || (`${d.title} ${d.description || ''}`.toLowerCase().includes(String(q).toLowerCase())));
  res.json({ documents: filtered });
});

router.get('/categories', (req, res) => {
  const cats = db.prepare('SELECT DISTINCT category FROM documents ORDER BY category').all().map((r) => r.category);
  res.json({ categories: cats });
});

// Create a new document with its first version.
router.post('/', (req, res) => {
  const { title, description, category, audience, reviewDate, requiresAck, file } = req.body || {};
  if (!title) return res.status(400).json({ error: 'A title is required.' });
  const aud = ['leaders', 'trustees', 'admins'].includes(audience) ? audience : 'leaders';
  if (aud !== 'leaders' && req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can publish trustee/admin-only documents.' });
  }
  const stored = storeFile(file);
  if (stored.error) return res.status(400).json({ error: stored.error });

  const info = db.prepare(`
    INSERT INTO documents (title, description, category, audience, owner_user_id, review_date, requires_ack, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'published')
  `).run(String(title).slice(0, 150), description || null, (category || 'General').slice(0, 60), aud,
    req.session.user.id, reviewDate || null, requiresAck ? 1 : 0);
  const docId = info.lastInsertRowid;
  db.prepare(`
    INSERT INTO document_versions (document_id, version_number, file_name, stored_name, mime_type, size_bytes, uploaded_by)
    VALUES (?, 1, ?, ?, ?, ?, ?)
  `).run(docId, stored.fileName, stored.storedName, stored.mimeType, stored.size, req.session.user.id);

  audit.fromReq(req, { event: 'document.created', detail: `#${docId} ${title}` });
  res.status(201).json({ id: docId });
});

// Document detail: metadata, version history and this user's acknowledgement state.
router.get('/:id', (req, res) => {
  const doc = db.prepare('SELECT d.*, u.display_name AS owner_name FROM documents d LEFT JOIN users u ON u.id = d.owner_user_id WHERE d.id = ?').get(req.params.id);
  if (!doc || !canSee(req.session.user.role, doc.audience)) return res.status(404).json({ error: 'Document not found.' });
  const versions = db.prepare(`
    SELECT v.*, u.display_name AS uploaded_by_name FROM document_versions v
    LEFT JOIN users u ON u.id = v.uploaded_by WHERE v.document_id = ? ORDER BY v.version_number DESC
  `).all(doc.id);
  const latest = versions[0];
  const acked = latest ? db.prepare('SELECT 1 FROM document_acknowledgements WHERE version_id = ? AND user_id = ?').get(latest.id, req.session.user.id) : null;
  const ackCount = latest ? db.prepare('SELECT count(*) AS n FROM document_acknowledgements WHERE version_id = ?').get(latest.id).n : 0;
  res.json({ document: doc, versions, acknowledgedLatest: !!acked, ackCount, canEdit: canEdit(req, doc) });
});

function canEdit(req, doc) {
  return req.session.user.role === 'admin' || doc.owner_user_id === req.session.user.id;
}

// Upload a new version of an existing document.
router.post('/:id/versions', (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc || !canSee(req.session.user.role, doc.audience)) return res.status(404).json({ error: 'Document not found.' });
  if (!canEdit(req, doc)) return res.status(403).json({ error: 'Only the document owner or an admin can add a version.' });
  const stored = storeFile(req.body?.file);
  if (stored.error) return res.status(400).json({ error: stored.error });
  const next = (latestVersion(doc.id)?.version_number || 0) + 1;
  db.prepare(`
    INSERT INTO document_versions (document_id, version_number, file_name, stored_name, mime_type, size_bytes, notes, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(doc.id, next, stored.fileName, stored.storedName, stored.mimeType, stored.size, req.body?.notes || null, req.session.user.id);
  db.prepare("UPDATE documents SET updated_at = datetime('now') WHERE id = ?").run(doc.id);
  audit.fromReq(req, { event: 'document.versioned', detail: `#${doc.id} v${next}` });
  res.status(201).json({ version: next });
});

// Record that the current user has acknowledged the latest version.
router.post('/:id/acknowledge', (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc || !canSee(req.session.user.role, doc.audience)) return res.status(404).json({ error: 'Document not found.' });
  const latest = latestVersion(doc.id);
  if (!latest) return res.status(400).json({ error: 'This document has no versions to acknowledge.' });
  db.prepare('INSERT OR IGNORE INTO document_acknowledgements (document_id, version_id, user_id) VALUES (?, ?, ?)')
    .run(doc.id, latest.id, req.session.user.id);
  audit.fromReq(req, { event: 'document.acknowledged', detail: `#${doc.id} v${latest.version_number}` });
  res.json({ ok: true });
});

// Stream a version's file to the browser (auth-gated; files are never public URLs).
router.get('/:id/download', (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc || !canSee(req.session.user.role, doc.audience)) return res.status(404).send('Not found');
  const version = req.query.version
    ? db.prepare('SELECT * FROM document_versions WHERE document_id = ? AND version_number = ?').get(doc.id, req.query.version)
    : latestVersion(doc.id);
  if (!version) return res.status(404).send('Not found');
  const filePath = path.join(documentsDir, version.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).send('File missing');
  audit.fromReq(req, { event: 'document.downloaded', detail: `#${doc.id} v${version.version_number}` });
  res.setHeader('Content-Type', version.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${version.file_name.replace(/"/g, '')}"`);
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(filePath).pipe(res);
});

module.exports = router;
