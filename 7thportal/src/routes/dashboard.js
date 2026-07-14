const express = require('express');
const db = require('../db');
const osm = require('../lib/osm');
const osmData = require('../lib/osmData');
const { logAudit, getVisibleSectionIds } = require('../lib/helpers');
const { requireAuth, requireParent, requireLeader } = require('../lib/middleware');
const { listNoticesForUser, serializeNotice } = require('./notices');

const router = express.Router();

function ageFromDob(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  const diff = Date.now() - d.getTime();
  return Math.floor(diff / (365.25 * 24 * 3600 * 1000));
}

router.get('/api/parent/dashboard', requireAuth, requireParent, async (req, res) => {
  const links = db.prepare('SELECT * FROM parent_child_links WHERE parent_user_id = ? ORDER BY child_display_name').all(req.user.id);
  if (links.length === 0) {
    return res.json({ noLinkedChildren: true, children: [], notices: [] });
  }

  const { token, unavailable, reason } = await osmData.readTokenFor(req.user);
  if (unavailable) {
    logAudit({ userId: req.user.id, action: 'osm_unavailable', entityType: 'dashboard' });
    return res.json({ osmUnavailable: true, reason, children: links.map(l => ({ linkId: l.id, name: l.child_display_name, sectionName: l.osm_section_name })), notices: [] });
  }

  const bySection = new Map();
  for (const link of links) {
    if (!bySection.has(link.osm_section_id)) bySection.set(link.osm_section_id, await osmData.sectionMembers(token, link.osm_section_id));
  }

  const children = links.map(link => {
    const sectionData = bySection.get(link.osm_section_id);
    const member = sectionData.available ? sectionData.members.find(m => m.id === link.osm_member_id) : null;
    return {
      linkId: link.id,
      name: link.child_display_name || (member ? `${member.firstName} ${member.lastName}` : 'Unknown'),
      sectionId: link.osm_section_id,
      sectionName: link.osm_section_name,
      status: member ? `${link.osm_section_name}${member.dob ? ' • Age ' + ageFromDob(member.dob) : ''}` : 'Details unavailable from OSM right now',
    };
  });

  const sectionIds = [...new Set(links.map(l => l.osm_section_id))];
  res.json({ children, notices: listNoticesForUser(req.user, sectionIds).map(serializeNotice) });
});

router.get('/api/leader/dashboard', requireAuth, requireLeader, async (req, res) => {
  let roles = JSON.parse(req.user.osm_roles_json || '[]').filter(r => osm.YOUTH_SECTION_TYPES.includes(r.section));
  const visible = getVisibleSectionIds();
  if (visible) roles = roles.filter(r => visible.includes(r.sectionid));

  if (roles.length === 0) {
    return res.json({ sections: [], notices: listNoticesForUser(req.user, []).map(serializeNotice) });
  }

  const { token, unavailable, reason } = await osmData.readTokenFor(req.user);
  if (unavailable) {
    logAudit({ userId: req.user.id, action: 'osm_unavailable', entityType: 'leader_dashboard' });
    return res.json({ osmUnavailable: true, reason, sections: roles.map(r => ({ sectionId: r.sectionid, sectionName: r.sectionname })), notices: [] });
  }

  const sections = await Promise.all(roles.map(async role => {
    const sectionId = role.sectionid;
    const [members, programme, events] = await Promise.all([
      osmData.sectionMembers(token, sectionId),
      osmData.sectionProgramme(token, sectionId),
      osmData.sectionEvents(token, sectionId),
    ]);
    const meta = osmData.sectionMeta(sectionId);
    return {
      sectionId,
      sectionName: role.sectionname,
      sectionType: role.section,
      meetingDay: meta?.meetingDay || null,
      meetingTime: meta?.meetingTime || null,
      location: meta?.location || null,
      memberCount: members.available ? members.members.length : null,
      membersAvailable: members.available,
      nextProgrammeItem: programme.available && programme.items[0] ? programme.items[0] : null,
      nextEvent: events.available && events.items[0] ? events.items[0] : null,
    };
  }));

  const sectionIds = sections.map(s => s.sectionId);
  res.json({ sections, notices: listNoticesForUser(req.user, sectionIds).map(serializeNotice) });
});

module.exports = router;
