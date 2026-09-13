/* Find Your Section — 7th Swindon Scouts (UX Spec v2.4, responsive finder)
 *
 * Two interaction models from one component, over the public registry
 * (sections.json):
 *  - Desktop (>= 900px): a one-screen comparison. All filters (age/DOB, day,
 *    locality) are visible at once and results update live on the right.
 *  - Mobile: a guided 3-step wizard (age/DOB -> day -> locality) that ends in
 *    result cards.
 * The same inputs live in the DOM in both modes, so selections are preserved
 * across a resize or a back/forward navigation.
 *
 * FRD Epic B + FIND rules preserved:
 *  - Age/DOB is used for matching only: never stored, never sent anywhere.
 *  - Day and locality options derive from active section records.
 *  - Broad localities only, never an exact venue.
 *  - No dead ends: filters that match nothing offer all options + a reset.
 *  - Transition ages are explained; placement is never implied as guaranteed.
 */
(function () {
  const form = document.getElementById('finderForm');
  if (!form) return;
  const finder = document.getElementById('finder');
  const $ = (id) => document.getElementById(id);

  const els = {
    groups: [...document.querySelectorAll('.fgrp')],
    progress: [...document.querySelectorAll('.wiz-progress li')],
    age: $('f-age'), dob: $('f-dob'),
    days: $('f-days'), locality: $('f-locality'),
    error: $('f-error'), results: $('finderResults'),
    actions: form.querySelector('.wiz-actions'),
    back: $('wiz-back'), next: $('wiz-next'),
  };

  const mq = window.matchMedia('(min-width: 900px)');
  let LIVE = mq.matches;
  let registry = null, waitingListUrl = '#', joinAgeMin = 5, current = 1, liveTimer = null;

  const time12 = (t) => {
    if (!t) return null;
    const [h, m] = t.split(':').map(Number);
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}${h >= 12 ? 'pm' : 'am'}`;
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uniq = (a) => [...new Set(a)];

  fetch('sections.json', { cache: 'no-store' })
    .then((r) => { if (!r.ok) throw new Error('registry'); return r.json(); })
    .then((data) => {
      registry = (data.sections || []).filter((s) => s.active);
      waitingListUrl = (data.meta && data.meta.waitingListUrl) || '#';
      joinAgeMin = (data.meta && data.meta.joinAgeMin) || 5;
      buildControls();
      applyHomePrefill();
      setMode();
    })
    .catch(() => {
      els.results.innerHTML =
        '<div class="f-note f-note-warn">We could not load our section list just now. Please try again shortly, or ' +
        '<a href="contact.html">get in touch</a> and we will help you find the right section.</div>';
      els.results.hidden = false;
    });

  function buildControls() {
    const order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const days = uniq(registry.map((s) => s.meetingDay).filter(Boolean)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    els.days.innerHTML =
      days.map((d) => `<label class="f-chip"><input type="checkbox" name="day" value="${esc(d)}"><span>${esc(d)}</span></label>`).join('') +
      `<label class="f-chip f-chip-any"><input type="checkbox" name="anyday" value="1" checked><span>Any day</span></label>`;

    const locs = uniq(registry.map((s) => s.locality).filter(Boolean)).sort();
    els.locality.innerHTML =
      `<label class="f-opt"><input type="radio" name="locality" value="" checked><span>Any area</span></label>` +
      locs.map((l) => `<label class="f-opt"><input type="radio" name="locality" value="${esc(l)}"><span>${esc(l)}</span></label>`).join('');

    const anyday = els.days.querySelector('input[name="anyday"]');
    els.days.querySelectorAll('input[name="day"]').forEach((c) =>
      c.addEventListener('change', () => { if (c.checked) anyday.checked = false; syncAny(); }));
    anyday.addEventListener('change', () => { if (anyday.checked) els.days.querySelectorAll('input[name="day"]').forEach((c) => (c.checked = false)); });
    function syncAny() { if (![...els.days.querySelectorAll('input[name="day"]')].some((c) => c.checked)) anyday.checked = true; }
  }

  function readAge() {
    if (els.dob.value) {
      const d = new Date(els.dob.value + 'T00:00:00');
      if (isNaN(d)) return null;
      const y = (Date.now() - d.getTime()) / (365.25 * 864e5);
      return y >= 0 && y < 30 ? Math.round(y * 100) / 100 : null;
    }
    const a = parseFloat(els.age.value);
    return isFinite(a) && a >= 0 && a < 30 ? a : null;
  }
  const selectedDays = () => [...els.days.querySelectorAll('input[name="day"]:checked')].map((c) => c.value);
  const selectedLocality = () => (els.locality.querySelector('input[name="locality"]:checked') || {}).value || '';

  function applyHomePrefill() {
    let raw = null;
    try { raw = sessionStorage.getItem('finderPrefill'); sessionStorage.removeItem('finderPrefill'); } catch (_) { return; }
    if (!raw) return;
    let p; try { p = JSON.parse(raw); } catch (_) { return; }
    if (p.dob) els.dob.value = p.dob;
    else if (p.age) els.age.value = p.age;
    if (p.day) {
      const chip = [...els.days.querySelectorAll('input[name="day"]')].find((c) => c.value === p.day);
      const any = els.days.querySelector('input[name="anyday"]');
      if (chip) { chip.checked = true; if (any) any.checked = false; }
    }
  }

  // ---- Matching ----
  const matchAge = (age) => registry.filter((s) => age >= s.ageMin && age < s.ageMax);

  function transitionFor(age, matches) {
    const types = uniq(matches.map((m) => m.type));
    let note = null; const comingUp = [];
    types.forEach((t) => {
      const tMax = Math.max(...matches.filter((m) => m.type === t).map((m) => m.ageMax));
      if (age >= tMax - 0.5) {
        const next = registry.filter((s) => s.ageMin === tMax);
        if (next.length) {
          next.forEach((n) => { if (!comingUp.some((c) => c.id === n.id)) comingUp.push(n); });
          note = `Around this age, young people often move from ${t} up to ${next[0].type}. ` +
            `The best starting point depends on local availability, and we will talk it through with you.`;
        }
      }
    });
    return { note, comingUp };
  }

  const applyFilters = (list, days, locality) => list.filter((s) => {
    const dayOk = days.length === 0 || !s.meetingDay || days.includes(s.meetingDay);
    const locOk = !locality || !s.locality || s.locality === locality;
    return dayOk && locOk;
  });

  function card(s, tag) {
    const name = s.publicName && s.publicName !== s.type ? s.publicName : s.type;
    const when = s.meetingDay ? `${esc(s.meetingDay)} · ${esc(time12(s.startTime))} to ${esc(time12(s.endTime))}` : 'Day varies, contact us';
    const where = s.locality ? esc(s.locality) : 'Area confirmed on contact';
    const avail = s.availabilityStatus ? `<span class="f-avail">${esc(s.availabilityStatus)}</span>` : '';
    const tagHtml = tag ? `<span class="f-tag">${esc(tag)}</span>` : '';
    return `<article class="f-card f-${s.type.toLowerCase()}">
      <div class="f-card-head"><h3>${esc(name)}</h3>${tagHtml}</div>
      <p class="f-meta"><span class="f-age">${esc(s.displayAge)} years</span>${avail}</p>
      <dl class="f-detail"><div><dt>When</dt><dd>${when}</dd></div><div><dt>Where</dt><dd>${where}</dd></div></dl>
      <p class="f-summary">${esc(s.summary)}</p>
      <div class="f-actions">
        <a class="f-btn f-btn-primary" href="${esc(waitingListUrl)}" target="_blank" rel="noopener noreferrer">Join waiting list</a>
        <a class="f-btn f-btn-ghost" href="${esc(s.type.toLowerCase())}.html">Find out more</a>
      </div></article>`;
  }
  const caveat = () => '<p class="f-caveat">A waiting-list place is not a guaranteed start date. The right section and start depend on local availability and a chat with the team. Exact meeting venues are shared once you are in touch.</p>';

  const placeholder = () => '<div class="f-placeholder"><span class="f-placeholder-emoji" aria-hidden="true">🧭</span>' +
    '<p>Enter your child\'s date of birth or age and we will show the sections that fit. Add a day or area to narrow it down.</p></div>';

  function render(age, showAll) {
    const days = showAll ? [] : selectedDays();
    const locality = showAll ? '' : selectedLocality();
    const matches = matchAge(age);
    const yrs = Math.floor(age);

    if (matches.length === 0) {
      if (age < 6) {
        const beavers = registry.filter((s) => s.type === 'Beavers');
        const intro = age >= joinAgeMin
          ? `Your child is not quite old enough for Beavers yet (it starts at 6), but you can join the waiting list now so they are ready when a space comes up.`
          : `Children can join our waiting list from age ${joinAgeMin}. Beavers is the section they will start in when they are old enough.`;
        return paint('Getting ready to start', `<p class="f-lead">${esc(intro)}</p>` + caveat() + `<div class="f-grid">${beavers.map((s) => card(s, 'Starts at 6')).join('')}</div>`);
      }
      return paint('Our youth sections are for 6 to 18',
        `<p class="f-lead">It looks like this age is above our youth sections. If you are an adult who would like to get involved, we would love your help, and there are flexible ways to volunteer.</p>` +
        `<div class="f-cta-row"><a class="f-btn f-btn-primary" href="volunteer.html">Get involved</a><a class="f-btn f-btn-ghost" href="contact.html">Talk to us</a></div>`);
    }

    const { note, comingUp } = transitionFor(age, matches);
    const now = applyFilters(matches, days, locality);
    const soon = applyFilters(comingUp, days, locality);
    const primaryType = matches[0].type;
    const primaryAge = matches[0].displayAge;

    if (now.length === 0 && soon.length === 0) {
      const dayLabel = days.length ? days.join(' or ') : 'those filters';
      return paint('No exact match for those filters',
        `<p class="f-lead">We could not find a ${esc(primaryType)} session on ${esc(dayLabel)}, but here are all the options for age ${yrs}.</p>` +
        `<div class="f-clearrow"><button type="button" class="f-btn f-btn-ghost" id="f-clear">Show all ${esc(primaryType)} options</button></div>` + caveat() +
        `<div class="f-grid">${matches.map((s) => card(s, 'Right age')).concat(comingUp.map((s) => card(s, 'Coming up'))).join('')}</div>`);
    }

    const count = now.length + soon.length;
    const lead = now.length
      ? `<strong>${esc(primaryType)}</strong> looks right for your child, age ${esc(primaryAge)}. We found ${count} local option${count === 1 ? '' : 's'}.`
      : `Your child is just coming up to the next section. Here is what is next.`;
    const body =
      `<p class="f-lead">${lead}</p>` +
      (note ? `<p class="f-note">${esc(note)}</p>` : '') + caveat() +
      `<div class="f-grid">${now.map((s) => card(s, 'Right age')).join('')}${soon.map((s) => card(s, 'Coming up next')).join('')}</div>` +
      (!showAll && (selectedDays().length || selectedLocality())
        ? `<div class="f-clearrow"><button type="button" class="f-btn f-btn-ghost" id="f-all">View all options for age ${yrs}</button></div>` : '');
    paint(now.length ? `Great, here is where age ${yrs} fits` : `Coming up for age ${yrs}`, body);
  }

  function paint(headingText, bodyHtml) {
    const nav = LIVE ? '' :
      `<div class="wiz-nav"><button type="button" class="f-btn f-btn-ghost" id="f-change">← Change answers</button>` +
      `<a class="f-btn f-btn-primary" href="${esc(waitingListUrl)}" target="_blank" rel="noopener noreferrer">Join waiting list</a>` +
      `<button type="button" class="f-btn f-btn-ghost" id="f-restart">Start again</button></div>`;
    els.results.innerHTML = `<h2 class="f-results-head" tabindex="-1">${esc(headingText)}</h2>${bodyHtml}${nav}`;
    els.results.hidden = false;
    if (!LIVE) showResults();

    const clear = $('f-clear') || $('f-all');
    if (clear) clear.addEventListener('click', () => render(readAge(), true));
    const change = $('f-change'); if (change) change.addEventListener('click', () => showStep(3));
    const restart = $('f-restart'); if (restart) restart.addEventListener('click', resetAll);
    if (!LIVE) { const h = els.results.querySelector('.f-results-head'); if (h) h.focus({ preventScroll: false }); }
  }

  // ---- Mode handling ----
  function setMode() {
    LIVE = mq.matches;
    finder.classList.toggle('is-live', LIVE);
    finder.classList.toggle('is-wizard', !LIVE);
    els.error.textContent = '';
    if (LIVE) {
      els.groups.forEach((g) => (g.hidden = false));
      if (els.actions) els.actions.hidden = true;
      els.progress.forEach((li) => li.classList.remove('is-active', 'is-done'));
      form.hidden = false;
      els.results.hidden = false;
      renderLive();
    } else {
      if (els.actions) els.actions.hidden = false;
      if (readAge() !== null) { render(readAge()); } else { showStep(Math.min(current, 3)); }
    }
  }

  function renderLive() {
    if (readAge() !== null) render(readAge());
    else els.results.innerHTML = placeholder();
  }

  // ---- Wizard navigation ----
  function showStep(n) {
    current = n;
    form.hidden = false;
    els.results.hidden = true;
    els.groups.forEach((g) => (g.hidden = Number(g.dataset.step) !== n));
    els.progress.forEach((li) => {
      const s = Number(li.dataset.step);
      li.classList.toggle('is-active', s === n);
      li.classList.toggle('is-done', s < n);
      li.setAttribute('aria-current', s === n ? 'step' : 'false');
    });
    if (els.actions) els.actions.hidden = false;
    if (els.back) els.back.hidden = n === 1;
    if (els.next) els.next.textContent = n === 3 ? 'Find my section →' : 'Next →';
    if (n !== 1) els.error.textContent = '';
    const f = els.groups[n - 1].querySelector('h2, input');
    if (f) f.focus({ preventScroll: true });
  }

  function showResults() {
    form.hidden = true;
    els.results.hidden = false;
    els.progress.forEach((li) => { li.classList.remove('is-active'); li.classList.add('is-done'); li.setAttribute('aria-current', 'false'); });
  }

  function goNext() {
    if (current === 1 && readAge() === null) {
      els.error.textContent = "Please enter your child's date of birth, or their age in years.";
      els.age.focus();
      return;
    }
    if (current === 3) { render(readAge()); return; }
    showStep(current + 1);
  }

  function resetAll() {
    form.reset();
    els.days.querySelectorAll('input[name="day"]').forEach((c) => (c.checked = false));
    const any = els.days.querySelector('input[name="anyday"]'); if (any) any.checked = true;
    const anyLoc = els.locality.querySelector('input[value=""]'); if (anyLoc) anyLoc.checked = true;
    els.error.textContent = '';
    els.results.innerHTML = '';
    if (LIVE) { renderLive(); } else { current = 1; showStep(1); }
  }

  // ---- Wiring ----
  if (els.next) els.next.addEventListener('click', () => { if (!LIVE) goNext(); });
  if (els.back) els.back.addEventListener('click', () => { if (!LIVE && current > 1) showStep(current - 1); });
  form.addEventListener('submit', (e) => { e.preventDefault(); if (!LIVE) goNext(); });

  // Live updates on any control change (desktop).
  const onLiveChange = () => {
    if (!LIVE) return;
    clearTimeout(liveTimer);
    liveTimer = setTimeout(renderLive, 150);
  };
  form.addEventListener('input', onLiveChange);
  form.addEventListener('change', onLiveChange);

  els.age.addEventListener('input', () => { if (els.age.value) els.dob.value = ''; });
  els.dob.addEventListener('input', () => { if (els.dob.value) els.age.value = ''; });

  // Switch modes when the viewport crosses the breakpoint. matchMedia's own
  // change event covers real browsers; a guarded resize listener is a robust
  // fallback (and only fires setMode when the mode actually changes).
  mq.addEventListener('change', setMode);
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (mq.matches !== LIVE) setMode(); }, 150);
  });
})();
