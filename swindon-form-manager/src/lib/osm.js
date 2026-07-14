const OSM_BASE = 'https://www.onlinescoutmanager.co.uk';

class OsmAuthError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status || 401;
  }
}

// Exchanges a member's own OSM email/password for an access token scoped to that member
// (OAuth2 "password" grant). The password is used only for this single request and is
// never logged or persisted - the caller must not store it.
async function exchangeCredentialsForToken(email, password) {
  const clientId = process.env.OSM_CLIENT_ID;
  const clientSecret = process.env.OSM_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new OsmAuthError('OSM_CLIENT_ID / OSM_CLIENT_SECRET are not configured on the server.', 500);
  }

  let res;
  try {
    res = await fetch(`${OSM_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: clientId,
        client_secret: clientSecret,
        username: email,
        password
      })
    });
  } catch (e) {
    throw new OsmAuthError('Could not reach Online Scout Manager. Please try again.', 502);
  }

  if (!res.ok) {
    if (res.status === 400 || res.status === 401) {
      throw new OsmAuthError('Incorrect OSM email or password.', 401);
    }
    throw new OsmAuthError(`OSM authentication failed (${res.status}).`, 502);
  }

  const data = await res.json();
  return { accessToken: data.access_token };
}

// Fetches the roles/sections the authenticated member has access to in OSM.
// Used only to summarise their sections for display - group/workflow membership in this
// app is still managed locally by an administrator.
async function getUserRoles(accessToken) {
  const url = new URL(`${OSM_BASE}/api.php`);
  url.searchParams.set('action', 'getUserRoles');
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) return [];
  try {
    return await res.json();
  } catch (e) {
    return [];
  }
}

function summariseSections(rolesData) {
  if (!Array.isArray(rolesData)) return [];
  return rolesData
    .filter(r => r && r.sectionname)
    .map(r => ({
      sectionId: r.sectionid,
      sectionName: r.sectionname,
      groupName: r.groupname || null
    }));
}

module.exports = { OsmAuthError, exchangeCredentialsForToken, getUserRoles, summariseSections };
