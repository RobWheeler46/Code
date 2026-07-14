function noteRow(note) {
  return `
    <div class="note-item">
      <div>
        <a href="asset.html?id=${note.assetId}"><strong>${escapeHtml(note.asset ? note.asset.symbol : '#' + note.assetId)}</strong></a>
        - ${escapeHtml(note.noteText)}
      </div>
      ${note.tags.length ? `<div class="tag-list">${note.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
      <div class="when">${formatDateTime(note.createdAt)}</div>
    </div>
  `;
}

async function loadNotes() {
  const tag = document.getElementById('tag-filter').value.trim();
  const qs = tag ? `?tag=${encodeURIComponent(tag)}` : '';
  const notes = await Api.get(`/api/notes${qs}`);
  document.getElementById('notes-list').innerHTML = notes.length
    ? notes.map(noteRow).join('')
    : '<div class="empty-state">No notes yet.</div>';
}

let filterTimer = null;
document.getElementById('tag-filter').addEventListener('input', () => {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(loadNotes, 250);
});

(async () => {
  const me = await initNav();
  if (!me) return;
  await loadNotes();
})();
