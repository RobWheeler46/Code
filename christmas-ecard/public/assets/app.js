// Progressive enhancement: live character counts, focus first error, warn before leaving unsaved work.
(function () {
  var f = document.querySelector('[data-focus]');
  if (f) f.focus();
  document.querySelectorAll('[data-max]').forEach(function (el) {
    var out = el.parentNode.querySelector('.count'), max = +el.dataset.max;
    function upd() { var n = el.value.length; out.textContent = n + ' of ' + max + ' characters' + (n > max ? ' (too long)' : ''); out.classList.toggle('over', n > max); }
    el.addEventListener('input', upd); upd();
  });
  document.querySelectorAll('ul.starters').forEach(function (ul) { // tone buttons only appear when scripts run; without them every idea is shown
    var tones = []; ul.querySelectorAll('li[data-tone]').forEach(function (li) { if (tones.indexOf(li.dataset.tone) < 0) tones.push(li.dataset.tone); });
    if (tones.length < 2) return;
    var bar = document.createElement('div'); bar.className = 'tones'; bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Show ideas that are');
    ['All'].concat(tones).forEach(function (t) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.setAttribute('aria-pressed', t === 'All' ? 'true' : 'false');
      b.addEventListener('click', function () { bar.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); }); ul.querySelectorAll('li').forEach(function (li) { li.hidden = t !== 'All' && li.dataset.tone !== t; }); });
      bar.appendChild(b);
    });
    ul.parentNode.insertBefore(bar, ul);
  });
  document.querySelectorAll('[data-starter]').forEach(function (b) {
    b.addEventListener('click', function () {
      var m = document.querySelector('textarea[name=message]');
      m.value = m.value ? m.value.replace(/\s+$/, '') + '\n' + b.dataset.starter : b.dataset.starter;
      m.dispatchEvent(new Event('input', { bubbles: true })); m.focus();
    });
  });
  var pm = document.querySelector('[data-preview-msg]'), pf = document.querySelector('[data-preview-from]');
  var mi = document.querySelector('textarea[name=message]'), fi = document.querySelector('input[name=sender_name]');
  if (pm && mi) mi.addEventListener('input', function () { pm.textContent = mi.value; });
  if (pf && fi) fi.addEventListener('input', function () { pf.textContent = fi.value; });
  var rc = document.querySelector('[data-recipient-count]');
  if (rc) {
    var max = parseInt(rc.textContent.split(' of ')[1], 10) || 20;
    var updR = function () { var n = document.querySelectorAll('input[name="r_email[]"]').length; var filled = 0; document.querySelectorAll('input[name="r_email[]"]').forEach(function (e) { if (e.value.trim()) filled++; }); var p = document.querySelector('textarea[name=paste]'); if (p) filled += p.value.split('\n').filter(function (l) { return l.indexOf('@') > -1; }).length; rc.textContent = filled + ' of ' + max + ' recipients'; rc.classList.toggle('over', filled > max); };
    document.addEventListener('input', function (e) { if (e.target.matches('input[name="r_email[]"], textarea[name=paste]')) updR(); }); updR();
  }
  var form = document.querySelector('form[data-dirty-warn]'), dirty = false;
  if (form) {
    form.addEventListener('input', function () { dirty = true; });
    form.addEventListener('submit', function () { dirty = false; });
    window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  }
})();
document.querySelectorAll('[data-print]').forEach(function (b) { b.addEventListener('click', function () { window.print(); }); });

document.querySelectorAll('[data-skip]').forEach(function (b) { b.addEventListener('click', function () { document.documentElement.classList.add('noanim'); b.parentNode.hidden = true; }); });

(function () { var f = document.querySelector('.sendopts'); if (!f) return;
  function upd() { var d = f.querySelector('input[name=mode][value=donate]').checked, t = 0, p = f.querySelector('input[name=amount]:checked');
    if (d && p) t = p.value === 'custom' ? Math.round(parseFloat(f.querySelector('input[name=custom]').value || 0) * 100) : parseInt(p.value, 10);
    f.querySelector('[data-total]').textContent = '£' + (t / 100).toFixed(2);
    f.querySelector('[data-send-btn]').textContent = d ? 'Donate and send my cards' : 'Send my cards for free'; }
  f.addEventListener('input', upd); f.addEventListener('change', upd); upd(); })();

(function () { var m = document.querySelector('.wsmenu'); if (m && window.matchMedia && window.matchMedia('(max-width:790px)').matches) m.removeAttribute('open'); })();

document.querySelectorAll('[data-autosubmit]').forEach(function (s) { s.addEventListener('change', function () { s.form.submit(); }); });

// Recipients: add and remove rows without reloading the page. Without scripts the same buttons still work, one page load each.
(function () {
  var fs = document.getElementById('recipients'); if (!fs) return;
  var rc = fs.querySelector('[data-recipient-count]'), max = rc ? parseInt(rc.textContent.split(' of ')[1], 10) || 20 : 20;
  var rows = function () { return fs.querySelectorAll('.rrow'); };
  var tidy = function (quiet) {
    var rs = rows(), add = fs.querySelector('button[value=addrow]');
    rs.forEach(function (r, i) {
      r.setAttribute('aria-label', 'Recipient ' + (i + 1));
      var b = r.querySelector('button[value^=remove_]');
      if (!b) { b = document.createElement('button'); b.type = 'button'; b.className = 'btn alt'; b.name = 'act'; b.textContent = 'Remove'; r.appendChild(b); }
      b.value = 'remove_' + i; b.setAttribute('aria-label', 'Remove recipient ' + (i + 1)); b.hidden = rs.length < 2;
    });
    if (add) add.hidden = rs.length >= max;
    var e = fs.querySelector('input[name="r_email[]"]'); if (e && !quiet) e.dispatchEvent(new Event('input', { bubbles: true })); // refreshes the count
  };
  fs.addEventListener('click', function (ev) {
    var b = ev.target.closest('button[name=act]'); if (!b) return;
    if (b.value === 'addrow') {
      ev.preventDefault(); var rs = rows(); if (rs.length >= max) return;
      var n = rs[rs.length - 1].cloneNode(true);
      n.querySelectorAll('input,textarea').forEach(function (x) { x.value = ''; x.removeAttribute('aria-invalid'); x.removeAttribute('aria-describedby'); x.removeAttribute('data-focus'); });
      n.querySelectorAll('.fe').forEach(function (x) { x.remove(); }); n.querySelectorAll('details').forEach(function (d) { d.open = false; });
      rs[rs.length - 1].after(n); tidy(); n.querySelector('input').focus();
    } else if (/^remove_/.test(b.value)) {
      ev.preventDefault(); var all = rows(), row = b.closest('.rrow'), at = Array.prototype.indexOf.call(all, row);
      if (all.length < 2) return; row.remove(); tidy(); var left = rows(); left[Math.min(at, left.length - 1)].querySelector('input').focus();
    }
  });
  tidy(true);
})();
