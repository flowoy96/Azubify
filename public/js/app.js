import { h, $, clear, api, icon, toast, modal, confirmDialog, formDialogSubmit, ROLE, themeToggle } from './ui.js';
import * as V from './views.js';

const app = $('#app');
const state = { user: null };
let cleanup = null;

// ─── Routing ───
const routes = [
  [/^\/?$/, (u) => (u.role === 'azubi' ? V.azubiHome : V.staffDashboard)],
  [/^\/topics$/, (u) => (u.role === 'azubi' ? V.azubiHome : V.staffTopics)],
  [/^\/topic\/(\d+)$/, (u) => (u.role === 'azubi' ? V.azubiTopic : V.staffTopic)],
  [/^\/task\/(\d+)$/, (u) => (u.role === 'azubi' ? V.azubiTask : V.staffPreview)],
  [/^\/edit\/(\d+)$/, (u) => (u.role === 'azubi' ? null : V.taskEditor)],
  [/^\/results\/(\d+)$/, (u) => (u.role === 'azubi' ? null : V.taskResults)],
  [/^\/submission\/(\d+)$/, (u) => (u.role === 'azubi' ? null : V.submissionReview)],
  [/^\/azubi\/(\d+)$/, (u) => (u.role === 'azubi' ? null : V.azubiDetail)],
  [/^\/users$/, (u) => (u.role === 'admin' ? V.adminUsers : null)],
];

async function route() {
  if (!state.user) return;
  if (cleanup) { try { await cleanup(); } catch { /* egal */ } cleanup = null; }
  const path = (location.hash.slice(1) || '/').split('?')[0];
  let view = null, args = [];
  for (const [re, pick] of routes) {
    const m = path.match(re);
    if (m) { view = pick(state.user); args = m.slice(1).map(Number); break; }
  }
  renderShell();
  const main = $('#view');
  if (!view) { clear(main).append(h('div', { class: 'empty' }, h('div', { class: 'big' }, 'Seite nicht gefunden'), h('a', { href: '#/' }, 'Zur Startseite'))); return; }
  clear(main).append(h('div', { class: 'loading' }, h('div', { class: 'spin' })));
  window.scrollTo(0, 0);
  try {
    const res = await view(main, ...args, state.user);
    if (typeof res === 'function') cleanup = res;
  } catch (e) {
    if (location.hash.slice(1) !== path && (location.hash.slice(1) || '/') !== path) return;
    clear(main).append(h('div', { class: 'empty' }, h('div', { class: 'ico' }, icon('info', 24)), h('div', { class: 'big' }, e.status === 403 || e.status === 404 ? 'Nicht verfügbar' : 'Fehler'), e.message, h('div', { style: { marginTop: '16px' } }, h('a', { href: '#/' }, 'Zur Startseite'))));
  }
}

