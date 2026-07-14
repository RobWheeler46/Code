(async () => {
  const me = await requireUserNav();
  if (!me) return;
  if (me.role !== 'parent') { location.href = 'leader-gallery.html'; return; }

  const content = document.getElementById('content');
  const albumId = new URLSearchParams(location.search).get('album');
  try {
    if (albumId) await renderAlbum(albumId);
    else await renderAlbumList();
  } catch (err) {
    content.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  }
})();

async function renderAlbumList() {
  const content = document.getElementById('content');
  const albums = await Api.get('/api/gallery/albums');
  if (albums.length === 0) {
    content.innerHTML = '<div class="empty-state">No photo albums are available to you yet.</div>';
    return;
  }
  content.innerHTML = `<h1>Photo gallery</h1><div class="album-grid">${albums.map(a => `
    <a class="album-tile" href="gallery.html?album=${a.id}">
      ${a.photos[0] ? `<img class="thumb" src="/api/gallery/photos/${a.photos[0].id}/image" alt="" oncontextmenu="return false" draggable="false">` : '<div class="thumb"></div>'}
      <div class="info">
        <strong>${escapeHtml(a.title)}</strong>
        <span class="muted">${a.photos.length} photo${a.photos.length === 1 ? '' : 's'}${a.sectionName ? ' &middot; ' + escapeHtml(a.sectionName) : ''}</span>
      </div>
    </a>
  `).join('')}</div>`;
}

async function renderAlbum(albumId) {
  const content = document.getElementById('content');
  const album = await Api.get(`/api/gallery/albums/${albumId}`);
  content.innerHTML = `
    <p><a href="gallery.html">&larr; Back to photo gallery</a></p>
    <h1>${escapeHtml(album.title)}</h1>
    <p class="muted">${escapeHtml(album.sectionName || '')}${album.groupingLabel ? ' &middot; ' + escapeHtml(album.groupingLabel) : ''}</p>
    <div class="photo-grid">${album.photos.map((p, i) => `
      <div class="photo-tile"><img data-open="${i}" src="/api/gallery/photos/${p.id}/image" alt="" oncontextmenu="return false" draggable="false"></div>
    `).join('')}</div>
  `;
  const photos = album.photos;
  content.querySelectorAll('[data-open]').forEach(img => {
    img.style.cursor = 'pointer';
    img.addEventListener('click', () => openLightbox(photos, Number(img.dataset.open)));
  });
}

function openLightbox(photos, index) {
  let i = index;
  const backdrop = document.createElement('div');
  backdrop.className = 'lightbox-backdrop';
  document.body.appendChild(backdrop);

  function render() {
    backdrop.innerHTML = `
      <button class="lightbox-close" aria-label="Close">&times;</button>
      ${photos.length > 1 ? '<button class="lightbox-nav prev" aria-label="Previous">&lsaquo;</button>' : ''}
      <img src="/api/gallery/photos/${photos[i].id}/image" alt="" oncontextmenu="return false" draggable="false">
      ${photos.length > 1 ? '<button class="lightbox-nav next" aria-label="Next">&rsaquo;</button>' : ''}
      <div class="lightbox-caption">${i + 1} of ${photos.length} &middot; private viewing only, please don't share</div>
    `;
    backdrop.querySelector('.lightbox-close').addEventListener('click', close);
    const prev = backdrop.querySelector('.lightbox-nav.prev');
    const next = backdrop.querySelector('.lightbox-nav.next');
    if (prev) prev.addEventListener('click', () => { i = (i - 1 + photos.length) % photos.length; render(); });
    if (next) next.addEventListener('click', () => { i = (i + 1) % photos.length; render(); });
  }
  function close() { backdrop.remove(); document.removeEventListener('keydown', onKey); }
  function onKey(e) {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft' && photos.length > 1) { i = (i - 1 + photos.length) % photos.length; render(); }
    if (e.key === 'ArrowRight' && photos.length > 1) { i = (i + 1) % photos.length; render(); }
  }
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey);
  render();
}
