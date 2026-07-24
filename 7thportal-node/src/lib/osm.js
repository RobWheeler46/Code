// Minimal OSM HTTP client (uses global fetch, Node 18+). Only the calls the login
// flow needs: exchange an authorisation code for tokens, and read the signed-in
// user's context from the resource endpoint.
const config = require('./config');

const TIMEOUT_MS = 15000;

async function postForm(url, params) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(params),
      signal: controller.signal
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function exchangeCode(code) {
  const { data, ok } = await postForm(config.osm.tokenUrl, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.osm.callbackUrl,
    client_id: config.osm.clientId,
    client_secret: config.osm.clientSecret
  });
  if (!ok || !data) return { ok: false };
  const accessToken = data.access_token || data.accessToken;
  if (!accessToken) return { ok: false };
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
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
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

module.exports = { exchangeCode, fetchProfile };
