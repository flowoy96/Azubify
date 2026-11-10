import { h, clear, api, icon, toast, confirmDialog, modal, formDialogSubmit, fmtDate, fmtNum, pct, isOverdue, progressBar, ring, statusPill, STATUS, ROLE } from './ui.js';
import { renderBlocks, isQuestion } from './render.js';
import { mountEditor } from './editor.js';

const crumbs = (...items) => h('div', { class: 'crumbs' }, items.flatMap((it, i) => [i > 0 && icon('chevron', 13), it.href ? h('a', { href: it.href }, it.label) : h('span', null, it.label)]));
const pageHead = (title, sub, ...actions) => h('div', { class: 'page-head' }, h('div', null, h('h1', null, title), sub && h('p', { class: 'sub' }, sub)), h('div', { class: 'row wrap' }, actions));
const empty = (ic, big, text, action) => h('div', { class: 'empty' }, h('div', { class: 'ico' }, icon(ic, 26)), h('div', { class: 'big' }, big), text, action && h('div', { style: { marginTop: '18px' } }, action));
const section = (t, ...extra) => h('div', { class: 'section-title' }, t, ...extra);

// ════════════ AZUBI ════════════
export async function azubiHome(main, u) {
  const { topics } = await api('GET', '/topics');
  const hour = new Date().getHours();
  const greet = hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Hallo' : 'Guten Abend';
  clear(main).append(pageHead(`${greet}, ${u.displayName.split(' ')[0]}`, 'Hier findest du deine Aufgaben und deinen Lernfortschritt.'));
  if (!topics.length) return main.append(empty('inbox', 'Noch keine Aufgaben', 'Sobald dein Ausbilder dir ein Thema freischaltet, erscheint es hier.'));
  const open = topics.reduce((s, t) => s + (t.progress.total - t.progress.submitted - t.progress.reviewed), 0);
  const review = topics.reduce((s, t) => s + t.progress.submitted, 0);
  const score = topics.reduce((a, t) => [a[0] + t.progress.score, a[1] + t.progress.max], [0, 0]);
  main.append(h('div', { class: 'stat-row' },
    stat(open, 'Noch zu bearbeiten'), stat(review, 'Warten auf Bewertung'), stat(score[1] ? pct(score[0], score[1]) + ' %' : '–', 'Durchschnittliches Ergebnis')),
  section('Themen'),
  h('div', { class: 'grid' }, topics.map((t) => {
    const p = t.progress, done = p.submitted + p.reviewed;
    return h('a', { class: `card topic-card c-${t.color}`, href: `#/topic/${t.id}` },
      h('div', { class: 'topic-dot' }, icon('book', 20)), h('div', null, h('h3', null, t.title), t.description && h('div', { class: 'desc', style: { marginTop: '4px' } }, t.description)),
      h('div', { class: 'foot' }, h('div', { style: { flex: 1 } }, progressBar(pct(done, p.total), t.color), h('div', { style: { marginTop: '6px' } }, `${done} von ${p.total} abgegeben`)),
        p.max > 0 && h('span', { class: 'pill c-' + t.color }, pct(p.score, p.max) + ' %')));
  })));
}
const stat = (v, l) => h('div', { class: 'card stat' }, h('div', { class: 'v num' }, v), h('div', { class: 'l' }, l));

export async function azubiTopic(main, id) {
  const { topic, tasks } = await api('GET', `/topics/${id}`);
  clear(main).append(crumbs({ label: 'Meine Aufgaben', href: '#/' }, { label: topic.title }), pageHead(topic.title, topic.description));
  if (!tasks.length) return main.append(empty('inbox', 'Keine Aufgaben', 'In diesem Thema gibt es noch keine veröffentlichten Aufgaben.'));
  main.append(h('div', { class: 'list' }, tasks.map((t) => h('a', { class: 'item', href: `#/task/${t.id}` },
    h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { class: 't' }, t.title),
      h('div', { class: 's' }, [`${t.questions} Frage${t.questions === 1 ? '' : 'n'}`, t.max > 0 && `${fmtNum(t.max)} Punkte`, t.dueDate && h('span', { style: { color: isOverdue(t.dueDate) && ['open', 'started', 'returned'].includes(t.state) ? 'var(--danger)' : '' } }, `fällig ${fmtDate(t.dueDate)}`)].filter(Boolean).flatMap((x, i) => (i ? [' · ', x] : [x])))),
    t.state === 'reviewed' && t.max > 0 && h('span', { class: 'num', style: { fontWeight: 600 } }, `${fmtNum(t.score)} / ${fmtNum(t.max)}`),
    statusPill(t.state), h('span', { class: 'chev' }, icon('chevron', 16))))));
}

