import { el, api, initPage, renderMessage } from './app.js';

const state = await initPage();
const { data } = await api('/oauth/outcome');

document.getElementById('outcome-area').replaceChildren(renderMessage(data.message));

const next = document.getElementById('next-area');
const connected = state.connectionState === 'Connected' || state.connectionState === 'Connected with warnings';
if (connected) {
  next.appendChild(el('a', { class: 'button', href: '/guided.html', text: 'Run guided test' }));
  next.appendChild(el('a', { class: 'button secondary', href: '/sections.html', text: 'Sections and permissions' }));
  next.appendChild(el('a', { class: 'button secondary', href: '/dashboard.html', text: 'Connection dashboard' }));
} else {
  next.appendChild(el('a', { class: 'button', href: '/oauth/connect', text: 'Start a new connection attempt' }));
  next.appendChild(el('a', { class: 'button secondary', href: '/index.html', text: 'Back to home' }));
  next.appendChild(el('a', { class: 'button secondary', href: '/help.html', text: 'Help and message catalogue' }));
}
