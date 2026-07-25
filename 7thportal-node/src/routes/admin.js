// Admin shell: users & roles, notice management, children, audit and settings.
const express = require('express');
const db = require('../db');
const config = require('../lib/config');
const users = require('../lib/users');
const audit = require('../lib/audit');
const osmSync = require('../lib/osmSync');
const { requireRole } = require('../lib/middleware');

const router = express.Router();
router.use(requireRole('admin'));
router.use(express.json({ limit: '256kb' }));

// --- users --------------------------------------------------------------------

router.get('/users', (req, res) => res.json({ users: users.listAll() }));

router.post('/users', (req, res) => {
  const { email, displayName, password, role } = req.body || {};
  if (!email || !displayName || !password) return res.status(400).json({ error: 'Email, name and password are required.' });
  if (users.findByEmail(email)) return res.status(409).json({ error: 'An account with that email already exists.' });
  const safeRole = ['parent', 'leader', 'admin'].includes(role) ? role : 'parent';
  const user = users.createLocal({ email, password, displayName, role: safeRole });
  audit.fromReq(req, { event: 'admin.user.created', detail: `${email} (${safeRole})` });
  res.status(201).json({ id: user.id });
});

router.patch('/users/:id/role', (req, res) => {
  const { role } = req.body || {};
  if (!['parent', 'leader', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role.' });
  if (Number(req.params.id) === req.session.user.id && role !== 'admin') {
    return res.status(400).json({ error: 'You cannot remove your own admin role.' });
  }
  users.setRole(req.params.id, role);
  audit.fromReq(req, { event: 'admin.user.role', detail: `#${req.params.id} -> ${role}` });
  res.json({ ok: true });
});

router.patch('/users/:id/status', (req, res) => {
  const { status } = req.body || {};
  if (!['active', 'suspended'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  if (Number(req.params.id) === req.session.user.id) return res.status(400).json({ error: 'You cannot suspend your own account.' });
  users.setStatus(req.params.id, status);
  audit.fromReq(req, { event: 'admin.user.status', detail: `#${req.params.id} -> ${status}` });
  res.json({ ok: true });
});

// --- children (parent dashboard data) ----------------------------------------

router.get('/children', (req, res) => {
  const rows = db.prepare(`
    SELECT c.*, u.display_name AS parent_name, u.email AS parent_email
    FROM children c JOIN users u ON u.id = c.parent_user_id ORDER BY u.display_name, c.name
  `).all();
  res.json({ children: rows });
});

router.post('/children', (req, res) => {
  const { parentUserId, name, section, osmLink } = req.body || {};
  const parent = users.findById(parentUserId);
  if (!parent || parent.role !== 'parent') return res.status(400).json({ error: 'Select a valid parent account.' });
  if (!name) return res.status(400).json({ error: 'A child name is required.' });
  db.prepare('INSERT INTO children (parent_user_id, name, section, osm_link) VALUES (?, ?, ?, ?)')
    .run(parent.id, String(name).slice(0, 120), section || null, osmLink || null);
  audit.fromReq(req, { event: 'admin.child.added', detail: `${name} -> ${parent.email}` });
  res.status(201).json({ ok: true });
});

router.delete('/children/:id', (req, res) => {
  db.prepare('DELETE FROM children WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// --- notices ------------------------------------------------------------------

router.get('/notices', (req, res) => {
  const rows = db.prepare(`
    SELECT n.*, u.display_name AS author FROM notices n LEFT JOIN users u ON u.id = n.created_by ORDER BY n.id DESC
  `).all();
  res.json({ notices: rows });
});

router.post('/notices', (req, res) => {
  const { title, body, audience, published } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: 'A title and body are required.' });
  const aud = ['all', 'parents', 'leaders'].includes(audience) ? audience : 'all';
  const info = db.prepare('INSERT INTO notices (title, body, audience, published, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(String(title).slice(0, 150), String(body), aud, published ? 1 : 0, req.session.user.id);
  audit.fromReq(req, { event: 'admin.notice.created', detail: title });
  res.status(201).json({ id: info.lastInsertRowid });
});

router.patch('/notices/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM notices WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Notice not found.' });
  const { title, body, audience, published } = req.body || {};
  const aud = ['all', 'parents', 'leaders'].includes(audience) ? audience : existing.audience;
  db.prepare("UPDATE notices SET title = ?, body = ?, audience = ?, published = ?, updated_at = datetime('now') WHERE id = ?")
    .run(title ?? existing.title, body ?? existing.body, aud, published ? 1 : 0, existing.id);
  audit.fromReq(req, { event: 'admin.notice.updated', detail: `#${existing.id}` });
  res.json({ ok: true });
});

router.delete('/notices/:id', (req, res) => {
  db.prepare('DELETE FROM notices WHERE id = ?').run(req.params.id);
  audit.fromReq(req, { event: 'admin.notice.deleted', detail: `#${req.params.id}` });
  res.json({ ok: true });
});

// --- operational / support dashboard (FRD 6.1 Admin Access to OSM Data) --------
// A least-privilege admin view: integration health, support exceptions and OSM
// account mapping, NOT unrestricted member data. Viewing it (it surfaces the
// user-to-OSM mapping) is itself audited per FR-OSM-ADM-010 / FR-OSM-ADM-012.
router.get('/overview', (req, res) => {
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const many = (sql, ...p) => db.prepare(sql).all(...p);

  const roleCounts = many('SELECT role, count(*) AS n FROM users GROUP BY role');
  const byRole = Object.fromEntries(roleCounts.map((r) => [r.role, r.n]));

  // Integration health: last successful OSM sign-in and recent auth failures.
  const lastOsmLogin = one("SELECT at, actor FROM audit_events WHERE event = 'login.osm.success' ORDER BY id DESC LIMIT 1");
  const failedLogins = many(
    "SELECT at, actor, event, detail FROM audit_events WHERE event IN ('login.failed','login.osm.failed') ORDER BY id DESC LIMIT 10"
  );
  const failedLoginCount = one("SELECT count(*) AS n FROM audit_events WHERE event IN ('login.failed','login.osm.failed')").n;

  // Support exceptions: things an admin should action.
  const parentsWithoutChildren = many(
    "SELECT id, display_name, email FROM users WHERE role = 'parent' AND status = 'active' AND id NOT IN (SELECT DISTINCT parent_user_id FROM children)"
  );
  const suspendedUsers = one("SELECT count(*) AS n FROM users WHERE status = 'suspended'").n;
  const documentsWithoutVersions = one(
    'SELECT count(*) AS n FROM documents d WHERE NOT EXISTS (SELECT 1 FROM document_versions v WHERE v.document_id = d.id)'
  ).n;

  // OSM account mapping (masked ref only; raw OSM ids/tokens are never exposed).
  const osmMappings = many(
    "SELECT display_name, email, osm_user_ref, role, last_login_at FROM users WHERE auth_source = 'osm' ORDER BY last_login_at DESC"
  );

  audit.fromReq(req, { event: 'admin.osm.support.viewed', detail: 'operational dashboard + OSM account mapping' });

  res.json({
    osm: {
      configured: config.osmConfigured(),
      callbackUrl: config.osm.callbackUrl,
      scopes: config.osm.scopes,
      lastSuccessfulLogin: lastOsmLogin || null,
      failedLoginCount,
      recentFailures: failedLogins
    },
    counts: {
      users: (byRole.parent || 0) + (byRole.leader || 0) + (byRole.admin || 0),
      parents: byRole.parent || 0,
      leaders: byRole.leader || 0,
      admins: byRole.admin || 0,
      children: one('SELECT count(*) AS n FROM children').n,
      noticesPublished: one('SELECT count(*) AS n FROM notices WHERE published = 1').n,
      noticesTotal: one('SELECT count(*) AS n FROM notices').n,
      documents: one('SELECT count(*) AS n FROM documents').n
    },
    exceptions: {
      parentsWithoutChildren,
      suspendedUsers,
      documentsWithoutVersions
    },
    osmMappings
  });
});

// --- section capacity tracker & movement trends (FRD 29) ----------------------
// Aggregate, counts-only by default. "Active" is sourced from the app's local
// children-by-section records (OSM member sync is not built yet), so it is
// labelled as portal data. Capacity/thresholds/status are purely local.

function capacityStatus(active, cap, amber, red) {
  if (!cap || cap <= 0) return { util: null, status: 'unset' };
  const util = Math.round((active / cap) * 100);
  let status = 'good';
  if (active > cap) status = 'over';
  else if (util >= red) status = 'full';
  else if (util >= amber) status = 'watch';
  return { util, status };
}

// Build the per-section summary and write today's snapshot so trends accumulate.
// "Active" prefers the OSM-synced count for a matching section name and falls back
// to the app's own children-by-section count when OSM has not been synced.
function buildSections() {
  const today = new Date().toISOString().slice(0, 10);
  // OSM-synced counts, keyed by lower-cased section name for matching.
  const osmRows = db.prepare('SELECT * FROM osm_sections').all();
  const osmByName = new Map(osmRows.map((r) => [r.section_name.toLowerCase(), r]));

  // Sections come from a configured capacity row, any child's section, or OSM.
  const names = new Set();
  db.prepare("SELECT DISTINCT section FROM children WHERE section IS NOT NULL AND section != ''").all().forEach((r) => names.add(r.section));
  db.prepare('SELECT section FROM section_capacity').all().forEach((r) => names.add(r.section));
  osmRows.forEach((r) => names.add(r.section_name));

  const insertSnap = db.prepare('INSERT OR IGNORE INTO section_snapshots (section, active_count, joining_count, snapshot_date) VALUES (?, ?, ?, ?)');
  const activeStmt = db.prepare("SELECT count(*) AS n FROM children WHERE section = ?");
  const cfgStmt = db.prepare('SELECT * FROM section_capacity WHERE section = ?');
  const prevSnap = db.prepare('SELECT active_count FROM section_snapshots WHERE section = ? AND snapshot_date < ? ORDER BY snapshot_date DESC LIMIT 1');

  const sections = [...names].sort().map((section) => {
    const cfg = cfgStmt.get(section) || {};
    const osmRow = osmByName.get(section.toLowerCase());
    let active; let source; let lastSync = null; let syncError = null;
    if (osmRow && osmRow.sync_status === 'ok' && osmRow.active_count != null) {
      active = osmRow.active_count; source = 'osm'; lastSync = osmRow.last_synced_at;
    } else if (osmRow && osmRow.sync_status === 'ok') {
      // Section came from OSM's list, but the count isn't available via OSM.
      active = activeStmt.get(section).n; source = 'osm-list'; lastSync = osmRow.last_synced_at;
    } else {
      active = activeStmt.get(section).n; source = 'local';
      if (osmRow) { lastSync = osmRow.last_synced_at; if (osmRow.sync_status === 'error') syncError = osmRow.sync_error; }
    }
    const amber = cfg.amber_pct ?? 85;
    const red = cfg.red_pct ?? 95;
    const { util, status } = capacityStatus(active, cfg.capacity, amber, red);
    insertSnap.run(section, active, cfg.joining_count ?? null, today);
    const prev = prevSnap.get(section, today);
    let trend = 'new';
    if (prev) trend = active > prev.active_count ? 'rising' : active < prev.active_count ? 'falling' : 'stable';
    return {
      section, active, joining: cfg.joining_count ?? null, capacity: cfg.capacity ?? null,
      utilisation: util, status, trend, amber, red, owner: cfg.owner || null,
      source, lastSync, syncError
    };
  });

  const totalActive = sections.reduce((s, x) => s + x.active, 0);
  const availableSpaces = sections.reduce((s, x) => s + (x.capacity ? Math.max(x.capacity - x.active, 0) : 0), 0);
  const joiningTotal = sections.reduce((s, x) => s + (x.joining || 0), 0);
  const nearCapacity = sections.filter((x) => ['watch', 'full', 'over'].includes(x.status)).length;
  return { sections, totals: { totalActive, availableSpaces, joiningTotal, nearCapacity } };
}

// Dashboard data (aggregate, counts only).
router.get('/sections', (req, res) => {
  const osmRows = db.prepare("SELECT count(*) AS n, max(last_synced_at) AS last FROM osm_sections WHERE sync_status = 'ok'").get();
  res.json({ ...buildSections(), osm: { configured: config.osmConfigured(), synced: osmRows.n > 0, lastSyncedAt: osmRows.last || null } });
});

// Pull live section-member counts from OSM using a stored leader/admin connection
// (FR-OSM-CAP-001). Counts only; named records are never stored.
router.post('/sections/sync', async (req, res) => {
  try {
    const result = await osmSync.syncLatest(req.session.user.id);
    audit.fromReq(req, { event: 'admin.section.osm_sync', detail: result.ok ? `${result.synced}/${result.total} sections synced` : `failed: ${result.error}` });
    if (!result.ok) return res.status(result.noConnection ? 409 : 502).json({ error: result.error });
    res.json(result);
  } catch (err) {
    console.error('[sections/sync]', err);
    res.status(500).json({ error: 'OSM sync failed unexpectedly.' });
  }
});

// Capacity settings rows for the settings editor.
router.get('/sections/settings', (req, res) => {
  const configured = db.prepare('SELECT * FROM section_capacity ORDER BY section').all();
  const known = new Set(configured.map((c) => c.section));
  db.prepare("SELECT DISTINCT section FROM children WHERE section IS NOT NULL AND section != ''").all().forEach((r) => known.add(r.section));
  res.json({ sections: [...known].sort(), configured });
});

// Create/update the local capacity + thresholds for a section.
router.post('/sections/settings', (req, res) => {
  const { section, capacity, amberPct, redPct, joiningCount, owner } = req.body || {};
  if (!section) return res.status(400).json({ error: 'A section is required.' });
  const amber = Number.isFinite(+amberPct) ? Math.max(0, Math.min(100, +amberPct)) : 85;
  const red = Number.isFinite(+redPct) ? Math.max(0, Math.min(100, +redPct)) : 95;
  db.prepare(`
    INSERT INTO section_capacity (section, capacity, amber_pct, red_pct, joining_count, owner, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(section) DO UPDATE SET
      capacity = excluded.capacity, amber_pct = excluded.amber_pct, red_pct = excluded.red_pct,
      joining_count = excluded.joining_count, owner = excluded.owner,
      updated_by = excluded.updated_by, updated_at = excluded.updated_at
  `).run(String(section).slice(0, 60), capacity === '' || capacity == null ? null : Math.max(0, +capacity),
    amber, red, joiningCount === '' || joiningCount == null ? null : Math.max(0, +joiningCount),
    owner ? String(owner).slice(0, 120) : null, req.session.user.id);
  audit.fromReq(req, { event: 'admin.section.capacity.set', detail: `${section} cap=${capacity ?? '—'} amber=${amber} red=${red}` });
  res.json({ ok: true });
});

// Audited named drill-down (FR-OSM-CAP-010/011): revealing named child records
// requires this explicit, logged action.
router.get('/sections/:section/children', (req, res) => {
  const section = req.params.section;
  const kids = db.prepare(`
    SELECT c.id, c.name, c.osm_link, u.display_name AS parent_name, u.email AS parent_email
    FROM children c JOIN users u ON u.id = c.parent_user_id WHERE c.section = ? ORDER BY c.name
  `).all(section);
  audit.fromReq(req, { event: 'admin.section.drilldown', detail: `${section} (${kids.length} named child records viewed)` });
  res.json({ section, children: kids });
});

// Diagnostic: show the shape of the OSM responses the sync relies on, so a
// non-JSON / unexpected payload can be identified and mapped correctly.
router.get('/sections/osm-diagnostic', async (req, res) => {
  try {
    const result = await osmSync.diagnose();
    audit.fromReq(req, { event: 'admin.section.osm_diagnostic', detail: result.ok ? 'ran' : result.error });
    res.status(result.ok ? 200 : 409).json(result);
  } catch (err) {
    console.error('[osm-diagnostic]', err);
    res.status(500).json({ error: 'Diagnostic failed unexpectedly.' });
  }
});

// Aggregate CSV export (FR-OSM-CAP-009).
router.get('/sections/export', (req, res) => {
  const { sections } = buildSections();
  const rows = [['Section', 'Active', 'Joining', 'Capacity', 'Utilisation %', 'Status', 'Trend', 'Owner']];
  sections.forEach((s) => rows.push([s.section, s.active, s.joining ?? '', s.capacity ?? '', s.utilisation ?? '', s.status, s.trend, s.owner ?? '']));
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  audit.fromReq(req, { event: 'admin.section.export', detail: 'aggregate capacity summary CSV' });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="section-capacity-summary.csv"');
  res.send(csv);
});

// --- audit & settings ---------------------------------------------------------

router.get('/audit', (req, res) => res.json({ events: audit.list(req.query.limit || 200) }));

router.get('/settings', (req, res) => {
  const count = (sql) => db.prepare(sql).get().n;
  res.json({
    osmConfigured: config.osmConfigured(),
    osmCallbackUrl: config.osm.callbackUrl,
    seedDemoUsers: config.seedDemoUsers,
    sessionIdleMinutes: config.sessionIdleMinutes,
    counts: {
      users: count('SELECT count(*) AS n FROM users'),
      children: count('SELECT count(*) AS n FROM children'),
      notices: count('SELECT count(*) AS n FROM notices'),
      documents: count('SELECT count(*) AS n FROM documents')
    }
  });
});

module.exports = router;