export async function azubiTask(main, id, u) {
  const data = await api('GET', `/tasks/${id}`);
  const { task, topic } = data;
  let sub = data.submission, result = data.result;
  const LS = `azubify:ans:${u.id}:${id}`;
  const pending = {};
  let timer = null, saving = false, destroyed = false;
  try { Object.assign(pending, JSON.parse(localStorage.getItem(LS) || '{}')); } catch { /* egal */ }
  const hasPending = () => Object.keys(pending).length > 0;
  const locked = () => sub.status !== 'draft';
  if (hasPending() && !locked()) Object.assign(sub.answers, pending);

  const saveEl = h('span', { class: 'save-state' });
  const setSave = (k, t) => { saveEl.className = 'save-state ' + k; clear(saveEl).append(k === 'ok' ? icon('cloud', 15) : '', t); };
  const persistLocal = () => { try { hasPending() ? localStorage.setItem(LS, JSON.stringify(pending)) : localStorage.removeItem(LS); } catch { /* egal */ } };

  async function flush() {
    if (saving || !hasPending() || locked()) return;
    saving = true;
    const snap = { ...pending };
    setSave('', 'Speichert …');
    try {
      await api('PUT', `/tasks/${id}/answers`, { answers: snap });
      for (const k of Object.keys(snap)) if (JSON.stringify(pending[k]) === JSON.stringify(snap[k])) delete pending[k];
      persistLocal();
      setSave('ok', hasPending() ? 'Speichert …' : 'Automatisch gespeichert');
    } catch (e) {
      if (e.status === 409) { setSave('err', 'Gesperrt'); location.reload(); return; }
      setSave('err', e.status === 0 ? 'Offline – lokal gesichert' : e.message);
    }
    saving = false;
    if (hasPending()) { clearTimeout(timer); timer = setTimeout(flush, 3000); }
  }
  function onChange(bid, value) {
    pending[bid] = value; sub.answers[bid] = value; persistLocal();
    setSave('', 'Ungespeichert …');
    clearTimeout(timer); timer = setTimeout(flush, 600);
  }
  const onUnload = (e) => {
    if (hasPending() && !locked()) {
      fetch(`/api/tasks/${id}/answers`, { method: 'PUT', keepalive: true, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers: pending }) }).catch(() => {});
    }
  };
  const onVis = () => { if (document.visibilityState === 'hidden') { clearTimeout(timer); flush(); } };
  window.addEventListener('pagehide', onUnload); document.addEventListener('visibilitychange', onVis);
  const onOnline = () => flush(); window.addEventListener('online', onOnline);

  async function submit() {
    const qs = task.blocks.filter(isQuestion);
    const missing = qs.filter((b) => { const a = sub.answers[b.id]; return a === undefined || a === null || a === '' || (Array.isArray(a) && !a.some((x) => (typeof x === 'string' ? x.trim() : true))); }).length;
    const ok = await confirmDialog('Aufgabe abgeben?', missing ? `${missing} Frage${missing === 1 ? ' ist' : 'n sind'} noch unbeantwortet. Nach dem Abgeben kannst du nichts mehr ändern.` : 'Nach dem Abgeben kannst du nichts mehr ändern.', 'Abgeben', false);
    if (!ok) return;
    clearTimeout(timer);
    while (saving) await new Promise((r) => setTimeout(r, 100));
    await flush();
    if (hasPending()) { toast('Speichern nicht möglich – bitte Verbindung prüfen.', 'err'); return; }
    try { await api('POST', `/tasks/${id}/submit`); toast('Abgegeben. Dein Ausbilder sieht dein Ergebnis jetzt.'); await draw(true); } catch (e) { toast(e.message, 'err'); }
  }

  async function draw(reload) {
    if (reload) { const d = await api('GET', `/tasks/${id}`); sub = d.submission; result = d.result; task.blocks = d.task.blocks; }
    clear(main);
    const reviewed = sub.status === 'reviewed';
    main.append(crumbs({ label: 'Meine Aufgaben', href: '#/' }, { label: topic.title, href: `#/topic/${topic.id}` }, { label: task.title }));
    const doc = h('div', { class: 'doc' });
    doc.append(h('h1', null, task.title),
      h('div', { class: 'doc-meta' }, statusPill(sub.status === 'draft' ? (sub.returned ? 'returned' : Object.keys(sub.answers).length ? 'started' : 'open') : sub.status),
        task.dueDate && h('span', { class: 'row', style: { gap: '5px', color: isOverdue(task.dueDate) && !locked() ? 'var(--danger)' : '' } }, icon('clock', 15), `Fällig ${fmtDate(task.dueDate)}`),
        !locked() && saveEl));
    if (sub.status === 'draft' && sub.returned) doc.append(h('div', { class: 'banner orange' }, icon('info', 22), h('div', null, h('b', null, 'Bitte überarbeiten'), h('div', null, sub.feedback || 'Dein Ausbilder hat die Aufgabe zur Überarbeitung zurückgegeben.'))));
    if (sub.status === 'submitted') doc.append(h('div', { class: 'banner purple' }, icon('lock', 22), h('div', null, h('b', null, 'Abgegeben'), h('div', { class: 'muted' }, `Am ${fmtDate(sub.submittedAt, true)} – wartet auf Bewertung.`))));
    if (reviewed) {
      doc.append(h('div', { class: 'banner green' }, h('div', { style: { flex: 1 } }, h('b', null, 'Bewertet'), h('div', { class: 'muted' }, `Am ${fmtDate(sub.reviewedAt, true)}`), sub.feedback && h('div', { style: { marginTop: '10px', whiteSpace: 'pre-wrap' } }, sub.feedback)),
        result.max > 0 && h('div', { style: { textAlign: 'right' } }, h('div', { class: 'score-big num' }, fmtNum(result.score)), h('div', { class: 'muted small' }, `von ${fmtNum(result.max)} Punkten (${pct(result.score, result.max)} %)`))));
    }
    doc.append(renderBlocks({ blocks: task.blocks, answers: sub.answers, readOnly: locked(), result, onChange, showSolutions: reviewed }));
    if (!locked()) doc.append(h('div', { class: 'card submit-card' }, h('h3', null, 'Fertig?'), h('p', { class: 'muted', style: { margin: '6px 0 18px' } }, 'Deine Antworten werden automatisch gespeichert. Mit dem Abgeben gehen sie an deinen Ausbilder.'), h('button', { class: 'btn primary', onclick: submit }, 'Aufgabe abgeben')));
    main.append(doc);
    if (!locked()) { setSave('ok', hasPending() ? 'Lokal gesichert' : 'Automatisch gespeichert'); if (hasPending()) flush(); }
  }
  await draw();
  return () => { destroyed = true; clearTimeout(timer); window.removeEventListener('pagehide', onUnload); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('online', onOnline); if (hasPending() && !locked()) flush(); };
}

