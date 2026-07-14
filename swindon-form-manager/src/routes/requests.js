const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const db = require('../db');
const { requireAuth } = require('../lib/middleware');
const {
  ACTIVE_REVIEW_STATUSES, nextReference, logAudit, notify, notifyGroup, getStage, isMemberOfGroup
} = require('../lib/helpers');
const { validateActivityForm, MAX_FILES, MAX_FILE_SIZE_MB } = require('../lib/activityForm');

const router = express.Router();
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024, files: MAX_FILES }
});

const uploadFields = upload.fields([
  { name: 'risk_assessment', maxCount: 1 },
  { name: 'supporting_documents', maxCount: MAX_FILES - 1 }
]);

const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.png', '.jpg', '.jpeg', '.gif'];

function getForm() {
  return db.prepare("SELECT * FROM forms WHERE slug = 'activity-approval'").get();
}

function saveFile(requestId, file, category, uploadedById) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    const err = new Error(`File type not allowed: ${file.originalname}`);
    err.status = 400;
    throw err;
  }
  const dir = path.join(uploadsDir, String(requestId));
  fs.mkdirSync(dir, { recursive: true });
  const storedName = `${require('crypto').randomUUID()}${ext}`;
  fs.writeFileSync(path.join(dir, storedName), file.buffer);
  db.prepare(`
    INSERT INTO request_documents (request_id, category, original_name, stored_name, size_bytes, uploaded_by_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(requestId, category, file.originalname, storedName, file.size, uploadedById);
}

function canViewRequest(req, request) {
  if (req.userRoles.isAdmin) return true;
  if (request.requester_id === req.user.id) return true;
  if (req.userRoles.isApprover) {
    const stage = getStage(request.form_id, request.current_stage_sequence);
    if (stage && isMemberOfGroup(req.user.id, stage.approver_group_id)) return true;
    // Approvers can also see requests they've previously acted on.
    const acted = db.prepare('SELECT 1 FROM request_approvals WHERE request_id = ? AND approver_id = ?').get(request.id, req.user.id);
    if (acted) return true;
  }
  return false;
}

function serializeRequest(request) {
  return {
    ...request,
    data: JSON.parse(request.data)
  };
}

// Create a new request (draft or submit)
router.post('/', requireAuth, uploadFields, (req, res) => {
  try {
    const form = getForm();
    const action = req.body.action === 'draft' ? 'draft' : 'submit';

    let requesterId = req.user.id;
    let submittedById = null;
    if (req.body.on_behalf_of_user_id) {
      if (!req.userRoles.isAdmin) return res.status(403).json({ error: 'Only administrators can submit on behalf of a requester.' });
      const target = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(req.body.on_behalf_of_user_id);
      if (!target) return res.status(400).json({ error: 'Requester not found.' });
      requesterId = target.id;
      submittedById = req.user.id;
    }

    const fields = { ...req.body };
    delete fields.action;
    delete fields.on_behalf_of_user_id;
    if (fields.attending_sections && !Array.isArray(fields.attending_sections)) {
      fields.attending_sections = [fields.attending_sections];
    }

    const riskFile = req.files?.risk_assessment?.[0];
    const supportingFiles = req.files?.supporting_documents || [];

    if (action === 'submit') {
      const { valid, errors } = validateActivityForm(fields, !!riskFile);
      if (!valid) return res.status(400).json({ error: 'Validation failed.', fields: errors });
    }

    const now = new Date().toISOString();
    const reference = nextReference();
    const status = action === 'submit' ? 'Submitted' : 'Draft';

    const result = db.prepare(`
      INSERT INTO requests (reference, form_id, requester_id, submitted_by_id, status, current_stage_sequence, data, title, activity_date, submitted_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
    `).run(
      reference, form.id, requesterId, submittedById, status,
      JSON.stringify(fields), fields.activity_description || null, fields.activity_date || null,
      action === 'submit' ? now : null
    );
    const requestId = result.lastInsertRowid;

    if (riskFile) saveFile(requestId, riskFile, 'risk_assessment', req.user.id);
    for (const f of supportingFiles) saveFile(requestId, f, 'supporting', req.user.id);

    logAudit({
      requestId, userId: req.user.id,
      action: action === 'submit' ? 'request_submitted' : 'draft_saved',
      detail: submittedById ? `Submitted on behalf of user ${requesterId}` : null
    });

    if (action === 'submit') {
      const stage = getStage(form.id, 1);
      notify(requesterId, requestId, `Your ${form.name} request (${reference}) has been submitted and is awaiting review. Please do not proceed with the activity until approval has been confirmed.`);
      if (stage) notifyGroup(stage.approver_group_id, requestId, `New request ${reference} (${fields.activity_description || ''}) is awaiting your review.`);
    }

    res.status(201).json({ id: requestId, reference, status });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Failed to create request.' });
  }
});

// List requests, scoped by role
router.get('/', requireAuth, (req, res) => {
  const scope = req.query.scope || 'mine';
  let rows;

  if (scope === 'all') {
    if (!req.userRoles.isAdmin) return res.status(403).json({ error: 'Administrator access required.' });
    const statusFilter = req.query.status;
    rows = statusFilter
      ? db.prepare('SELECT * FROM requests WHERE status = ? ORDER BY created_at DESC').all(statusFilter)
      : db.prepare('SELECT * FROM requests ORDER BY created_at DESC').all();
  } else if (scope === 'pending') {
    if (!req.userRoles.isApprover) return res.status(403).json({ error: 'Approver access required.' });
    const groupIds = req.userRoles.groups.filter(g => g.type === 'approver').map(g => g.id);
    if (groupIds.length === 0) { rows = []; } else {
      const placeholders = groupIds.map(() => '?').join(',');
      rows = db.prepare(`
        SELECT r.* FROM requests r
        JOIN workflow_stages ws ON ws.form_id = r.form_id AND ws.sequence = r.current_stage_sequence
        WHERE ws.approver_group_id IN (${placeholders})
        AND r.status IN ('${ACTIVE_REVIEW_STATUSES.join("','")}')
        ORDER BY r.created_at ASC
      `).all(...groupIds);
    }
  } else {
    rows = db.prepare('SELECT * FROM requests WHERE requester_id = ? ORDER BY created_at DESC').all(req.user.id);
  }

  const requesterIds = [...new Set(rows.map(r => r.requester_id))];
  const requesters = requesterIds.length
    ? db.prepare(`SELECT id, name FROM users WHERE id IN (${requesterIds.map(() => '?').join(',')})`).all(...requesterIds)
    : [];
  const requesterMap = Object.fromEntries(requesters.map(u => [u.id, u.name]));

  res.json(rows.map(r => ({
    id: r.id,
    reference: r.reference,
    status: r.status,
    title: r.title,
    activityDate: r.activity_date,
    requesterId: r.requester_id,
    requesterName: requesterMap[r.requester_id] || null,
    currentStageSequence: r.current_stage_sequence,
    createdAt: r.created_at,
    submittedAt: r.submitted_at
  })));
});

// Request detail
router.get('/:id', requireAuth, (req, res) => {
  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found.' });
  if (!canViewRequest(req, request)) return res.status(403).json({ error: 'You do not have access to this request.' });

  const documents = db.prepare('SELECT * FROM request_documents WHERE request_id = ? AND removed_at IS NULL ORDER BY uploaded_at').all(request.id);
  const approvals = db.prepare(`
    SELECT ra.*, u.name AS approver_name FROM request_approvals ra
    JOIN users u ON u.id = ra.approver_id
    WHERE ra.request_id = ? ORDER BY ra.created_at
  `).all(request.id);
  const audit = db.prepare(`
    SELECT al.*, u.name AS user_name FROM audit_log al
    LEFT JOIN users u ON u.id = al.user_id
    WHERE al.request_id = ? ORDER BY al.created_at
  `).all(request.id);
  const requester = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(request.requester_id);
  const stage = getStage(request.form_id, request.current_stage_sequence);

  const canAct = req.userRoles.isApprover && stage && isMemberOfGroup(req.user.id, stage.approver_group_id)
    && ACTIVE_REVIEW_STATUSES.includes(request.status);

  res.json({
    ...serializeRequest(request),
    requester,
    documents,
    approvals,
    audit,
    canApproveOrReject: canAct,
    canWithdraw: request.requester_id === req.user.id && ['Draft', 'Submitted', 'Under review', 'Resubmitted'].includes(request.status),
    canResubmit: request.requester_id === req.user.id && request.status === 'Rejected'
  });
});

// Download a document
router.get('/:id/documents/:docId', requireAuth, (req, res) => {
  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found.' });
  if (!canViewRequest(req, request)) return res.status(403).json({ error: 'You do not have access to this document.' });

  const doc = db.prepare('SELECT * FROM request_documents WHERE id = ? AND request_id = ? AND removed_at IS NULL').get(req.params.docId, request.id);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });

  const filePath = path.join(uploadsDir, String(request.id), doc.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk.' });
  res.download(filePath, doc.original_name);
});

// Approve
router.post('/:id/approve', requireAuth, (req, res) => {
  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found.' });
  const stage = getStage(request.form_id, request.current_stage_sequence);
  if (!stage || !isMemberOfGroup(req.user.id, stage.approver_group_id) || !req.userRoles.isApprover) {
    return res.status(403).json({ error: 'You are not an approver for this request.' });
  }
  if (!ACTIVE_REVIEW_STATUSES.includes(request.status)) {
    return res.status(400).json({ error: `Request cannot be approved from status "${request.status}".` });
  }

  db.prepare(`
    INSERT INTO request_approvals (request_id, stage_sequence, approver_group_id, action, approver_id, comment)
    VALUES (?, ?, ?, 'approved', ?, ?)
  `).run(request.id, request.current_stage_sequence, stage.approver_group_id, req.user.id, req.body.comment || null);

  const nextStage = getStage(request.form_id, request.current_stage_sequence + 1);
  const newStatus = nextStage ? 'Under review' : 'Approved';
  const newSequence = nextStage ? request.current_stage_sequence + 1 : request.current_stage_sequence;

  db.prepare(`
    UPDATE requests SET status = ?, current_stage_sequence = ?, updated_at = datetime('now') WHERE id = ?
  `).run(newStatus, newSequence, request.id);

  logAudit({
    requestId: request.id, userId: req.user.id, action: 'approved',
    detail: req.body.comment || null, previousValue: request.status, newValue: newStatus
  });

  if (nextStage) {
    notifyGroup(nextStage.approver_group_id, request.id, `Request ${request.reference} has moved to your review stage.`);
    notify(request.requester_id, request.id, `Your request ${request.reference} has been approved at this stage and moved to the next review stage.`);
  } else {
    notify(request.requester_id, request.id, `Your request ${request.reference} has been approved.`);
  }

  res.json({ ok: true, status: newStatus });
});

// Reject
router.post('/:id/reject', requireAuth, (req, res) => {
  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found.' });
  const stage = getStage(request.form_id, request.current_stage_sequence);
  if (!stage || !isMemberOfGroup(req.user.id, stage.approver_group_id) || !req.userRoles.isApprover) {
    return res.status(403).json({ error: 'You are not an approver for this request.' });
  }
  if (!ACTIVE_REVIEW_STATUSES.includes(request.status)) {
    return res.status(400).json({ error: `Request cannot be rejected from status "${request.status}".` });
  }
  const reason = (req.body.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'A rejection reason is required.' });

  db.prepare(`
    INSERT INTO request_approvals (request_id, stage_sequence, approver_group_id, action, approver_id, comment)
    VALUES (?, ?, ?, 'rejected', ?, ?)
  `).run(request.id, request.current_stage_sequence, stage.approver_group_id, req.user.id, reason);

  db.prepare(`UPDATE requests SET status = 'Rejected', updated_at = datetime('now') WHERE id = ?`).run(request.id);

  logAudit({
    requestId: request.id, userId: req.user.id, action: 'rejected',
    detail: reason, previousValue: request.status, newValue: 'Rejected'
  });
  notify(request.requester_id, request.id, `Your request ${request.reference} has been rejected. Reason: ${reason}`);

  res.json({ ok: true, status: 'Rejected' });
});

// Approver marks a request as actively under review (optional status step)
router.post('/:id/start-review', requireAuth, (req, res) => {
  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found.' });
  const stage = getStage(request.form_id, request.current_stage_sequence);
  if (!stage || !isMemberOfGroup(req.user.id, stage.approver_group_id)) {
    return res.status(403).json({ error: 'You are not an approver for this request.' });
  }
  if (!['Submitted', 'Resubmitted'].includes(request.status)) {
    return res.status(400).json({ error: `Cannot start review from status "${request.status}".` });
  }
  db.prepare(`UPDATE requests SET status = 'Under review', updated_at = datetime('now') WHERE id = ?`).run(request.id);
  logAudit({ requestId: request.id, userId: req.user.id, action: 'review_started', previousValue: request.status, newValue: 'Under review' });
  res.json({ ok: true, status: 'Under review' });
});

// Withdraw
router.post('/:id/withdraw', requireAuth, (req, res) => {
  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found.' });
  if (request.requester_id !== req.user.id) return res.status(403).json({ error: 'You can only withdraw your own request.' });
  if (!['Draft', 'Submitted', 'Under review', 'Resubmitted'].includes(request.status)) {
    return res.status(400).json({ error: `Cannot withdraw from status "${request.status}".` });
  }
  db.prepare(`UPDATE requests SET status = 'Withdrawn', updated_at = datetime('now') WHERE id = ?`).run(request.id);
  logAudit({ requestId: request.id, userId: req.user.id, action: 'withdrawn', previousValue: request.status, newValue: 'Withdrawn' });
  res.json({ ok: true, status: 'Withdrawn' });
});

// Resubmit after rejection: workflow restarts from the beginning
router.post('/:id/resubmit', requireAuth, uploadFields, (req, res) => {
  try {
    const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found.' });
    if (request.requester_id !== req.user.id) return res.status(403).json({ error: 'You can only resubmit your own request.' });
    if (request.status !== 'Rejected') return res.status(400).json({ error: 'Only rejected requests can be resubmitted.' });

    const removeIds = [].concat(req.body.remove_document_ids || []).map(Number);
    for (const docId of removeIds) {
      const doc = db.prepare('SELECT * FROM request_documents WHERE id = ? AND request_id = ?').get(docId, request.id);
      if (doc) {
        db.prepare(`UPDATE request_documents SET removed_at = datetime('now') WHERE id = ?`).run(docId);
        logAudit({ requestId: request.id, userId: req.user.id, action: 'document_removed', detail: doc.original_name });
      }
    }

    const existingData = JSON.parse(request.data);
    const fields = { ...existingData, ...req.body };
    delete fields.remove_document_ids;
    if (fields.attending_sections && !Array.isArray(fields.attending_sections)) {
      fields.attending_sections = [fields.attending_sections];
    }

    const remainingRisk = db.prepare(`
      SELECT 1 FROM request_documents WHERE request_id = ? AND category = 'risk_assessment' AND removed_at IS NULL
    `).get(request.id);
    const riskFile = req.files?.risk_assessment?.[0];
    const supportingFiles = req.files?.supporting_documents || [];

    const { valid, errors } = validateActivityForm(fields, !!riskFile || !!remainingRisk);
    if (!valid) return res.status(400).json({ error: 'Validation failed.', fields: errors });

    if (riskFile) saveFile(request.id, riskFile, 'risk_assessment', req.user.id);
    for (const f of supportingFiles) saveFile(request.id, f, 'supporting', req.user.id);

    db.prepare(`
      UPDATE requests SET status = 'Resubmitted', current_stage_sequence = 1, data = ?, title = ?, activity_date = ?, submitted_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(JSON.stringify(fields), fields.activity_description || null, fields.activity_date || null, request.id);

    logAudit({ requestId: request.id, userId: req.user.id, action: 'resubmitted', previousValue: 'Rejected', newValue: 'Resubmitted' });

    const stage = getStage(request.form_id, 1);
    if (stage) notifyGroup(stage.approver_group_id, request.id, `Request ${request.reference} has been resubmitted and is awaiting your review.`);
    notify(request.requester_id, request.id, `Your request ${request.reference} has been resubmitted.`);

    res.json({ ok: true, status: 'Resubmitted' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Failed to resubmit request.' });
  }
});

module.exports = router;
