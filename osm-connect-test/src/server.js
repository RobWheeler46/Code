const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const session = require('express-session');

require('./db'); // initialise the schema
require('./lib/endpoints').seed();

const { securityHeaders, csrf, idleTimeout } = require('./lib/middleware');
const messages = require('./lib/messages');
const config = require('./lib/config');

const oauthRoutes = require('./routes/oauth');
const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// Railway terminates TLS in front of the app, so trust the proxy for req.secure
// and for Secure cookies (FR-SEC-001).
app.set('trust proxy', 1);

app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));
app.use(securityHeaders);

const inProduction = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT_NAME;

app.use(session({
  name: 'osmct.sid',
  secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,          // FR-AUTH-013: never readable by page scripts
    sameSite: 'lax',         // allows the OSM callback redirect to carry the session
    secure: inProduction,
    maxAge: 1000 * 60 * 60 * 4
  }
}));

app.use(idleTimeout);
app.use(csrf);

app.use('/oauth', oauthRoutes);
app.use('/api', apiRoutes);
app.use('/api/admin', adminRoutes);

app.use(express.static(path.join(__dirname, '..', 'public'), {
  extensions: ['html'],
  setHeaders(res) { res.setHeader('Cache-Control', 'no-store'); }
}));

// FR-ERR-002 / FR-ERR-004: an unexpected exception becomes a safe user message and
// the stack trace stays in protected server logging.
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[unhandled]', err);
  res.status(500).json({ message: messages.build('OSM-APP-004') });
});

app.listen(PORT, () => {
  console.log(`OSM Connect Test Harness listening on http://localhost:${PORT}`);
  const missing = config.missingRequired();
  if (missing.length) {
    console.warn(`[config] incomplete - the connection test cannot run until these are set: ${missing.join(', ')}`);
  }
  if (!process.env.SESSION_SECRET) {
    console.warn('[security] SESSION_SECRET is not set. Set it before using this deployment.');
  }
});
