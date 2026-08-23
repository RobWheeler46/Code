// Global search (v1, leader-only): live debounced find across the enabled modules
// a leader can access. Results are grouped by type and deep-link to their page.
(async () => {
  const me = await requireUserNav();
  if (!me) return;
  const input = document.getElementById('search-input');
  const content = document.getElementById('content');

  if (!(me.capabilities && me.capabilities.leader)) {
    content.innerHTML = '<div class="alert alert-warning">Search is available to leaders. Parents can find their information from the My Children dashboard.</div>';
    input.disabled = true;
    return;
  }

  let seq = 0;
  async function run(q) {
    q = q.trim();
    if (q.length < 2) {
      content.innerHTML = '<p class="muted">Type at least 2 characters to search across everything you can access.</p>';
      return;
    }
    const mine = ++seq;
    content.innerHTML = '<p class="muted">Searching&hellip;</p>';
    let data;
    try { data = await Api.get('/api/search?q=' + encodeURIComponent(q)); }
    catch (e) { if (mine === seq) content.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; return; }
    if (mine !== seq) return; // a newer keystroke already superseded this one

    if (!data.results.length) {
      content.innerHTML = `<div class="empty-state">Nothing found for &ldquo;${escapeHtml(q)}&rdquo;. Try a different word &mdash; a name, place, category or claim number.</div>`;
      return;
    }
    // Group results by their type label, preserving the backend's category order.
    const groups = [];
    const byType = {};
    data.results.forEach(r => {
      if (!byType[r.typeLabel]) { byType[r.typeLabel] = []; groups.push(r.typeLabel); }
      byType[r.typeLabel].push(r);
    });
    content.innerHTML = `<p class="muted" style="margin:.2rem 0 1rem;">${data.total} result${data.total === 1 ? '' : 's'} for &ldquo;${escapeHtml(q)}&rdquo;</p>` +
      groups.map(g => `
        <h2 style="margin:1rem 0 .5rem;font-size:1.05rem;">${escapeHtml(g)}</h2>
        <div style="display:grid;gap:.6rem;">
          ${byType[g].map(r => `
            <a class="card clickable" href="${escapeHtml(r.link)}" style="margin:0;display:flex;justify-content:space-between;align-items:center;gap:.8rem;">
              <div><strong>${escapeHtml(r.label)}</strong>${r.sublabel ? `<div class="muted" style="font-size:.88rem;">${escapeHtml(r.sublabel)}</div>` : ''}</div>
              <span class="muted" aria-hidden="true">&rsaquo;</span>
            </a>`).join('')}
        </div>`).join('');
  }

  let timer = null;
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => run(input.value), 250); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(timer); run(input.value); } });

  // Deep-linkable: /search.html?q=tent runs the search on load.
  const q0 = new URLSearchParams(location.search).get('q');
  if (q0) { input.value = q0; run(q0); }
  input.focus();
})();
