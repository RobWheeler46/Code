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
      throw err;
    }
    return data;
  },
  get(url) { return this.request('GET', url); },
  post(url, body) { return this.request('POST', url, body || {}); },
  patch(url, body) { return this.request('PATCH', url, body || {}); },
  put(url, body) { return this.request('PUT', url, body || {}); },
  delete(url, body) { return this.request('DELETE', url, body); },
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

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function initials(name) {
  return String(name || '').trim().split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase() || '?';
}

function statusBadge(status) {
  return `<span class="badge" data-status="${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

function osmUnavailableAlert(reason) {
  return `<div class="alert alert-warning">
    <strong>Live OSM information cannot currently be loaded.</strong><br>
    ${escapeHtml(reason || 'Please try again shortly, or use OSM directly in the meantime.')}
    <br><a href="https://www.onlinescoutmanager.co.uk/" target="_blank" rel="noopener">Open OSM directly &rarr;</a>
  </div>`;
}
