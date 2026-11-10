// Kleine UI-Helfer: DOM-Builder, API-Client, Dialoge, Icons
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else if (k in el && typeof v !== 'string' && k !== 'list') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
}
export const $ = (sel, root = document) => root.querySelector(sel);
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

// ─── API ───
export class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
export async function api(method, url, body, opts = {}) {
  let res;
  try {
    res = await fetch('/api' + url, {
      method, credentials: 'same-origin', keepalive: !!opts.keepalive,
      headers: body !== undefined && !(body instanceof Blob) ? { 'Content-Type': 'application/json' } : undefined,
      body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
    });
  } catch { throw new ApiError('Keine Verbindung zum Server.', 0); }
  let data = null;
  try { data = await res.json(); } catch { /* leer */ }
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/login') && !url.startsWith('/me')) window.dispatchEvent(new Event('azubify:unauth'));
    throw new ApiError((data && data.error) || 'Unbekannter Fehler.', res.status);
  }
  return data;
}

// ─── Icons (SF-Symbols-ähnlich, 1.7px Strich) ───
const P = {
  home: 'M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10',
  book: 'M4 5.5A1.5 1.5 0 0 1 5.5 4H20v15H5.5A1.5 1.5 0 0 0 4 20.5zM4 20.5A1.5 1.5 0 0 0 5.5 22H20',
  users: 'M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM20 20v-1.5a3.5 3.5 0 0 0-2.5-3.3M15.5 5.2a3.5 3.5 0 0 1 0 6.6',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  plus: 'M12 5v14M5 12h14',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6 6 18',
  chevron: 'm9 6 6 6-6 6',
  back: 'm15 6-6 6 6 6',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  logout: 'M10 4H5v16h5M15 8l4 4-4 4M19 12H9',
  key: 'M14 10a4 4 0 1 0-3.8 4L14 17.5h2v2h2v-2h1.5v-2L14.8 10.8',
  inbox: 'M3 13h5l1.5 3h5l1.5-3h5M5 5h14l2 8v6H3v-6z',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M9 9.5h.01',
  code: 'm8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14',
  info: 'M12 11v6M12 7.5h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  olist: 'M10 6h10M10 12h10M10 18h10M4 5l1.5-1v4M4 14.5h2.5L4 17.5h2.5',
  cloud: 'M7 18a4.5 4.5 0 0 1-.5-9A6 6 0 0 1 18 10a4 4 0 0 1-.5 8z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 20a7 7 0 0 1 14 0',
};
export function icon(name, size = 18) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.7');
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', P[name] || ''); s.append(p);
  return s;
}

// ─── Toast ───
let toastTimer;
export function toast(msg, kind = '') {
  let t = $('#toast');
  if (!t) { t = h('div', { id: 'toast', role: 'status' }); document.body.append(t); }
  t.className = 'show ' + kind; t.textContent = msg;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ''; }, 3200);
}

// ─── Dialoge ───
export function modal({ title, body, actions = [], wide = false }) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const close = (v) => { overlay.classList.add('out'); setTimeout(() => { overlay.remove(); prevFocus && prevFocus.focus && prevFocus.focus(); }, 160); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(undefined); };
    const footer = h('div', { class: 'modal-actions' }, actions.map((a) => h('button', {
      class: 'btn ' + (a.kind || ''), type: 'button',
      onclick: async () => { if (a.onclick) { const r = await a.onclick(close); if (r === false) return; } close(a.value); },
    }, a.label)));
    const overlay = h('div', { class: 'overlay', onmousedown: (e) => { if (e.target === overlay) close(undefined); } },
      h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('h2', null, title), h('div', { class: 'modal-body' }, body), footer));
    document.body.append(overlay);
    document.addEventListener('keydown', onKey);
    const first = overlay.querySelector('input, textarea, select') || overlay.querySelector('.btn.primary');
    first && first.focus();
  });
}
export const confirmDialog = (title, text, okLabel = 'Löschen', danger = true) => modal({
  title, body: h('p', { class: 'muted' }, text),
  actions: [{ label: 'Abbrechen', value: false }, { label: okLabel, kind: danger ? 'danger' : 'primary', value: true }],
}).then((v) => !!v);

