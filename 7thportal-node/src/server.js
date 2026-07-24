const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const session = require('express-session');

require('./db'); // initialise the schema
const config = require('./lib/config');
const users = require('./lib/users');
const { securityHeaders, idleTimeout, requireAuth, requireRole } = require('./lib/middleware');

users.seedDemo();

const app = express();
app.disable('x-powered-by');

// Railway terminates TLS in front of the app, so trust the proxy for Secure cookies.
app.set('trust proxy', 1);

app.use(securityHeaders);
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false, limit: '256kb' }));

app.use(session({
  name: 'portal.sid',
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.inProduction,
    maxAge: config.sessionIdleMinutes * 60 * 1000
  }
}));

app.use(idleTimeout);

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/api', require('./routes/api'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/admin', require('./routes/admin'));

app.get('/healthz', (req, res) => res.json({ ok: true }));

// Page routes that require a session redirect to /login when signed out; the
// static HTML shells themselves are then served below.
const pub = path.join(__dirname, '..', 'public');
const page = (file) => (req, res) => res.sendFile(path.join(pub, file));

app.get('/dashboard', requireAuth, page('dashboard.html'));
app.get('/notices', requireAuth, page('notices.html'));
app.get('/documents', requireRole('leader', 'admin'), page('documents.html'));
app.get('/documents/:id', requireRole('leader', 'admin'), page('document.html'));
app.get('/admin', requireRole('admin'), page('admin.html'));

app.use(express.static(pub, {
  extensions: ['html'],
  setHeaders(res) { res.setHeader('Cache-Control', 'no-store'); }
}));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[unhandled]', err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

app.listen(config.port, () => {
  console.log(`7thPortal listening on http://localhost:${config.port}`);
  if (!config.osmConfigured()) {
    console.warn('[config] OSM sign-in is not configured (OSM_CLIENT_ID / OSM_CLIENT_SECRET). Local logins still work.');
  }
});
