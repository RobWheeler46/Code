const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const session = require('express-session');

const db = require('./db'); // ensure schema is initialized

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const childrenRoutes = require('./routes/children');
const sectionsRoutes = require('./routes/sections');
const { router: noticesRoutes } = require('./routes/notices');
const adminRoutes = require('./routes/admin');
const galleryRoutes = require('./routes/gallery');
const gallery = require('./lib/gallery');

const app = express();
const PORT = process.env.PORT || 3000;

// Prune audit log entries past the configured retention window (NFR-011, FR-068).
function pruneAuditLog() {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'audit_retention_days'`).get();
  const days = Number(row?.value || 365);
  db.prepare(`DELETE FROM audit_log WHERE created_at < datetime('now', ?)`).run(`-${days} days`);
}
pruneAuditLog();
gallery.pruneArchivedAlbums(); // FRD 13.1 mitigation: don't keep archived albums indefinitely

// First-run convenience: seed one published welcome notice so a fresh install
// isn't a blank dashboard (FR-013).
if (db.prepare('SELECT COUNT(*) AS n FROM notices').get().n === 0) {
  db.prepare(`
    INSERT INTO notices (title, body, audience, start_date, status)
    VALUES ('Welcome to 7thPortal', 'This is your new 7th Swindon Scout Group portal. Head to OSM for anything this site cannot show yet.', 'all', date('now'), 'published')
  `).run();
}

function sessionMaxAgeMs() {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'session_timeout_minutes'`).get();
  const minutes = Number(row?.value || 720);
  return minutes * 60 * 1000;
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
  resave: false,
  saveUninitialized: false,
  rolling: true, // sliding expiry - inactive sessions end after the configured idle period (FR-005)
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: sessionMaxAgeMs(),
  },
}));

app.use(authRoutes);
app.use(dashboardRoutes);
app.use(childrenRoutes);
app.use(sectionsRoutes);
app.use(noticesRoutes);
app.use(adminRoutes);
app.use(galleryRoutes);

app.use(express.static(path.join(__dirname, '..', 'public')));

// NFR-007: never expose technical error details to end users.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

app.listen(PORT, () => {
  console.log(`7thPortal running at http://localhost:${PORT}`);
});