// ════════════ AUSBILDER / ADMIN ════════════
export async function staffDashboard(main) {
  const { azubis, toReview } = await api('GET', '/progress');
  const active = azubis.filter((a) => a.active);
  clear(main).append(pageHead('Übersicht', 'Lernfortschritt und Ergebnisse aller Auszubildenden.'));
  main.append(h('div', { class: 'stat-row' }, stat(active.length, 'Aktive Azubis'), stat(toReview.length, 'Zu prüfende Abgaben'), stat(active.reduce((s, a) => s + a.reviewed, 0), 'Bewertete Aufgaben')));
  if (toReview.length) {
    main.append(section('Zu prüfen', h('span', { class: 'badge-n' }, toReview.length)),
      h('div', { class: 'list' }, toReview.slice(0, 8).map((s) => h('a', { class: 'item', href: `#/submission/${s.id}` },
        h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { class: 't' }, s.name), h('div', { class: 's' }, `${s.topic} › ${s.task}`)),
        h('span', { class: 's hide-sm' }, fmtDate(s.submitted_at, true)), h('span', { class: 'chev' }, icon('chevron', 16))))));
  }
  main.append(section('Azubis'));
  if (!azubis.length) return main.append(empty('users', 'Noch keine Azubis', 'Lege Azubi-Accounts im Bereich „Benutzer“ an.'));
  main.append(h('div', { class: 'card flush tbl-wrap' }, h('table', { class: 'tbl' },
    h('thead', null, h('tr', null, ['Name', 'Fortschritt', 'Abgegeben', 'Ergebnis', ''].map((x, i) => h('th', { class: i === 2 ? 'hide-sm' : '' }, x)))),
    h('tbody', null, azubis.map((a) => h('tr', { class: 'clickable', onclick: () => { location.hash = `#/azubi/${a.id}`; } },
      h('td', null, h('div', { style: { fontWeight: 500 } }, a.name), !a.active && h('span', { class: 'small muted' }, 'deaktiviert')),
      h('td', { style: { minWidth: '160px' } }, a.total ? h('div', null, progressBar(pct(a.done, a.total)), h('div', { class: 'small muted', style: { marginTop: '4px' } }, `${a.done} von ${a.total} Aufgaben`)) : h('span', { class: a.topicCount ? 'pill c-orange' : 'muted' }, a.topicCount ? 'Freigeschaltet, aber keine veröffentlichten Aufgaben' : 'Keine Themen freigeschaltet')),
      h('td', { class: 'hide-sm num' }, a.submitted ? h('span', { class: 'pill c-purple' }, `${a.submitted} offen`) : '–'),
      h('td', { class: 'num' }, a.max ? `${pct(a.score, a.max)} %` : '–'),
      h('td', { style: { textAlign: 'right', color: 'var(--faint)' } }, icon('chevron', 16))))))));
}

