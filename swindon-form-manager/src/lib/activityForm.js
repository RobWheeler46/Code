const SECTIONS = [
  'Sparrowhawks Beavers', 'Falcon Beavers', 'Kingfisher Beavers',
  'Isambard Cubs', 'Kingdom Cubs', 'Brunel Cubs',
  'Discovery Scouts', 'Endeavour Scouts'
];

const LEADER_SECTION_OR_ROLE = [...SECTIONS, 'Group Lead Volunteer', 'Trustee', 'Other'];
const ATTENDING_SECTIONS = [...SECTIONS, 'Adults / volunteers', 'Other'];

const RISK_ASSESSMENT_WORDING = 'I confirm that I have completed a written risk assessment for this activity and that it will be shared with the adults and young people involved where appropriate.';
const RULES_CONFIRMATION_WORDING = 'I confirm that I have checked the relevant Scouts rules and guidance for this activity and that the activity will be run in line with those requirements.';
const ACCURACY_CONFIRMATION_WORDING = 'I confirm that the information provided is accurate and that I will update the approver if anything changes before the activity takes place.';

const MAX_FILES = 10;
const MAX_FILE_SIZE_MB = 10;

// Validates a plain-object payload of form field values (strings/booleans as submitted).
// Returns { valid: boolean, errors: { field: message } }
function validateActivityForm(fields, hasRiskAssessmentFile) {
  const errors = {};
  const req = (key, label) => {
    if (!fields[key] || String(fields[key]).trim() === '') errors[key] = `${label} is required.`;
  };

  req('leader_name', 'Name');
  req('leader_phone', 'Phone number');
  req('leader_email', 'Email address');
  req('leader_section_role', 'Section or role');

  req('activity_description', 'Description of activity');
  req('activity_location', 'Location');
  req('activity_date', 'Date');
  req('activity_start_time', 'Start time');
  req('activity_finish_time', 'Finish time');
  req('away_from_meeting_place', 'Away from usual meeting place');
  req('joint_activity', 'Joint activity');
  if (fields.joint_activity === 'Yes') req('joint_activity_details', 'Joint activity details');

  if (!fields.attending_sections || (Array.isArray(fields.attending_sections) && fields.attending_sections.length === 0)) {
    errors.attending_sections = 'Section(s) attending is required.';
  }
  req('young_people_count', 'Estimated number of young people');
  req('adults_count', 'Estimated number of adults');
  req('additional_needs', 'Additional needs, adjustments or specific considerations');
  if (fields.additional_needs === 'Yes') req('additional_needs_details', 'Additional details');

  req('requires_permit', 'Permit / qualification / instructor question');
  if (fields.requires_permit === 'Yes' || fields.requires_permit === 'Not sure') {
    req('permit_details', 'Permit, qualification or instructor details');
  }
  req('external_provider', 'External provider question');
  if (fields.external_provider === 'Yes') req('external_provider_details', 'External provider details');

  req('in_touch_process', 'In Touch process');
  req('first_aid_arrangements', 'First aid arrangements');
  req('transport_arrangements', 'Transport arrangements');
  if (fields.risk_assessment_confirmed !== 'true' && fields.risk_assessment_confirmed !== true) {
    errors.risk_assessment_confirmed = 'You must confirm the risk assessment statement.';
  }
  if (!hasRiskAssessmentFile) errors.risk_assessment_file = 'Risk assessment upload is required.';

  if (fields.rules_confirmed !== 'true' && fields.rules_confirmed !== true) {
    errors.rules_confirmed = 'You must confirm the Scouts rules and guidance statement.';
  }
  if (fields.accuracy_confirmed !== 'true' && fields.accuracy_confirmed !== true) {
    errors.accuracy_confirmed = 'You must confirm the accuracy statement.';
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

module.exports = {
  SECTIONS,
  LEADER_SECTION_OR_ROLE,
  ATTENDING_SECTIONS,
  RISK_ASSESSMENT_WORDING,
  RULES_CONFIRMATION_WORDING,
  ACCURACY_CONFIRMATION_WORDING,
  MAX_FILES,
  MAX_FILE_SIZE_MB,
  validateActivityForm
};
