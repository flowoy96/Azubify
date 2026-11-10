// Darstellung einer Aufgabe (Azubi-Ansicht, Prüf-Ansicht)
import { h, icon, fmtNum } from './ui.js';

const GAP = /\[\[(.*?)\]\]/g;
export const isQuestion = (b) => ['short', 'long', 'single', 'multi', 'number', 'cloze'].includes(b.type);

let uid = 0;

/**
 * opts: { blocks, answers, readOnly, result (perBlock), onChange(id,value), extra(block) -> Node, showSolutions }
 */
export function renderBlocks(opts) {
  const { blocks, answers = {}, readOnly = false, result, onChange = () => {}, extra, showSolutions = false } = opts;
  let n = 0;
  const root = h('div', { class: 'blocks' });
  for (const b of blocks) {
    if (!isQuestion(b)) { root.append(renderContent(b)); continue; }
    n += 1;
    root.append(renderQuestion(b, n));
  }
  return root;

  function renderQuestion(b, num) {
    const r = result && result.perBlock && result.perBlock[b.id];
    let cls = 'q blk';
    if (r && r.awarded !== null && r.awarded !== undefined && r.max > 0) cls += r.awarded >= r.max ? ' correct' : r.awarded > 0 ? ' partial' : ' wrong';
    const q = h('div', { class: cls, 'data-block': b.id });
    q.append(h('div', { class: 'q-head' },
      h('div', { class: 'q-n' }, num),
      h('div', { class: 'rich', style: { flex: 1 }, html: b.question || '' }),
      b.points > 0 && h('div', { class: 'q-pts num' }, r && r.awarded !== null && r.awarded !== undefined ? `${fmtNum(r.awarded)} / ${fmtNum(b.points)} P.` : `${fmtNum(b.points)} P.`)));
    q.append(renderInput(b));
    if (showSolutions) { const s = solutionBox(b); if (s) q.append(s); }
    if (r && r.comment) q.append(h('div', { class: 'feedback' }, h('b', null, 'Anmerkung: '), r.comment));
    if (extra) { const x = extra(b, num); if (x) q.append(x); }
    return q;
  }

  function renderInput(b) {
    const a = answers[b.id];
    switch (b.type) {
      case 'short': {
        const el = h('input', { type: 'text', value: a || '', disabled: readOnly, placeholder: 'Deine Antwort …', maxLength: 500, 'aria-label': 'Antwort' });
        el.addEventListener('input', () => onChange(b.id, el.value));
        return el;
      }
      case 'long': {
        const el = h('textarea', { class: 'auto', rows: b.rows || 6, value: a || '', disabled: readOnly, placeholder: 'Schreibe hier deine Lösung …', 'aria-label': 'Antwort' });
        const fit = () => { el.style.height = 'auto'; el.style.height = Math.max(el.scrollHeight + 2, 24 * (b.rows || 6)) + 'px'; };
        el.addEventListener('input', () => { fit(); onChange(b.id, el.value); });
        requestAnimationFrame(fit); setTimeout(fit, 80);
        return el;
      }
      case 'number': {
        const el = h('input', { type: 'text', inputMode: 'decimal', value: a || '', disabled: readOnly, placeholder: '0', 'aria-label': 'Antwort' });
        el.addEventListener('input', () => onChange(b.id, el.value));
        return h('div', { class: 'num-in' }, el, b.unit && h('span', { class: 'muted' }, b.unit));
      }
      case 'single': case 'multi': {
        const multi = b.type === 'multi', name = 'o' + (++uid);
        const sel = multi ? new Set(Array.isArray(a) ? a : []) : a;
        const wrap = h('div', { role: multi ? 'group' : 'radiogroup' });
        b.options.forEach((o, i) => {
          const checked = multi ? sel.has(i) : sel === i;
          const inp = h('input', { type: multi ? 'checkbox' : 'radio', name, checked, disabled: readOnly });
          let cls = 'opt' + (checked ? ' sel' : '') + (readOnly ? ' locked' : '');
          if (showSolutions && b.correct !== undefined) {
            const isCorrect = multi ? b.correct.includes(i) : b.correct === i;
            if (isCorrect) cls = 'opt good locked'; else if (checked) cls = 'opt bad locked';
          }
          const lab = h('label', { class: cls }, inp, h('span', null, o));
          inp.addEventListener('change', () => {
            if (multi) { inp.checked ? sel.add(i) : sel.delete(i); lab.classList.toggle('sel', inp.checked); onChange(b.id, [...sel].sort((x, y) => x - y)); }
            else { wrap.querySelectorAll('.opt').forEach((l) => l.classList.remove('sel')); lab.classList.add('sel'); onChange(b.id, i); }
          });
          wrap.append(lab);
        });
        if (multi) wrap.append(h('div', { class: 'hint' }, 'Mehrere Antworten möglich.'));
        return wrap;
      }
      case 'cloze': {
        const vals = Array.isArray(a) ? [...a] : [];
        const gaps = [...b.text.matchAll(GAP)].map((m) => m[1]);
        const wrap = h('div', { class: 'cloze' });
        let last = 0, gi = 0;
        for (const m of b.text.matchAll(GAP)) {
          wrap.append(b.text.slice(last, m.index));
          const i = gi++;
          const inp = h('input', { type: 'text', value: vals[i] || '', disabled: readOnly, 'aria-label': `Lücke ${i + 1}`, maxLength: 200 });
          if (showSolutions && gaps[i] !== undefined && gaps[i] !== '') {
            const ok = gaps[i].split('|').some((x) => x.trim().toLowerCase() === String(vals[i] || '').trim().toLowerCase());
            inp.classList.add(ok ? 'ok' : 'no');
          }
          inp.addEventListener('input', () => { vals[i] = inp.value; onChange(b.id, vals.slice(0, gaps.length)); });
          wrap.append(inp);
          last = m.index + m[0].length;
        }
        wrap.append(b.text.slice(last));
        return wrap;
      }
    }
  }

  function solutionBox(b) {
    let t = null;
    if (b.type === 'short' && b.solution && b.solution.length) t = b.solution.join(' / ');
    else if (b.type === 'number' && b.solution !== null && b.solution !== undefined) t = fmtNum(b.solution) + (b.unit ? ' ' + b.unit : '') + (b.tolerance ? ` (± ${fmtNum(b.tolerance)})` : '');
    else if (b.type === 'long' && b.sample) t = b.sample;
    else if (b.type === 'cloze') { const g = [...b.text.matchAll(GAP)].map((m) => m[1].split('|')[0]); if (g.length) t = g.join(' · '); }
    if (!t) return null;
    return h('div', { class: 'solution-box', style: { whiteSpace: 'pre-wrap' } }, h('b', null, b.type === 'long' ? 'Musterlösung: ' : 'Lösung: '), t);
  }
}

export function renderContent(b) {
  switch (b.type) {
    case 'heading': return h(b.level === 3 ? 'h3' : 'h2', { class: 'blk-h' }, b.text);
    case 'text': return h('div', { class: 'blk rich', html: b.html });
    case 'callout': {
      const ico = { info: 'info', tip: 'check', warn: 'info' }[b.variant] || 'info';
      return h('div', { class: `blk callout ${b.variant}` }, icon(ico, 20), h('div', { class: 'rich', html: b.html }));
    }
    case 'code': return h('pre', { class: 'blk code' }, h('code', null, b.text));
    case 'image': return b.src ? h('figure', { class: 'blk img' }, h('img', { src: b.src, alt: b.caption || '', loading: 'lazy' }), b.caption && h('figcaption', null, b.caption)) : h('span');
    case 'divider': return h('hr', { class: 'div' });
    default: return h('span');
  }
}
