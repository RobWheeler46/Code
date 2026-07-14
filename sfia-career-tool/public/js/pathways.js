async function loadFamilyOptions() {
  const families = await Api.get('/api/role-families');
  const select = document.getElementById('family-filter');
  for (const f of families) {
    select.insertAdjacentHTML('beforeend', `<option value="${f.id}">${escapeHtml(f.name)}</option>`);
  }
}

async function loadPathways() {
  const roleFamilyId = document.getElementById('family-filter').value;
  const pathwayType = document.getElementById('type-filter').value;
  const params = new URLSearchParams();
  if (roleFamilyId) params.set('roleFamilyId', roleFamilyId);
  if (pathwayType) params.set('pathwayType', pathwayType);

  const list = document.getElementById('pathway-list');
  const pathways = await Api.get(`/api/pathways?${params.toString()}`);

  if (pathways.length === 0) {
    list.innerHTML = '<div class="card"><div class="empty-state">No career pathways match your filters.</div></div>';
    return;
  }

  list.innerHTML = `<div class="grid cols-2">${pathways.map(p => `
    <a class="card clickable" href="pathway.html?id=${p.id}">
      <span class="badge" data-pathway-type="${escapeHtml(p.pathway_type)}">${escapeHtml(p.pathway_type)}</span>
      <h2>${escapeHtml(p.pathway_name)}</h2>
      <p class="muted">${escapeHtml(p.role_family_name || '')}</p>
      <p>${escapeHtml(p.pathway_description || '')}</p>
    </a>
  `).join('')}</div>`;
}

document.addEventListener('DOMContentLoaded', async () => {
  renderPublicNav();
  await loadFamilyOptions();
  await loadPathways();
  document.getElementById('family-filter').addEventListener('change', loadPathways);
  document.getElementById('type-filter').addEventListener('change', loadPathways);
});