/** Formular-Dialog: fields = [{name,label,type,value,options,hint}]; Fehler aus onSubmit erscheinen im Dialog. */
export function formDialogSubmit({ title, fields, submitLabel = 'Speichern', onSubmit }) {
  const inputs = {};
  const err = h('div', { class: 'form-error', role: 'alert' });
  const body = h('form', { autocomplete: 'off', onsubmit: (e) => { e.preventDefault(); btn.click(); } }, fields.map((f) => {
    let el;
    if (f.type === 'select') el = h('select', null, f.options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(f.value) }, l)));
    else if (f.type === 'textarea') el = h('textarea', { rows: 3, value: f.value || '' });
    else if (f.type === 'color') {
      el = h('div', { class: 'swatches' });
      let cur = f.value || 'blue';
      for (const c of ['blue', 'green', 'orange', 'purple', 'red', 'teal', 'pink', 'gray']) {
        const b = h('button', { type: 'button', class: `swatch c-${c}` + (c === cur ? ' on' : ''), 'aria-label': c, onclick: () => { cur = c; el.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('on', s === b)); } });
        el.append(b);
      }
      el.get = () => cur;
    } else el = h('input', { type: f.type || 'text', value: f.value ?? '', placeholder: f.placeholder || '', autocomplete: f.type === 'password' ? 'new-password' : 'off' });
    inputs[f.name] = el;
    return h('label', { class: 'field' }, h('span', null, f.label), el, f.hint && h('small', null, f.hint));
  }), h('button', { type: 'submit', hidden: true }));
  let btn;
  const p = modal({
    title, body: h('div', null, body, err),
    actions: [{ label: 'Abbrechen', value: null }, {
      label: submitLabel, kind: 'primary', value: true,
      onclick: async () => {
        const out = {};
        for (const f of fields) out[f.name] = inputs[f.name].get ? inputs[f.name].get() : inputs[f.name].value;
        err.textContent = '';
        try { await onSubmit(out); return true; } catch (e) { err.textContent = e.message; return false; }
      },
    }],
  });
  btn = document.querySelector('.modal-actions .btn.primary');
  return p;
}

// ─── Formatierung ───
export function fmtDate(s, withTime = false) {
  if (!s) return '';
  const d = new Date(s.length <= 10 ? s + 'T00:00:00' : s.replace(' ', 'T') + 'Z');
  if (isNaN(d)) return s;
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + (withTime ? ', ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '');
}
export const fmtNum = (n) => (Math.round(n * 100) / 100).toLocaleString('de-DE');
export const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
export function isOverdue(due) { return due && due < new Date().toISOString().slice(0, 10); }

export function progressBar(value, color = 'blue') {
  return h('div', { class: `bar c-${color}`, role: 'progressbar', 'aria-valuenow': Math.round(value), 'aria-valuemin': 0, 'aria-valuemax': 100 },
    h('i', { style: { width: Math.max(0, Math.min(100, value)) + '%' } }));
}
export function ring(value, size = 44, color = 'blue') {
  const r = (size - 6) / 2, c = 2 * Math.PI * r;
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg'); s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('class', `ring c-${color}`);
  const mk = (cls, extra = {}) => { const e = document.createElementNS(ns, 'circle'); e.setAttribute('cx', size / 2); e.setAttribute('cy', size / 2); e.setAttribute('r', r); e.setAttribute('class', cls); for (const [k, v] of Object.entries(extra)) e.setAttribute(k, v); return e; };
  s.append(mk('ring-bg'), mk('ring-fg', { 'stroke-dasharray': c, 'stroke-dashoffset': c * (1 - Math.min(1, value / 100)), transform: `rotate(-90 ${size / 2} ${size / 2})` }));
  return h('div', { class: 'ring-wrap', style: { width: size + 'px', height: size + 'px' } }, s, h('span', null, Math.round(value) + '%'));
}
export const STATUS = {
  open: ['Offen', 'gray'], started: ['In Bearbeitung', 'blue'], returned: ['Überarbeiten', 'orange'],
  submitted: ['Abgegeben', 'purple'], reviewed: ['Bewertet', 'green'],
};
export const statusPill = (s) => h('span', { class: `pill c-${(STATUS[s] || STATUS.open)[1]}` }, (STATUS[s] || STATUS.open)[0]);
export const ROLE = { admin: 'Admin', ausbilder: 'Ausbilder', azubi: 'Azubi' };
