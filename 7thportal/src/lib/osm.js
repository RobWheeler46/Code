const crypto = require('crypto');

// ── OSM OAuth2 + "ext" API client ──────────────────────────────────────────
//
// The OAuth handshake (Basic-auth token exchange, refresh flow, Bearer calls)
// mirrors the pattern already proven working in the osm-badges-2025 tool in
// this workspace, which authenticates a *leader's* OSM account and receives
// section-scoped access. OSM does not currently offer a public OAuth route
// for parents/carers (see README "Integration model" and FRD open question
// 15.2) - only OSM-authenticated leaders/admins get a real OSM session here.
//
// Field names for the startup/member/programme/event "ext" endpoints beyond
// roles+terms (already exercised by osm-badges-2025) are best-effort, based
// on public community documentation rather than an official OSM API spec.
// Every call is wrapped so a shape mismatch degrades to "data not available"
// instead of breaking the page (FRD NFR-017) - validate against a live
// sandbox account before relying on anything beyond roles/terms/badges.

const OSM_BASE = 'https://www.onlinescoutmanager.co.uk';
const SCOPES = 'section:member:read section:programme:read section:event:read section:badge:read';
const YOUTH_SECTION_TYPES = ['squirrels', 'beavers', 'cubs', 'scouts', 'explorers'];
const BADGE_TYPE_NAMES = { 1: 'Challenge', 2: 'Activity', 3: 'Staged', 4: 'Core' };

function isConfigured() {
  return !!(process.env.OSM_CLIENT_ID && process.env.OSM_CLIENT_SECRET && process.env.OSM_REDIRECT_URI);
}

function demoModeAllowed() {
  return process.env.ALLOW_DEMO_MODE === 'true' || !isConfigured();
}

function basicAuthHeader() {
  const creds = Buffer.from(`${process.env.OSM_CLIENT_ID}:${process.env.OSM_CLIENT_SECRET}`).toString('base64');
  return `Basic ${creds}`;
}

function buildAuthorizeUrl(state) {
  const url = new URL(`${OSM_BASE}/oauth/authorize`);
  url.searchParams.set('client_id', process.env.OSM_CLIENT_ID);
  url.searchParams.set('redirect_uri', process.env.OSM_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('state', state);
  return url.toString();
}

async function exchangeCodeForToken(code) {
  const res = await fetch(`${OSM_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuthHeader() },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: process.env.OSM_REDIRECT_URI }),
  });
  if (!res.ok) throw new Error(`OSM token exchange failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in - 30) * 1000,
  };
}

