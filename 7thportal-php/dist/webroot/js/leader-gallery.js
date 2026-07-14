(async () => {
  const me = await requireUserNav();
  if (!me) return;
  if (me.role === 'parent') { location.href = 'gallery.html'; return; }

  try {
    const sections = await Api.get('/api/leader/gallery/sections');
    const sectionSelect = document.getElementById('a-section');
    sectionSelect.innerHTML = sections.map(s => `<option value="${escapeHtml(s.sectionId)}" data-name="${escapeHtml(s.sectionName)}">${escapeHtml(s.sectionName)}</option>`).join('') || '<option value="">No sections</option>';
  } catch (e) { /* best effort */ }

  document.getElementById('album-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const sectionSelect = document.getElementById('a-section');
    const opt = sectionSelect.selectedOptions[0];
    try {
      const album = await Api.post('/api/leader/gallery/albums', {
        title: document.getElementById('a-title').value,
        groupingType: document.getElementById('a-grouping').value,
        sectionId: opt ? opt.value : null,
        sectionName: opt ? opt.dataset.name : null,
        visibilityScope: document.getElementById('a-scope').value,
      });
      location.href = `album-edit.html?id=${album.id}`;
    } catch (err) {
      document.getElementById('album-error').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });

  await loadList();
})();

async function loadList() {
  const box = document.getElementById('album-list');
  const albums = await Api.get('/api/leader/gallery/albums');
  box.innerHTML = albums.length === 0 ? '<p class="muted">No albums yet.</p>' : `<div class="album-grid">${albums.map(a => `
    <a class="album-tile" href="album-edit.html?id=${a.id}">
      <div class="thumb"></div>
      <div class="info">
        <strong>${escapeHtml(a.title)}</strong><br>
        ${statusBadge(a.status)}
        <span class="muted">${a.photoCount} photo${a.photoCount === 1 ? '' : 's'}</span>
      </div>
    </a>
  `).join('')}</div>`;
}
