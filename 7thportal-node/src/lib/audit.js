// Append-only audit trail for key actions.
const db = require('../db');

const insert = db.prepare(
  'INSERT INTO audit_events (user_id, actor, event, detail, ip) VALUES (?, ?, ?, ?, ?)'
);

function record({ userId = null, actor = null, event, detail = null, ip = null }) {
  try {
    insert.run(userId, actor, event, detail ? String(detail).slice(0, 500) : null, ip);
  } catch (err) {
    console.error('[audit] failed to record', event, err.message);
  }
}

function fromReq(req, { event, detail = null }) {
  record({
    userId: req.session?.user?.id ?? null,
    actor: req.session?.user?.email ?? 'anonymous',
    event,
    detail,
    ip: req.ip
  });
}

const recent = db.prepare(
  'SELECT * FROM audit_events ORDER BY id DESC LIMIT ?'
);
function list(limit = 200) {
  return recent.all(Math.min(1000, Number(limit) || 200));
}

module.exports = { record, fromReq, list };
