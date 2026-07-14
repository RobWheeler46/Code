const express = require('express');
const db = require('../db');
const osmData = require('../lib/osmData');
const { logAudit } = require('../lib/helpers');
const { requireAuth, requireLeader } = require('../lib/middleware');

const router = express.Router();

function userSectionIds(user) {
  return JSON.parse(user.osm_roles_json || '[]').map(r => r.sectionid).filter(Boolean);
}

// Trustee viewers get governance/reporting visibility, not member-level detail
// (FRD 6: "No default access to medical or detailed child records").
function canViewMembers(user, sectionId) {
  if (user.portal_role === 'trustee_viewer') return false;
  if (user.portal_role === 'admin') return true;
  return userSectionIds(user).includes(sectionId);
}

router.get('/api/sections/:sectionId/members', requireAuth, requireLeader, async (req, res) => {
  if (!canViewMembers(req.user, req.params.sectionId)) {
    return res.status(403).json({ error: 'You do not have permission to view this section.' });
  }
  const { token, unavailable, reason } = await osmData.readTokenFor(req.user);
  if (unavailable) return res.json({ osmUnavailable: true, reason, members: [] });

  const [membersData, roleRow] = [await osmData.sectionMembers(token, req.params.sectionId), null];
  const stripSensitive = req.user.portal_role === 'group_leadership';
  logAudit({ userId: req.user.id, action: 'view_member_list', entityType: 'section', entityId: req.params.sectionId, ipAddress: req.ip });
  res.json({
    available: membersData.available,
    members: membersData.available ? membersData.members.map(m => ({
      id: m.id, firstName: m.firstName, lastName: m.lastName, patrol: m.patrol,
      dob: stripSensitive ? null : m.dob,
    })) : [],
  });
});

router.get('/api/sections/:sectionId/members/:memberId', requireAuth, requireLeader, async (req, res) => {
  if (!canViewMembers(req.user, req.params.sectionId)) {
    return res.status(403).json({ error: 'You do not have permission to view this member.' });
  }
  const { token, unavailable, reason } = await osmData.readTokenFor(req.user);
  if (unavailable) return res.json({ osmUnavailable: true, reason });

  const roles = JSON.parse(req.user.osm_roles_json || '[]');
  const role = roles.find(r => r.sectionid === req.params.sectionId) || {};
  const [membersData, badges] = await Promise.all([
    osmData.sectionMembers(token, req.params.sectionId),
    osmData.memberBadges(token, role.section, req.params.sectionId, req.params.memberId),
  ]);
  const member = membersData.available ? membersData.members.find(m => m.id === req.params.memberId) : null;
  if (!member) return res.status(404).json({ error: 'Member not found.' });

  logAudit({ userId: req.user.id, action: 'view_member_summary', entityType: 'member', entityId: req.params.memberId, ipAddress: req.ip });
  const stripSensitive = req.user.portal_role === 'group_leadership';
  res.json({
    firstName: member.firstName, lastName: member.lastName, patrol: member.patrol,
    dob: stripSensitive ? null : member.dob,
    badges: badges.available ? badges.badges : [],
    badgesAvailable: badges.available,
  });
});

module.exports = router;
