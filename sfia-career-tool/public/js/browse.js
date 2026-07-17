let allFamilies = [];
let allAreas = [];

const ROLE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

function renderHomeHero() {
  document.getElementById('home-hero').innerHTML = `
    <section class="hero">
      <h1>Explore roles, compare skills and plan your growth</h1>
      <p>Discover opportunities, understand the skills you need and take the next step in your career journey.</p>
      <div class="hero-search field" style="margin-bottom:0;">
        <input type="search" id="search" placeholder="Search for a role" aria-label="Search for a role">
      </div>
      ${heroIllustrationSvg()}
    </section>
  `;
}

function renderActionGrid() {
  document.getElementById('action-grid').innerHTML = `
    <div class="action-grid">
      <a class="action-card" href="#roles-heading">
        <span class="icon-tile">${ROLE_ICON}</span>
        <span class="action-body"><strong>Browse roles</strong><span>Explore roles and find the right fit.</span></span>
        <span class="chev">&rsaquo;</span>
      </a>
      <a class="action-card" href="compare.html">
        <span class="icon-tile"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/></svg></span>
        <span class="action-body"><strong>Compare roles</strong><span>Compare roles side by side.</span></span>
        <span class="chev">&rsaquo;</span>
      </a>
      <a class="action-card" href="pathways.html">
        <span class="icon-tile"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h6a4 4 0 0 0 4-4V8"/></svg></span>
        <span class="action-body"><strong>Career pathways</strong><span>Discover pathways to reach your goals.</span></span>
        <span class="chev">&rsaquo;</span>
      </a>
    </div>
  `;
}

async function loadFilters() {
  allFamilies = await Api.get('/api/role-families');
  allAreas = await Api.get('/api/capability-areas');
  const familySelect = document.getElementById('family-filter');
  for (const f of allFamilies) {
    familySelect.insertAdjacentHTML('beforeend', `<option value="${f.id}">${escapeHtml(f.name)}</option>`);
  }
  refreshAreaOptions();
}

function refreshAreaOptions() {
  const familyId = document.getElementById('family-filter').value;
  const areaSelect = document.getElementById('area-filter');
  const areas = familyId ? allAreas.filter(a => String(a.role_family_id) === familyId) : allAreas;
  areaSelect.innerHTML = '<option value="">All capability areas</option>' +
    areas.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
}

async function loadRoles() {
  const search = document.getElementById('search').value.trim();
  const roleFamilyId = document.getElementById('family-filter').value;
  const capabilityAreaId = document.getElementById('area-filter').value;
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (roleFamilyId) params.set('roleFamilyId', roleFamilyId);
  if (capabilityAreaId) params.set('capabilityAreaId', capabilityAreaId);

  const list = document.getElementById('role-list');
  const roles = await Api.get(`/api/roles?${params.toString()}`);
  document.getElementById('roles-heading').textContent = (search || roleFamilyId || capabilityAreaId) ? `Roles (${roles.length})` : 'Featured roles';

  if (roles.length === 0) {
    list.innerHTML = '<div class="card"><div class="empty-state">No role profiles match your search.</div></div>';
    return;
  }

  list.innerHTML = `<div class="role-cards">${roles.map(r => `
    <a class="role-card" href="role.html?id=${r.id}">
      <div class="role-card-head">
        <span class="icon-tile">${ROLE_ICON}</span>
        <div class="role-card-title">
          <h3>${escapeHtml(r.title)}</h3>
          ${r.grade ? `<div class="role-card-grade">Grade ${escapeHtml(r.grade)}</div>` : ''}
        </div>
      </div>
      <p class="role-card-desc">${escapeHtml((r.role_description || r.summary || '').slice(0, 120))}${(r.role_description || r.summary || '').length > 120 ? '…' : ''}</p>
    </a>
  `).join('')}</div>`;
}

document.addEventListener('DOMContentLoaded', async () => {
  renderPublicNav();
  renderHomeHero();
  renderActionGrid();
  await loadFilters();
  await loadRoles();

  document.getElementById('search').addEventListener('input', debounce(loadRoles, 250));
  document.getElementById('family-filter').addEventListener('change', () => { refreshAreaOptions(); loadRoles(); });
  document.getElementById('area-filter').addEventListener('change', loadRoles);
  document.getElementById('clear-filters').addEventListener('click', () => {
    document.getElementById('search').value = '';
    document.getElementById('family-filter').value = '';
    refreshAreaOptions();
    loadRoles();
  });
});

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