export async function azubiDetail(main, id) {
  const { user, topics } = await api('GET', `/progress/${id}`);
  clear(main).append(crumbs({ label: 'Übersicht', href: '#/' }, { label: user.name }), pageHead(user.name, 'Lernfortschritt und Ergebnisse'));
  if (!topics.length) return main.append(empty('book', 'Keine Themen freigeschaltet', 'Schalte unter „Themen & Aufgaben“ ein Thema für diesen Azubi frei.'));
  for (const t of topics) {
    main.append(section(t.title, t.max > 0 && h('span', { class: `pill c-${t.color}` }, `${pct(t.score, t.max)} % Ergebnis`)),
      t.tasks.length ? h('div', { class: 'list' }, t.tasks.map((k) => h(k.submissionId && k.status !== 'open' && k.status !== 'started' ? 'a' : 'div', { class: 'item', href: k.submissionId ? `#/submission/${k.submissionId}` : undefined },
        h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { class: 't' }, k.title), k.submittedAt && h('div', { class: 's' }, `Abgegeben ${fmtDate(k.submittedAt, true)}`)),
        k.status === 'reviewed' && k.max > 0 && h('span', { class: 'num', style: { fontWeight: 600 } }, `${fmtNum(k.score)} / ${fmtNum(k.max)}`), statusPill(k.status)))) : h('p', { class: 'muted' }, 'Keine veröffentlichten Aufgaben.'));
  }
}

const TOPIC_FIELDS = (t = {}) => [
  { name: 'title', label: 'Titel', value: t.title || '', placeholder: 'z. B. Netzwerktechnik' },
  { name: 'description', label: 'Beschreibung', type: 'textarea', value: t.description || '' },
  { name: 'color', label: 'Farbe', type: 'color', value: t.color || 'blue' },
];
export async function staffTopics(main) {
  const { topics } = await api('GET', '/topics');
  const add = h('button', { class: 'btn primary', onclick: async () => {
    const r = await formDialogSubmit({ title: 'Neues Thema', fields: TOPIC_FIELDS(), submitLabel: 'Anlegen', onSubmit: async (v) => { await api('POST', '/topics', v); } });
    if (r) staffTopics(main);
  } }, icon('plus', 16), 'Neues Thema');
  clear(main).append(pageHead('Themen & Aufgaben', 'Gruppiere Aufgaben nach Themengebiet und schalte sie für Azubis frei.', add));
  if (!topics.length) return main.append(empty('book', 'Noch keine Themen', 'Lege ein Themengebiet an und füge darin Aufgaben hinzu.'));
  main.append(h('div', { class: 'grid' }, topics.map((t) => h('div', { class: `card link topic-card c-${t.color}`, tabIndex: 0, role: 'link', onclick: (e) => { if (!e.target.closest('.card-actions')) location.hash = `#/topic/${t.id}`; }, onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) location.hash = `#/topic/${t.id}`; } },
    h('div', { class: 'row' }, h('div', { class: 'topic-dot' }, icon('book', 20)), t.toReview > 0 && h('span', { class: 'badge-n', title: 'Zu prüfen' }, t.toReview)),
    h('div', null, h('h3', null, t.title), t.description && h('div', { class: 'desc', style: { marginTop: '4px' } }, t.description)),
    h('div', { class: 'foot' }, h('span', null, `${t.publishedCount} von ${t.taskCount} Aufgaben veröffentlicht`), h('span', null, `${t.accessCount} Azubi${t.accessCount === 1 ? '' : 's'}`)),
    h('div', { class: 'card-actions' },
      h('button', { class: 'icon-btn', title: 'Bearbeiten', 'aria-label': 'Thema bearbeiten', onclick: async () => { const r = await formDialogSubmit({ title: 'Thema bearbeiten', fields: TOPIC_FIELDS(t), onSubmit: (v) => api('PATCH', `/topics/${t.id}`, v) }); if (r) staffTopics(main); } }, icon('edit', 16)),
      h('button', { class: 'icon-btn danger', title: 'Löschen', 'aria-label': 'Thema löschen', onclick: async () => { if (await confirmDialog('Thema löschen?', `„${t.title}“ wird mit allen Aufgaben und Abgaben unwiderruflich gelöscht.`)) { await api('DELETE', `/topics/${t.id}`); staffTopics(main); } } }, icon('trash', 16)))))));
}

