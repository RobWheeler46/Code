// Minimal OSM HTTP client (uses global fetch, Node 18+). Only the calls the login
// flow needs: exchange an authorisation code for tokens, and read the signed-in
// user's context from the resource endpoint.
const config = require('./config');

const TIMEOUT_MS = 15000;
// OSM's edge blocks requests without a browser-like User-Agent; set one on every call.
const USER_AGENT = 'Mozilla/5.0 (compatible; 7thPortal/1.0; +https://7thswindon.org.uk)';

function bearerHeaders(accessToken) {
  return { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'User-Agent': USER_AGENT };
}

async function postForm(url, params, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': USER_AGENT, ...extraHeaders },
      body: new URLSearchParams(params),
      signal: controller.signal
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return { ok: res.ok, status: res.status, data, raw: text };
  } finally {
    clearTimeout(timer);
  }
}

// OSM's token endpoint authenticates the client with HTTP Basic auth (matching the
// proven 7thportal-php implementation), not client credentials in the body.
function basicAuthHeader() {
  return 'Basic ' + Buffer.from(`${config.osm.clientId}:${config.osm.clientSecret}`).toString('base64');
}

async function exchangeCode(code) {
  const { data, ok, status, raw } = await postForm(config.osm.tokenUrl, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.osm.callbackUrl
  }, { Authorization: basicAuthHeader() });
  if (!ok || !data) {
    console.error(`[osm.exchangeCode] token endpoint HTTP ${status}: ${String(raw || '').slice(0, 300)}`);
    return { ok: false, status };
  }
  const accessToken = data.access_token || data.accessToken;
  if (!accessToken) {
    console.error(`[osm.exchangeCode] no access_token in response: ${String(raw || '').slice(0, 300)}`);
    return { ok: false, status };
  }
  const expiresIn = Number(data.expires_in ?? data.expiresIn);
  return {
    ok: true,
    accessToken,
    refreshToken: data.refresh_token || data.refreshToken || null,
    tokenType: data.token_type || 'Bearer',
    scope: data.scope || config.osm.scopes,
    expiresAt: Number.isFinite(expiresIn) ? new Date(Date.now() + expiresIn * 1000).toISOString() : null
  };
}

// The resource endpoint describes the signed-in user. Field names vary between OSM
// responses, so read defensively.
async function fetchProfile(accessToken) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(config.osm.resourceUrl, {
      headers: bearerHeaders(accessToken),
      signal: controller.signal
    });
    if (!res.ok) return { ok: false, status: res.status };
    const data = await res.json().catch(() => null);
    const d = data?.data || data || {};
    return {
      ok: true,
      userId: d.user_id ?? d.userid ?? d.id ?? d.sub ?? null,
      email: d.email ?? d.email_address ?? null,
      name: d.full_name ?? d.fullname ?? d.name ?? ([d.firstname, d.lastname].filter(Boolean).join(' ') || null),
      raw: d
    };
  } finally {
    clearTimeout(timer);
  }
}

// Exchange a refresh token for a fresh access token (used by the section sync when
// a stored OSM token has expired).
async function refreshToken(refresh) {
  const { data, ok, status, raw } = await postForm(config.osm.tokenUrl, {
    grant_type: 'refresh_token',
    refresh_token: refresh
  }, { Authorization: basicAuthHeader() });
  const accessToken = data?.access_token || data?.accessToken;
  if (!ok || !accessToken) {
    console.error(`[osm.refreshToken] HTTP ${status}: ${String(raw || '').slice(0, 300)}`);
    return { ok: false };
  }
  const expiresIn = Number(data.expires_in ?? data.expiresIn);
  return {
    ok: true,
    accessToken,
    refreshToken: data.refresh_token || data.refreshToken || null,
    expiresAt: Number.isFinite(expiresIn) ? new Date(Date.now() + expiresIn * 1000).toISOString() : null
  };
}

// Authenticated GET against an OSM data endpoint.
async function osmGet(accessToken, pathname, params = {}) {
  const url = new URL(config.osm.apiBase + pathname);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: bearerHeaders(accessToken),
      signal: controller.signal
    });
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok) return { ok: false, status: res.status, contentType };
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { return { ok: false, status: res.status, parseError: true, contentType, snippet: text.slice(0, 400) }; }
    return { ok: true, data, contentType };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'OSM request timed out' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

