/* Latest Adventures renderer — 7th Swindon Scouts (FRD Epic H, STORY-001–006)
 *
 * One script, two contexts, both driven by the stories.json registry:
 *   • adventures.html  — a filterable listing + a client-rendered, shareable
 *     detail view (?story=<slug>, back/forward aware). No per-story HTML files,
 *     so publishing a story stays a data edit + redeploy.
 *   • index.html       — a "Latest Adventures" teaser (top few featured stories).
 *
 * Publishing rules are enforced here, not just by convention:
 *   • a story shows only when published === true
 *   • a photo shows only when its approved === true (image-consent gate); with
 *     no approved photo a section-coloured banner is used instead — so the page
 *     never leaks an unapproved image.
 */
(function () {
  const grid = document.getElementById('storyGrid');
  const teaser = document.getElementById('adventuresTeaser');
  if (!grid && !teaser) return;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SECTION_ORDER = ['Beavers', 'Cubs', 'Scouts', 'Explorers'];
  const PALETTE = {
    Beavers: ['#1e88e5', '#6ec6ff'], Cubs: ['#2e7d32', '#66bb6a'],
    Scouts: ['#00897b', '#4db6ac'], Explorers: ['#c62828', '#ef5350']
  };
  const EMOJI = { Beavers: '🌿', Cubs: '🏕️', Scouts: '🧭', Explorers: '🤝' };
  const fallbackPal = ['#6d28d9', '#9c6ef0'];

  const fmtDate = (iso) => {
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return esc(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  // Approved, present hero image → <img>; otherwise a section-coloured banner.
  const banner = (s, tall) => {
    const pal = PALETTE[s.section] || fallbackPal;
    if (s.hero && s.hero.image && s.hero.approved) {
      return `<img class="adv-img${tall ? ' tall' : ''}" src="${esc(s.hero.image)}" alt="${esc(s.hero.alt || '')}" loading="lazy">`;
    }
    return `<div class="adv-ban${tall ? ' tall' : ''}" style="background:linear-gradient(135deg,${pal[0]},${pal[1]})" aria-hidden="true"><span class="adv-ban-emoji">${EMOJI[s.section] || '✨'}</span></div>`;
  };

  const chipRow = (s) => {
    const tags = (s.tags || []).map((t) => `<span class="adv-tag">${esc(t)}</span>`).join('');
    return `<span class="adv-sec adv-sec-${esc((s.section || 'group').toLowerCase())}">${esc(s.section || 'Group')}</span>${tags}`;
  };

  function cardHTML(s) {
    return `<a class="adv-card" href="adventures.html?story=${encodeURIComponent(s.slug)}" data-slug="${esc(s.slug)}">
      ${banner(s)}
      <div class="adv-card-body">
        <div class="adv-meta">${chipRow(s)}</div>
        <h3>${esc(s.title)}</h3>
        <p class="adv-date">${fmtDate(s.date)}</p>
        <p class="adv-sum">${esc(s.summary)}</p>
        <span class="adv-more">Read more <span aria-hidden="true">→</span></span>
      </div>
    </a>`;
  }

  fetch('stories.json', { cache: 'no-store' })
    .then((r) => { if (!r.ok) throw new Error('registry'); return r.json(); })
    .then((data) => {
      const all = (data.stories || [])
        .filter((s) => s.published)
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));

      if (teaser) return renderTeaser(all);
      renderAdventures(all);
    })
    .catch(() => {
      if (teaser) { const sec = document.getElementById('latestAdventures'); if (sec) sec.hidden = true; return; }
      if (grid) grid.innerHTML = '<p class="adv-empty">Our latest stories will appear here soon. In the meantime, <a href="index.html#contact">say hello</a> and we\'d love to tell you what we\'ve been up to.</p>';
    });

  /* ---------- Homepage teaser ---------- */
  function renderTeaser(all) {
    const featured = all.filter((s) => s.featured);
    const pick = (featured.length ? featured : all).slice(0, 3);
    if (!pick.length) { const sec = document.getElementById('latestAdventures'); if (sec) sec.hidden = true; return; }
    teaser.innerHTML = pick.map(cardHTML).join('');
  }

  /* ---------- Adventures listing + detail ---------- */
  function renderAdventures(all) {
    const filterBar = document.getElementById('storyFilter');
    const article = document.getElementById('storyArticle');
    const listView = document.getElementById('storyList');
    const canonical = document.querySelector('link[rel="canonical"]');
    const baseTitle = document.title;
    const baseCanonical = canonical ? canonical.getAttribute('href') : null;
    const bySlug = Object.fromEntries(all.map((s) => [s.slug, s]));
    let activeSection = 'All';

    const sectionsPresent = SECTION_ORDER.filter((sec) => all.some((s) => s.section === sec));

    function paintGrid() {
      const list = activeSection === 'All' ? all : all.filter((s) => s.section === activeSection);
      grid.innerHTML = list.length ? list.map(cardHTML).join('')
        : '<p class="adv-empty">No adventures in this section yet. Try another, or <a href="adventures.html">see them all</a>.</p>';
    }

    function paintFilter() {
      if (!filterBar) return;
      const opts = ['All'].concat(sectionsPresent);
      filterBar.innerHTML = opts.map((o) =>
        `<button type="button" class="adv-filter${o === activeSection ? ' is-active' : ''}" data-sec="${esc(o)}" aria-pressed="${o === activeSection}">${esc(o)}</button>`
      ).join('');
    }

    function showList(section) {
      if (section) activeSection = section;
      if (article) { article.hidden = true; article.innerHTML = ''; }
      if (listView) listView.hidden = false;
      document.title = baseTitle;
      if (canonical && baseCanonical) canonical.setAttribute('href', baseCanonical);
      paintFilter();
      paintGrid();
    }

    function showDetail(slug, push) {
      const s = bySlug[slug];
      if (!s) return showList();
      if (listView) listView.hidden = true;
      if (article) {
        article.hidden = false;
        article.innerHTML = `
          <a class="adv-back" href="adventures.html">← All adventures</a>
          <div class="adv-article-head">
            <div class="adv-meta">${chipRow(s)}</div>
            <h1>${esc(s.title)}</h1>
            <p class="adv-date">${fmtDate(s.date)}</p>
          </div>
          ${banner(s, true)}
          <div class="adv-article-body">${(s.body || []).map((p) => `<p>${esc(p)}</p>`).join('')}</div>
          <div class="adv-article-foot">
            <a class="adv-back" href="adventures.html">← All adventures</a>
            <a class="adv-cta" href="find-your-section.html">Fancy joining in? Find your section →</a>
          </div>`;
      }
      document.title = `${s.title} · Latest Adventures · 7th Swindon Scouts`;
      if (canonical) canonical.setAttribute('href', `https://www.7thswindon.org.uk/adventures.html?story=${encodeURIComponent(slug)}`);
      window.scrollTo({ top: 0, behavior: 'auto' });
      if (push) history.pushState({ slug }, '', `adventures.html?story=${encodeURIComponent(slug)}`);
    }

    // Filter clicks
    if (filterBar) filterBar.addEventListener('click', (e) => {
      const b = e.target.closest('.adv-filter');
      if (!b) return;
      activeSection = b.dataset.sec;
      showList();
    });

    // Card clicks → client-side detail (progressive enhancement over the real href)
    grid.addEventListener('click', (e) => {
      const card = e.target.closest('.adv-card');
      if (!card || e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
      e.preventDefault();
      showDetail(card.dataset.slug, true);
    });
    if (article) article.addEventListener('click', (e) => {
      const back = e.target.closest('.adv-back');
      if (!back) return;
      e.preventDefault();
      activeSection = 'All';
      history.pushState({}, '', 'adventures.html');
      showList();
    });

    window.addEventListener('popstate', () => {
      const slug = new URLSearchParams(location.search).get('story');
      if (slug && bySlug[slug]) showDetail(slug, false); else showList();
    });

    // Initial route from the URL (deep-link / refresh on a story).
    const initial = new URLSearchParams(location.search).get('story');
    paintFilter();
    paintGrid();
    if (initial && bySlug[initial]) showDetail(initial, false); else showList();
  }
})();
