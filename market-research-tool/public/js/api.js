const Api = {
  async request(method, url, body, isForm) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      if (isForm) {
        opts.body = body;
      } else {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
    }
    const res = await fetch(url, opts);
    if (res.status === 401 && !location.pathname.endsWith('login.html')) {
      location.href = 'login.html';
      return new Promise(() => {});
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.fields = data && data.fields;
      err.status = res.status;
      throw err;
    }
    return data;
  },
  get(url) { return this.request('GET', url); },
  post(url, body) { return this.request('POST', url, body || {}); },
  patch(url, body) { return this.request('PATCH', url, body || {}); },
  del(url) { return this.request('DELETE', url); }
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

function formatPct(value, opts) {
  opts = opts || {};
  if (value === null || value === undefined || isNaN(value)) return opts.dash !== false ? '&ndash;' : '';
  const cls = value > 0.05 ? 'pct-up' : value < -0.05 ? 'pct-down' : 'pct-flat';
  const sign = value > 0 ? '+' : '';
  return `<span class="${cls}">${sign}${value.toFixed(2)}%</span>`;
}

function formatPrice(value, currency) {
  if (value === null || value === undefined || isNaN(value)) return '&ndash;';
  const symbol = currency === 'GBP' ? '£' : currency === 'GBp' ? '' : currency === 'USD' ? '$' : '';
  const suffix = currency === 'GBp' ? 'p' : '';
  return `${symbol}${value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${suffix}`;
}

function strengthBadge(strength) {
  return `<span class="badge strength-${strength}">${escapeHtml((strength || '').replace('_', ' '))}</span>`;
}

function signalTypeBadge(type) {
  return `<span class="badge signal-${type}">${escapeHtml((type || '').replace(/_/g, ' '))}</span>`;
}

function assetClassLabel(assetClass) {
  return { us_share: 'US Share', uk_share: 'UK Share', crypto: 'Crypto' }[assetClass] || assetClass;
}
