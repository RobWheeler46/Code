(async () => {
  const me = await requireUserNav();
  if (!me) return;
  renderActions();
})();

const PRIORITY_BADGE = { High: 'deleted', Medium: 'suspended', Low: 'draft' };

async function renderActions() {
  const box = document.getElementById('content');
  box.innerHTML = '<p class="muted">Loading&hellip;</p>';
  let data;
  try { data = await Api.get('/api/actions'); }
  catch (e) { box.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; return; }
  const s = data.summary;

  box.innerHTML = `
    <div class="cap-stats">
      <div class="card"><div class="muted">High priority</div><div class="cap-big">${s.high}</div></div>
      <div class="card"><div class="muted">Due this week</div><div class="cap-big">${s.dueThisWeek}</div></div>
      <div class="card"><div class="muted">Open actions</div><div class="cap-big">${s.total}</div></div>
    </div>
    <div class="card">
      ${data.items.length ? `<table class="data-table">
        <thead><tr><th>Priority</th><th>Type</th><th>Action</th><th>Owner</th><th>Due</th><th></th></tr></thead>
        <tbody>${data.items.map(i => `
          <tr>
            <td><span class="badge" data-status="${PRIORITY_BADGE[i.priority] || 'draft'}">${i.priority}</span></td>
            <td>${escapeHtml(i.type)}</td>
            <td>${escapeHtml(i.action)}</td>
            <td class="muted">${escapeHtml(i.owner)}</td>
            <td class="muted">${i.due ? formatDate(i.due) : '&mdash;'}</td>
            <td style="white-space:nowrap">
              <a class="btn btn-secondary btn-sm" href="${escapeHtml(i.link)}">${escapeHtml(i.status)}</a>
              ${i.dismissible ? `<button class="btn btn-sm act-dismiss" data-key="${escapeHtml(i.key)}" title="Dismiss">&times;</button>` : ''}
            </td>
          </tr>`).join('')}</tbody>
      </table>` : '<div class="empty-state">Nothing needs your attention right now.</div>'}
    </div>`;

  document.querySelectorAll('.act-dismiss').forEach(b => b.addEventListener('click', async () => {
    try { await Api.post('/api/actions/dismiss', { key: b.dataset.key }); renderActions(); }
    catch (e) { alert(e.message); }
  }));
}