async function refreshAccessToken(refreshToken) {
  const res = await fetch(`${OSM_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuthHeader() },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  if (!res.ok) throw new Error('OSM session expired');
  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: Date.now() + (data.expires_in - 30) * 1000,
  };
}

async function osmGet(accessToken, pathname, params = {}) {
  const url = new URL(OSM_BASE + pathname);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`OSM API error ${res.status} on ${pathname}`);
  return res.json();
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function getStartupData(accessToken) {
  return osmGet(accessToken, '/ext/generic/startup/', { action: 'getDataPayload' });
}

// Best-effort identity extraction - OSM's public OAuth token response carries
// no user identifier, so the startup payload is the only source. Field paths
// vary across community write-ups; try the likely candidates and fail loudly
// (server-side log) rather than silently mis-attributing an account.
function extractIdentity(startup) {
  const g = startup?.data?.globals || {};
  const roles = g.roles || [];
  const userId = g.user_id || g.userid || g.userId || (roles[0] && roles[0].userid);
  const firstName = g.firstname || g.firstName || (g.user && g.user.firstname) || 'OSM';
  const lastName = g.lastname || g.lastName || (g.user && g.user.lastname) || 'User';
  const email = g.email || (g.user && g.user.email) || null;
  if (!userId) throw new Error('Could not determine OSM user identity from startup payload - see README OSM integration notes.');
  return { osmUserId: String(userId), firstName, lastName, email, roles, terms: g.terms || {} };
}

async function getSectionMembers(accessToken, sectionId, termId) {
  try {
    const resp = await osmGet(accessToken, '/ext/members/contact/', { action: 'getListOfMembers', sort: 'dob', section_id: sectionId, term_id: termId || -1 });
    const items = Array.isArray(resp) ? resp : Object.values(resp?.items || resp || {});
    return { available: true, members: items.map(m => ({
      id: String(m.scoutid || m.member_id || m.id),
      firstName: m.firstname || m.first_name || '',
      lastName: m.lastname || m.last_name || '',
      dob: m.dob || null,
      patrol: m.patrol || m.patrolname || null,
    })) };
  } catch (e) {
    return { available: false, members: [], error: e.message };
  }
}

async function getSectionProgramme(accessToken, sectionId, termId) {
  try {
    const resp = await osmGet(accessToken, '/ext/programme/', { action: 'getProgrammeSummary', section_id: sectionId, term_id: termId || -1 });
    const items = Array.isArray(resp?.items) ? resp.items : Array.isArray(resp) ? resp : [];
    return { available: true, items: items.map(p => ({
      date: p.meetingdate || p.date || null,
      title: p.title || p.meeting_title || 'Meeting',
      notes: p.notesforparents || p.notes || null,
    })) };
  } catch (e) {
    return { available: false, items: [], error: e.message };
  }
}

async function getSectionEvents(accessToken, sectionId) {
  try {
    const resp = await osmGet(accessToken, '/ext/events/summary/', { action: 'get', section_id: sectionId });
    const items = Array.isArray(resp?.items) ? resp.items : Array.isArray(resp) ? resp : [];
    return { available: true, items: items.map(e => ({
      id: String(e.eventid || e.id),
      name: e.name || 'Event',
      date: e.startdate || e.date || null,
      location: e.location || null,
    })) };
  } catch (e) {
    return { available: false, items: [], error: e.message };
  }
}

async function getMemberBadgeProgress(accessToken, sectionType, sectionId, termId, memberId) {
  try {
    const typeIds = [1, 2, 3, 4];
    const badgeLists = await mapLimit(typeIds, 4, async typeId => {
      const resp = await osmGet(accessToken, '/ext/badges/records/', {
        action: 'getAvailableBadges', section: sectionType, section_id: sectionId, term_id: termId, type_id: String(typeId), context: 'none',
      });
      return (resp.data || []).map(b => ({ ...b, typeId }));
    });
    const allBadges = badgeLists.flat();
    const results = [];
    await mapLimit(allBadges, 5, async badge => {
      const resp = await osmGet(accessToken, '/ext/badges/records/', {
        action: 'getBadgeRecords', section: sectionType, section_id: sectionId, term_id: termId,
        type_id: String(badge.typeId), badge_id: String(badge.badge_id), badge_version: String(badge.badge_version ?? 0),
      });
      const record = (resp.data || []).find(r => String(r.scoutid) === String(memberId));
      if (!record) return;
      const awarded = record.awarded === '1' || record.awarded === 1;
      results.push({ badgeName: badge.name || badge.badge, type: BADGE_TYPE_NAMES[badge.typeId], completed: awarded });
    });
    return { available: true, badges: results };
  } catch (e) {
    return { available: false, badges: [], error: e.message };
  }
}

// ── Demo mode - deterministic fake OSM data so the app is fully clickable
// without live credentials. Never used once a real osm_access_token is set.
const DEMO_TERM = { termid: 'demo-term', name: 'Autumn Term', startdate: '2026-09-01', enddate: '2026-12-15' };
const DEMO_SECTIONS = {
  s101: { sectionid: 's101', sectionname: 'Cubs', section: 'cubs', meetingDay: 'Tuesday', meetingTime: '18:15 - 19:30', location: '7th Swindon Scout Hut' },
  s102: { sectionid: 's102', sectionname: 'Scouts', section: 'scouts', meetingDay: 'Thursday', meetingTime: '19:30 - 21:00', location: '7th Swindon Scout Hut' },
};
const DEMO_MEMBERS = {
  s101: [
    { id: 'm201', firstName: 'Amelia', lastName: 'Turner', dob: '2016-03-14', patrol: 'Blue Six' },
    { id: 'm202', firstName: 'Jack', lastName: 'Ellis', dob: '2016-07-02', patrol: 'Red Six' },
  ],
  s102: [
    { id: 'm203', firstName: 'Freddie', lastName: 'Brown', dob: '2013-11-20', patrol: 'Kestrel Patrol' },
  ],
};
const DEMO_PROGRAMME = {
  s101: [
    { date: '2026-07-14', title: 'Pioneering skills', notes: 'Bring old bedsheets for shelter building.' },
    { date: '2026-07-21', title: 'Nature trail and badge work', notes: null },
  ],
  s102: [
    { date: '2026-07-16', title: 'Map and compass night', notes: 'Meet in the main hall, not the field.' },
  ],
};
const DEMO_EVENTS = {
  s101: [{ id: 'e301', name: 'Summer Camp 2026', date: '2026-08-08', location: 'Youlbury Scout Camp' }],
  s102: [{ id: 'e302', name: 'Night Hike', date: '2026-07-25', location: 'Barbury Castle' }],
};
const DEMO_BADGES = {
  m201: [
    { badgeName: 'Outdoor Adventurer', type: 'Activity', completed: true },
    { badgeName: 'Nights Away', type: 'Staged', completed: false },
  ],
  m202: [{ badgeName: 'Chef', type: 'Activity', completed: true }],
  m203: [
    { badgeName: 'Hikes Away', type: 'Staged', completed: false },
    { badgeName: 'Navigator', type: 'Activity', completed: true },
  ],
};

function demoStartupForRole(role) {
  const roles = role === 'parent' ? [] : [
    { sectionid: 's101', sectionname: 'Cubs', section: 'cubs', userid: 'demo-osm-user' },
  ];
  return { data: { globals: { user_id: 'demo-osm-user', firstname: 'Demo', lastname: role === 'admin' ? 'Administrator' : 'Leader', roles, terms: { s101: [DEMO_TERM], s102: [DEMO_TERM] } } } };
}

module.exports = {
  OSM_BASE, YOUTH_SECTION_TYPES, isConfigured, demoModeAllowed,
  buildAuthorizeUrl, exchangeCodeForToken, refreshAccessToken,
  getStartupData, extractIdentity,
  getSectionMembers, getSectionProgramme, getSectionEvents, getMemberBadgeProgress,
  demoStartupForRole,
  demo: { DEMO_TERM, DEMO_SECTIONS, DEMO_MEMBERS, DEMO_PROGRAMME, DEMO_EVENTS, DEMO_BADGES },
  randomState: () => crypto.randomBytes(16).toString('hex'),
};
