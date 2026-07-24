// Environment-driven configuration. OSM settings are optional: when the client id
// and secret are absent the app runs with local logins only and the login page
// shows the OSM button as unavailable.

function str(name, fallback = '') {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function list(name) {
  return str(name).split(',').map((s) => s.trim()).filter(Boolean);
}

const config = {
  port: Number(str('PORT', '8050')),
  sessionSecret: str('SESSION_SECRET', 'dev-only-secret-change-me'),
  sessionIdleMinutes: Number(str('SESSION_IDLE_MINUTES', '120')),
  seedDemoUsers: str('SEED_DEMO_USERS', 'true') !== 'false',

  osm: {
    clientId: str('OSM_CLIENT_ID'),
    clientSecret: str('OSM_CLIENT_SECRET'),
    callbackUrl: str('OSM_CALLBACK_URL', 'http://localhost:8050/auth/osm/callback'),
    authorizeUrl: str('OSM_AUTHORIZE_URL', 'https://www.onlinescoutmanager.co.uk/oauth/authorize'),
    tokenUrl: str('OSM_TOKEN_URL', 'https://www.onlinescoutmanager.co.uk/oauth/token'),
    resourceUrl: str('OSM_RESOURCE_URL', 'https://www.onlinescoutmanager.co.uk/oauth/resource'),
    scopes: str('OSM_SCOPES', 'section:member:read'),
    adminEmails: list('ADMIN_EMAILS').map((e) => e.toLowerCase()),
    adminUserIds: list('ADMIN_OSM_USER_IDS')
  },

  get inProduction() {
    return process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT_NAME;
  }
};

// OSM login is only offered when both halves of the credential are present.
config.osmConfigured = () => Boolean(config.osm.clientId && config.osm.clientSecret);

module.exports = config;
