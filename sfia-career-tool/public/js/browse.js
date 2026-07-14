let allFamilies = [];
let allAreas = [];

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

  if (roles.length === 0) {
    list.innerHTML = '<div class="card"><div class="empty-state">No role profiles match your search.</div></div>';
    return;
  }

  list.innerHTML = `<div class="grid cols-2">${roles.map(r => `
    <a class="card clickable" href="role.html?id=${r.id}">
      <h2>${escapeHtml(r.title)}</h2>
      <p class="muted">${escapeHtml(r.role_family_name || '')}${r.capability_area_name ? ' &middot; ' + escapeHtml(r.capability_area_name) : ''}${r.seniority_level ? ' &middot; ' + escapeHtml(r.seniority_level) : ''}</p>
      <p>${escapeHtml(r.summary || '')}</p>
    </a>
  `).join('')}</div>`;
}

document.addEventListener('DOMContentLoaded', async () => {
  renderPublicNav();
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