export async function staffTopic(main, id) {
  const [{ topic, tasks, access }, { users }] = await Promise.all([api('GET', `/topics/${id}`), api('GET', '/users')]);
  const azubis = users.filter((x) => x.role === 'azubi' && x.active);
  const reload = () => staffTopic(main, id);
  const newTask = async () => {
    const r = await formDialogSubmit({ title: 'Neue Aufgabe', fields: [{ name: 'title', label: 'Titel', placeholder: 'z. B. OSI-Modell' }], submitLabel: 'Erstellen', onSubmit: async (v) => { const x = await api('POST', `/topics/${id}/tasks`, v); location.hash = `#/edit/${x.id}`; } });
    return r;
  };
  const accessDlg = async () => {
    const sel = new Set(access);
    const list = h('div', { class: 'stack', style: { gap: '4px', maxHeight: '50vh', overflow: 'auto' } });
    const draw = () => { clear(list).append(...azubis.map((a) => h('label', { class: 'check', style: { padding: '8px 4px' } }, h('input', { type: 'checkbox', checked: sel.has(a.id), onchange: (e) => { e.target.checked ? sel.add(a.id) : sel.delete(a.id); } }), a.displayName))); };
    draw();
    const r = await modal({ title: 'Azubis freischalten', body: azubis.length ? h('div', null, h('div', { class: 'row', style: { marginBottom: '10px' } }, h('button', { class: 'btn sm', onclick: () => { azubis.forEach((a) => sel.add(a.id)); draw(); } }, 'Alle'), h('button', { class: 'btn sm', onclick: () => { sel.clear(); draw(); } }, 'Keine')), list) : h('p', { class: 'muted' }, 'Es gibt noch keine Azubi-Accounts.'),
      actions: [{ label: 'Abbrechen', value: false }, { label: 'Speichern', kind: 'primary', value: true }] });
    if (r) { await api('PUT', `/topics/${id}/access`, { userIds: [...sel] }); toast('Freigabe gespeichert.'); reload(); }
  };
  clear(main).append(crumbs({ label: 'Themen & Aufgaben', href: '#/topics' }, { label: topic.title }),
    pageHead(topic.title, topic.description || `${access.length} Azubi${access.length === 1 ? '' : 's'} freigeschaltet`,
      h('button', { class: 'btn', onclick: accessDlg }, icon('users', 16), `Freischalten (${access.length})`), h('button', { class: 'btn primary', onclick: newTask }, icon('plus', 16), 'Neue Aufgabe')));
  if (!tasks.length) return main.append(empty('edit', 'Noch keine Aufgaben', 'Erstelle die erste Aufgabe für dieses Thema.'));
  if (access.length && !tasks.some((t) => t.status === 'published')) main.append(h('div', { class: 'banner orange' }, icon('info', 22), h('div', null, h('b', null, 'Azubis sehen noch nichts'), h('div', null, 'Alle Aufgaben sind noch Entwürfe. Klicke bei einer Aufgabe auf „Entwurf“, um sie zu veröffentlichen.'))));
  main.append(h('div', { class: 'list' }, tasks.map((t) => h('div', { class: 'item' },
    h('a', { href: `#/edit/${t.id}`, style: { flex: 1, minWidth: 0, color: 'inherit' } }, h('div', { class: 't' }, t.title || 'Ohne Titel'),
      h('div', { class: 's' }, `${t.questions} Frage${t.questions === 1 ? '' : 'n'} · ${fmtNum(t.points)} Punkte${t.dueDate ? ' · fällig ' + fmtDate(t.dueDate) : ''}`)),
    h('button', { class: `pill c-${t.status === 'published' ? 'green' : 'gray'}`, style: { border: 0, cursor: 'pointer' }, title: t.status === 'published' ? 'Klicken, um auf Entwurf zurückzusetzen' : 'Klicken, um zu veröffentlichen', onclick: async () => { await api('PUT', `/tasks/${t.id}`, { status: t.status === 'published' ? 'draft' : 'published' }); toast(t.status === 'published' ? 'Auf Entwurf gesetzt.' : 'Veröffentlicht – Azubis sehen die Aufgabe jetzt.'); reload(); } }, t.status === 'published' ? 'Veröffentlicht' : 'Entwurf'),
    h('a', { class: 'btn sm hide-sm', href: `#/results/${t.id}` }, 'Ergebnisse', t.submitted > 0 && h('span', { class: 'badge-n' }, t.submitted)),
    h('a', { class: 'icon-btn', href: `#/edit/${t.id}`, title: 'Bearbeiten', 'aria-label': 'Bearbeiten' }, icon('edit', 16)),
    h('button', { class: 'icon-btn', title: 'Duplizieren', 'aria-label': 'Duplizieren', onclick: async () => { await api('POST', `/tasks/${t.id}/duplicate`); toast('Dupliziert.'); reload(); } }, icon('copy', 16)),
    h('button', { class: 'icon-btn danger', title: 'Löschen', 'aria-label': 'Löschen', onclick: async () => { if (await confirmDialog('Aufgabe löschen?', `„${t.title}“ und alle Abgaben dazu werden gelöscht.`)) { await api('DELETE', `/tasks/${t.id}`); reload(); } } }, icon('trash', 16))))));
}

