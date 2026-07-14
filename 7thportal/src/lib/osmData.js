// Thin layer over osm.js that resolves "which OSM token reads for this
// request" (own token for leaders/admins, the shared service account for
// parents - see helpers.getServiceAccount) and swaps in demo.* fixtures
// whenever the resolved token is the 'demo' sentinel. Every dashboard/child/
// section route goes through here so OSM-unavailable handling (FRD journey
// 7.4 / NFR-017) lives in one place.
const osm = require('./osm');
const { ensureFreshToken, getServiceAccount } = require('./helpers');

async function readTokenFor(user) {
  try {
    if (user.portal_role === 'parent') {
      const service = getServiceAccount();
      if (service) return { token: await ensureFreshToken(service), unavailable: false };
      if (osm.demoModeAllowed()) return { token: 'demo', unavailable: false };
      return { unavailable: true, reason: 'No OSM service connection has been configured yet. Ask a Portal Administrator to connect OSM in Admin Settings.' };
    }
    return { token: await ensureFreshToken(user), unavailable: false };
  } catch (e) {
    if (osm.demoModeAllowed()) return { token: 'demo', unavailable: false };
    return { unavailable: true, reason: 'Live OSM information cannot currently be loaded. Please try again shortly.' };
  }
}

function sectionMeta(sectionId) {
  return osm.demo.DEMO_SECTIONS[sectionId] || null;
}

async function sectionMembers(token, sectionId) {
  if (token === 'demo') return { available: true, members: osm.demo.DEMO_MEMBERS[sectionId] || [] };
  return osm.getSectionMembers(token, sectionId);
}

async function sectionProgramme(token, sectionId) {
  if (token === 'demo') return { available: true, items: osm.demo.DEMO_PROGRAMME[sectionId] || [] };
  return osm.getSectionProgramme(token, sectionId);
}

async function sectionEvents(token, sectionId) {
  if (token === 'demo') return { available: true, items: osm.demo.DEMO_EVENTS[sectionId] || [] };
  return osm.getSectionEvents(token, sectionId);
}

async function memberBadges(token, sectionType, sectionId, memberId) {
  if (token === 'demo') return { available: true, badges: osm.demo.DEMO_BADGES[memberId] || [] };
  return osm.getMemberBadgeProgress(token, sectionType, sectionId, osm.demo.DEMO_TERM.termid, memberId);
}

module.exports = { readTokenFor, sectionMeta, sectionMembers, sectionProgramme, sectionEvents, memberBadges };
