(async function () {
  const user = await mountNav('notices');
  if (!user) return;
  const list = document.getElementById('list');
  const { notices } = await api('/api/notices');
  if (!notices.length) { list.innerHTML = '<div class="empty">No notices to show.</div>'; return; }
  list.innerHTML = notices.map((n) => `
    <article class="card">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <h2 style="margin:0">${esc(n.title)}</h2>
        <span class="pill ${n.audience}">${n.audience}</span>
        <span class="small muted" style="margin-left:auto">${fmtDate(n.created_at)}</span>
      </div>
      <p style="white-space:pre-wrap;margin:10px 0 0">${esc(n.body)}</p>
    </article>`).join('');
})();
