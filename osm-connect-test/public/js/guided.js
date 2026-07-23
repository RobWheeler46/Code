import { el, api, initPage, renderMessage, statusPill } from './app.js';

const state = await initPage();

const startBtn = document.getElementById('start-btn');
const cancelBtn = document.getElementById('cancel-btn');
const stageList = document.getElementById('stage-list');
const overallArea = document.getElementById('overall-area');
const progressText = document.getElementById('progress-text');
const progressFill = document.getElementById('progress-fill');
const progressTrack = document.getElementById('progress-track');

// FR-TEST-001: every stage is displayed before it runs.
const { data: stageData } = await api('/api/stages');
let stages = stageData.stages.map((s) => ({ ...s, status: 'Waiting', summary: null, message: null }));
render();

const pretest = el('dl', { class: 'facts' });
const add = (t, v) => { pretest.appendChild(el('dt', { text: t })); pretest.appendChild(typeof v === 'string' ? el('dd', { text: v }) : el('dd', {}, [v])); };
add('Connection state', statusPill(state.connectionState));
add('Selected section', state.selectedSection ? `${state.selectedSection.name} (${state.selectedSection.maskedId})` : 'None selected — the test will select one if it can');
add('Stages to run', String(stages.length));
add('Read only', 'Yes. No write operation exists in this release.');
document.getElementById('pretest-area').replaceChildren(pretest);

const connected = state.connectionState === 'Connected' || state.connectionState === 'Connected with warnings'
  || state.connectionState === 'Authentication expired';
if (!connected) {
  startBtn.disabled = true;
  document.getElementById('pretest-area').appendChild(
    el('p', { class: 'hint', text: 'You need a valid OSM connection before the guided test can run. Connect from the home page first.' })
  );
}

let sessionRef = null;
let poller = null;

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  overallArea.replaceChildren();
  const { ok, data } = await api('/api/test/guided', { method: 'POST', body: {} });
  if (!ok) {
    startBtn.disabled = false;
    overallArea.replaceChildren(data.message ? renderMessage(data.message) : el('p', { text: data.error || 'The test could not be started.' }));
    return;
  }
  sessionRef = data.sessionRef;
  cancelBtn.disabled = false;
  apply(data);
  poller = setInterval(poll, 700);
});

cancelBtn.addEventListener('click', async () => {
  if (!sessionRef) return;
  cancelBtn.disabled = true;
  const { data } = await api(`/api/test/guided/${encodeURIComponent(sessionRef)}/cancel`, { method: 'POST', body: {} });
  apply(data);
});

async function poll() {
  if (!sessionRef) return;
  const { ok, data } = await api(`/api/test/guided/${encodeURIComponent(sessionRef)}`);
  if (!ok) { clearInterval(poller); return; }
  apply(data);
  if (!data.running) {
    clearInterval(poller);
    startBtn.disabled = false;
    cancelBtn.disabled = true;
  }
}

function apply(snapshot) {
  stages = snapshot.stages;
  render();
  if (snapshot.message) {
    overallArea.replaceChildren(...[
      el('h3', {}, ['Overall result: ', statusPill(snapshot.overall || 'Running')]),
      renderMessage(snapshot.message),
      snapshot.primaryFailure
        ? el('p', { text: `Review the first failed stage first: ${snapshot.primaryFailure.stage}.` })
        : null,
      el('div', { class: 'actions' }, [
        el('a', { class: 'button secondary', href: `/report.html?ref=${encodeURIComponent(snapshot.sessionRef)}`, text: 'View diagnostic report' }),
        el('a', { class: 'button secondary', href: `/api/report/${encodeURIComponent(snapshot.sessionRef)}?format=text`, text: 'Download sanitised text report' })
      ])
    ].filter(Boolean));
  }
}

function render() {
  stageList.replaceChildren(...stages.map((stage) => {
    const li = el('li');
    li.appendChild(el('span', { class: 'stage-name', text: stage.name }));
    li.appendChild(statusPill(stage.status));
    if (stage.summary) li.appendChild(el('p', { class: 'stage-summary', text: stage.summary }));
    if (stage.durationMs !== null && stage.durationMs !== undefined) {
      li.appendChild(el('p', {
        class: 'stage-summary',
        text: `Started ${stage.startedAt ? new Date(stage.startedAt).toLocaleTimeString('en-GB') : '—'} · took ${stage.durationMs} ms`
      }));
    }
    if (stage.message || stage.technical) {
      const wrap = el('div', { class: 'stage-detail' });
      const details = el('details');
      details.appendChild(el('summary', { text: 'Show technical details' }));
      if (stage.message) details.appendChild(renderMessage(stage.message));
      if (stage.technical) details.appendChild(el('pre', { text: JSON.stringify(stage.technical, null, 2) }));
      details.appendChild(el('p', { class: 'hint', text: 'All technical information shown here is sanitised before display.' }));
      wrap.appendChild(details);
      li.appendChild(wrap);
    }
    return li;
  }));

  const done = stages.filter((s) => !['Waiting', 'Running'].includes(s.status)).length;
  const percent = stages.length ? Math.round((done / stages.length) * 100) : 0;
  progressFill.style.width = `${percent}%`;
  progressTrack.setAttribute('aria-label', `Test progress ${percent} per cent`);
  const running = stages.find((s) => s.status === 'Running');
  progressText.textContent = running
    ? `Running: ${running.name} (${done} of ${stages.length} stages complete).`
    : `${done} of ${stages.length} stages complete.`;
}
