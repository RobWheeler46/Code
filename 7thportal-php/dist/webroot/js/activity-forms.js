// Activity Approval forms - list (my forms + forms awaiting my approval).
(async () => {
  const me = await requireUserNav();
  if (!me) return;
  const box = document.getElementById('content');
  let data;
  try { data = await Api.get('/api/activity/forms'); }
  catch (e) { box.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; return; }

  if (data.canComplete) {
    document.getElementById('af-head').innerHTML = '<button class="btn" id="af-new">New form</button>';
    document.getElementById('af-new').addEventListener('click', async () => {
      try { const f = await Api.post('/api/activity/forms', {}); location.href = 'activity-form.html?id=' + f.id; }
      catch (e) { alert(e.message); }
    });
  }

  const badge = (r) => `<span class="badge" data-status="${STATUS_KEY[r.status] || 'draft'}">${escapeHtml(r.statusLabel)}</span>`;
  const table = (rows) => `<table class="data-table rcards">
    <thead><tr><th>Ref</th><th>Activity</th><th>Date</th><th>Section(s)</th><th>Status</th></tr></thead>
    <tbody>${rows.map(r => `<tr class="af-row clickable" data-id="${r.id}">
      <td data-label="Ref"><strong>${escapeHtml(r.reference)}</strong></td>
      <td data-label="Activity" class="rcard-title">${escapeHtml(r.activityDescription || '(untitled)')}</td>
      <td data-label="Date" class="muted">${r.activityDate ? formatDate(r.activityDate) : '—'}</td>
      <td data-label="Section(s)" class="muted">${escapeHtml(r.sectionNames || '—')}</td>
      <td data-label="Status">${badge(r)}</td>
    </tr>`).join('')}</tbody></table>`;

  box.innerHTML = `
    ${data.inbox.length ? `<div class="card card-accent accent-yellow"><h2>Awaiting your approval (${data.inbox.length})</h2>${table(data.inbox)}</div>` : ''}
    <div class="card"><h2>My forms</h2>${data.mine.length ? table(data.mine) : '<p class="muted">No forms yet. Start a new Activity Approval form to get going.</p>'}</div>`;

  document.querySelectorAll('.af-row').forEach(r => r.addEventListener('click', () => location.href = 'activity-form.html?id=' + r.dataset.id));
})();

const STATUS_KEY = { draft: 'suspended', awaiting_section: 'pending_approval', awaiting_glv: 'pending_approval', approved: 'active', rejected: 'deleted', more_info: 'suspended' };
