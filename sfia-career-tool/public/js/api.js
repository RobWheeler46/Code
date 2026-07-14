const Api = {
  async request(method, url, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      err.requiresConfirmation = data && data.requiresConfirmation;
      throw err;
    }
    return data;
  },
  get(url) { return this.request('GET', url); },
  post(url, body) { return this.request('POST', url, body || {}); },
  patch(url, body) { return this.request('PATCH', url, body || {}); },
  delete(url, body) { return this.request('DELETE', url, body); }
};

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function levelLabel(number, name) {
  if (!name || name === `Level ${number}`) return `Level ${number}`;
  return `Level ${number} — ${name}`;
}

function statusBadge(status) {
  return `<span class="badge" data-status="${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

function importanceBadge(importance) {
  return `<span class="badge" data-importance="${escapeHtml(importance)}">${escapeHtml(importance)}</span>`;
}

function gapBadge(label) {
  return `<span class="badge" data-gap="${escapeHtml(label)}">${escapeHtml(label)}</span>`;
}

const PRACTICAL_RESOURCE_TYPES = ['shadowing', 'stretch_assignment', 'mentoring', 'project_experience', 'communities_of_practice', 'coaching'];

function renderResourceList(resources) {
  if (resources.length === 0) return '<p class="muted">No learning resources are linked yet.</p>';
  return resources.map(r => `
    <div class="learning-item">
      <div class="title">
        ${r.url ? `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.title)}</a>` : escapeHtml(r.title)}
        <span class="badge" data-priority="${escapeHtml(r.priority)}">${escapeHtml(r.priority)}</span>
      </div>
      <div class="meta">
        ${escapeHtml(r.resourceType || '')}${r.provider ? ' &middot; ' + escapeHtml(r.provider) : ''}${r.estimatedDuration ? ' &middot; ' + escapeHtml(r.estimatedDuration) : ''}${r.costType ? ' &middot; ' + escapeHtml(r.costType) : ''}
      </div>
      ${r.description ? `<p style="margin:0.4rem 0 0;">${escapeHtml(r.description)}</p>` : ''}
    </div>
  `).join('');
}
