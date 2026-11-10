'use strict';
const crypto = require('node:crypto');
const sanitizeHtml = require('sanitize-html');

const QUESTION_TYPES = ['short', 'long', 'single', 'multi', 'number', 'cloze'];
const CONTENT_TYPES = ['heading', 'text', 'callout', 'code', 'image', 'divider'];
const GAP = /\[\[(.*?)\]\]/g;

const richOpts = {
  allowedTags: ['b', 'strong', 'i', 'em', 'u', 's', 'code', 'br', 'p', 'ul', 'ol', 'li', 'a', 'sub', 'sup', 'mark', 'div'],
  allowedAttributes: { a: ['href'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: {
    a: (tag, attribs) => ({ tagName: 'a', attribs: { href: attribs.href || '', target: '_blank', rel: 'noopener noreferrer' } }),
  },
};
const rich = (v) => sanitizeHtml(String(v ?? ''), richOpts).slice(0, 20000);
const plain = (v, max = 5000) => String(v ?? '').slice(0, max);
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const points = (v) => Math.min(1000, Math.max(0, Math.round(num(v, 1) * 100) / 100));
const strList = (arr, max = 30) => (Array.isArray(arr) ? arr : []).slice(0, max).map((s) => plain(s, 500));

/** Bereinigt die vom Editor gelieferten Blöcke und vergibt IDs. */
function sanitizeBlocks(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  return input.slice(0, 300).map((b) => {
    if (!b || typeof b !== 'object') return null;
    const type = [...QUESTION_TYPES, ...CONTENT_TYPES].includes(b.type) ? b.type : null;
    if (!type) return null;
    let id = /^[\w-]{6,40}$/.test(b.id || '') ? b.id : crypto.randomUUID();
    if (seen.has(id)) id = crypto.randomUUID();
    seen.add(id);
    const out = { id, type };
    switch (type) {
      case 'heading': out.text = plain(b.text, 300); out.level = b.level === 3 ? 3 : 2; break;
      case 'text': out.html = rich(b.html); break;
      case 'callout':
        out.variant = ['info', 'tip', 'warn'].includes(b.variant) ? b.variant : 'info';
        out.html = rich(b.html); break;
      case 'code': out.text = plain(b.text, 20000); break;
      case 'image': {
        const src = String(b.src || '');
        out.src = /^\/api\/uploads\/[\w.-]+$/.test(src) ? src : '';
        out.caption = plain(b.caption, 300); break;
      }
      case 'divider': break;
      case 'short':
        out.question = rich(b.question); out.points = points(b.points);
        out.solution = strList(b.solution, 20).filter(Boolean);
        out.caseSensitive = !!b.caseSensitive; break;
      case 'long':
        out.question = rich(b.question); out.points = points(b.points ?? 0);
        out.sample = plain(b.sample, 10000); out.rows = Math.min(30, Math.max(3, Math.round(num(b.rows, 6)))); break;
      case 'single':
      case 'multi': {
        out.question = rich(b.question); out.points = points(b.points);
        out.options = strList(b.options, 12);
        while (out.options.length < 2) out.options.push('');
        if (type === 'single') {
          const c = Math.round(num(b.correct, -1));
          out.correct = c >= 0 && c < out.options.length ? c : -1;
        } else {
          out.correct = [...new Set((Array.isArray(b.correct) ? b.correct : []).map((x) => Math.round(num(x, -1))))]
            .filter((c) => c >= 0 && c < out.options.length).sort((a, c) => a - c);
        }
        break;
      }
      case 'number':
        out.question = rich(b.question); out.points = points(b.points);
        out.solution = b.solution === null || b.solution === '' || b.solution === undefined ? null : num(b.solution, null);
        out.tolerance = Math.max(0, num(b.tolerance, 0)); out.unit = plain(b.unit, 20); break;
      case 'cloze':
        out.question = rich(b.question); out.points = points(b.points);
        out.text = plain(b.text, 5000); break;
    }
    return out;
  }).filter(Boolean);
}

/** Entfernt Lösungen aus den Blöcken (für Azubis, solange nicht bewertet). */
function stripSolutions(blocks) {
  return blocks.map((b) => {
    const c = { ...b };
    delete c.sample;
    if (b.type === 'short') { c.hasSolution = b.solution.length > 0; delete c.solution; }
    if (b.type === 'number') { c.hasSolution = b.solution !== null; delete c.solution; }
    if (b.type === 'single') { c.hasSolution = b.correct >= 0; delete c.correct; }
    if (b.type === 'multi') { c.hasSolution = b.correct.length > 0; delete c.correct; }
    if (b.type === 'cloze') c.text = b.text.replace(GAP, '[[]]');
    return c;
  });
}

const isQuestion = (b) => QUESTION_TYPES.includes(b.type);
const norm = (s, cs) => { const t = String(s ?? '').trim().replace(/\s+/g, ' '); return cs ? t : t.toLowerCase(); };
const round = (n) => Math.round(n * 100) / 100;

/** Automatische Bewertung eines Blocks. null = nicht automatisch prüfbar. */
function autoScore(b, ans) {
  const max = b.points || 0;
  switch (b.type) {
    case 'single':
      if (b.correct < 0) return null;
      return ans === b.correct ? max : 0;
    case 'multi': {
      if (!b.correct.length) return null;
      const sel = Array.isArray(ans) ? ans : [];
      const right = sel.filter((i) => b.correct.includes(i)).length;
      const wrong = sel.length - right;
      return round(Math.max(0, (right - wrong) / b.correct.length) * max);
    }
    case 'short': {
      if (!b.solution.length) return null;
      return b.solution.some((s) => norm(s, b.caseSensitive) === norm(ans, b.caseSensitive)) ? max : 0;
    }
    case 'number': {
      if (b.solution === null) return null;
      const v = Number(String(ans ?? '').replace(',', '.'));
      if (String(ans ?? '').trim() === '' || !Number.isFinite(v)) return 0;
      return Math.abs(v - b.solution) <= b.tolerance + 1e-9 ? max : 0;
    }
    case 'cloze': {
      const gaps = [...b.text.matchAll(GAP)].map((m) => m[1]);
      if (!gaps.length) return null;
      const given = Array.isArray(ans) ? ans : [];
      const ok = gaps.filter((g, i) => g.split('|').some((alt) => norm(alt) === norm(given[i]))).length;
      return round((ok / gaps.length) * max);
    }
    default: return null; // long
  }
}

/** Liefert pro Frageblock Punkte und Gesamtsumme. */
function evaluate(blocks, answers, review) {
  const rb = (review && review.blocks) || {};
  const perBlock = {};
  let max = 0, score = 0, open = 0;
  for (const b of blocks.filter(isQuestion)) {
    const auto = autoScore(b, (answers || {})[b.id]);
    const manual = rb[b.id] && typeof rb[b.id].points === 'number' ? rb[b.id].points : null;
    const awarded = manual ?? auto;
    perBlock[b.id] = { max: b.points || 0, auto, awarded, manual: manual !== null, comment: (rb[b.id] && rb[b.id].comment) || '' };
    max += b.points || 0;
    if (awarded === null) { if ((b.points || 0) > 0) open += 1; } else score += awarded;
  }
  return { perBlock, max: round(max), score: round(score), open };
}

/** Ein Frageblock gilt als bearbeitet, wenn eine Antwort vorhanden ist. */
function isAnswered(b, a) {
  if (a === undefined || a === null) return false;
  if (Array.isArray(a)) return a.some((x) => (typeof x === 'string' ? x.trim() : x !== null && x !== undefined));
  if (typeof a === 'string') return a.trim() !== '';
  return typeof a === 'number';
}

/** Antworten auf erlaubte Form bringen. */
function sanitizeAnswer(b, v) {
  switch (b.type) {
    case 'short': case 'number': return plain(v, 500);
    case 'long': return plain(v, 50000);
    case 'single': { const n = Math.round(num(v, -1)); return n >= 0 && n < b.options.length ? n : null; }
    case 'multi': return [...new Set((Array.isArray(v) ? v : []).map((x) => Math.round(num(x, -1))))]
      .filter((n) => n >= 0 && n < b.options.length).sort((a, c) => a - c);
    case 'cloze': {
      const n = [...b.text.matchAll(GAP)].length;
      return Array.from({ length: n }, (_, i) => plain(Array.isArray(v) ? v[i] : '', 200));
    }
    default: return undefined;
  }
}

module.exports = { sanitizeBlocks, stripSolutions, evaluate, isQuestion, isAnswered, sanitizeAnswer, autoScore };
