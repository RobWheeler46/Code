/* Volunteer journey — 7th Swindon Scouts (UX Spec v2.4, responsive)
 *
 * Two interaction models from one component, over opportunities.json:
 *  - Desktop (>= 900px): a comparison view. The choice controls (how to help +
 *    availability) sit on the left and matching opportunities update live on the
 *    right. Choosing one reveals the expression of interest in place.
 *  - Mobile: the guided wizard (how to help -> availability -> opportunities ->
 *    interested). Selections are preserved across a resize.
 * A lightweight expression of interest only; DBS/references/training stay off the
 * public site and are handled later by the Group/official Scout systems.
 */
(function () {
  const wizard = document.getElementById('volWizard');
  if (!wizard) return;
  const vol = document.getElementById('volunteer');
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const els = {
    groups: [...document.querySelectorAll('.vgrp')],
    progress: [...document.querySelectorAll('.wiz-progress li')],
    controls: $('volControls'), results: $('v-results'),
    opps: $('v-opps'), eoi: $('v-eoi'),
    actions: document.querySelector('#volControls .wiz-actions'),
    back: $('vwiz-back'), next: $('vwiz-next'),
    form: $('eoiForm'),
  };

  const mq = window.matchMedia('(min-width: 900px)');
  let LIVE = mq.matches, current = 1, opps = [], general = null, enquiryUrl = 'volunteer.php', liveTimer = null, chosen = false;

  fetch('opportunities.json', { cache: 'no-store' })
    .then((r) => { if (!r.ok) throw new Error('registry'); return r.json(); })
    .then((data) => {
      opps = (data.opportunities || []).filter((o) => o.status === 'open');
      general = (data.meta && data.meta.generalInterest) || { id: 'general', title: 'General interest', summary: '' };
      enquiryUrl = (data.meta && data.meta.enquiryUrl) || 'volunteer.php';
      setMode();
    })
    .catch(() => { opps = []; general = { id: 'general', title: 'General interest', summary: 'Tell us you would like to help and we will find a fit together.' }; setMode(); });

  const selectedWay = () => (document.querySelector('input[name="way"]:checked') || {}).value || 'either';
  const selectedAvail = () => [...document.querySelectorAll('input[name="avail"]:checked')].map((c) => c.value);

  function matched() {
    const way = selectedWay();
    const avail = selectedAvail();
    let list = opps.filter((o) => (way === 'either' ? true : way === 'young' ? o.worksWithYoungPeople : !o.worksWithYoungPeople));
    if (!list.length) list = opps.slice();
    const score = (o) => (o.availability || []).filter((a) => avail.includes(a)).length;
    return list.map((o, i) => [o, i]).sort((a, b) => score(b[0]) - score(a[0]) || a[1] - b[1]).map((x) => x[0]);
  }

  function oppCard(o) {
    const commit = o.estimatedCommitment ? `<span class="v-commit">${esc(o.estimatedCommitment)}</span>` : '';
    return `<article class="v-opp"><div class="v-opp-main"><h3>${esc(o.title)}</h3>${commit}<p>${esc(o.summary)}</p></div>` +
      `<button type="button" class="f-btn f-btn-primary v-choose" data-title="${esc(o.title)}">Choose this →</button></article>`;
  }
  const generalCard = () => `<article class="v-opp v-opp-general"><div class="v-opp-main"><h3>${esc(general.title)}</h3><p>${esc(general.summary)}</p></div>` +
    `<button type="button" class="f-btn f-btn-ghost v-choose" data-title="General interest">Choose this →</button></article>`;

  function renderOpps() {
    const list = matched();
    const cards = list.map((o) => oppCard(o)).join('') + generalCard();
    const wizNav = LIVE ? '' : `<div class="wiz-actions"><button type="button" class="f-btn f-btn-ghost" id="vopps-back">← Back</button><span></span></div>`;
    els.opps.innerHTML =
      `<p class="v-opps-lead">Based on your choices, here are some ways you could help. Pick one that appeals, or choose “${esc(general.title)}” and we will help you find a fit.</p>` +
      `<div class="v-opp-list">${cards}</div>${wizNav}`;
    els.opps.querySelectorAll('.v-choose').forEach((b) => b.addEventListener('click', () => chooseOpportunity(b.dataset.title)));
    const ob = $('vopps-back'); if (ob) ob.addEventListener('click', () => showStep(2));
    els.opps.hidden = false;
    els.eoi.hidden = true;
  }

  function chooseOpportunity(title) {
    $('v-interest').value = title;
    $('v-interest-label').textContent = title;
    showEoi();
  }

  // Render Turnstile only when the (initially hidden) form is shown — Turnstile
  // can fail to size a widget inside a display:none container at load. Retries
  // until the Cloudflare script has loaded, and renders once.
  function renderTurnstile() {
    const el = document.getElementById('v-turnstile');
    if (!el || el.dataset.rendered === '1') return;
    if (!window.turnstile) { setTimeout(renderTurnstile, 200); return; }
    window.turnstile.render(el, { sitekey: '0x4AAAAAAFMxidFYKrI0nPMi' });
    el.dataset.rendered = '1';
  }

  function showEoi() {
    chosen = true;
    els.opps.hidden = true;
    els.eoi.hidden = false;
    renderTurnstile();
    if (!LIVE) { els.controls.hidden = true; els.results.hidden = false; markProgress(4); }
    const h = els.eoi.querySelector('.f-step-h'); if (h) h.focus({ preventScroll: false });
  }

  function showOpps() {
    chosen = false;
    els.eoi.hidden = true;
    els.opps.hidden = false;
    if (!LIVE) markProgress(3);
  }

  function markProgress(n) {
    els.progress.forEach((li) => {
      const s = Number(li.dataset.step);
      li.classList.toggle('is-active', s === n);
      li.classList.toggle('is-done', s < n);
      li.setAttribute('aria-current', s === n ? 'step' : 'false');
    });
  }

  // ---- Mode handling ----
  function setMode() {
    LIVE = mq.matches;
    vol.classList.toggle('is-live', LIVE);
    vol.classList.toggle('is-wizard', !LIVE);
    if (LIVE) {
      els.groups.forEach((g) => (g.hidden = false));
      if (els.actions) els.actions.hidden = true;
      els.controls.hidden = false;
      els.results.hidden = false;
      els.progress.forEach((li) => li.classList.remove('is-active', 'is-done'));
      renderOpps();
      if (chosen) showEoi();
    } else {
      if (els.actions) els.actions.hidden = false;
      if (chosen) { els.controls.hidden = true; els.results.hidden = false; renderOpps(); showEoi(); }
      else showStep(current <= 2 ? current : 1);
    }
  }

  // ---- Wizard navigation ----
  function showStep(n) {
    current = n;
    els.eoi.hidden = true;
    if (n <= 2) {
      els.controls.hidden = false;
      els.results.hidden = true;
      els.opps.hidden = true;
      els.groups.forEach((g) => (g.hidden = Number(g.dataset.step) !== n));
      if (els.actions) els.actions.hidden = false;
      if (els.back) els.back.hidden = n === 1;
      if (els.next) els.next.textContent = n === 2 ? 'See opportunities →' : 'Next →';
      markProgress(n);
      const f = els.groups[n - 1].querySelector('.f-step-h, input'); if (f) f.focus({ preventScroll: true });
    } else if (n === 3) {
      els.controls.hidden = true;
      els.results.hidden = false;
      renderOpps();
      markProgress(3);
    } else if (n === 4) {
      els.controls.hidden = true;
      els.results.hidden = false;
      showEoi();
    }
  }

  // ---- Wiring ----
  if (els.next) els.next.addEventListener('click', () => { if (!LIVE) { if (current === 1) showStep(2); else if (current === 2) showStep(3); } });
  if (els.back) els.back.addEventListener('click', () => { if (!LIVE && current > 1) showStep(current - 1); });
  const eoiBack = els.eoi.querySelector('[data-veoi-back]');
  if (eoiBack) eoiBack.addEventListener('click', () => { if (LIVE) showOpps(); else showStep(3); });

  // Live updates when the choice controls change (desktop).
  els.controls.addEventListener('change', () => {
    if (!LIVE || chosen) return;
    clearTimeout(liveTimer);
    liveTimer = setTimeout(renderOpps, 150);
  });

  mq.addEventListener('change', setMode);
  let resizeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (mq.matches !== LIVE) setMode(); }, 150); });

  // ---- Expression of interest ----
  if (els.form) {
    const status = $('v-status');
    const setStatus = (kind, msg) => { status.className = 'contact-status ' + kind; status.textContent = msg; };
    els.form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = new FormData(els.form);
      if ((data.get('website') || '').trim()) { setStatus('ok', 'Thanks! Your interest has been sent.'); els.form.reset(); return; }
      const name = (data.get('name') || '').trim();
      const email = (data.get('email') || '').trim();
      if (!name || !email) { setStatus('err', 'Please add your name and email so we can get back to you.'); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setStatus('err', 'Please enter a valid email address.'); return; }
      const btn = els.form.querySelector('button[type="submit"]');
      const label = btn.textContent; btn.disabled = true; btn.textContent = 'Sending…'; setStatus('', '');
      try {
        const res = await fetch(enquiryUrl, { method: 'POST', headers: { Accept: 'application/json' }, body: data });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json.ok) { els.form.reset(); setStatus('ok', json.message || "Thanks! We will be in touch to have an informal chat."); }
        else { setStatus('err', json.message || 'Sorry, something went wrong. Please try again in a moment.'); }
      } catch (err) {
        setStatus('err', "Sorry, we could not send that. Please try again in a moment.");
      } finally { btn.disabled = false; btn.textContent = label; }
    });
  }
})();
