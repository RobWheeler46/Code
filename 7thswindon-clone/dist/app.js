// 7th Swindon Scouts — reproduction of the site's interactive behaviour.
// (FAQ accordion, mobile nav.) Shared by index.html and agm.html, so every
// block is guarded to no-op on pages that don't contain its markup.

/* ---------- Mobile navigation ---------- */
const menuBtn = document.getElementById('mobileMenuBtn');
const mobileMenu = document.getElementById('mobileMenu');
if (menuBtn && mobileMenu) {
  menuBtn.addEventListener('click', () => {
    const open = !mobileMenu.classList.toggle('hidden');
    menuBtn.setAttribute('aria-expanded', String(open));
  });
  document.querySelectorAll('.mobile-link').forEach((a) =>
    a.addEventListener('click', () => {
      mobileMenu.classList.add('hidden');
      menuBtn.setAttribute('aria-expanded', 'false');
    })
  );
}

/* ---------- Mark the current top-level nav item (NAV-004) ---------- */
(function () {
  const page = location.pathname.split('/').pop() || 'index.html';
  const map = {
    '': 'home', 'index.html': 'home',
    'find-your-section.html': 'join', 'how-joining-works.html': 'join', 'inclusion.html': 'join',
    'contact.html': 'contact',
    'beavers.html': 'what', 'cubs.html': 'what', 'scouts.html': 'what', 'explorers.html': 'what',
    'adventures.html': 'what',
    'volunteer.html': 'volunteer',
    'about.html': 'about', 'support.html': 'about', 'safeguarding.html': 'about', 'agm.html': 'about',
  };
  const key = map[page];
  if (key) document.querySelectorAll('.mainnav [data-nav="' + key + '"]').forEach((a) => a.classList.add('nav-active'));
})();

/* ---------- Homepage inline finder → hand off to the wizard ---------- */
/* Carries the age via sessionStorage (ephemeral, per-session) — never the URL,
   never analytics — so the finder rules are preserved (FIND-002/009/010). */
const homeFinder = document.getElementById('homeFinder');
if (homeFinder) {
  homeFinder.addEventListener('submit', (e) => {
    e.preventDefault();
    const err = document.getElementById('hf-err');
    const dob = document.getElementById('hf-dob').value;
    const age = document.getElementById('hf-age').value;
    const day = document.getElementById('hf-day').value;
    if (err) err.textContent = '';
    if (!dob && !age) { if (err) err.textContent = "Please enter your child's date of birth or age."; return; }
    try { sessionStorage.setItem('finderPrefill', JSON.stringify({ dob, age, day })); } catch (_) {}
    window.location.href = 'find-your-section.html';
  });
  // Age and DOB shouldn't both be set.
  const hfAge = document.getElementById('hf-age');
  const hfDob = document.getElementById('hf-dob');
  hfAge.addEventListener('input', () => { if (hfAge.value) hfDob.value = ''; });
  hfDob.addEventListener('input', () => { if (hfDob.value) hfAge.value = ''; });
}

/* ---------- Contact form ---------- */
const contactForm = document.getElementById('contactForm');
if (contactForm) {
  const status = document.getElementById('contactStatus');
  const setStatus = (kind, msg) => { status.className = 'contact-status ' + kind; status.textContent = msg; };
  // Existing-member deflection (CON-004): point them to 7thPortal, without trapping.
  const typeSel = document.getElementById('cf-type');
  const deflect = document.getElementById('cf-deflect');
  if (typeSel && deflect) typeSel.addEventListener('change', () => { deflect.hidden = typeSel.value !== 'Existing member'; });
  // Time-trap: record when the form loaded so the server can reject bot-speed submits.
  const cfStart = Date.now();
  contactForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(contactForm);
    data.append('elapsed', Date.now() - cfStart);
    // Honeypot: real users can't see this field, so if it's filled, drop silently.
    if ((data.get('website') || '').trim()) { setStatus('ok', 'Thanks! Your message has been sent.'); contactForm.reset(); return; }
    const name = (data.get('name') || '').trim();
    const email = (data.get('email') || '').trim();
    const type = (data.get('enquiryType') || '').trim();
    const message = (data.get('message') || '').trim();
    if (!type) { setStatus('err', 'Please choose what your enquiry is about.'); return; }
    if (!name || !email || !message) { setStatus('err', 'Please fill in your name, email and message.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setStatus('err', 'Please enter a valid email address.'); return; }
    const btn = contactForm.querySelector('button[type="submit"]');
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Sending…'; setStatus('', '');
    try {
      const res = await fetch(contactForm.action, { method: 'POST', headers: { Accept: 'application/json' }, body: data });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok) {
        contactForm.reset();
        setStatus('ok', json.message || "Thanks! Your message has been sent, we'll be in touch soon.");
      } else {
        setStatus('err', json.message || 'Sorry, something went wrong. Please try again in a moment.');
      }
    } catch (err) {
      setStatus('err', "Sorry, we couldn't send that. Please try again in a moment.");
    } finally {
      btn.disabled = false; btn.textContent = label;
    }
  });
}

