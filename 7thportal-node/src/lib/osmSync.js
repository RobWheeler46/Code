// Section-member sync (FRD 29 / FR-OSM-CAP-001). Uses a stored OSM connection's
// token to read the leader's sections and each section's active member count from
// OSM, then stores COUNTS ONLY (never named member records). Refreshes an expired
// access token from the stored refresh token when needed.
const db = require('./../db');
const config = require('./config');
const osm = require('./osm');
const { encrypt, decrypt } = require('./crypto');

const latestConn = db.prepare("SELECT * FROM osm_connections WHERE status = 'connected' ORDER BY id DESC LIMIT 1");
const connForUser = db.prepare("SELECT * FROM osm_connections WHERE user_id = ? AND status = 'connected' ORDER BY id DESC LIMIT 1");
const updateTokens = db.prepare("UPDATE osm_connections SET access_token_enc = ?, refresh_token_enc = ?, expires_at = ? WHERE id = ?");
const upsertSection = db.prepare(`
  INSERT INTO osm_sections (osm_section_id, section_name, section_type, active_count, last_synced_at, synced_by, sync_status, sync_error)
  VALUES (?, ?, ?, ?, datetime('now'), ?, ?, ?)
  ON CONFLICT(osm_section_id) DO UPDATE SET
    section_name = excluded.section_name, section_type = excluded.section_type,
    active_count = excluded.active_count, last_synced_at = excluded.last_synced_at,
    synced_by = excluded.synced_by, sync_status = excluded.sync_status, sync_error = excluded.sync_error
`);

// Return a usable access token for a connection, refreshing if it has expired.
async function freshToken(conn) {
  const expired = conn.expires_at && Date.now() >= Date.parse(conn.expires_at) - 60_000;
  if (!expired) return decrypt(conn.access_token_enc);
  const refresh = decrypt(conn.refresh_token_enc);
  if (!refresh) return null;
  const r = await osm.refreshToken(refresh);
  if (!r.ok) return null;
  updateTokens.run(encrypt(r.accessToken), encrypt(r.refreshToken || refresh), r.expiresAt, conn.id);
  return r.accessToken;
}

// Sync using a specific connection row. Returns { ok, synced, sections } or { ok:false, error }.
async function syncForConnection(conn, actorUserId = null) {
  if (!config.osmConfigured()) return { ok: false, error: 'OSM is not configured.' };
  const accessToken = await freshToken(conn);
  if (!accessToken) return { ok: false, error: 'No usable OSM token — the leader needs to sign in with OSM again.' };

  const resource = await osm.getResource(accessToken);
  if (!resource.ok) {
    const why = resource.parseable === false
      ? `OSM returned ${resource.contentType || 'a non-JSON page'} (usually a rate-limit/block page — wait a few minutes and retry)`
      : (resource.error || `HTTP ${resource.status}`);
    return { ok: false, error: `Could not read section data from OSM: ${why}.` };
  }
  const sections = osm.extractSectionsFromResource(resource.data);
  if (!sections.length) return { ok: false, error: 'No sections were found in the OSM response for this account.' };

  // Register the section LIST from OSM only. Member COUNTS are deliberately NOT
  // fetched: OSM's member endpoint is an internal /ext/ route that rejects OAuth
  // GETs (405) and, after a few rapid calls, trips OSM's anti-abuse block (which
  // took sign-in down). So "active" stays sourced from local records; this sync
  // makes exactly one safe /oauth/resource call.
  for (const s of sections) {
    upsertSection.run(s.id, s.name, s.type, null, actorUserId, 'ok', null);
  }
  return { ok: true, synced: sections.length, total: sections.length, sections: sections.map((s) => ({ section: s.name })) };
}

// Sync using the most recent connected OSM account (for an admin-triggered run).
async function syncLatest(actorUserId = null) {
  const conn = latestConn.get();
  if (!conn) return { ok: false, error: 'No OSM connection yet — a leader must sign in with OSM before a sync can run.', noConnection: true };
  return syncForConnection(conn, actorUserId);
}

// Best-effort sync for a user who just signed in with OSM (never throws).
async function syncForUser(userId) {
  try {
    const conn = connForUser.get(userId);
    if (conn) await syncForConnection(conn, userId);
  } catch (err) {
    console.error('[osmSync] background sync failed', err.message);
  }
}

// Dump the /oauth/resource structure (a single request, to avoid re-tripping the
// block) with long strings truncated, so the section shape can be mapped.
function truncateJson(obj, max = 3000) {
  try {
    const s = JSON.stringify(obj, (k, v) => (typeof v === 'string' && v.length > 60 ? v.slice(0, 60) + '…' : v));
    return s.length > max ? s.slice(0, max) + '…(truncated)' : s;
  } catch { return null; }
}

async function diagnose() {
  const conn = latestConn.get();
  if (!conn) return { ok: false, error: 'No OSM connection yet — sign in with OSM first.' };
  const accessToken = await freshToken(conn);
  if (!accessToken) return { ok: false, error: 'No usable OSM token — sign in with OSM again.' };
  const r = await osm.getResource(accessToken);
  const sections = r.parseable ? osm.extractSectionsFromResource(r.data) : [];
  return {
    ok: true,
    resource: {
      status: r.status, contentType: r.contentType, parseable: r.parseable,
      snippet: r.snippet, structure: r.parseable ? truncateJson(r.data) : null
    },
    sectionsFound: sections
  };
}

module.exports = { syncForConnection, syncLatest, syncForUser, diagnose };
