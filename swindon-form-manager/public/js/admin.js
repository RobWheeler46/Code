const ALL_STATUSES = ['Draft', 'Submitted', 'Under review', 'Approved', 'Rejected', 'Resubmitted', 'Withdrawn', 'Completed', 'Archived', 'Deleted'];

function switchAdminTab(tab) {
  document.querySelectorAll('#admin-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('requests-tab').style.display = tab === 'requests' ? '' : 'none';
  document.getElementById('users-tab').style.display = tab === 'users' ? '' : 'none';
  document.getElementById('groups-tab').style.display = tab === 'groups' ? '' : 'none';
}

// --- Requests tab ---

async function renderRequestsTab(statusFilter) {
  const tab = document.getElementById('requests-tab');
  const rows = await Api.get(`/api/requests?scope=all${statusFilter ? `&status=${encodeURIComponent(statusFilter)}` : ''}`);

  tab.innerHTML = `
    <h2>All requests</h2>
    <div class="field" style="max-width:260px">
      <label for="status-filter">Filter by status</label>
      <select id="status-filter">
        <option value="">All statuses</option>
        ${ALL_STATUSES.map(s => `<option value="${s}" ${s === statusFilter ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    </div>
    ${rows.length === 0 ? '<div class="empty-state">No requests found.</div>' : `
      <table>
        <thead><tr><th>Reference</th><th>Activity</th><th>Requester</th><th>Status</th><th>Submitted</th><th></th></tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${escapeHtml(r.reference)}</td>
              <td>${escapeHtml(r.title || '(untitled)')}</td>
              <td>${escapeHtml(r.requesterName || '')}</td>
              <td>${statusBadge(r.status)}</td>
              <td>${formatDateTime(r.submittedAt)}</td>
              <td><a class="btn btn-sm btn-secondary" href="request.html?id=${r.id}">View</a></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `}
  `;

  document.getElementById('status-filter').addEventListener('change', (e) => renderRequestsTab(e.target.value));
}

// --- Users tab ---

async function renderUsersTab() {
  const tab = document.getElementById('users-tab');
  const [users, groups] = await Promise.all([Api.get('/api/admin/users'), Api.get('/api/admin/groups')]);

  tab.innerHTML = `
    <h2>Users</h2>
    <div id="user-alert"></div>
    <table>
      <thead><tr><th>Name</th><th>Email</th><th>Admin</th><th>Active</th><th>Groups</th><th></th></tr></thead>
      <tbody>
        ${users.map(u => `
          <tr data-user-id="${u.id}">
            <td>${escapeHtml(u.name)}</td>
            <td>${escapeHtml(u.email)}</td>
            <td>${u.is_admin ? 'Yes' : 'No'}</td>
            <td>${u.active ? 'Yes' : 'No'}</td>
            <td>${u.groups.map(g => `<span class="badge" style="background:${g.type === 'approver' ? '#4472c4' : '#6a2c8f'}">${escapeHtml(g.name)}</span>`).join(' ')}</td>
            <td>
              <button class="btn btn-sm btn-secondary toggle-active" data-id="${u.id}" data-active="${u.active}">${u.active ? 'Deactivate' : 'Activate'}</button>
              <button class="btn btn-sm btn-secondary toggle-admin" data-id="${u.id}" data-admin="${u.is_admin}">${u.is_admin ? 'Remove admin' : 'Make admin'}</button>
            </td>
          </tr>
          <tr>
            <td colspan="6">
              <div style="display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap">
                <select class="group-select" data-user-id="${u.id}" style="width:auto">
                  <option value="">Add to group...</option>
                  ${groups.map(g => `<option value="${g.id}">${escapeHtml(g.name)} (${g.type})</option>`).join('')}
                </select>
                <button class="btn btn-sm btn-secondary add-group" data-id="${u.id}">Add</button>
                ${u.groups.map(g => `<button class="btn btn-sm btn-secondary remove-group" data-id="${u.id}" data-group-id="${g.id}">Remove ${escapeHtml(g.name)}</button>`).join('')}
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <h2 style="margin-top:1.5rem">Add a user</h2>
    <p class="muted">People must be added here, by their OSM email address, before they can sign in &mdash;
      a valid OSM login on its own is not enough to gain access. Once added, they log in with their normal
      OSM email and password; there's no separate password to set here.</p>
    <form id="create-user-form">
      <div class="grid cols-2">
        <div class="field"><label for="new-user-name">Name (optional)</label><input type="text" id="new-user-name"></div>
        <div class="field"><label for="new-user-email">OSM email address</label><input type="email" id="new-user-email" required></div>
        <div class="field">
          <label for="new-user-admin">Administrator?</label>
          <select id="new-user-admin"><option value="">No</option><option value="1">Yes</option></select>
        </div>
      </div>
      <button class="btn btn-primary" type="submit">Add user</button>
    </form>
  `;

  const alertBox = document.getElementById('user-alert');
  const onError = (err) => { alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`; };

  tab.querySelectorAll('.toggle-active').forEach(btn => btn.addEventListener('click', async () => {
    try { await Api.patch(`/api/admin/users/${btn.dataset.id}`, { active: btn.dataset.active !== '1' }); renderUsersTab(); }
    catch (e) { onError(e); }
  }));
  tab.querySelectorAll('.toggle-admin').forEach(btn => btn.addEventListener('click', async () => {
    try { await Api.patch(`/api/admin/users/${btn.dataset.id}`, { isAdmin: btn.dataset.admin !== '1' }); renderUsersTab(); }
    catch (e) { onError(e); }
  }));
  tab.querySelectorAll('.add-group').forEach(btn => btn.addEventListener('click', async () => {
    const select = tab.querySelector(`.group-select[data-user-id="${btn.dataset.id}"]`);
    if (!select.value) return;
    try { await Api.post(`/api/admin/users/${btn.dataset.id}/groups`, { groupId: select.value, action: 'add' }); renderUsersTab(); }
    catch (e) { onError(e); }
  }));
  tab.querySelectorAll('.remove-group').forEach(btn => btn.addEventListener('click', async () => {
    try { await Api.post(`/api/admin/users/${btn.dataset.id}/groups`, { groupId: btn.dataset.groupId, action: 'remove' }); renderUsersTab(); }
    catch (e) { onError(e); }
  }));

  document.getElementById('create-user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await Api.post('/api/admin/users', {
        name: document.getElementById('new-user-name').value,
        email: document.getElementById('new-user-email').value,
        isAdmin: !!document.getElementById('new-user-admin').value
      });
      renderUsersTab();
    } catch (e) { onError(e); }
  });
}

// --- Groups tab ---

async function renderGroupsTab() {
  const tab = document.getElementById('groups-tab');
  const groups = await Api.get('/api/admin/groups');

  tab.innerHTML = `
    <h2>Groups</h2>
    <div id="group-alert"></div>
    <table>
      <thead><tr><th>Name</th><th>Type</th><th>Members</th></tr></thead>
      <tbody>
        ${groups.map(g => `
          <tr><td>${escapeHtml(g.name)}</td><td>${g.type}</td><td>${g.member_count}</td></tr>
        `).join('')}
      </tbody>
    </table>

    <h2 style="margin-top:1.5rem">Add a new group</h2>
    <form id="create-group-form">
      <div class="grid cols-2">
        <div class="field"><label for="new-group-name">Name</label><input type="text" id="new-group-name" required></div>
        <div class="field">
          <label for="new-group-type">Type</label>
          <select id="new-group-type">
            <option value="requester">Requester group</option>
            <option value="approver">Approver group</option>
          </select>
        </div>
      </div>
      <button class="btn btn-primary" type="submit">Create group</button>
    </form>
  `;

  document.getElementById('create-group-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const alertBox = document.getElementById('group-alert');
    try {
      await Api.post('/api/admin/groups', {
        name: document.getElementById('new-group-name').value,
        type: document.getElementById('new-group-type').value
      });
      renderGroupsTab();
    } catch (err) {
      alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });
}

(async () => {
  const me = await initNav();
  if (!me) return;
  if (!me.isAdmin) {
    document.querySelector('.container').innerHTML = '<div class="card"><p>Administrator access required.</p></div>';
    return;
  }

  await renderRequestsTab('');

  document.querySelectorAll('#admin-tabs button').forEach(btn => {
    btn.addEventListener('click', async () => {
      switchAdminTab(btn.dataset.tab);
      if (btn.dataset.tab === 'users') await renderUsersTab();
      if (btn.dataset.tab === 'groups') await renderGroupsTab();
    });
  });
})();
