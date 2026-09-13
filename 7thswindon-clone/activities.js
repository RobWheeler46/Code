/* Activity showcase renderer — 7th Swindon Scouts (FRD Epic A, HOME-005)
 *
 * Fills the homepage "What you'll get up to" band from the activities.json
 * registry — a visual grid of what young people actually do at Scouts. No
 * photos required: each tile is an icon on a section-flavoured tint, so the
 * band always renders. Edit activities.json to change the line-up; no code
 * change. Guarded so the shared behaviour is a no-op on other pages.
 */
(function () {
  const grid = document.getElementById('activityGrid');
  if (!grid) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const tile = (a) => {
    const accent = /^#[0-9a-fA-F]{3,6}$/.test(a.accent || '') ? a.accent : '#6d28d9';
    return `<li class="act-tile" style="--act:${accent}">
      <span class="act-icon" aria-hidden="true">${esc(a.icon || '✨')}</span>
      <h3>${esc(a.title)}</h3>
      <p>${esc(a.blurb)}</p>
    </li>`;
  };

  fetch('activities.json', { cache: 'no-store' })
    .then((r) => { if (!r.ok) throw new Error('registry'); return r.json(); })
    .then((data) => {
      const items = data.activities || [];
      if (!items.length) throw new Error('empty');
      const intro = document.getElementById('activityIntro');
      if (intro && data.meta && data.meta.intro) intro.textContent = data.meta.intro;
      grid.innerHTML = items.map(tile).join('');
    })
    .catch(() => {
      const sec = document.getElementById('activityShowcase');
      if (sec) sec.hidden = true;
    });
})();
