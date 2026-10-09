// Progressive enhancement: live character counts, focus first error, warn before leaving unsaved work.
(function () {
  var f = document.querySelector('[data-focus]');
  if (f) f.focus();
  document.querySelectorAll('[data-max]').forEach(function (el) {
    var out = el.parentNode.querySelector('.count'), max = +el.dataset.max;
    function upd() { var n = el.value.length; out.textContent = n + ' of ' + max + ' characters' + (n > max ? ' (too long)' : ''); out.classList.toggle('over', n > max); }
    el.addEventListener('input', upd); upd();
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
  var rt = document.querySelector('[data-count-recipients]'), rc = document.querySelector('[data-recipient-count]');
  if (rt && rc) {
    var updR = function () { var n = rt.value.split('\n').filter(function (l) { return l.indexOf("@") > -1; }).length; rc.textContent = n + " of 20 recipients"; rc.classList.toggle("over", n > 20); };
    rt.addEventListener('input', updR); updR();
  }
  var form = document.querySelector('form[data-dirty-warn]'), dirty = false;
  if (form) {
    form.addEventListener('input', function () { dirty = true; });
    form.addEventListener('submit', function () { dirty = false; });
    window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  }
})();
