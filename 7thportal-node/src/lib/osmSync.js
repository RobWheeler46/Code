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

  const startup = await osm.getStartup(accessToken);
  if (!startup.ok) return { ok: false, error: `Could not read OSM startup data (${startup.error}).` };
  const sections = osm.extractSections(startup.globals);
  if (!sections.length) return { ok: false, error: 'No OSM sections are available for this account.' };

  const results = [];
  let synced = 0;
  for (const s of sections) {
    const c = await osm.getSectionMemberCount(accessToken, s.id);
    if (c.ok) {
      upsertSection.run(s.id, s.name, s.type, c.count, actorUserId, 'ok', null);
      synced += 1;
      results.push({ section: s.name, count: c.count });
    } else {
      upsertSection.run(s.id, s.name, s.type, null, actorUserId, 'error', String(c.error || 'fetch failed').slice(0, 200));
      results.push({ section: s.name, error: c.error });
    }
  }
  return { ok: true, synced, total: sections.length, sections: results };
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

module.exports = { syncForConnection, syncLatest, syncForUser };
