// Badges Awarded summary. A Tier A screen: aggregate badge counts per section, broken
// down by badge type, read from the local mirror (osm_badge_summary). Any leader/trustee
// role may view; only a Portal Administrator sees the "Refresh from OSM" control, which
// triggers the paced read. No individual member name or progress is shown here.

let ME = null;
let DATA = null;
const box = () => document.getElementById('content');
const esc = (s) => escapeHtml(s == null ? '' : String(s));
const fmt = (dt) => (typeof formatDateTime === 'function' && dt) ? formatDateTime(dt) : (dt || 'never');

const STATUS_LABEL = { ok: 'Synced', needs_verification: 'Check needed', empty: 'No current term', error: 'Not read' };

(async () => {
  ME = await requireUserNav();
  if (!ME) return;
  await load();
})();

function crumbs() {
  return [
    { label: 'Admin', href: 'admin.html' },
    { label: 'Integrations', href: 'admin.html?tab=health' },
    { label: 'OSM', href: 'admin.html?tab=health' },
    { label: 'Badges Awarded' },
  ];
}

async function load() {
  let d;
  try {
    d = await Api.get('/api/osm/badges');
  } catch (e) {
    renderPageHeader({ title: 'Badges Awarded', crumbs: crumbs() });
    box().innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`;
    return;
  }
  DATA = d;
  render();
}

function render() {
  const s = DATA.summary;
  const canRefresh = DATA.canRefresh;
  renderPageHeader({
    title: 'Badges Awarded',
    crumbs: crumbs(),
    description: 'How many badges each section has awarded, counted from Online Scout Manager. Counts only, no individual members.',
    actions: canRefresh ? `<button class="btn" id="osb-refresh">Refresh from OSM</button>` : '',
  });

  const parts = [];
  const src = s.source === 'demo' ? 'demonstration data' : (s.source === 'live' ? 'the live OSM connection' : null);

  if (!s.sections.length) {
    parts.push(`<div class="alert alert-info">No badge summary has been read yet.
      ${canRefresh ? 'Use <strong>Refresh from OSM</strong> above to read the current counts for each section.'
        : 'Ask a Portal Administrator to run the first refresh.'}</div>`);
    box().innerHTML = parts.join('');
    if (canRefresh) wireRefresh();
    return;
  }

  if (s.needsVerification) {
    parts.push(`<div class="alert alert-warning">One or more sections returned badges but no award-count field,
      so their totals may read as zero. This usually means the badge response uses a different field name than
      expected and needs a quick check against a real OSM response. The sections affected are marked
      <span class="osb-status osb-needs_verification">Check needed</span> below.</div>`);
  }

  // Group totals
  parts.push(`<div class="osb-tiles">
    <div class="osb-tile"><div class="n">${s.totals.awarded}</div><div class="l">Badges awarded</div></div>
    <div class="osb-tile"><div class="n">${s.totals.completed}</div><div class="l">Completed</div></div>
    <div class="osb-tile"><div class="n">${s.totals.badges}</div><div class="l">Badges tracked</div></div>
    <div class="osb-tile"><div class="n">${s.sections.length}</div><div class="l">Sections</div></div>
  </div>`);

  // By type across the group
  const types = s.typeOrder || Object.keys(s.byType);
  parts.push('<h3>Awarded by badge type</h3><div class="osb-type-row">' +
    types.map((t) => {
      const v = s.byType[t] || {};
      return `<div class="osb-type"><div class="t">${esc(t)}</div><div class="v">${(v.awarded || 0)}</div></div>`;
    }).join('') + '</div>');

  // Per-section table
  const head = ['Section', 'Term'].concat(types).concat(['Awarded', 'Status']);
  const foot = { awarded: {}, total: 0 };
  types.forEach((t) => foot.awarded[t] = 0);

  const rows = s.sections.map((sec) => {
    const cells = types.map((t) => {
      const n = (sec.byType[t] && sec.byType[t].awarded) || 0;
      foot.awarded[t] += n;
      return `<td class="num">${n}</td>`;
    }).join('');
    foot.total += sec.totalAwarded;
    return `<tr>
      <td>${esc(sec.sectionName)}</td>
      <td>${esc(sec.term || '&mdash;')}</td>
      ${cells}
      <td class="num">${sec.totalAwarded}</td>
      <td><span class="osb-status osb-${esc(sec.status)}">${esc(STATUS_LABEL[sec.status] || sec.status)}</span></td>
    </tr>`;
  }).join('');

  const footCells = types.map((t) => `<td class="num">${foot.awarded[t]}</td>`).join('');
  parts.push(`<div class="osb-table-wrap"><table class="osb-table">
    <thead><tr>${head.map((h, i) => `<th class="${i >= 2 && i < head.length - 1 ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td>All sections</td><td></td>${footCells}<td class="num">${foot.total}</td><td></td></tr></tfoot>
  </table></div>`);

  parts.push(`<p class="osb-meta">Last refreshed ${esc(fmt(s.lastSynced))}${src ? ' from ' + esc(src) : ''}.
    Because Online Scout Manager limits how often it can be read, this screen shows the last saved counts rather than reading live on each visit.</p>`);

  if (canRefresh) {
    parts.push(`<p class="osb-meta"><button class="btn btn-secondary btn-sm" id="osb-diagnose">Inspect the OSM badge response</button>
      <span class="osb-meta"> shows the shape of one section's live badge response, to map the award counts.</span></p>
      <pre id="osb-diag" hidden style="overflow:auto;max-height:24rem;background:var(--surface-2,#f2eef7);padding:.8rem;border-radius:8px;font-size:.78rem;white-space:pre-wrap"></pre>`);
  }

  box().innerHTML = parts.join('');
  if (canRefresh) { wireRefresh(); wireDiagnose(); }
}

function wireDiagnose() {
  const btn = document.getElementById('osb-diagnose');
  const out = document.getElementById('osb-diag');
  if (!btn || !out) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = 'Reading from OSM…';
    try {
      const d = await Api.get('/api/osm/badges/diagnose');
      out.hidden = false;
      out.textContent = JSON.stringify(d.diagnostic, null, 2);
    } catch (e) {
      out.hidden = false;
      out.textContent = 'Diagnostic failed: ' + e.message;
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  });
}

function wireRefresh() {
  const btn = document.getElementById('osb-refresh');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = 'Reading from OSM…';
    try {
      const r = await Api.post('/api/osm/badges/refresh', {});
      DATA.summary = r.summary;
      render();
      const res = r.result || {};
      let msg = `Refreshed ${res.synced || 0} of ${res.sections || 0} sections`;
      if (res.blocked) msg += ' (stopped early because OSM began throttling; previous counts kept for the rest)';
      else if (res.errors) msg += ` (${res.errors} could not be read; their previous counts were kept)`;
      const banner = document.createElement('div');
      banner.className = 'alert ' + (res.blocked ? 'alert-warning' : 'alert-success');
      banner.textContent = msg + '.';
      box().prepend(banner);
    } catch (e) {
      const banner = document.createElement('div');
      banner.className = 'alert alert-error';
      banner.textContent = e.message;
      box().prepend(banner);
      btn.disabled = false;
      btn.textContent = orig;
    }
  });
}
