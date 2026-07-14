const FIELD_GROUPS = [
  { title: 'Leader in charge', fields: [
    ['leader_name', 'Name'], ['leader_phone', 'Phone number'], ['leader_email', 'Email address'],
    ['leader_section_role', 'Section or role']
  ]},
  { title: 'Activity details', fields: [
    ['activity_description', 'Description of activity'], ['activity_location', 'Location'],
    ['activity_date', 'Date', 'date'], ['activity_start_time', 'Start time'], ['activity_finish_time', 'Finish time'],
    ['away_from_meeting_place', 'Away from usual meeting place'], ['joint_activity', 'Joint activity'],
    ['joint_activity_details', 'Joint activity details']
  ]},
  { title: 'Participants', fields: [
    ['attending_sections', 'Section(s) attending', 'list'], ['young_people_count', 'Estimated number of young people'],
    ['adults_count', 'Estimated number of adults'], ['additional_needs', 'Additional needs, adjustments or specific considerations'],
    ['additional_needs_details', 'Additional details']
  ]},
  { title: 'Permits, qualifications and providers', fields: [
    ['requires_permit', 'Requires Scout permit / qualification / instructor'], ['permit_details', 'Permit, qualification or instructor details'],
    ['external_provider', 'External provider being used'], ['external_provider_details', 'External provider details']
  ]},
  { title: 'Safety', fields: [
    ['in_touch_process', 'In Touch process'], ['first_aid_arrangements', 'First aid arrangements'],
    ['transport_arrangements', 'Transport arrangements'], ['risk_assessment_confirmed', 'Risk assessment confirmation', 'bool']
  ]},
  { title: 'Final confirmations', fields: [
    ['rules_confirmed', 'Scouts rules and guidance confirmation', 'bool'],
    ['accuracy_confirmed', 'Accuracy confirmation', 'bool']
  ]}
];

function renderFieldValue(value, type) {
  if (value === undefined || value === null || value === '') return '<span class="muted">&mdash;</span>';
  if (type === 'date') return escapeHtml(formatDate(value));
  if (type === 'list') return escapeHtml(Array.isArray(value) ? value.join(', ') : value);
  if (type === 'bool') return (value === true || value === 'true') ? 'Confirmed' : 'Not confirmed';
  return escapeHtml(value);
}

function renderDataSections(data) {
  return FIELD_GROUPS.map(group => `
    <h3>${escapeHtml(group.title)}</h3>
    <table>
      <tbody>
        ${group.fields.map(([key, label, type]) => `
          <tr><th style="width:40%">${escapeHtml(label)}</th><td>${renderFieldValue(data[key], type)}</td></tr>
        `).join('')}
      </tbody>
    </table>
  `).join('');
}

function renderDocuments(documents, requestId) {
  if (documents.length === 0) return '<p class="muted">No documents uploaded.</p>';
  return `<ul class="doc-list">${documents.map(d => `
    <li>
      <a href="/api/requests/${requestId}/documents/${d.id}" target="_blank">${escapeHtml(d.original_name)}</a>
      <span class="muted"> &mdash; ${d.category === 'risk_assessment' ? 'Risk assessment' : 'Supporting document'}, ${(d.size_bytes / 1024).toFixed(0)} KB</span>
    </li>
  `).join('')}</ul>`;
}

function renderApprovals(approvals) {
  if (approvals.length === 0) return '<p class="muted">No approval actions recorded yet.</p>';
  return `<ul class="audit-list">${approvals.map(a => `
    <li>
      <strong>${a.action === 'approved' ? 'Approved' : 'Rejected'}</strong> by ${escapeHtml(a.approver_name)} (stage ${a.stage_sequence})
      ${a.comment ? `<br>${escapeHtml(a.comment)}` : ''}
      <div class="when">${formatDateTime(a.created_at)}</div>
    </li>
  `).join('')}</ul>`;
}

function renderAudit(audit) {
  if (audit.length === 0) return '<p class="muted">No audit history.</p>';
  return `<ul class="audit-list">${audit.map(a => `
    <li>
      ${escapeHtml(a.action.replace(/_/g, ' '))}${a.user_name ? ' by ' + escapeHtml(a.user_name) : ''}
      ${a.detail ? `<br><span class="muted">${escapeHtml(a.detail)}</span>` : ''}
      <div class="when">${formatDateTime(a.created_at)}</div>
    </li>
  `).join('')}</ul>`;
}