export async function taskEditor(main, id) {
  const wrap = h('div');
  const ed = mountEditor(wrap, { taskId: id, onTitle: () => {} });
  const data = await ed.ready;
  clear(main).append(
    h('div', { class: 'sticky-bar' }, h('a', { class: 'btn sm ghost', href: `#/topic/${data.topic.id}` }, icon('back', 15), data.topic.title), h('div', { class: 'spacer' }), ed.saveEl,
      h('a', { class: 'btn sm', href: `#/task/${id}`, onclick: async (e) => { e.preventDefault(); await ed.flushNow(); location.hash = `#/task/${id}`; } }, icon('eye', 15), 'Vorschau'),
      h('button', { class: 'btn sm primary', onclick: async () => { await ed.flushNow(); location.hash = `#/topic/${data.topic.id}`; } }, 'Fertig')), wrap);
  return async () => { await ed.flushNow(); ed.destroy(); };
}

export async function staffPreview(main, id) {
  const { task, topic } = await api('GET', `/tasks/${id}`);
  clear(main).append(crumbs({ label: 'Themen & Aufgaben', href: '#/topics' }, { label: topic.title, href: `#/topic/${topic.id}` }, { label: 'Vorschau' }));
  const doc = h('div', { class: 'doc' }, h('div', { class: 'banner' }, icon('eye', 20), h('div', { style: { flex: 1 } }, h('b', null, 'Vorschau mit Lösungen'), h('div', { class: 'muted small' }, 'So sieht der Azubi die Aufgabe – Antworten werden hier nicht gespeichert.')), h('a', { class: 'btn sm', href: `#/edit/${id}` }, icon('edit', 15), 'Bearbeiten')),
    h('h1', null, task.title), h('div', { class: 'doc-meta' }, h('span', { class: `pill c-${task.status === 'published' ? 'green' : 'gray'}` }, task.status === 'published' ? 'Veröffentlicht' : 'Entwurf')),
    renderBlocks({ blocks: task.blocks, answers: {}, showSolutions: false, onChange: () => {}, extra: (b) => solutionHint(b) }));
  main.append(doc);
}
function solutionHint(b) {
  let t = null;
  if (b.type === 'short' && b.solution.length) t = b.solution.join(' / ');
  else if (b.type === 'number' && b.solution !== null) t = fmtNum(b.solution) + (b.unit ? ' ' + b.unit : '');
  else if (b.type === 'single' && b.correct >= 0) t = b.options[b.correct];
  else if (b.type === 'multi' && b.correct.length) t = b.correct.map((i) => b.options[i]).join(' · ');
  else if (b.type === 'long' && b.sample) t = b.sample;
  else if (b.type === 'cloze') t = [...b.text.matchAll(/\[\[(.*?)\]\]/g)].map((m) => m[1]).join(' · ') || null;
  return h('div', { class: 'solution-box', style: { whiteSpace: 'pre-wrap' } }, h('b', null, 'Lösung: '), t || 'manuelle Bewertung');
}

export async function taskResults(main, id) {
  const { task, rows } = await api('GET', `/tasks/${id}/submissions`);
  clear(main).append(crumbs({ label: 'Themen & Aufgaben', href: '#/topics' }, { label: 'Thema', href: `#/topic/${task.topicId}` }, { label: 'Ergebnisse' }), pageHead(task.title, 'Abgaben der freigeschalteten Azubis'));
  if (!rows.length) return main.append(empty('users', 'Keine Azubis', 'Für dieses Thema ist noch kein Azubi freigeschaltet.'));
  main.append(h('div', { class: 'list' }, rows.map((r) => h(r.submissionId && r.status !== 'open' ? 'a' : 'div', { class: 'item', href: r.submissionId ? `#/submission/${r.submissionId}` : undefined },
    h('div', { style: { flex: 1 } }, h('div', { class: 't' }, r.name), r.submittedAt && h('div', { class: 's' }, `Abgegeben ${fmtDate(r.submittedAt, true)}`)),
    r.max > 0 && r.score !== null && h('span', { class: 'num', style: { fontWeight: 600 } }, `${fmtNum(r.score)} / ${fmtNum(r.max)}`), r.openBlocks > 0 && r.status === 'submitted' && h('span', { class: 'small muted hide-sm' }, `${r.openBlocks} manuell`),
    statusPill(r.status), r.submissionId && r.status !== 'open' && h('span', { class: 'chev' }, icon('chevron', 16))))));
}

