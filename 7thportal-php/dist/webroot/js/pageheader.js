// Canonical PageHeader + breadcrumb component (FRD v3.0 §5.3/§5.5, FR-UX-001..004).
// One shared page anatomy for every screen: an optional hierarchy breadcrumb, a single
// H1, optional workflow status beside the H1, an optional role/context chip shown
// SEPARATELY from the breadcrumb, an optional lede description, and a right-aligned
// actions slot. Root destinations (Today, Actions, Sections, Search, Notifications)
// take no breadcrumb; second-level/object screens do.
//
// Labels come from one canonical registry so navigation, breadcrumbs, H1 titles and
// deep-link crumbs never drift apart (resolves gap G52 — Dashboard/Home,
// Action Centre/Actions, Event Hub/Events & Camps etc.).

const PORTAL_LABELS = {
  today: 'Today',
  actions: 'Actions',
  search: 'Search',
  notifications: 'Notifications',
  notices: 'Notices',
  sections: 'Sections',
  children: 'My Children',
  events: 'Events & Camps',
  calendar: 'Calendar',
  attendance: 'Attendance',
  activity: 'Activity Approval',
  patrolPoints: 'Patrol Points',
  gallery: 'Photo Gallery',
  finance: 'Finance',
  claims: 'Claims',
  payments: 'Payments',
  documents: 'Documents',
  incidents: 'Incidents',
  equipment: 'Equipment',
  bookings: 'Bookings',
  treasurer: 'Treasurer',
  governance: 'Trustee dashboard',
  admin: 'Admin',
  privacy: 'Privacy notice',
};

// The Today home differs by active view; callers usually pass an explicit crumb, but
// this keeps the "up to home" target correct for a given user.
function portalHome(me) {
  const view = me && (me.activeView || (me.role === 'parent' ? 'parent' : 'leader'));
  return { label: PORTAL_LABELS.today, href: view === 'parent' ? 'parent-dashboard.html' : 'leader-dashboard.html' };
}

// Workflow-status tone -> the shared .badge[data-status] tint vocabulary. Pages pass a
// plain tone (ready/pending/attention/blocked/neutral) so the header owns the visual
// mapping rather than each page hand-picking a data-status key.
const PH_TONE = { ready: 'active', pending: 'pending_approval', attention: 'suspended', blocked: 'deleted', neutral: 'draft' };

function phEsc(s) { return (typeof escapeHtml === 'function') ? escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s); }

// Build one breadcrumb trail. Each crumb is {label, href?}. The final crumb is the
// current page and is never a link (FR-UX-002). Earlier crumbs link only when href is
// given (omit href where the user/context is no longer authorised for that level).
function phCrumbHtml(crumbs) {
  if (!crumbs || !crumbs.length) return '';
  const last = crumbs.length - 1;
  const trail = crumbs.map((c, i) => {
    const label = phEsc(c.label);
    if (i === last || !c.href) return `<span class="bc-here"${i === last ? ' aria-current="page"' : ''}>${label}</span>`;
    return `<a href="${phEsc(c.href)}">${label}</a>`;
  }).join('<span class="bc-sep" aria-hidden="true">&rsaquo;</span>');
  // Mobile compresses a long trail to "Back to <parent>" (FR-UX-004); both are rendered
  // and CSS shows the one that fits the width.
  const parent = crumbs[crumbs.length - 2];
  const back = parent && parent.href
    ? `<a class="bc-back" href="${phEsc(parent.href)}"><span aria-hidden="true">&lsaquo;</span> ${phEsc(parent.label)}</a>`
    : '';
  return `<nav class="breadcrumb" aria-label="Breadcrumb">${back}<span class="bc-trail">${trail}</span></nav>`;
}

// Render the canonical header into a mount. Options:
//   crumbs:      [{label, href?}, ...]  breadcrumb trail (omit/empty for root pages)
//   title:       string                 the single H1 (required)
//   status:      {label, tone}          workflow status shown beside the H1
//   context:     string                 role/section context chip, shown separately
//   description: string (HTML allowed)  short lede under the header
//   actions:     string (HTML)          right-aligned primary/secondary actions
//   mount:       element|selector        where to render (default: first .container)
// Returns the header element so callers can wire buttons in the actions slot.
function renderPageHeader(opts) {
  opts = opts || {};
  const host = (typeof opts.mount === 'string' ? document.querySelector(opts.mount) : opts.mount)
    || document.querySelector('.app-main .container')
    || document.querySelector('.container');
  if (!host) return null;

  let header = host.querySelector(':scope > .page-header');
  if (!header) {
    header = document.createElement('div');
    header.className = 'page-header';
    host.prepend(header);
  }
  const status = opts.status
    ? `<span class="badge" data-status="${PH_TONE[opts.status.tone] || 'draft'}">${phEsc(opts.status.label)}</span>`
    : '';
  const context = opts.context ? `<span class="ph-context">${phEsc(opts.context)}</span>` : '';
  const description = opts.description ? `<p class="ph-desc muted">${opts.description}</p>` : '';
  const actions = opts.actions ? `<div class="ph-actions">${opts.actions}</div>` : '';

  header.innerHTML = `
    ${phCrumbHtml(opts.crumbs)}
    <div class="ph-row">
      <div class="ph-titlewrap">
        <div class="ph-titleline"><h1 class="ph-title">${phEsc(opts.title)}</h1>${status}</div>
        ${context}
      </div>
      ${actions}
    </div>
    ${description}
  `;
  document.title = `${opts.title} - 7thPortal`;
  return header;
}