// ─── Shell ───
function renderShell() {
  const u = state.user, path = (location.hash.slice(1) || '/');
  const staff = u.role !== 'azubi';
  const tabs = staff
    ? [['/', 'Übersicht', 'chart'], ['/topics', 'Themen & Aufgaben', 'book'], u.role === 'admin' && ['/users', 'Benutzer', 'users']]
    : [['/', 'Meine Aufgaben', 'book']];
  const isOn = (p) => (p === '/' ? path === '/' || /^\/(azubi|submission)/.test(path) && staff : path.startsWith(p) || (p === '/topics' && /^\/(topic|task|edit|results)/.test(path) && staff));
  let shell = $('#shell');
  const nav = h('header', { class: 'nav' }, h('div', { class: 'nav-in' },
    h('a', { class: 'brand', href: '#/' }, h('span', { class: 'brand-mark' }, 'A'), 'Azubify'),
    h('nav', { style: { display: 'flex', gap: '4px' }, 'aria-label': 'Hauptnavigation' }, tabs.filter(Boolean).map(([p, l, ic]) => h('a', { class: 'tab' + (isOn(p) ? ' on' : ''), href: '#' + p, 'aria-current': isOn(p) ? 'page' : undefined }, icon(ic, 17), h('span', null, l)))),
    h('div', { class: 'grow' }), themeToggle(), accountMenu()));
  if (!shell) { clear(app).append(h('div', { id: 'shell' }, nav, h('main', { id: 'view' }))); return; }
  shell.firstChild.replaceWith(nav);
}
function accountMenu() {
  const u = state.user;
  const pop = h('div', { class: 'menu-pop', hidden: true, role: 'menu' },
    h('div', { class: 'who' }, h('div', { style: { fontWeight: 600 } }, u.displayName), h('div', { class: 'small muted' }, `${ROLE[u.role]} · @${u.username}`)),
    h('button', { role: 'menuitem', onclick: () => { pop.hidden = true; changePassword(); } }, icon('key', 16), 'Passwort ändern'),
    h('button', { role: 'menuitem', onclick: async () => { await api('POST', '/logout'); state.user = null; showLogin(); } }, icon('logout', 16), 'Abmelden'));
  const btn = h('button', { class: 'icon-btn', style: { width: '36px', height: '36px' }, 'aria-haspopup': 'menu', 'aria-label': 'Konto', onclick: (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; } },
    h('span', { class: 'avatar' }, u.displayName.trim().split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase()));
  const close = (e) => { if (!pop.contains(e.target)) pop.hidden = true; };
  document.addEventListener('click', close);
  new MutationObserver((_, o) => { if (!document.contains(pop)) { document.removeEventListener('click', close); o.disconnect(); } }).observe(document.body, { childList: true, subtree: true });
  return h('div', { class: 'menu' }, btn, pop);
}

function changePassword(forced = false) {
  return formDialogSubmit({
    title: forced ? 'Bitte neues Passwort festlegen' : 'Passwort ändern',
    fields: [
      { name: 'current', label: 'Aktuelles Passwort', type: 'password' },
      { name: 'next', label: 'Neues Passwort', type: 'password', hint: 'Mindestens 8 Zeichen.' },
      { name: 'again', label: 'Neues Passwort wiederholen', type: 'password' },
    ],
    submitLabel: 'Ändern',
    onSubmit: async (v) => {
      if (v.next !== v.again) throw new Error('Die neuen Passwörter stimmen nicht überein.');
      await api('POST', '/me/password', { current: v.current, next: v.next });
      state.user.mustChangePw = false; toast('Passwort geändert.');
    },
  });
}

// ─── Login ───
function showLogin(message) {
  cleanup && cleanup(); cleanup = null;
  const err = h('div', { class: 'form-error', role: 'alert' }, message || '');
  const user = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: false, required: true, 'aria-label': 'Benutzername', autofocus: true });
  const pw = h('input', { type: 'password', autocomplete: 'current-password', required: true, 'aria-label': 'Passwort' });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Anmelden');
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault(); err.textContent = ''; btn.disabled = true;
    try { const r = await api('POST', '/login', { username: user.value, password: pw.value }); state.user = r.user; start(); }
    catch (ex) { err.textContent = ex.message; btn.disabled = false; pw.select(); }
  } },
  h('label', { class: 'field' }, h('span', null, 'Benutzername'), user), h('label', { class: 'field' }, h('span', null, 'Passwort'), pw), err, btn);
  clear(app).append(h('div', { class: 'login' }, themeToggle('login-theme'), h('div', { class: 'login-box' },
    h('div', { class: 'brand-mark' }, 'A'), h('h1', null, 'Azubify'), h('p', { class: 'muted' }, 'Lernen, üben, nachweisen.'), h('div', { class: 'card' }, form))));
  user.focus();
}

function start() {
  if (!state.user) return showLogin();
  route();
  if (state.user.mustChangePw) changePassword(true);
}
window.addEventListener('hashchange', route);
window.addEventListener('azubify:unauth', () => { if (state.user) { state.user = null; showLogin('Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.'); } });

(async () => {
  try { const r = await api('GET', '/me'); state.user = r.user; } catch { /* offline */ }
  state.user ? start() : showLogin();
})();
