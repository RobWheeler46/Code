// Session/role guards and light security headers.
const config = require('./config');

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
}

// Rolling idle timeout: a session untouched for longer than the configured window
// is treated as expired.
function idleTimeout(req, res, next) {
  if (req.session?.user) {
    const now = Date.now();
    const last = req.session.lastSeen || now;
    if (now - last > config.sessionIdleMinutes * 60 * 1000) {
      return req.session.destroy(() => res.status(401).json({ error: 'Your session has expired. Please sign in again.' }));
    }
    req.session.lastSeen = now;
  }
  next();
}

function wantsJson(req) {
  return req.path.startsWith('/api/') || (req.get('accept') || '').includes('application/json');
}

function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  if (wantsJson(req)) return res.status(401).json({ error: 'Please sign in.' });
  return res.redirect('/login');
}

function requireRole(...roles) {
  return (req, res, next) => {
    const user = req.session?.user;
    if (!user) {
      if (wantsJson(req)) return res.status(401).json({ error: 'Please sign in.' });
      return res.redirect('/login');
    }
    if (!roles.includes(user.role)) {
      if (wantsJson(req)) return res.status(403).json({ error: 'You do not have access to this area.' });
      return res.status(403).send('You do not have access to this area.');
    }
    next();
  };
}

module.exports = { securityHeaders, idleTimeout, requireAuth, requireRole };
