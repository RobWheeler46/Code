(async () => {
  const me = await requireUserNav();
  if (!me) return;
  const sectionId = new URLSearchParams(location.search).get('id');
  const content = document.getElementById('content');
  if (!sectionId) { content.innerHTML = '<div class="alert alert-error">No section specified.</div>'; return; }

  try {
    const data = await Api.get(`/api/sections/${encodeURIComponent(sectionId)}/members`);
    if (data.osmUnavailable) { content.innerHTML = osmUnavailableAlert(data.reason); return; }
    if (!data.available) { content.innerHTML = '<div class="alert alert-warning">Member data is not available right now.</div>'; return; }
    if (data.members.length === 0) { content.innerHTML = '<p class="muted">No members found for this section.</p>'; return; }

    content.innerHTML = `<div class="card"><table>
      <thead><tr><th>Name</th><th>Patrol/Six</th><th></th></tr></thead>
      <tbody>${data.members.map(m => `
        <tr>
          <td>${escapeHtml(m.firstName)} ${escapeHtml(m.lastName)}</td>
          <td>${escapeHtml(m.patrol || '')}</td>
          <td><a class="btn btn-secondary btn-sm" href="member.html?section=${encodeURIComponent(sectionId)}&id=${encodeURIComponent(m.id)}">View summary</a></td>
        </tr>`).join('')}</tbody>
    </table></div>`;
  } catch (err) {
    content.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  }
})();
