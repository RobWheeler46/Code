function buildRadioGroup(container, name, options) {
  container.innerHTML = options.map(opt => `
    <label><input type="radio" name="${name}" value="${escapeHtml(opt)}"> ${escapeHtml(opt)}</label>
  `).join('');
}

function clearFieldErrors(form) {
  form.querySelectorAll('.field .error').forEach(el => el.remove());
}

function showFieldErrors(form, fields) {
  clearFieldErrors(form);
  for (const [key, message] of Object.entries(fields || {})) {
    const input = form.querySelector(`[name="${key}"]`);
    const fieldWrap = input ? input.closest('.field') : null;
    if (fieldWrap) {
      const err = document.createElement('div');
      err.className = 'error';
      err.textContent = message;
      fieldWrap.appendChild(err);
    }
  }
}

// Populates the static activity-approval form (selects, radios, checkbox wording,
// and conditional show/hide wiring). Shared between new-request.js and resubmit.js.
async function setupActivityFormFields() {
  const options = await Api.get('/api/form-options');

  const leaderSelect = document.getElementById('leader_section_role');
  leaderSelect.innerHTML = '<option value="">Select...</option>' +
    options.leaderSectionOrRole.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');

  const attendingGroup = document.getElementById('attending_sections_group');
  attendingGroup.innerHTML = options.attendingSections.map(o => `
    <label><input type="checkbox" name="attending_sections" value="${escapeHtml(o)}"> ${escapeHtml(o)}</label>
  `).join('');

  buildRadioGroup(document.querySelector('[data-yesno="away_from_meeting_place"]'), 'away_from_meeting_place', ['Yes', 'No']);
  buildRadioGroup(document.querySelector('[data-yesno="joint_activity"]'), 'joint_activity', ['Yes', 'No']);
  buildRadioGroup(document.querySelector('[data-yesno="additional_needs"]'), 'additional_needs', ['Yes', 'No']);
  buildRadioGroup(document.querySelector('[data-yesno="external_provider"]'), 'external_provider', ['Yes', 'No']);
  buildRadioGroup(document.querySelector('[data-yesnonotsure="requires_permit"]'), 'requires_permit', ['Yes', 'No', 'Not sure']);

  document.getElementById('risk_assessment_confirmed_label').textContent = options.riskAssessmentWording;
  document.getElementById('rules_confirmed_label').textContent = options.rulesConfirmationWording;
  document.getElementById('accuracy_confirmed_label').textContent = options.accuracyConfirmationWording;
  document.getElementById('file-help').textContent =
    `Up to ${options.maxFiles} files in total (including the risk assessment), maximum ${options.maxFileSizeMb} MB per file. Accepted types: PDF, Word, Excel, images.`;

  document.querySelectorAll('input[name="joint_activity"]').forEach(r => r.addEventListener('change', () => {
    const show = document.querySelector('input[name="joint_activity"]:checked')?.value === 'Yes';
    document.getElementById('joint_activity_details_wrap').style.display = show ? '' : 'none';
    document.getElementById('joint_activity_details').required = show;
  }));
  document.querySelectorAll('input[name="additional_needs"]').forEach(r => r.addEventListener('change', () => {
    const show = document.querySelector('input[name="additional_needs"]:checked')?.value === 'Yes';
    document.getElementById('additional_needs_details_wrap').style.display = show ? '' : 'none';
    document.getElementById('additional_needs_details').required = show;
  }));
  document.querySelectorAll('input[name="requires_permit"]').forEach(r => r.addEventListener('change', () => {
    const val = document.querySelector('input[name="requires_permit"]:checked')?.value;
    const show = val === 'Yes' || val === 'Not sure';
    document.getElementById('permit_details_wrap').style.display = show ? '' : 'none';
    document.getElementById('permit_details').required = show;
  }));
  document.querySelectorAll('input[name="external_provider"]').forEach(r => r.addEventListener('change', () => {
    const show = document.querySelector('input[name="external_provider"]:checked')?.value === 'Yes';
    document.getElementById('external_provider_details_wrap').style.display = show ? '' : 'none';
    document.getElementById('external_provider_details').required = show;
  }));

  return options;
}

// Prefills a rendered activity form with previously submitted data (used on resubmission).
function prefillActivityForm(form, data) {
  for (const [key, value] of Object.entries(data || {})) {
    const els = form.querySelectorAll(`[name="${key}"]`);
    if (els.length === 0) continue;
    const first = els[0];
    if (first.type === 'checkbox') {
      els.forEach(el => { el.checked = Array.isArray(value) ? value.includes(el.value) : (el.value === String(value)); });
    } else if (first.type === 'radio') {
      els.forEach(el => { el.checked = el.value === value; });
    } else {
      first.value = value;
    }
  }
  form.querySelectorAll('input[name="joint_activity"]:checked, input[name="additional_needs"]:checked, input[name="requires_permit"]:checked, input[name="external_provider"]:checked')
    .forEach(el => el.dispatchEvent(new Event('change')));
}
