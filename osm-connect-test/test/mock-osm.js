// A stand-in for OSM, so the connection flow and the error paths in FRD section 25
// can be exercised without touching live OSM data.
//
// Behaviour is driven by the `scenario` query/header so one server can act out a
// successful connection, a 429, a blocked client, a wrapped response, and so on.

const http = require('node:http');

const SCENARIOS = {
  happy: {},
  'no-sections': { sections: [] },
  'unknown-permission': { permissionOverride: { member: 999, unheardof: 10 } },
  'rate-limited': { apiStatus: 429, retryAfter: 120 },
  blocked: { apiStatus: 403, blockedHeader: 'client blocked' },
  removed: { apiStatus: 410 },
  forbidden: { apiStatus: 403 },
  'server-error': { apiStatus: 500 },
  'invalid-json': { body: 'this is not json at all', contentType: 'application/json' },
  wrapped: { body: 'callback({"data":{"terms":[]}});', contentType: 'application/javascript' },
  empty: { body: '', contentType: 'application/json' },
  'unsupported-type': { body: '<html>nope</html>', contentType: 'text/html' },
  'missing-user': { omitUserId: true },
  'token-rejected': { tokenStatus: 400 },
  deprecated: { deprecationHeader: 'version="1"' }
};

function sectionsFor(scenario) {
  const cfg = SCENARIOS[scenario] || {};
  if (cfg.sections) return cfg.sections;
  const permissions = cfg.permissionOverride || { member: 10, programme: 20, badge: 10, events: 10 };
  return [
    { section_id: 12345, section_name: 'Cubs', group_id: 987, group_name: '7th Swindon', section_type: 'cubs', default: true, permissions },
    { section_id: 12346, section_name: 'Beavers', group_id: 987, group_name: '7th Swindon', section_type: 'beavers', default: false, permissions: { member: 10 } }
  ];
}

function start(port = 3999, { scenario = 'happy' } = {}) {
  const cfg = SCENARIOS[scenario] || {};
  const issued = new Set();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);

    // Authorisation: immediately bounce back to the application callback.
    if (url.pathname === '/oauth/authorize') {
      const redirect = url.searchParams.get('redirect_uri');
      const state = url.searchParams.get('state');
      if (scenario === 'declined') {
        res.writeHead(302, { Location: `${redirect}?error=access_denied&state=${encodeURIComponent(state)}` });
        return res.end();
      }
      if (scenario === 'no-code') {
        res.writeHead(302, { Location: `${redirect}?state=${encodeURIComponent(state)}` });
        return res.end();
      }
      if (scenario === 'bad-state') {
        res.writeHead(302, { Location: `${redirect}?code=test-code&state=tampered-state` });
        return res.end();
      }
      const code = `test-code-${Date.now()}`;
      issued.add(code);
      res.writeHead(302, { Location: `${redirect}?code=${code}&state=${encodeURIComponent(state)}` });
      return res.end();
    }

    if (url.pathname === '/oauth/token') {
      let body = '';
      req.on('data', (c) => { body += c; });
      return req.on('end', () => {
        const params = new URLSearchParams(body);
        if (cfg.tokenStatus) {
          res.writeHead(cfg.tokenStatus, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'invalid_client', error_description: 'The client credentials were rejected.' }));
        }
        if (!params.get('client_secret')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'invalid_request', error_description: 'client_secret missing' }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          access_token: `mock-access-${Date.now()}`,
          refresh_token: 'mock-refresh-token',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'section:member:read section:programme:read'
        }));
      });
    }

    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'unauthorised' }));
    }

    const headers = {
      'Content-Type': cfg.contentType || 'application/json',
      'X-RateLimit-Limit': '1000',
      'X-RateLimit-Remaining': '842',
      'X-RateLimit-Reset': '3600'
    };
    if (cfg.blockedHeader) headers['X-Blocked'] = cfg.blockedHeader;
    if (cfg.deprecationHeader) headers.Deprecation = cfg.deprecationHeader;
    if (cfg.retryAfter) headers['Retry-After'] = String(cfg.retryAfter);

    if (url.pathname === '/oauth/resource') {
      if (cfg.apiStatus && cfg.apiStatus !== 200) {
        res.writeHead(cfg.apiStatus, headers);
        return res.end(JSON.stringify({ error: `status ${cfg.apiStatus}` }));
      }
      if (cfg.body !== undefined) { res.writeHead(200, headers); return res.end(cfg.body); }
      const data = {
        user_id: cfg.omitUserId ? undefined : 55501,
        full_name: 'Test Leader',
        email: 'leader@example.invalid',
        sections: sectionsFor(scenario)
      };
      res.writeHead(200, headers);
      return res.end(JSON.stringify({ data }));
    }

    if (url.pathname === '/api.php') {
      if (cfg.apiStatus && cfg.apiStatus !== 200) {
        res.writeHead(cfg.apiStatus, headers);
        return res.end(JSON.stringify({ error: `status ${cfg.apiStatus}` }));
      }
      if (cfg.body !== undefined) { res.writeHead(200, headers); return res.end(cfg.body); }
      res.writeHead(200, headers);
      return res.end(JSON.stringify({
        terms: { 12345: [{ termid: '900', name: 'Autumn 2026', startdate: '2026-09-01', enddate: '2026-12-18' }] }
      }));
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'not found' }));
  });

  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

module.exports = { start, SCENARIOS };

if (require.main === module) {
  const scenario = process.argv[2] || 'happy';
  start(3999, { scenario }).then(() => console.log(`Mock OSM listening on http://localhost:3999 (scenario: ${scenario})`));
}