/* ---------- FAQ accordion ---------- */
const faqs = [
  { q: 'How much does it cost?', a: 'Subscription fees vary by section but typically range from £3 to 5 per week, which covers weekly meetings, activities, and insurance. Additional costs apply for camps and special events. We never want cost to be a barrier. Please speak to us if you need support.' },
  { q: 'What uniform do they need?', a: "Each section has a specific uniform consisting of a colored shirt/sweatshirt and scarf (necker). Uniform can be purchased from Scout Shops or online. We can provide guidance on second-hand options and what's essential and what's optional." },
  { q: 'Can my child join mid-year?', a: "Yes! Scouts can join at any time during the year. We operate on a rolling admissions basis through our waiting list. Once a space becomes available in your local section, we'll be in touch." },
  { q: 'What happens at the first meeting?', a: 'New members are warmly welcomed and paired with existing scouts. The first meeting usually involves games, getting to know the leaders and other young people, and an introduction to what Scouts is all about. No uniform needed for the first session!' },
  { q: 'Do you go camping?', a: 'Yes! Camping is a core part of Scouting. Beavers do sleepovers, Cubs do indoor and outdoor camps, and Scouts regularly camp outdoors. We also run district camps and annual summer camps. All camps are fully risk-assessed and led by qualified leaders.' },
  { q: 'How can I volunteer?', a: "We're always looking for volunteers! You don't need Scouting experience - full training is provided. Roles range from helping at weekly meetings to supporting camps and activities. Time commitments are flexible. Get in touch through our contact page to learn more." },
  { q: 'Is Scouting safe?', a: 'Safety is our top priority. All adult volunteers are DBS checked, complete safeguarding training, and follow Scout Association policies. We have comprehensive risk assessments for all activities and maintain high adult-to-young person ratios.' },
  { q: 'What will my child learn?', a: 'Scouts develop skills for life including teamwork, leadership, resilience, outdoor skills, first aid, cooking, and much more. They work towards badges and awards while having fun with friends. Each section has an age-appropriate program focused on personal development.' },
  { q: 'How is 7th Swindon run?', a: "We're governed by a volunteer Trustee Board. The board includes our Group Lead Volunteer, Chair, Treasurer, Secretary, section leaders, and parent representatives. We meet regularly to ensure the group runs safely and effectively. All trustees are DBS checked and complete safeguarding training. We operate as part of The Scout Association (Registered Charity 306101)." },
  { q: 'What age can my child join?', a: "Children must be aged 5 or above to join our waiting list. Our Beavers section caters for ages 6 to 8, Cubs for ages 8 to 10½, Scouts for ages 10½ to 14, and Explorers for ages 14 to 18. We'll place your child in the appropriate section based on their age when a space becomes available." },
];

const faqList = document.getElementById('faqList');
if (faqList) faqs.forEach((item) => {
  const wrap = document.createElement('div');
  wrap.className = 'border-2 border-gray-200 rounded-xl overflow-hidden transition-all';
  wrap.innerHTML =
    '<button class="w-full px-6 py-5 text-left flex justify-between items-center hover:bg-gray-50 transition-colors">' +
      '<span class="text-lg font-semibold pr-8"></span>' +
      '<span class="text-2xl text-purple-600 transition-transform">+</span>' +
    '</button>' +
    '<div class="faq-answer hidden px-6 pb-5 text-gray-600 leading-relaxed border-t border-gray-200 pt-4 bg-gray-50"></div>';
  wrap.querySelector('span').textContent = item.q;
  wrap.querySelector('div').textContent = item.a;
  const btn = wrap.querySelector('button');
  const plus = wrap.querySelectorAll('span')[1];
  const answer = wrap.querySelector('div');
  btn.addEventListener('click', () => {
    const open = !answer.classList.contains('hidden');
    // close all
    faqList.querySelectorAll('.faq-answer').forEach((d) => d.classList.add('hidden'));
    faqList.querySelectorAll('button span:last-child').forEach((p) => p.classList.remove('rotate-45'));
    if (!open) {
      answer.classList.remove('hidden');
      plus.classList.add('rotate-45');
    }
  });
  faqList.appendChild(wrap);
});
