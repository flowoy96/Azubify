// Block-Editor für Aufgaben (WYSIWYG) mit automatischem Speichern
import { h, icon, api, toast, clear } from './ui.js';

const TYPES = {
  heading: ['Überschrift', 'edit'], text: ['Text', 'list'], callout: ['Hinweis', 'info'], code: ['Code', 'code'], image: ['Bild', 'image'], divider: ['Trennlinie', 'more'],
  short: ['Kurzantwort', 'edit'], long: ['Freitext', 'edit'], single: ['Single Choice', 'check'], multi: ['Multiple Choice', 'check'], number: ['Zahl', 'edit'], cloze: ['Lückentext', 'edit'],
};
const CONTENT = ['heading', 'text', 'callout', 'code', 'image', 'divider'];
const QUESTIONS = ['short', 'long', 'single', 'multi', 'number', 'cloze'];
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : 'b' + Math.random().toString(36).slice(2) + Date.now().toString(36));

function defaults(type) {
  const b = { id: newId(), type };
  switch (type) {
    case 'heading': Object.assign(b, { text: '', level: 2 }); break;
    case 'text': b.html = ''; break;
    case 'callout': Object.assign(b, { variant: 'info', html: '' }); break;
    case 'code': b.text = ''; break;
    case 'image': Object.assign(b, { src: '', caption: '' }); break;
    case 'short': Object.assign(b, { question: '', points: 1, solution: [], caseSensitive: false }); break;
    case 'long': Object.assign(b, { question: '', points: 5, sample: '', rows: 6 }); break;
    case 'single': Object.assign(b, { question: '', points: 1, options: ['', ''], correct: -1 }); break;
    case 'multi': Object.assign(b, { question: '', points: 2, options: ['', ''], correct: [] }); break;
    case 'number': Object.assign(b, { question: '', points: 1, solution: null, tolerance: 0, unit: '' }); break;
    case 'cloze': Object.assign(b, { question: 'Setze die fehlenden Wörter ein.', points: 2, text: '' }); break;
  }
  return b;
}

/** Rich-Text-Feld mit kleiner Werkzeugleiste. */
function richField(value, placeholder, onInput, { boxed = false, toolbar = true } = {}) {
  const ed = h('div', { class: 'rt' + (boxed ? ' boxed' : ''), contentEditable: 'true', 'data-ph': placeholder, role: 'textbox', 'aria-multiline': 'true', html: value || '' });
  ed.addEventListener('input', () => onInput(ed.innerHTML));
  ed.addEventListener('paste', (e) => { // nur Text einfügen
    e.preventDefault();
    const t = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, t);
  });
  ed.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && ['b', 'i', 'u'].includes(e.key.toLowerCase())) { e.preventDefault(); document.execCommand({ b: 'bold', i: 'italic', u: 'underline' }[e.key.toLowerCase()]); onInput(ed.innerHTML); }
  });
  const cmd = (c, arg) => (e) => { e.preventDefault(); ed.focus(); document.execCommand(c, false, arg); onInput(ed.innerHTML); };
  const btn = (label, title, fn, ic) => h('button', { type: 'button', title, 'aria-label': title, onmousedown: (e) => e.preventDefault(), onclick: fn }, ic ? icon(ic, 15) : label);
  const bar = h('div', { class: 'rt-bar' },
    btn('B', 'Fett (Strg+B)', cmd('bold')));
  bar.append(
    h('button', { type: 'button', title: 'Kursiv (Strg+I)', 'aria-label': 'Kursiv', onmousedown: (e) => e.preventDefault(), onclick: cmd('italic') }, h('i', null, 'I')),
    h('button', { type: 'button', title: 'Unterstrichen (Strg+U)', 'aria-label': 'Unterstrichen', onmousedown: (e) => e.preventDefault(), onclick: cmd('underline') }, h('u', null, 'U')),
    btn('', 'Aufzählung', cmd('insertUnorderedList'), 'list'), btn('', 'Nummerierung', cmd('insertOrderedList'), 'olist'),
    btn('', 'Code', (e) => { e.preventDefault(); ed.focus(); const sel = getSelection().toString(); if (sel) document.execCommand('insertHTML', false, `<code>${sel.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</code>`); onInput(ed.innerHTML); }, 'code'),
    btn('', 'Link', (e) => { e.preventDefault(); const sel = window.getSelection(); const range = sel.rangeCount ? sel.getRangeAt(0) : null; const url = prompt('Link-Adresse (https://…)'); if (url && /^(https?:|mailto:)/i.test(url)) { sel.removeAllRanges(); range && sel.addRange(range); ed.focus(); document.execCommand('createLink', false, url); onInput(ed.innerHTML); } }, 'link'),
    btn('', 'Formatierung entfernen', cmd('removeFormat'), 'x'),
  );
  return h('div', null, toolbar && bar, ed);
}

