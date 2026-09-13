/* Section page renderer — 7th Swindon Scouts (FRD Epic C, v2.3 wireframe)
 *
 * Fills a section landing page (Beavers/Cubs/Scouts/Explorers) from the public
 * registry (sections.json). The page's <title>/meta/canonical and <h1> are
 * static per file for SEO; this enriches the body: tagline, intro, benefits,
 * activities, live meeting options, and progressive-disclosure accordions.
 * Meeting data comes from the same records the finder uses (single source).
 * Core joining path (nav, Find/Join CTAs) is static and works without JS.
 */
(function () {
  const root = document.querySelector('[data-section-type]');
  if (!root) return;
  const type = root.dataset.sectionType;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const time12 = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}${h >= 12 ? 'pm' : 'am'}`; };

  const ICONS = {
    friends: '<path d="M9 11a3 3 0 100-6 3 3 0 000 6zm7 0a3 3 0 100-6 3 3 0 000 6zm-7 2c-2.7 0-5 1.6-5 3.5V19h10v-2.5C14 14.6 11.7 13 9 13zm7 0c-.5 0-1 .05-1.4.14 1 .8 1.6 1.9 1.6 3.36V19h5v-2.5c0-1.9-2.3-3.5-5.2-3.5z"/>',
    skills: '<path d="M12 2l2.4 5 5.5.5-4.2 3.6 1.3 5.4L12 19l-5 3 1.3-5.4L4 13l5.5-.5L12 2z" fill="none" stroke="currentColor" stroke-width="1.6"/>',
    compass: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M15.5 8.5l-2 5-5 2 2-5 5-2z" fill="currentColor"/>',
    target: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>',
    star: '<path d="M12 3l2.6 5.9 6.4.6-4.8 4.3 1.4 6.2L12 17l-5.6 3 1.4-6.2L3 9.5l6.4-.6L12 3z" fill="currentColor"/>'
  };
  const icon = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[k] || ICONS.star}</svg>`;

  const set = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };
  const acc = (title, body) => `<details class="sec-acc"><summary>${esc(title)}</summary><div class="sec-acc-body">${body}</div></details>`;

  function card(s) {
    const name = s.publicName && s.publicName !== s.type ? s.publicName : s.type;
    const when = s.meetingDay ? `${esc(s.meetingDay)} · ${esc(time12(s.startTime))} to ${esc(time12(s.endTime))}` : 'Day varies, contact us';
    const where = s.locality ? esc(s.locality) : 'Area confirmed on contact';
    const avail = s.availabilityStatus ? `<span class="sec-avail">${esc(s.availabilityStatus)}</span>` : '';
    return `<article class="sec-card sec-${s.type.toLowerCase()}"><div class="sec-card-head"><h3>${esc(name)}</h3>${avail}</div>
      <dl class="sec-detail"><div><dt>When</dt><dd>${when}</dd></div><div><dt>Where</dt><dd>${where}</dd></div></dl></article>`;
  }

  fetch('sections.json', { cache: 'no-store' })
    .then((r) => { if (!r.ok) throw new Error('registry'); return r.json(); })
    .then((data) => {
      const t = (data.sectionTypes || {})[type];
      const meetings = (data.sections || []).filter((s) => s.active && s.type === type);
      if (!t) return;

      set('sec-tagline', esc(t.tagline || ''));
      set('sec-intro', esc(t.intro || ''));

      if (t.benefits) set('sec-benefits', t.benefits.map((b) =>
        `<li class="sec-benefit"><span class="sec-benefit-icon">${icon(b.icon)}</span><span>${esc(b.label)}</span></li>`).join(''));

      if (t.activities) set('sec-activities', t.activities.map((a) =>
        `<li><span class="sec-check" aria-hidden="true">✓</span>${esc(a)}</li>`).join(''));

      // Live meeting options (single source with the finder).
      const meetHtml = meetings.length
        ? `<div class="sec-cards">${meetings.map(card).join('')}</div>`
        : '';
      set('sec-meetings', meetHtml);

      // Partnership units (Explorers).
      if (t.partnership && t.units && $('sec-units')) {
        set('sec-units', `<div class="sec-units">${t.units.map((u) =>
          `<div class="sec-unit"><strong>${esc(u.name)}</strong><span>${esc(u.detail)}</span></div>`).join('')}</div>`);
      }

      // Progressive-disclosure detail accordions.
      if (t.details) set('sec-details', Object.entries(t.details).map(([k, v]) => acc(k, `<p>${esc(v)}</p>`)).join(''));

      // Section FAQs (reused pattern).
      if (t.faqs && t.faqs.length) set('sec-faqs', t.faqs.map((f) => acc(f.q, `<p>${esc(f.a)}</p>`)).join(''));
    })
    .catch(() => {
      const note = $('sec-meetings');
      if (note) note.innerHTML = '<p class="sec-fallback">Use <a href="find-your-section.html">Find Your Section</a> to see local meeting options, or <a href="index.html#contact">get in touch</a> and we\'ll help.</p>';
    });
})();
