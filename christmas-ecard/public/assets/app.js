// Progressive enhancement: live character counts, focus first error, warn before leaving unsaved work.
(function () {
  var f = document.querySelector('[data-focus]');
  if (f) f.focus();
  document.querySelectorAll('[data-max]').forEach(function (el) {
    var out = el.parentNode.querySelector('.count'), max = +el.dataset.max;
    function upd() { var n = el.value.length; out.textContent = n + ' of ' + max + ' characters' + (n > max ? ' (too long)' : ''); out.classList.toggle('over', n > max); }
    el.addEventListener('input', upd); upd();
  });
  var form = document.querySelector('form[data-dirty-warn]'), dirty = false;
  if (form) {
    form.addEventListener('input', function () { dirty = true; });
    form.addEventListener('submit', function () { dirty = false; });
    window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  }
})();