// Diagnostic probe of a full OSM URL: returns the shape of the response without
// dumping personal data (keys + a short snippet only when the body is not JSON).
async function probeUrl(accessToken, url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: bearerHeaders(accessToken), signal: controller.signal });
    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();
    let parseable = true; let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { parseable = false; }
    return {
      status: res.status, contentType, parseable, bytes: text.length,
      topKeys: parseable && data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data).slice(0, 25) : null,
      isArray: Array.isArray(data),
      dataKeys: parseable && data?.data && typeof data.data === 'object' ? Object.keys(data.data).slice(0, 25) : null,
      globalsKeys: parseable && data?.data?.globals ? Object.keys(data.data.globals).slice(0, 40) : null,
      snippet: parseable ? null : text.slice(0, 400)
    };
  } catch (e) {
    return { error: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

// The startup payload is OSM's authoritative source for which sections the
// signed-in leader can see (data.globals.roles). Field paths vary across
// community write-ups, so read defensively.
async function getStartup(accessToken) {
  const r = await osmGet(accessToken, '/ext/generic/startup/', { action: 'getDataPayload' });
  if (!r.ok) {
    const why = r.parseError ? `returned ${r.contentType || 'a non-JSON body'}, not JSON` : (r.error || `HTTP ${r.status}`);
    return { ok: false, error: why, snippet: r.snippet };
  }
  return { ok: true, globals: r.data?.data?.globals || r.data?.globals || {} };
}

// Turn the startup roles into a deduplicated list of { id, name, type }.
function extractSections(globals) {
  const roles = globals?.roles || [];
  const seen = new Map();
  roles.forEach((r) => {
    const id = r.sectionid ?? r.section_id ?? r.sectionId;
    if (id == null || seen.has(String(id))) return;
    seen.set(String(id), {
      id: String(id),
      name: r.sectionname ?? r.section_name ?? r.name ?? `Section ${id}`,
      type: r.section ?? r.section_type ?? null
    });
  });
  return [...seen.values()];
}

// Read the OAuth-native resource endpoint (the same one login uses). This is the
// supported way to learn who the user is and which sections they can see, without
// hitting the internal /ext/ webapp routes that OSM blocks for OAuth tokens.
async function getResource(accessToken) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(config.osm.resourceUrl, { headers: bearerHeaders(accessToken), signal: controller.signal });
    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();
    let data = null; let parseable = true;
    try { data = text ? JSON.parse(text) : null; } catch { parseable = false; }
    return { ok: res.ok && parseable, status: res.status, contentType, parseable, data, snippet: parseable ? null : text.slice(0, 400) };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'OSM request timed out' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

// Find a section list inside the resource payload. OSM's exact shape is not a
// published spec, so search the likely containers for arrays of section objects.
function extractSectionsFromResource(data) {
  const roots = [data, data?.data, data?.data?.globals, data?.user].filter((x) => x && typeof x === 'object');
  const candidates = [];
  for (const r of roots) {
    for (const key of ['sections', 'roles', 'groups_and_sections']) {
      if (Array.isArray(r[key])) candidates.push(...r[key]);
    }
    if (Array.isArray(r.groups)) for (const g of r.groups) if (g && Array.isArray(g.sections)) candidates.push(...g.sections);
  }
  const seen = new Map();
  for (const c of candidates) {
    if (!c || typeof c !== 'object') continue;
    const id = c.sectionid ?? c.section_id ?? c.sectionId ?? c.id;
    if (id == null || seen.has(String(id))) continue;
    seen.set(String(id), {
      id: String(id),
      name: c.sectionname ?? c.section_name ?? c.name ?? `Section ${id}`,
      type: c.section ?? c.section_type ?? c.type ?? null
    });
  }
  return [...seen.values()];
}

// Active member count for a section (aggregate only - the named list is read to
// count length, then discarded; only the count is returned).
async function getSectionMemberCount(accessToken, sectionId) {
  const r = await osmGet(accessToken, '/ext/members/contact/', {
    action: 'getListOfMembers', sort: 'dob', section_id: sectionId, term_id: -1
  });
  if (!r.ok) return { ok: false, error: r.error || `members ${r.status}` };
  const d = r.data;
  const items = Array.isArray(d) ? d : (Array.isArray(d?.items) ? d.items : []);
  return { ok: true, count: items.length };
}

module.exports = { exchangeCode, fetchProfile, refreshToken, getStartup, extractSections, getResource, extractSectionsFromResource, getSectionMemberCount, probeUrl };