const labeled = (text, el) => h('label', { class: '' }, h('span', { class: 'lbl' }, text), el);

export function mountEditor(container, { taskId, onTitle }) {
  const state = { task: null, blocks: [], dirty: false, saving: false, timer: null };
  const LS = `azubify:task:${taskId}`;
  const saveEl = h('span', { class: 'save-state' });
  const setSave = (kind, text) => { saveEl.className = 'save-state ' + kind; clear(saveEl).append(kind === 'ok' ? icon('check', 15) : '', text); };

  async function flush() {
    if (!state.dirty || state.saving) return;
    state.saving = true; state.dirty = false; setSave('', 'Speichert …');
    const payload = { title: state.task.title, blocks: state.blocks, status: state.task.status, dueDate: state.task.dueDate || '' };
    try {
      await api('PUT', `/tasks/${taskId}`, payload);
      try { localStorage.removeItem(LS); } catch { /* egal */ }
      if (!state.dirty) setSave('ok', 'Gespeichert');
    } catch (e) { state.dirty = true; setSave('err', e.status === 0 ? 'Offline – wird erneut versucht' : e.message); }
    state.saving = false;
    if (state.dirty) { clearTimeout(state.timer); state.timer = setTimeout(flush, 2500); }
  }
  function touch() {
    state.dirty = true; setSave('', 'Ungespeichert …');
    try { localStorage.setItem(LS, JSON.stringify({ title: state.task.title, blocks: state.blocks, dueDate: state.task.dueDate, ts: Date.now() })); } catch { /* egal */ }
    clearTimeout(state.timer); state.timer = setTimeout(flush, 700);
  }
  const beforeUnload = (e) => {
    if (state.dirty) {
      // Letzter Versuch per keepalive, Browser-Hinweis falls es nicht reicht
      api('PUT', `/tasks/${taskId}`, { title: state.task.title, blocks: state.blocks, status: state.task.status, dueDate: state.task.dueDate || '' }, { keepalive: true }).catch(() => {});
      e.preventDefault(); e.returnValue = '';
    }
  };
  window.addEventListener('beforeunload', beforeUnload);
  const onVis = () => { if (document.visibilityState === 'hidden') { clearTimeout(state.timer); flush(); } };
  document.addEventListener('visibilitychange', onVis);

  const listEl = h('div', { class: 'ed-blocks' });
  function move(i, d) { const j = i + d; if (j < 0 || j >= state.blocks.length) return; [state.blocks[i], state.blocks[j]] = [state.blocks[j], state.blocks[i]]; renderList(); touch(); }
  function addBlock(type, at) {
    const b = defaults(type);
    state.blocks.splice(at ?? state.blocks.length, 0, b); renderList(); touch();
    const el = listEl.querySelector(`[data-id="${b.id}"]`);
    if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); const f = el.querySelector('[contenteditable],input[type=text],textarea'); f && f.focus(); }
  }

  function renderList() {
    clear(listEl);
    let qn = 0;
    state.blocks.forEach((b, i) => {
      if (QUESTIONS.includes(b.type)) qn++;
      listEl.append(blockEditor(b, i, QUESTIONS.includes(b.type) ? qn : 0));
    });
    if (!state.blocks.length) listEl.append(h('div', { class: 'empty' }, h('div', { class: 'big' }, 'Noch leer'), 'Füge unten Textbausteine und Fragen hinzu.'));
  }

  function blockEditor(b, i, qn) {
    const [label, ic] = TYPES[b.type];
    const set = (patch) => { Object.assign(b, patch); touch(); };
    const head = h('div', { class: 'eb-head' },
      h('span', { class: 'tag' }, icon(ic, 15), qn ? `Frage ${qn} · ${label}` : label),
      b.points !== undefined && h('span', { class: 'pts' }, 'Punkte', h('input', { type: 'number', min: 0, max: 1000, step: 0.5, value: b.points, 'aria-label': 'Punkte', oninput: (e) => set({ points: e.target.value === '' ? 0 : Number(e.target.value) }) })),
      h('span', { class: 'tools' },
        h('button', { class: 'icon-btn', type: 'button', title: 'Nach oben', 'aria-label': 'Nach oben', disabled: i === 0, onclick: () => move(i, -1) }, icon('up', 16)),
        h('button', { class: 'icon-btn', type: 'button', title: 'Nach unten', 'aria-label': 'Nach unten', disabled: i === state.blocks.length - 1, onclick: () => move(i, 1) }, icon('down', 16)),
        h('button', { class: 'icon-btn', type: 'button', title: 'Duplizieren', 'aria-label': 'Duplizieren', onclick: () => { const c = JSON.parse(JSON.stringify(b)); c.id = newId(); state.blocks.splice(i + 1, 0, c); renderList(); touch(); } }, icon('copy', 16)),
        h('button', { class: 'icon-btn danger', type: 'button', title: 'Entfernen', 'aria-label': 'Entfernen', onclick: () => { state.blocks.splice(i, 1); renderList(); touch(); } }, icon('trash', 16))));
    const body = h('div', { class: 'eb-body' });
    const q = () => richField(b.question, 'Fragestellung …', (v) => set({ question: v }), { boxed: true });

    switch (b.type) {
      case 'heading':
        body.append(h('div', { class: 'row' },
          h('input', { type: 'text', value: b.text, placeholder: 'Überschrift', maxLength: 300, style: { fontWeight: 600 }, oninput: (e) => set({ text: e.target.value }) }),
          h('div', { class: 'seg' }, [[2, 'Groß'], [3, 'Klein']].map(([l, t]) => h('button', { type: 'button', class: b.level === l ? 'on' : '', onclick: (e) => { set({ level: l }); e.target.parentNode.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === e.target)); } }, t)))));
        break;
      case 'text': body.append(richField(b.html, 'Text eingeben …', (v) => set({ html: v }))); break;
      case 'callout':
        body.append(h('div', { class: 'seg', style: { alignSelf: 'flex-start' } }, [['info', 'Info'], ['tip', 'Tipp'], ['warn', 'Achtung']].map(([v, t]) => h('button', { type: 'button', class: b.variant === v ? 'on' : '', onclick: (e) => { set({ variant: v }); e.target.parentNode.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === e.target)); } }, t))),
          richField(b.html, 'Hinweistext …', (v) => set({ html: v }), { boxed: true }));
        break;
      case 'code':
        body.append(h('textarea', { rows: 6, value: b.text, placeholder: 'Code …', spellcheck: false, style: { fontFamily: 'var(--mono)', fontSize: '.88rem' }, oninput: (e) => set({ text: e.target.value }) }));
        break;
      case 'image': {
        const prev = h('div');
        const showPrev = () => { clear(prev); if (b.src) prev.append(h('img', { src: b.src, alt: '', style: { maxWidth: '100%', maxHeight: '280px', borderRadius: '12px' } })); };
        showPrev();
        const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', hidden: true, onchange: async () => {
          const f = file.files[0]; if (!f) return;
          try { const r = await api('POST', '/uploads', f); set({ src: r.src }); showPrev(); } catch (e) { toast(e.message, 'err'); }
        } });
        body.append(file, h('div', { class: 'row' }, h('button', { class: 'btn sm', type: 'button', onclick: () => file.click() }, icon('image', 15), b.src ? 'Bild ersetzen' : 'Bild hochladen')), prev,
          labeled('Bildunterschrift (optional)', h('input', { type: 'text', value: b.caption, maxLength: 300, oninput: (e) => set({ caption: e.target.value }) })));
        break;
      }
      case 'divider': body.append(h('hr', { class: 'div', style: { margin: '6px 0' } })); break;
      case 'short':
        body.append(q(),
          labeled('Richtige Antwort(en) – eine pro Zeile (optional, sonst manuelle Bewertung)', h('textarea', { rows: 2, value: b.solution.join('\n'), placeholder: 'z. B. Router', oninput: (e) => set({ solution: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) }) })),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: b.caseSensitive, onchange: (e) => set({ caseSensitive: e.target.checked }) }), 'Groß-/Kleinschreibung beachten'));
        break;
      case 'long':
        body.append(q(), labeled('Musterlösung (nur für Ausbilder und nach der Bewertung sichtbar)', h('textarea', { rows: 3, value: b.sample, oninput: (e) => set({ sample: e.target.value }) })),
          h('p', { class: 'hint' }, 'Freitext wird von dir manuell bewertet. Punkte = 0 bedeutet „unbewertet“.'));
        break;
      case 'single': case 'multi': {
        const multi = b.type === 'multi';
        const opts = h('div', { class: 'stack', style: { gap: '8px' } });
        const draw = () => {
          clear(opts);
          b.options.forEach((o, i) => {
            const on = multi ? b.correct.includes(i) : b.correct === i;
            opts.append(h('div', { class: 'opt-ed' },
              h('input', { type: multi ? 'checkbox' : 'radio', name: 'c' + b.id, checked: on, title: 'Richtige Antwort', 'aria-label': 'Richtige Antwort', onchange: (e) => {
                if (multi) set({ correct: e.target.checked ? [...new Set([...b.correct, i])].sort((a, c) => a - c) : b.correct.filter((x) => x !== i) });
                else set({ correct: i });
              }, onclick: (e) => { if (!multi && b.correct === i) { e.target.checked = false; set({ correct: -1 }); } } }),
              h('input', { type: 'text', value: o, placeholder: `Antwort ${i + 1}`, maxLength: 500, oninput: (e) => { b.options[i] = e.target.value; touch(); } }),
              h('button', { class: 'icon-btn', type: 'button', title: 'Antwort entfernen', 'aria-label': 'Antwort entfernen', disabled: b.options.length <= 2, onclick: () => {
                b.options.splice(i, 1);
                b.correct = multi ? b.correct.filter((x) => x !== i).map((x) => (x > i ? x - 1 : x)) : (b.correct === i ? -1 : b.correct > i ? b.correct - 1 : b.correct);
                draw(); touch();
              } }, icon('x', 15))));
          });
          opts.append(h('div', null, h('button', { class: 'btn sm ghost', type: 'button', disabled: b.options.length >= 12, onclick: () => { b.options.push(''); draw(); touch(); } }, icon('plus', 15), 'Antwort hinzufügen')));
        };
        draw();
        body.append(q(), opts, h('p', { class: 'hint' }, multi ? 'Hake alle richtigen Antworten an. Ohne Markierung wird manuell bewertet.' : 'Markiere die richtige Antwort. Ohne Markierung wird manuell bewertet.'));
        break;
      }
      case 'number':
        body.append(q(), h('div', { class: 'inline-fields' },
          labeled('Richtiger Wert (optional)', h('input', { type: 'text', inputMode: 'decimal', value: b.solution ?? '', oninput: (e) => { const v = e.target.value.replace(',', '.'); set({ solution: v === '' || isNaN(Number(v)) ? null : Number(v) }); } })),
          labeled('Toleranz (±)', h('input', { type: 'text', inputMode: 'decimal', value: b.tolerance || '', placeholder: '0', oninput: (e) => { const v = Number(e.target.value.replace(',', '.')); set({ tolerance: isNaN(v) ? 0 : Math.max(0, v) }); } })),
          labeled('Einheit', h('input', { type: 'text', value: b.unit, maxLength: 20, placeholder: 'z. B. €, mm', oninput: (e) => set({ unit: e.target.value }) }))));
        break;
      case 'cloze':
        body.append(q(), labeled('Text mit Lücken', h('textarea', { rows: 4, value: b.text, placeholder: 'Ein [[Router]] verbindet Netze auf Schicht [[3|drei]] des OSI-Modells.', oninput: (e) => set({ text: e.target.value }) })),
          h('p', { class: 'hint' }, 'Lücken in doppelten eckigen Klammern: [[Lösung]]. Mehrere gültige Lösungen mit | trennen: [[3|drei]].'));
        break;
    }
    return h('section', { class: 'eb', 'data-id': b.id, 'aria-label': label }, head, body);
  }

  const addBar = h('div', { class: 'add-bar' },
    h('p', { class: 'lbl-t' }, 'Baustein hinzufügen'),
    h('div', { class: 'add-grid' },
      CONTENT.map((t) => h('button', { class: 'btn', type: 'button', onclick: () => addBlock(t) }, icon(TYPES[t][1], 15), TYPES[t][0])),
      h('span', { class: 'sep' }),
      QUESTIONS.map((t) => h('button', { class: 'btn', type: 'button', onclick: () => addBlock(t) }, icon('plus', 15), TYPES[t][0]))));

  const titleEl = h('input', { class: 'ed-title', type: 'text', placeholder: 'Titel der Aufgabe', maxLength: 200, 'aria-label': 'Titel',
    oninput: (e) => { state.task.title = e.target.value; touch(); onTitle && onTitle(e.target.value); } });
  const dueEl = h('input', { type: 'date', 'aria-label': 'Fällig am', onchange: (e) => { state.task.dueDate = e.target.value; touch(); } });
  const pubEl = h('div', { class: 'seg' });
  function drawPub() {
    clear(pubEl).append(
      h('button', { type: 'button', class: state.task.status === 'draft' ? 'on' : '', onclick: () => { state.task.status = 'draft'; drawPub(); touch(); } }, 'Entwurf'),
      h('button', { type: 'button', class: state.task.status === 'published' ? 'on' : '', onclick: () => { state.task.status = 'published'; drawPub(); touch(); } }, 'Veröffentlicht'));
  }

  const ready = (async () => {
    const data = await api('GET', `/tasks/${taskId}`);
    state.task = { title: data.task.title, status: data.task.status, dueDate: data.task.dueDate || '' };
    state.blocks = data.task.blocks;
    let restored = false;
    try {
      const raw = localStorage.getItem(LS);
      if (raw) {
        const l = JSON.parse(raw);
        if (l.ts > Date.parse(data.task.updatedAt.replace(' ', 'T') + 'Z') + 1000) { state.task.title = l.title; state.task.dueDate = l.dueDate || ''; state.blocks = l.blocks; restored = true; }
        else localStorage.removeItem(LS);
      }
    } catch { /* egal */ }
    titleEl.value = state.task.title; dueEl.value = state.task.dueDate; drawPub(); renderList();
    container.append(
      h('div', { class: 'ed-wrap' }, titleEl,
        h('div', { class: 'ed-settings' }, h('span', null, 'Status'), pubEl, h('span', null, 'Fällig am'), dueEl),
        listEl, addBar));
    if (restored) { toast('Ungespeicherte Änderungen wiederhergestellt.'); touch(); } else setSave('ok', 'Gespeichert');
    onTitle && onTitle(state.task.title);
    return data;
  })();

  return {
    ready, saveEl,
    async flushNow() { clearTimeout(state.timer); await flush(); },
    destroy() { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('visibilitychange', onVis); clearTimeout(state.timer); if (state.dirty) flush(); },
  };
}