export async function submissionReview(main, id) {
  const d = await api('GET', `/submissions/${id}`);
  const { task, user } = d;
  let sub = d.submission, result = d.result;
  const rb = {}; // blockId -> {points, comment}
  for (const [k, v] of Object.entries(result.perBlock)) rb[k] = { points: v.manual ? v.awarded : null, comment: v.comment || '' };
  let comment = sub.comment, timer = null, dirty = false;
  const saveEl = h('span', { class: 'save-state' });
  const totalEl = h('div'), openEl = h('div', { class: 'small muted' });

  const payload = (action) => ({ blocks: rb, comment, action });
  const calc = () => {
    let score = 0, max = 0, open = 0;
    for (const [k, v] of Object.entries(result.perBlock)) {
      max += v.max; const p = rb[k].points !== null && rb[k].points !== '' && rb[k].points !== undefined ? Number(rb[k].points) : v.auto;
      if (p === null || p === undefined) { if (v.max > 0) open++; } else score += Math.min(v.max, p);
    }
    return { score, max, open };
  };
  const drawTotal = () => {
    const c = calc();
    clear(totalEl).append(h('div', { class: 'score-big num' }, fmtNum(c.score)), h('div', { class: 'muted' }, `von ${fmtNum(c.max)} Punkten${c.max ? ` · ${pct(c.score, c.max)} %` : ''}`));
    openEl.textContent = c.open ? `${c.open} Frage${c.open === 1 ? '' : 'n'} noch ohne Punkte` : '';
    return c;
  };
  async function save(action = 'save') {
    clearTimeout(timer);
    try {
      const r = await api('PUT', `/submissions/${id}/review`, payload(action));
      dirty = false; sub.status = r.status; result = { ...result, ...r.result };
      saveEl.className = 'save-state ok'; clear(saveEl).append(icon('check', 15), 'Gespeichert'); return r;
    } catch (e) { saveEl.className = 'save-state err'; saveEl.textContent = e.message; throw e; }
  }
  const touch = () => { dirty = true; saveEl.className = 'save-state'; saveEl.textContent = 'Ungespeichert …'; drawTotal(); clearTimeout(timer); timer = setTimeout(() => save().catch(() => {}), 900); };
  const locked = sub.status === 'reviewed';

  const extra = (b) => {
    const r = result.perBlock[b.id]; if (!r) return null;
    const pts = h('input', { type: 'number', min: 0, max: b.points, step: 0.5, value: rb[b.id].points ?? '', placeholder: r.auto !== null ? fmtNum(r.auto) : '–', disabled: locked, 'aria-label': 'Punkte', oninput: (e) => { rb[b.id].points = e.target.value === '' ? null : Math.min(b.points, Math.max(0, Number(e.target.value))); touch(); } });
    const cm = h('input', { type: 'text', value: rb[b.id].comment, placeholder: 'Anmerkung für den Azubi (optional)', disabled: locked, maxLength: 2000, oninput: (e) => { rb[b.id].comment = e.target.value; touch(); } });
    return h('div', { class: 'rv-pts' }, b.points > 0 ? [h('span', null, 'Punkte'), pts, h('span', { class: 'muted' }, `von ${fmtNum(b.points)}`), r.auto !== null && h('span', { class: 'pill c-blue' }, `automatisch: ${fmtNum(r.auto)}`)] : h('span', { class: 'muted' }, 'Nicht bewertet'), cm);
  };
  const overall = h('textarea', { rows: 4, value: comment, placeholder: 'Gesamtfeedback für den Azubi …', disabled: locked, oninput: (e) => { comment = e.target.value; touch(); } });

  async function act(action, msg) { try { await save(action); toast(msg); render(); } catch (e) { toast(e.message, 'err'); } }
  function render() {
    clear(main).append(crumbs({ label: 'Übersicht', href: '#/' }, { label: task.title, href: `#/results/${task.id}` }, { label: user.name }), pageHead(user.name, task.title));
    const side = h('div', { class: 'card rv-side stack' }, h('div', null, totalEl, openEl),
      statusPill(sub.status === 'draft' ? (sub.returned ? 'returned' : 'started') : sub.status),
      sub.submittedAt && h('div', { class: 'small muted' }, `Abgegeben ${fmtDate(sub.submittedAt, true)}`),
      h('label', { class: 'field', style: { margin: 0 } }, h('span', null, 'Gesamtfeedback'), overall), saveEl,
      sub.status === 'reviewed'
        ? h('button', { class: 'btn', onclick: () => act('reopen', 'Bewertung wieder geöffnet.') }, 'Bewertung bearbeiten')
        : sub.status === 'submitted' ? [h('button', { class: 'btn primary', onclick: () => act('finish', 'Bewertung abgeschlossen.') }, icon('check', 16), 'Bewertung abschließen'),
          h('button', { class: 'btn', onclick: async () => { if (await confirmDialog('Zurückgeben?', 'Der Azubi kann die Aufgabe dann erneut bearbeiten und abgeben.', 'Zurückgeben', false)) act('return', 'Zur Überarbeitung zurückgegeben.'); } }, 'Zur Überarbeitung zurückgeben')]
          : h('p', { class: 'small muted' }, 'Der Azubi bearbeitet diese Aufgabe gerade. Du siehst den aktuellen Stand.'));
    main.append(h('div', { class: 'rv-grid' }, renderBlocks({ blocks: task.blocks, answers: sub.answers, readOnly: true, result, showSolutions: true, extra: sub.status === 'draft' && !sub.returned ? undefined : extra }), side));
    drawTotal();
  }
  render();
  return async () => { if (dirty) await save().catch(() => {}); };
}

