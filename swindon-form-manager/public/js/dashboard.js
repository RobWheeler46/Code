function renderRequestTable(rows, opts) {
  if (rows.length === 0) return `<div class="empty-state">${opts.emptyMessage}</div>`;
  return `
    <table>
      <thead>
        <tr>
          <th>Reference</th>
          <th>Activity</th>
          ${opts.showRequester ? '<th>Requester</th>' : ''}
          <th>Activity date</th>
          <th>Status</th>
          <th>Submitted</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td>${escapeHtml(r.reference)}</td>
            <td>${escapeHtml(r.title || '(untitled)')}</td>
            ${opts.showRequester ? `<td>${escapeHtml(r.requesterName || '')}</td>` : ''}
            <td>${formatDate(r.activityDate)}</td>
            <td>${statusBadge(r.status)}</td>
            <td>${formatDateTime(r.submittedAt)}</td>
            <td><a class="btn btn-sm btn-secondary" href="request.html?id=${r.id}">View</a></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

async function loadMine() {
  const rows = await Api.get('/api/requests?scope=mine');
  document.getElementById('mine-panel').innerHTML = renderRequestTable(rows, {
    emptyMessage: 'You have not submitted any requests yet.',
    showRequester: false
  });
}

async function loadPending() {
  const rows = await Api.get('/api/requests?scope=pending');
  document.getElementById('pending-panel').innerHTML = renderRequestTable(rows, {
    emptyMessage: 'No requests are currently awaiting your approval.',
    showRequester: true
  });
}

function switchTab(tab) {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('mine-panel').style.display = tab === 'mine' ? '' : 'none';
  document.getElementById('pending-panel').style.display = tab === 'pending' ? '' : 'none';
}

(async () => {
  const me = await initNav();
  if (!me) return;

  const introParts = [];
  if (me.isRequester) introParts.push('submit and track requests');
  if (me.isApprover) introParts.push('review requests awaiting your approval');
  if (me.isAdmin) introParts.push('manage users, groups and forms in the Admin area');
  document.getElementById('intro-text').textContent = introParts.length
    ? `You can ${introParts.join(', ')}.`
    : 'You do not currently belong to any group. Contact an administrator for access.';

  if (me.isRequester) document.getElementById('new-request-btn').style.display = 'inline-block';

  await loadMine();

  if (me.isApprover) {
    document.getElementById('tabs').style.display = 'flex';
    await loadPending();
    document.querySelectorAll('.tabs button').forEach(b => {
      b.addEventListener('click', () => switchTab(b.dataset.tab));
    });
    if (location.hash === '#pending') switchTab('pending');
  }
})();