async function loadRequest(id) {
  const r = await Api.get(`/api/requests/${id}`);
  const content = document.getElementById('content');

  let actionsHtml = '<div class="actions-row">';
  if (r.canApproveOrReject) {
    actionsHtml += `
      <button class="btn btn-success" id="approve-btn">Approve</button>
      <button class="btn btn-danger" id="reject-btn">Reject</button>
    `;
    if (['Submitted', 'Resubmitted'].includes(r.status)) {
      actionsHtml += `<button class="btn btn-secondary" id="start-review-btn">Mark as under review</button>`;
    }
  }
  if (r.canWithdraw) actionsHtml += `<button class="btn btn-secondary" id="withdraw-btn">Withdraw request</button>`;
  if (r.canResubmit) actionsHtml += `<a class="btn btn-primary" href="resubmit.html?id=${r.id}">Edit and resubmit</a>`;
  actionsHtml += '</div><div id="action-panel"></div>';

  let adminActionsHtml = '';
  if (__currentUser && __currentUser.isAdmin) {
    const btns = [];
    if (['Approved', 'Rejected', 'Withdrawn', 'Completed'].includes(r.status)) btns.push('<button class="btn btn-secondary" id="archive-btn">Archive</button>');
    if (r.status === 'Approved') btns.push('<button class="btn btn-secondary" id="complete-btn">Mark completed</button>');
    if (r.status === 'Archived') btns.push('<button class="btn btn-danger" id="delete-btn">Permanently delete</button>');
    if (btns.length) adminActionsHtml = `<div class="card"><h2>Administration</h2><div class="actions-row">${btns.join('')}</div></div>`;
  }

  content.innerHTML = `
    <div class="card">
      <h1>${escapeHtml(r.reference)} ${statusBadge(r.status)}</h1>
      <p class="muted">Requester: ${escapeHtml(r.requester?.name || '')} (${escapeHtml(r.requester?.email || '')})</p>
      <div id="alert-box"></div>
      ${actionsHtml}
    </div>
    ${adminActionsHtml}
    <div class="card">
      <h2>Submitted information</h2>
      ${renderDataSections(r.data || {})}
    </div>
    <div class="card">
      <h2>Documents</h2>
      ${renderDocuments(r.documents, r.id)}
    </div>
    <div class="card">
      <h2>Approval history</h2>
      ${renderApprovals(r.approvals)}
    </div>
    <div class="card">
      <h2>Audit trail</h2>
      ${renderAudit(r.audit)}
    </div>
  `;

  const alertBox = document.getElementById('alert-box');
  const panel = document.getElementById('action-panel');
  const onError = (err) => { alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`; };

  function showPanel(html) {
    panel.innerHTML = `<div class="card">${html}</div>`;
  }
  function closePanel() { panel.innerHTML = ''; }

  document.getElementById('approve-btn')?.addEventListener('click', () => {
    showPanel(`
      <h2>Approve request</h2>
      <div class="field">
        <label for="approve-comment">Comment (optional)</label>
        <textarea id="approve-comment"></textarea>
      </div>
      <div class="actions-row">
        <button class="btn btn-success" id="confirm-approve-btn">Confirm approval</button>
        <button class="btn btn-secondary" id="cancel-action-btn">Cancel</button>
      </div>
    `);
    document.getElementById('cancel-action-btn').addEventListener('click', closePanel);
    document.getElementById('confirm-approve-btn').addEventListener('click', async () => {
      const comment = document.getElementById('approve-comment').value || undefined;
      try { await Api.post(`/api/requests/${id}/approve`, { comment }); loadRequest(id); }
      catch (e) { onError(e); }
    });
  });

  document.getElementById('reject-btn')?.addEventListener('click', () => {
    showPanel(`
      <h2>Reject request</h2>
      <div class="field">
        <label for="reject-reason">Rejection reason (required)</label>
        <textarea id="reject-reason"></textarea>
      </div>
      <div class="actions-row">
        <button class="btn btn-danger" id="confirm-reject-btn">Confirm rejection</button>
        <button class="btn btn-secondary" id="cancel-action-btn">Cancel</button>
      </div>
    `);
    document.getElementById('cancel-action-btn').addEventListener('click', closePanel);
    document.getElementById('confirm-reject-btn').addEventListener('click', async () => {
      const reason = document.getElementById('reject-reason').value.trim();
      if (!reason) { onError(new Error('A rejection reason is required.')); return; }
      try { await Api.post(`/api/requests/${id}/reject`, { reason }); loadRequest(id); }
      catch (e) { onError(e); }
    });
  });

  document.getElementById('start-review-btn')?.addEventListener('click', async () => {
    try { await Api.post(`/api/requests/${id}/start-review`); loadRequest(id); }
    catch (e) { onError(e); }
  });

  function wireConfirmButton(btnId, question, confirmLabel, confirmClass, onConfirm) {
    document.getElementById(btnId)?.addEventListener('click', () => {
      showPanel(`
        <p>${escapeHtml(question)}</p>
        <div class="actions-row">
          <button class="btn ${confirmClass}" id="confirm-action-btn">${escapeHtml(confirmLabel)}</button>
          <button class="btn btn-secondary" id="cancel-action-btn">Cancel</button>
        </div>
      `);
      document.getElementById('cancel-action-btn').addEventListener('click', closePanel);
      document.getElementById('confirm-action-btn').addEventListener('click', async () => {
        try { await onConfirm(); loadRequest(id); }
        catch (e) { onError(e); }
      });
    });
  }

  wireConfirmButton('withdraw-btn', 'Withdraw this request?', 'Confirm withdrawal', 'btn-secondary',
    () => Api.post(`/api/requests/${id}/withdraw`));
  wireConfirmButton('archive-btn', 'Archive this request?', 'Confirm archive', 'btn-secondary',
    () => Api.post(`/api/admin/requests/${id}/archive`));
  wireConfirmButton('complete-btn', 'Mark this request as completed?', 'Confirm', 'btn-secondary',
    () => Api.post(`/api/admin/requests/${id}/complete`));
  wireConfirmButton('delete-btn', 'Permanently delete this request and its documents? This cannot be undone.', 'Confirm permanent deletion', 'btn-danger',
    () => Api.post(`/api/admin/requests/${id}/delete`));
}

(async () => {
  const me = await initNav();
  if (!me) return;
  const id = new URLSearchParams(location.search).get('id');
  if (!id) { document.getElementById('content').innerHTML = '<div class="card">No request specified.</div>'; return; }
  try {
    await loadRequest(id);
  } catch (err) {
    document.getElementById('content').innerHTML = `<div class="card"><div class="alert alert-error">${escapeHtml(err.message)}</div></div>`;
  }
})();
