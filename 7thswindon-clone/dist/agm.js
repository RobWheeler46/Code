/* AGM Documents renderer — 7th Swindon Scouts (FRD Epic K, GOV-002)
 *
 * Renders the AGM page from the public registry (agm.json), newest year first,
 * so publishing a new year's papers is a data edit — add a record (or just a
 * date, ahead of the meeting) and the page picks it up, no markup change.
 * The page heading/intro/nav are static (SEO + no-JS); this fills the year
 * blocks with a calm, consistent document list styled by the .gov-* classes
 * in agm.html.
 */
(function () {
  const mount = document.getElementById('agmYears');
  if (!mount) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const FILE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>';
  const DL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"></path><path d="M8 11l4 4 4-4"></path><path d="M5 21h14"></path></svg>';

  // One document row. `name` is the accessible label so screen-reader users hear
  // which file each "Download" points to, not a row of identical buttons.
  const docRow = (title, file, meta, name) => {
    const action = file
      ? `<a class="gov-dl" href="${esc(file)}" download aria-label="Download ${esc(name)} (PDF)">${DL_ICON}Download</a>`
      : '<span class="gov-soon">Coming soon</span>';
    return `<li class="gov-doc"><span class="gov-doc-icon">${FILE_ICON}</span>` +
      `<span class="gov-doc-info"><span class="gov-doc-title">${esc(title)}</span><span class="gov-doc-meta">${esc(meta)}</span></span>` +
      `${action}</li>`;
  };

  const yearBlock = (y) => {
    const held = y.heldOn ? `<span class="gov-held">Held on ${esc(y.heldOn)}</span>` : '';
    const rows = [];
    const mLabel = (y.minutes && y.minutes.label) || `Annual General Meeting Minutes ${y.year}`;
    rows.push(docRow(mLabel, y.minutes && y.minutes.file, 'Meeting minutes · PDF', mLabel));
    (y.documents || []).forEach((d) => {
      const meta = /report/i.test(d.label || '') ? "Trustees’ report · PDF" : 'Document · PDF';
      rows.push(docRow(d.label, d.file, meta, d.label));
    });
    return `<section class="gov-year"><div class="gov-year-head"><h2>${esc(y.year)}</h2>${held}</div>` +
      `<ul class="gov-docs">${rows.join('')}</ul></section>`;
  };

  const noteBlock = (email, note) =>
    `<div class="gov-note"><p><strong>Transparency.</strong> ${esc(note)} For questions about our governance, contact <a href="mailto:${esc(email)}">${esc(email)}</a>.</p></div>`;

  fetch('agm.json', { cache: 'no-store' })
    .then((r) => { if (!r.ok) throw new Error('registry'); return r.json(); })
    .then((data) => {
      const meta = data.meta || {};
      const email = meta.contactEmail || 'trustees@7thswindon.org.uk';
      const note = meta.transparencyNote || 'AGM documents are published to keep our community informed.';
      const years = (data.years || []).slice().sort((a, b) => (b.year || 0) - (a.year || 0));
      if (!years.length) throw new Error('empty');
      mount.innerHTML = years.map(yearBlock).join('') + noteBlock(email, note);
    })
    .catch(() => {
      mount.innerHTML = '<div class="gov-note"><p>Our AGM documents are available on request. Please contact <a href="mailto:trustees@7thswindon.org.uk">trustees@7thswindon.org.uk</a>.</p></div>';
    });
})();
