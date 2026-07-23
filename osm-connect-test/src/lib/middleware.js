// Session, role and recent-authentication guards (FRD 9, FR-SEC-007, FR-SEC-008).

const db = require('../db');
const config = require('./config');
const messages = require('./messages');
const { parseUtc } = require('./times');

function currentUser(req) {
  if (!req.session?.appUserId) return null;
  const user = db.prepare('SELECT * FROM app_users WHERE id = ?').get(req.session.appUserId);
  if (!user || user.account_status !== 'active') return null;
  return user;
}

/** FR-SEC-007: sessions expire after a configurable period of inactivity. */
function idleTimeout(req, res, next) {
  if (!req.session?.appUserId) return next();
  const limit = (config.get('sessionIdleMinutes') || 60) * 60 * 1000;
  const last = req.session.lastSeenAt ? Date.parse(req.session.lastSeenAt) : Date.now();
  if (Date.now() - last > limit) {
    return req.session.destroy(() => {
      res.status(401).json({ message: messages.build('OSM-CONN-002', { detail: 'The application session expired after a period of inactivity.' }) });
    });
  }
  req.session.lastSeenAt = new Date().toISOString();
  return next();
}

function requireUser(req, res, next) {
  const user = currentUser(req);
  if (!user) {
    return res.status(401).json({
      message: messages.build('OSM-CONN-001', { detail: 'You need to connect to OSM before using this page.' })
    });
  }
  req.user = user;
  return next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: messages.build('OSM-API-007', {
          detail: `This area requires one of these application roles: ${roles.join(', ')}.`,
          actions: ['Ask an application administrator to review your access.']
        })
      });
    }
    return next();
  };
}

/** FR-SEC-008: administrative actions require recent authentication. */
function requireRecentAuth(maxMinutes = 30) {
  return (req, res, next) => {
    const at = req.session?.authenticatedAt;
    const ms = at ? parseUtc(at) : null;
    if (ms === null || Date.now() - ms > maxMinutes * 60 * 1000) {
      return res.status(403).json({
        message: messages.build('OSM-CONN-002', {
          detail: `This action requires a sign in completed within the last ${maxMinutes} minutes.`,
          actions: ['Reconnect to OSM, then try again.']
        })
      });
    }
    return next();
  };
}

// Security headers. A strict CSP keeps the pages script-src 'self' only, which also
// prevents third-party analytics from ever seeing OSM data (FR-PRIV-003/004).
function securityHeaders(req, res, next) {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'"
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  // Diagnostics must never be cached by an intermediary (FR-PRIV-007).
  res.setHeader('Cache-Control', 'no-store');
  return next();
}

/**
 * CSRF protection for state-changing requests (FR-SEC-005). The token is issued into
 * the session and echoed by the page in an X-CSRF-Token header.
 */
function csrf(req, res, next) {
  if (!req.session) return next();
  if (!req.session.csrfToken) {
    req.session.csrfToken = require('./crypto').randomToken(24);
  }
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const supplied = req.get('X-CSRF-Token') || req.body?._csrf;
  if (!supplied || supplied !== req.session.csrfToken) {
    return res.status(403).json({ error: 'The request could not be verified. Reload the page and try again.' });
  }
  return next();
}

module.exports = { currentUser, requireUser, requireRole, requireRecentAuth, securityHeaders, csrf, idleTimeout };