// ════════════ ADMIN ════════════
export async function adminUsers(main, u) {
  const { users } = await api('GET', '/users');
  const reload = () => adminUsers(main, u);
  const create = async () => {
    const r = await formDialogSubmit({
      title: 'Benutzer anlegen', submitLabel: 'Anlegen',
      fields: [
        { name: 'displayName', label: 'Name', placeholder: 'Vor- und Nachname' },
        { name: 'username', label: 'Benutzername', placeholder: 'z. B. max.muster' },
        { name: 'role', label: 'Gruppe', type: 'select', value: 'azubi', options: [['azubi', 'Azubi'], ['ausbilder', 'Ausbilder'], ['admin', 'Admin']] },
        { name: 'password', label: 'Startpasswort', type: 'text', hint: 'Mindestens 8 Zeichen. Die Person muss es beim ersten Login ändern.' },
      ],
      onSubmit: (v) => api('POST', '/users', v),
    });
    if (r) { toast('Benutzer angelegt.'); reload(); }
  };
  clear(main).append(pageHead('Benutzer', 'Azubis und Ausbilder verwalten.', h('button', { class: 'btn primary', onclick: create }, icon('plus', 16), 'Benutzer anlegen')));
  const body = h('tbody');
  for (const x of users) {
    const self = x.id === u.id, isAdmin = x.role === 'admin';
    body.append(h('tr', { style: { opacity: x.active ? 1 : 0.55 } },
      h('td', null, h('div', { style: { fontWeight: 500 } }, x.displayName), h('div', { class: 'small muted' }, '@' + x.username)),
      h('td', null, h('span', { class: `pill c-${isAdmin ? 'orange' : x.role === 'ausbilder' ? 'purple' : 'blue'}` }, ROLE[x.role]), !x.active && h('span', { class: 'pill c-gray', style: { marginLeft: '6px' } }, 'Deaktiviert')),
      h('td', { class: 'hide-sm muted' }, fmtDate(x.createdAt)),
      h('td', { style: { textAlign: 'right', whiteSpace: 'nowrap' } },
        h('button', { class: 'icon-btn', title: 'Bearbeiten', 'aria-label': 'Bearbeiten', onclick: async () => {
          const r = await formDialogSubmit({ title: 'Benutzer bearbeiten', fields: [
            { name: 'displayName', label: 'Name', value: x.displayName },
            !self && { name: 'role', label: 'Gruppe', type: 'select', value: x.role, options: [['azubi', 'Azubi'], ['ausbilder', 'Ausbilder'], ['admin', 'Admin']] },
            { name: 'password', label: 'Neues Passwort (optional)', type: 'text', hint: 'Leer lassen, um das Passwort zu behalten.' },
          ].filter(Boolean), onSubmit: (v) => { const body = { displayName: v.displayName, password: v.password }; if (v.role) body.role = v.role; return api('PATCH', `/users/${x.id}`, body); } });
          if (r) { toast('Gespeichert.'); reload(); }
        } }, icon('edit', 16)),
        !self && h('button', { class: 'icon-btn', title: x.active ? 'Deaktivieren' : 'Aktivieren', 'aria-label': x.active ? 'Deaktivieren' : 'Aktivieren', onclick: async () => { await api('PATCH', `/users/${x.id}`, { active: !x.active }); reload(); } }, icon(x.active ? 'lock' : 'check', 16)),
        !self && h('button', { class: 'icon-btn danger', title: 'Löschen', 'aria-label': 'Löschen', onclick: async () => { if (await confirmDialog('Benutzer löschen?', `„${x.displayName}“ und alle zugehörigen Abgaben werden endgültig gelöscht. Tipp: Deaktivieren behält die Daten.`)) { await api('DELETE', `/users/${x.id}`); reload(); } } }, icon('trash', 16)))));
  }
  main.append(h('div', { class: 'card flush tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Name', 'Gruppe', 'Angelegt', ''].map((t, i) => h('th', { class: i === 2 ? 'hide-sm' : '' }, t)))), body)));
}
