/* AGM Documents renderer — 7th Swindon Scouts (FRD Epic K, GOV-002)
 *
 * Renders the AGM page from the public registry (agm.json), newest year first,
 * so publishing a new year's papers is a data edit — add a record (or just a
 * date, ahead of the meeting) and the page picks it up, no markup change.
 * The page heading/intro/nav are static (SEO + no-JS); this fills the year
 * blocks. Reuses the site's existing Tailwind card classes, so no new CSS.
 */
(function () {
  const mount = document.getElementById('agmYears');
  if (!mount) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const DL_ICON = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>';
  const DL_ICON_SM = DL_ICON.replace('w-5 h-5', 'w-4 h-4');

  const minutesBlock = (y) => {
    const title = esc((y.minutes && y.minutes.label) || `Annual General Meeting Minutes ${y.year}`);
    const held = y.heldOn ? `<p class="text-gray-600 mb-6">Held on ${esc(y.heldOn)}</p>` : '';
    const action = y.minutes && y.minutes.file
      ? `<a href="${esc(y.minutes.file)}" download="" class="inline-flex items-center gap-2 bg-purple-600 text-white px-8 py-3 rounded-full font-semibold hover:bg-purple-700 transition-colors">${DL_ICON}Download PDF</a>`
      : `<p class="text-gray-500 italic">Minutes will be published here after the meeting.</p>`;
    return `<div class="bg-white rounded-3xl shadow-lg hover:shadow-2xl hover:-translate-y-2 transition-all overflow-hidden mb-6"><div class="h-1.5 bg-gradient-to-r from-purple-600 to-blue-600"></div><div class="p-8"><h2 class="text-2xl font-bold text-purple-600 mb-6">📄 ${title}</h2>${held}${action}</div></div>`;
  };

  const docsBlock = (y) => {
    if (!y.documents || !y.documents.length) return '';
    const items = y.documents.map((d) => `<div class="bg-white rounded-3xl shadow-lg hover:shadow-2xl hover:-translate-y-2 transition-all overflow-hidden"><div class="h-1.5 bg-gradient-to-r from-green-500 to-blue-500"></div><div class="p-8"><div class="flex items-center justify-between"><h4 class="text-xl font-bold text-gray-900">${esc(d.label)}</h4>${d.file ? `<a href="${esc(d.file)}" download="" class="inline-flex items-center gap-2 bg-green-600 text-white px-6 py-2 rounded-full font-semibold hover:bg-green-700 transition-colors">${DL_ICON_SM}PDF</a>` : '<span class="text-gray-500 italic text-sm">Coming soon</span>'}</div></div></div>`).join('');
    return `<div class="space-y-4"><h3 class="text-lg font-bold text-gray-900 px-2">📎 Supporting Documents</h3>${items}</div>`;
  };

  const transparency = (email, note) => `<div class="mt-8 bg-blue-50 border-l-4 border-blue-500 p-6 rounded-lg"><p class="text-sm text-gray-700"><strong>Transparency:</strong> ${esc(note)} For questions, contact <a href="mailto:${esc(email)}" class="text-blue-600 hover:text-blue-700 font-semibold">${esc(email)}</a></p></div>`;

  fetch('agm.json', { cache: 'no-store' })
    .then((r) => { if (!r.ok) throw new Error('registry'); return r.json(); })
    .then((data) => {
      const meta = data.meta || {};
      const email = meta.contactEmail || 'glv@7thswindon.org.uk';
      const note = meta.transparencyNote || 'AGM documents are published to keep our community informed.';
      const years = (data.years || []).slice().sort((a, b) => (b.year || 0) - (a.year || 0));
      if (!years.length) throw new Error('empty');
      mount.innerHTML = years.map((y) =>
        `<div>${minutesBlock(y)}${docsBlock(y)}${transparency(email, note)}</div>`
      ).join('');
    })
    .catch(() => {
      mount.innerHTML = '<div class="bg-blue-50 border-l-4 border-blue-500 p-6 rounded-lg"><p class="text-sm text-gray-700">Our AGM documents are available on request, please contact <a href="mailto:glv@7thswindon.org.uk" class="text-blue-600 hover:text-blue-700 font-semibold">glv@7thswindon.org.uk</a>.</p></div>';
    });
})();
