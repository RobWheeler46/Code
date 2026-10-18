/* Pre-render the section pages' body content into static HTML for SEO/GEO.
 *
 * section.js fills Beavers/Cubs/Scouts/Explorers from sections.json at runtime,
 * but AI answer-engine crawlers (GPTBot, ClaudeBot, PerplexityBot, …) usually
 * do not run JavaScript and so would see empty section pages. This bakes the
 * same markup section.js produces into the HTML, wrapped in <!--pr:ID--> markers
 * so it is replaced (not duplicated) on re-run. section.js still runs for real
 * visitors and overwrites the identical content, so nothing changes visually.
 *
 * Run `node prerender-sections.js` after editing sections.json.
 * KEEP THE RENDER BELOW IN SYNC WITH section.js.
 */
const fs = require('fs');
const DIR = __dirname;
const data = JSON.parse(fs.readFileSync(`${DIR}/sections.json`, 'utf8'));

// ---- render helpers (mirror of section.js) ----
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const time12 = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}${h >= 12 ? 'pm' : 'am'}`; };
const ICONS = {
  friends: '<path d="M9 11a3 3 0 100-6 3 3 0 000 6zm7 0a3 3 0 100-6 3 3 0 000 6zm-7 2c-2.7 0-5 1.6-5 3.5V19h10v-2.5C14 14.6 11.7 13 9 13zm7 0c-.5 0-1 .05-1.4.14 1 .8 1.6 1.9 1.6 3.36V19h5v-2.5c0-1.9-2.3-3.5-5.2-3.5z"/>',
  skills: '<path d="M12 2l2.4 5 5.5.5-4.2 3.6 1.3 5.4L12 19l-5 3 1.3-5.4L4 13l5.5-.5L12 2z" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  compass: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M15.5 8.5l-2 5-5 2 2-5 5-2z" fill="currentColor"/>',
  target: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>',
  star: '<path d="M12 3l2.6 5.9 6.4.6-4.8 4.3 1.4 6.2L12 17l-5.6 3 1.4-6.2L3 9.5l6.4-.6L12 3z" fill="currentColor"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[k] || ICONS.star}</svg>`;
const acc = (title, body) => `<details class="sec-acc"><summary>${esc(title)}</summary><div class="sec-acc-body">${body}</div></details>`;
function card(s) {
  const name = s.publicName && s.publicName !== s.type ? s.publicName : s.type;
  const when = s.meetingDay ? `${esc(s.meetingDay)} · ${esc(time12(s.startTime))} to ${esc(time12(s.endTime))}` : 'Day varies, contact us';
  const where = s.locality ? esc(s.locality) : 'Area confirmed on contact';
  const avail = s.availabilityStatus ? `<span class="sec-avail">${esc(s.availabilityStatus)}</span>` : '';
  return `<article class="sec-card sec-${s.type.toLowerCase()}"><div class="sec-card-head"><h3>${esc(name)}</h3>${avail}</div>
      <dl class="sec-detail"><div><dt>When</dt><dd>${when}</dd></div><div><dt>Where</dt><dd>${where}</dd></div></dl></article>`;
}

function blocks(type) {
  const t = (data.sectionTypes || {})[type];
  if (!t) return null;
  const meetings = (data.sections || []).filter((s) => s.active && s.type === type);
  const out = {
    'sec-tagline': esc(t.tagline || ''),
    'sec-intro': esc(t.intro || ''),
    'sec-benefits': t.benefits ? t.benefits.map((b) => `<li class="sec-benefit"><span class="sec-benefit-icon">${icon(b.icon)}</span><span>${esc(b.label)}</span></li>`).join('') : '',
    'sec-activities': t.activities ? t.activities.map((a) => `<li><span class="sec-check" aria-hidden="true">✓</span>${esc(a)}</li>`).join('') : '',
    'sec-meetings': meetings.length ? `<div class="sec-cards">${meetings.map(card).join('')}</div>` : '',
    'sec-details': t.details ? Object.entries(t.details).map(([k, v]) => acc(k, `<p>${esc(v)}</p>`)).join('') : '',
    'sec-faqs': (t.faqs && t.faqs.length) ? t.faqs.map((f) => acc(f.q, `<p>${esc(f.a)}</p>`)).join('') : '',
  };
  if (t.partnership && t.units) {
    out['sec-units'] = `<div class="sec-units">${t.units.map((u) => `<div class="sec-unit"><strong>${esc(u.name)}</strong><span>${esc(u.detail)}</span></div>`).join('')}</div>`;
  }
  return out;
}

function inject(html, id, content) {
  if (!content) return html;
  const wrapped = `<!--pr:${id}-->${content}<!--/pr:${id}-->`;
  const markerRe = new RegExp(`<!--pr:${id}-->[\\s\\S]*?<!--/pr:${id}-->`);
  if (markerRe.test(html)) return html.replace(markerRe, wrapped);
  return html.replace(new RegExp(`(id="${id}"[^>]*>)`), `$1${wrapped}`);
}

const FILES = ['beavers.html', 'cubs.html', 'scouts.html', 'explorers.html'];
for (const file of FILES) {
  const p = `${DIR}/${file}`;
  let html = fs.readFileSync(p, 'utf8');
  const type = (html.match(/data-section-type="([^"]+)"/) || [])[1];
  const b = type && blocks(type);
  if (!b) { console.log(`${file}: no section type / data — skipped`); continue; }
  let filled = 0;
  for (const [id, content] of Object.entries(b)) {
    if (!content) continue;
    const before = html;
    html = inject(html, id, content);
    if (html !== before) filled++;
  }
  fs.writeFileSync(p, html);
  fs.writeFileSync(`${DIR}/dist/${file}`, html);
  console.log(`${file} (${type}): baked ${filled} blocks (+ dist)`);
}
