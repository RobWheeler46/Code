const express = require('express');
const db = require('../db');
const osmData = require('../lib/osmData');
const { logAudit } = require('../lib/helpers');
const { requireAuth, requireParent } = require('../lib/middleware');

const router = express.Router();
const OSM_LINK = 'https://www.onlinescoutmanager.co.uk/';

router.get('/api/children/:linkId', requireAuth, requireParent, async (req, res) => {
  const link = db.prepare('SELECT * FROM parent_child_links WHERE id = ? AND parent_user_id = ?').get(req.params.linkId, req.user.id);
  if (!link) return res.status(404).json({ error: 'Child not found.' });

  const { token, unavailable, reason } = await osmData.readTokenFor(req.user);
  if (unavailable) {
    return res.json({ osmUnavailable: true, reason, name: link.child_display_name, sectionName: link.osm_section_name, osmLink: OSM_LINK });
  }

  const [membersData, programme, events, badges] = await Promise.all([
    osmData.sectionMembers(token, link.osm_section_id),
    osmData.sectionProgramme(token, link.osm_section_id),
    osmData.sectionEvents(token, link.osm_section_id),
    osmData.memberBadges(token, link.osm_section_type, link.osm_section_id, link.osm_member_id),
  ]);
  const member = membersData.available ? membersData.members.find(m => m.id === link.osm_member_id) : null;

  logAudit({ userId: req.user.id, action: 'view_child_profile', entityType: 'child', entityId: link.osm_member_id, ipAddress: req.ip });

  res.json({
    name: link.child_display_name || (member ? `${member.firstName} ${member.lastName}` : 'Unknown'),
    sectionName: link.osm_section_name,
    dob: member?.dob || null,
    patrol: member?.patrol || null,
    profileAvailable: !!member,
    programme: programme.available ? programme.items : [],
    programmeAvailable: programme.available,
    events: events.available ? events.items : [],
    eventsAvailable: events.available,
    badges: badges.available ? badges.badges : [],
    badgesAvailable: badges.available,
    osmLink: OSM_LINK,
  });
});

module.exports = router;
