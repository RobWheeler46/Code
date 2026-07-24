(async function () {
  const user = await mountNav('dashboard');
  if (!user) return;

  document.getElementById('greeting').textContent = `Welcome, ${user.displayName.split(' ')[0]}`;
  const content = document.getElementById('content');

  const data = await api('/api/dashboard');

  const noticeCard = (notices) => `
    <section class="card">
      <h2>Latest notices</h2>
      ${notices.length ? notices.map((n) => `
        <div class="list-item">
          <div class="grow">
            <div><strong>${esc(n.title)}</strong> <span class="pill ${n.audience}">${n.audience}</span></div>
            <div class="small muted">${fmtDate(n.created_at)}</div>
            <div class="small" style="margin-top:4px">${esc(n.body).slice(0, 160)}${n.body.length > 160 ? '…' : ''}</div>
          </div>
        </div>`).join('') : '<div class="empty">No notices yet.</div>'}
      <div style="margin-top:12px"><a class="btn secondary sm" href="/notices">All notices</a></div>
    </section>`;

  if (user.role === 'parent') {
    document.getElementById('subhead').textContent = 'Your children and the latest group notices.';
    content.innerHTML = `
      <section class="card">
        <h2>Your children</h2>
        ${data.children.length ? data.children.map((c) => `
          <div class="list-item">
            <div class="grow">
              <div><strong>${esc(c.name)}</strong> ${c.section ? `<span class="pill">${esc(c.section)}</span>` : ''}</div>
              ${c.osm_link ? `<a class="small" href="${esc(c.osm_link)}" target="_blank" rel="noopener">View in OSM ↗</a>` : '<span class="small muted">No OSM link</span>'}
            </div>
          </div>`).join('') : '<div class="empty">No children are linked to your account yet. Ask a leader or admin to add them.</div>'}
      </section>
      ${noticeCard(data.notices)}`;
  } else {
    const leaderLinks = `
      <section class="card">
        <h2>Leader tools</h2>
        <div class="stack">
          <a class="btn" href="/documents">Document library</a>
          <a class="btn secondary" href="/notices">Group notices</a>
          ${user.role === 'admin' ? '<a class="btn secondary" href="/admin">Admin</a>' : ''}
        </div>
        <p class="hint" style="margin-top:12px">Leaders and admins can view and acknowledge leader-only documents and read all notices.</p>
      </section>`;
    document.getElementById('subhead').textContent = 'Your leader workspace and the latest notices.';
    content.innerHTML = leaderLinks + noticeCard(data.notices);
  }
})();