// Declarative headers for the straightforward landing/list pages, so they need no
// per-page JS - just this one canonical source of title/description/breadcrumb.
// Pages with a dynamic record title (detail/object screens) render their own header
// in their page script instead and are absent here. crumbs omitted => a root/domain
// landing with no breadcrumb (Today, Actions, Sections, domain roots).
const PAGE_HEADERS = {
  'action-centre.html': { title: 'Actions', description: 'Everything across the portal that needs you, gathered in one place.' },
  'notifications.html': { title: 'Notifications', description: 'Updates and reminders. Anything needing a decision also appears in Actions.' },
  'notices.html': { title: 'Notices', description: 'Published notices for you and your sections.' },
  'search.html': { title: 'Search' },
  'documents.html': { title: 'Documents', description: 'The leader document library. Acknowledge published policies and templates here.' },
  'expenses.html': { title: 'Expenses & mileage', description: 'Your claims, receipts and mileage. Submit for approval and track payment status.' },
  'treasurer.html': { title: 'Treasurer', description: 'Approved items awaiting payment, payment recording and finance exports.' },
  'governance.html': { title: 'Trustee dashboard', description: 'Board-level finance oversight and exceptions.' },
  'trustee-dashboard.html': { title: 'Trustee dashboard', description: 'Board-level finance oversight and exceptions.' },
  'patrol-leaderboard.html': { title: 'Patrol Points' },
  'equipment-labels.html': { title: 'Equipment labels', crumbs: [{ label: 'Equipment', href: 'equipment.html' }, { label: 'Labels' }] },
  'admin.html': { title: 'Admin', description: 'Organisational configuration and support. Personal account settings live outside Admin.' },
  // Prepare Tonight is retired from primary navigation (v3.0 §1.2); its content now
  // rides on Today. The page stays reachable as a deep link under Today > Tonight.
  'prepare-tonight.html': { title: 'Tonight', crumbs: [{ label: 'Today', href: 'leader-dashboard.html' }, { label: 'Tonight' }], description: 'Everything for your next section night in one place.' },
  'leader-gallery.html': { title: 'Photo gallery', description: 'Create albums, upload photos and publish to families once an album is approved.' },
  'gallery.html': { title: 'Photo gallery', description: 'Photos shared with your family for private viewing.' },
};

// Auto-render the header for a registry-covered page. Called by requireUserNav after the
// nav is drawn. Dynamic pages (not in the registry) are left to their own page script.
function autoPageHeader() {
  const page = location.pathname.split('/').pop() || 'index.html';
  const spec = PAGE_HEADERS[page];
  if (spec) renderPageHeader(spec);
}

// Update just the current (last) breadcrumb label + H1 in place, for SPA pages that
// render a list then a record detail without a full re-render. Pass the new record
// label; optionally a new status/title.
function setPageHeaderRecord(label, opts) {
  opts = opts || {};
  const header = document.querySelector('.page-header');
  if (!header) return;
  const here = header.querySelector('.bc-trail .bc-here[aria-current], .bc-trail .bc-here:last-child');
  if (here) here.textContent = label;
  const h1 = header.querySelector('.ph-title');
  if (h1 && (opts.title || label)) h1.textContent = opts.title || label;
  if (opts.status !== undefined) {
    const line = header.querySelector('.ph-titleline');
    const old = line && line.querySelector('.badge');
    if (old) old.remove();
    if (opts.status && line) {
      const b = document.createElement('span');
      b.className = 'badge';
      b.setAttribute('data-status', PH_TONE[opts.status.tone] || 'draft');
      b.textContent = opts.status.label;
      line.appendChild(b);
    }
  }
  if (opts.title || label) document.title = `${opts.title || label} - 7thPortal`;
}
