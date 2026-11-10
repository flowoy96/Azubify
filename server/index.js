'use strict';
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { db, tx, DATA_DIR } = require('./db');
const A = require('./auth');
const B = require('./blocks');

A.ensureAdmin();

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
  });
  next();
});
app.use(express.json({ limit: '2mb' }));
app.use(A.loadUser);

// CSRF-Schutz: schreibende Anfragen müssen vom eigenen Host kommen.
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin) {
    try { if (new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Ungültige Herkunft.' }); }
    catch { return res.status(403).json({ error: 'Ungültige Herkunft.' }); }
  }
  next();
});

const api = express.Router();
const wrap = (fn) => (req, res, next) => { try { fn(req, res, next); } catch (e) { next(e); } };
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const staff = A.requireRole('admin', 'ausbilder');
const admin = A.requireRole('admin');
const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const jparse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

// ───────────── Auth ─────────────
api.post('/login', wrap((req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const key = `${req.ip}|${username.toLowerCase()}`;
  const wait = A.loginThrottle(key);
  if (wait) return bad(res, `Zu viele Versuche. Bitte in ${wait} Sekunden erneut probieren.`, 429);
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  const ok = u && u.active && A.verifyPassword(password, u.password_hash);
  if (!ok) { A.loginFailed(key); return bad(res, 'Benutzername oder Passwort ist falsch.', 401); }
  A.loginOk(key);
  A.setSessionCookie(req, res, A.createSession(u.id));
  res.json({ user: A.publicUser(u) });
}));
api.post('/logout', wrap((req, res) => {
  A.destroySession(req.sessionToken); A.clearSessionCookie(req, res); res.json({ ok: true });
}));
api.get('/me', wrap((req, res) => res.json({ user: req.user ? A.publicUser(req.user) : null })));

api.use(A.requireAuth);

api.post('/me/password', wrap((req, res) => {
  const { current, next } = req.body;
  if (!A.verifyPassword(String(current || ''), req.user.password_hash)) return bad(res, 'Das aktuelle Passwort ist falsch.');
  if (String(next || '').length < 8) return bad(res, 'Das neue Passwort muss mindestens 8 Zeichen haben.');
  db.prepare('UPDATE users SET password_hash=?, must_change_pw=0 WHERE id=?').run(A.hashPassword(next), req.user.id);
  db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(req.user.id, require('node:crypto').createHash('sha256').update(req.sessionToken).digest('hex'));
  res.json({ ok: true });
}));

// ───────────── Benutzer (Admin) ─────────────
api.get('/users', staff, wrap((req, res) => {
  const rows = db.prepare('SELECT * FROM users ORDER BY role, display_name COLLATE NOCASE').all();
  const visible = req.user.role === 'admin' ? rows : rows.filter((u) => u.role === 'azubi');
  res.json({ users: visible.map(A.publicUser) });
}));
const validRole = (r) => ['azubi', 'ausbilder', 'admin'].includes(r);
api.post('/users', admin, wrap((req, res) => {
  const { username, displayName, role, password } = req.body;
  const un = String(username || '').trim();
  if (!/^[\w.@-]{3,40}$/.test(un)) return bad(res, 'Benutzername: 3–40 Zeichen (Buchstaben, Zahlen, . _ - @).');
  if (!String(displayName || '').trim()) return bad(res, 'Bitte einen Anzeigenamen angeben.');
  if (!validRole(role)) return bad(res, 'Ungültige Gruppe.');
  if (String(password || '').length < 8) return bad(res, 'Das Passwort muss mindestens 8 Zeichen haben.');
  if (db.prepare('SELECT 1 FROM users WHERE username=?').get(un)) return bad(res, 'Dieser Benutzername ist bereits vergeben.', 409);
  const r = db.prepare('INSERT INTO users (username,display_name,role,password_hash,must_change_pw) VALUES (?,?,?,?,1)')
    .run(un, String(displayName).trim().slice(0, 80), role, A.hashPassword(password));
  res.status(201).json({ user: A.publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(r.lastInsertRowid)) });
}));
api.patch('/users/:id', admin, wrap((req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) return bad(res, 'Benutzer nicht gefunden.', 404);
  const isSelf = u.id === req.user.id;
  const otherAdmin = () => db.prepare("SELECT 1 FROM users WHERE role='admin' AND active=1 AND id<>?").get(u.id);
  const { displayName, role, active, password } = req.body;
  if (displayName !== undefined) {
    if (!String(displayName).trim()) return bad(res, 'Anzeigename darf nicht leer sein.');
    db.prepare('UPDATE users SET display_name=? WHERE id=?').run(String(displayName).trim().slice(0, 80), u.id);
  }
  if (role !== undefined && role !== u.role) {
    if (u.role === 'admin' && !otherAdmin()) return bad(res, 'Es muss mindestens ein aktiver Admin bleiben.');
    if (!validRole(role)) return bad(res, 'Ungültige Gruppe.');
    db.prepare('UPDATE users SET role=? WHERE id=?').run(role, u.id);
  }
  if (active !== undefined) {
    if (!active && u.role === 'admin' && !otherAdmin()) return bad(res, 'Es muss mindestens ein aktiver Admin bleiben.');
    db.prepare('UPDATE users SET active=? WHERE id=?').run(active ? 1 : 0, u.id);
    if (!active) db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
  }
  if (password !== undefined && password !== '') {
    if (String(password).length < 8) return bad(res, 'Das Passwort muss mindestens 8 Zeichen haben.');
    db.prepare('UPDATE users SET password_hash=?, must_change_pw=? WHERE id=?').run(A.hashPassword(password), isSelf ? 0 : 1, u.id);
    if (!isSelf) db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
  }
  res.json({ user: A.publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(u.id)) });
}));
api.delete('/users/:id', admin, wrap((req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) return bad(res, 'Benutzer nicht gefunden.', 404);
  if (u.role === 'admin' && !db.prepare("SELECT 1 FROM users WHERE role='admin' AND active=1 AND id<>?").get(u.id)) return bad(res, 'Es muss mindestens ein aktiver Admin bleiben.');
  db.prepare('DELETE FROM users WHERE id=?').run(u.id);
  res.json({ ok: true });
}));

// ───────────── Themen ─────────────
const COLORS = ['blue', 'green', 'orange', 'purple', 'red', 'teal', 'pink', 'gray'];

/** Fortschritt eines Azubis für eine Liste von Aufgaben (nur veröffentlichte). */
function progressFor(userId, topicId) {
  const tasks = db.prepare("SELECT id, blocks FROM tasks WHERE topic_id=? AND status='published'").all(topicId);
  const subs = new Map(db.prepare(`SELECT s.* FROM submissions s JOIN tasks t ON t.id=s.task_id
    WHERE s.user_id=? AND t.topic_id=?`).all(userId, topicId).map((s) => [s.task_id, s]));
  const p = { total: tasks.length, started: 0, submitted: 0, reviewed: 0, score: 0, max: 0 };
  for (const t of tasks) {
    const s = subs.get(t.id);
    if (!s) continue;
    const blocks = jparse(t.blocks, []);
    if (s.status === 'draft') { if (Object.keys(jparse(s.answers, {})).length) p.started++; }
    else if (s.status === 'submitted') p.submitted++;
    else {
      p.reviewed++;
      const ev = B.evaluate(blocks, jparse(s.answers, {}), jparse(s.review, {}));
      p.score += ev.score; p.max += ev.max;
    }
  }
  p.score = Math.round(p.score * 100) / 100; p.max = Math.round(p.max * 100) / 100;
  return p;
}

api.get('/topics', wrap((req, res) => {
  if (A.isStaff(req.user)) {
    const topics = db.prepare('SELECT * FROM topics ORDER BY title COLLATE NOCASE').all().map((t) => ({
      id: t.id, title: t.title, description: t.description, color: t.color,
      taskCount: db.prepare('SELECT COUNT(*) c FROM tasks WHERE topic_id=?').get(t.id).c,
      publishedCount: db.prepare("SELECT COUNT(*) c FROM tasks WHERE topic_id=? AND status='published'").get(t.id).c,
      accessCount: db.prepare('SELECT COUNT(*) c FROM topic_access WHERE topic_id=?').get(t.id).c,
      toReview: db.prepare(`SELECT COUNT(*) c FROM submissions s JOIN tasks k ON k.id=s.task_id
        WHERE k.topic_id=? AND s.status='submitted' AND s.archived=0`).get(t.id).c,
    }));
    return res.json({ topics });
  }
  const topics = db.prepare(`SELECT t.* FROM topics t JOIN topic_access a ON a.topic_id=t.id
    WHERE a.user_id=? ORDER BY t.title COLLATE NOCASE`).all(req.user.id)
    .map((t) => ({ id: t.id, title: t.title, description: t.description, color: t.color, progress: progressFor(req.user.id, t.id) }))
    .filter((t) => t.progress.total > 0);
  res.json({ topics });
}));
api.post('/topics', staff, wrap((req, res) => {
  const title = String(req.body.title || '').trim();
  if (!title) return bad(res, 'Bitte einen Titel angeben.');
  const color = COLORS.includes(req.body.color) ? req.body.color : 'blue';
  const r = db.prepare('INSERT INTO topics (title,description,color,created_by) VALUES (?,?,?,?)')
    .run(title.slice(0, 120), String(req.body.description || '').slice(0, 1000), color, req.user.id);
  res.status(201).json({ id: Number(r.lastInsertRowid) });
}));
api.patch('/topics/:id', staff, wrap((req, res) => {
  const t = db.prepare('SELECT * FROM topics WHERE id=?').get(req.params.id);
  if (!t) return bad(res, 'Thema nicht gefunden.', 404);
  const title = req.body.title !== undefined ? String(req.body.title).trim() : t.title;
  if (!title) return bad(res, 'Bitte einen Titel angeben.');
  db.prepare('UPDATE topics SET title=?, description=?, color=? WHERE id=?').run(
    title.slice(0, 120),
    req.body.description !== undefined ? String(req.body.description).slice(0, 1000) : t.description,
    COLORS.includes(req.body.color) ? req.body.color : t.color, t.id);
  res.json({ ok: true });
}));
api.delete('/topics/:id', staff, wrap((req, res) => {
  db.prepare('DELETE FROM topics WHERE id=?').run(req.params.id); res.json({ ok: true });
}));

api.get('/topics/:id', wrap((req, res) => {
  const t = db.prepare('SELECT * FROM topics WHERE id=?').get(req.params.id);
  if (!t) return bad(res, 'Thema nicht gefunden.', 404);
  const topic = { id: t.id, title: t.title, description: t.description, color: t.color };
  if (A.isStaff(req.user)) {
    const tasks = db.prepare('SELECT * FROM tasks WHERE topic_id=? ORDER BY position, id').all(t.id).map((k) => {
      const blocks = jparse(k.blocks, []);
      const counts = db.prepare(`SELECT status, COUNT(*) c FROM submissions WHERE task_id=? GROUP BY status`).all(k.id);
      const c = Object.fromEntries(counts.map((x) => [x.status, x.c]));
      return {
        id: k.id, title: k.title, status: k.status, dueDate: k.due_date,
        questions: blocks.filter(B.isQuestion).length, points: blocks.reduce((s, b) => s + (B.isQuestion(b) ? b.points || 0 : 0), 0),
        submitted: db.prepare("SELECT COUNT(*) c FROM submissions WHERE task_id=? AND status='submitted' AND archived=0").get(k.id).c, reviewed: c.reviewed || 0, draft: c.draft || 0, updatedAt: k.updated_at,
      };
    });
    const access = db.prepare('SELECT user_id FROM topic_access WHERE topic_id=?').all(t.id).map((r) => r.user_id);
    return res.json({ topic, tasks, access });
  }
  if (!db.prepare('SELECT 1 FROM topic_access WHERE topic_id=? AND user_id=?').get(t.id, req.user.id)) return bad(res, 'Kein Zugriff.', 403);
  const tasks = db.prepare("SELECT * FROM tasks WHERE topic_id=? AND status='published' ORDER BY position, id").all(t.id).map((k) => {
    const blocks = jparse(k.blocks, []);
    const s = db.prepare('SELECT * FROM submissions WHERE task_id=? AND user_id=?').get(k.id, req.user.id);
    let state = 'open', score = null, max = 0;
    max = blocks.reduce((sum, b) => sum + (B.isQuestion(b) ? b.points || 0 : 0), 0);
    if (s) {
      if (s.status === 'draft') state = Object.keys(jparse(s.answers, {})).length ? (s.returned ? 'returned' : 'started') : 'open';
      else state = s.status;
      if (s.status === 'reviewed') score = B.evaluate(blocks, jparse(s.answers, {}), jparse(s.review, {})).score;
    }
    return { id: k.id, title: k.title, dueDate: k.due_date, state, score, max, questions: blocks.filter(B.isQuestion).length };
  });
  res.json({ topic, tasks });
}));
api.put('/topics/:id/access', staff, wrap((req, res) => {
  const t = db.prepare('SELECT 1 FROM topics WHERE id=?').get(req.params.id);
  if (!t) return bad(res, 'Thema nicht gefunden.', 404);
  const ids = (Array.isArray(req.body.userIds) ? req.body.userIds : []).map(Number)
    .filter((id) => db.prepare("SELECT 1 FROM users WHERE id=? AND role='azubi'").get(id));
  tx(() => {
    db.prepare('DELETE FROM topic_access WHERE topic_id=?').run(req.params.id);
    for (const id of new Set(ids)) db.prepare('INSERT INTO topic_access (topic_id,user_id) VALUES (?,?)').run(req.params.id, id);
  });
  res.json({ ok: true });
}));

// ───────────── Aufgaben ─────────────
function loadTask(id) {
  const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
  return t && { ...t, blocksArr: jparse(t.blocks, []) };
}
const taskJson = (t, blocks) => ({
  id: t.id, topicId: t.topic_id, title: t.title, status: t.status, dueDate: t.due_date, blocks, updatedAt: t.updated_at,
});
const validDate = (d) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);

api.post('/topics/:id/tasks', staff, wrap((req, res) => {
  if (!db.prepare('SELECT 1 FROM topics WHERE id=?').get(req.params.id)) return bad(res, 'Thema nicht gefunden.', 404);
  const title = String(req.body.title || '').trim() || 'Neue Aufgabe';
  const pos = db.prepare('SELECT COALESCE(MAX(position),0)+1 p FROM tasks WHERE topic_id=?').get(req.params.id).p;
  const r = db.prepare('INSERT INTO tasks (topic_id,title,blocks,position,created_by) VALUES (?,?,?,?,?)')
    .run(req.params.id, title.slice(0, 200), '[]', pos, req.user.id);
  res.status(201).json({ id: Number(r.lastInsertRowid) });
}));

api.get('/tasks/:id', wrap((req, res) => {
  const t = loadTask(req.params.id);
  if (!t) return bad(res, 'Aufgabe nicht gefunden.', 404);
  const topic = db.prepare('SELECT id,title,color FROM topics WHERE id=?').get(t.topic_id);
  if (A.isStaff(req.user)) return res.json({ task: taskJson(t, t.blocksArr), topic });
  if (t.status !== 'published' || !db.prepare('SELECT 1 FROM topic_access WHERE topic_id=? AND user_id=?').get(t.topic_id, req.user.id))
    return bad(res, 'Kein Zugriff.', 403);
  const s = db.prepare('SELECT * FROM submissions WHERE task_id=? AND user_id=?').get(t.id, req.user.id);
  const reviewed = s && s.status === 'reviewed';
  const answers = s ? jparse(s.answers, {}) : {};
  const review = s ? jparse(s.review, {}) : {};
  const out = {
    task: taskJson(t, reviewed ? t.blocksArr : B.stripSolutions(t.blocksArr)),
    topic,
    submission: {
      status: s ? s.status : 'draft', returned: !!(s && s.returned), answers,
      submittedAt: s && s.submitted_at, reviewedAt: s && s.reviewed_at,
      feedback: s && (s.returned || reviewed) ? review.comment || '' : '',
    },
  };
  if (reviewed) out.result = B.evaluate(t.blocksArr, answers, review);
  else if (s && s.returned) out.result = { perBlock: Object.fromEntries(Object.entries(review.blocks || {}).map(([k, v]) => [k, { comment: v.comment || '' }])) };
  res.json(out);
}));

api.put('/tasks/:id', staff, wrap((req, res) => {
  const t = loadTask(req.params.id);
  if (!t) return bad(res, 'Aufgabe nicht gefunden.', 404);
  const title = req.body.title !== undefined ? String(req.body.title).slice(0, 200) : t.title;
  const blocks = req.body.blocks !== undefined ? JSON.stringify(B.sanitizeBlocks(req.body.blocks)) : t.blocks;
  const status = ['draft', 'published'].includes(req.body.status) ? req.body.status : t.status;
  const due = req.body.dueDate !== undefined ? validDate(req.body.dueDate) : t.due_date;
  const ts = now();
  db.prepare('UPDATE tasks SET title=?, blocks=?, status=?, due_date=?, updated_at=? WHERE id=?').run(title, blocks, status, due, ts, t.id);
  res.json({ ok: true, updatedAt: ts, blocks: jparse(blocks, []) });
}));
api.delete('/tasks/:id', staff, wrap((req, res) => {
  db.prepare('DELETE FROM tasks WHERE id=?').run(req.params.id); res.json({ ok: true });
}));
api.post('/tasks/:id/duplicate', staff, wrap((req, res) => {
  const t = loadTask(req.params.id);
  if (!t) return bad(res, 'Aufgabe nicht gefunden.', 404);
  const blocks = t.blocksArr.map((b) => ({ ...b, id: crypto.randomUUID() }));
  const pos = db.prepare('SELECT COALESCE(MAX(position),0)+1 p FROM tasks WHERE topic_id=?').get(t.topic_id).p;
  const r = db.prepare('INSERT INTO tasks (topic_id,title,blocks,position,created_by) VALUES (?,?,?,?,?)')
    .run(t.topic_id, `${t.title} (Kopie)`.slice(0, 200), JSON.stringify(blocks), pos, req.user.id);
  res.status(201).json({ id: Number(r.lastInsertRowid) });
}));

// ───────────── Azubi: Antworten speichern / abgeben ─────────────
function azubiTask(req, res) {
  const t = loadTask(req.params.id);
  if (!t || t.status !== 'published' || !db.prepare('SELECT 1 FROM topic_access WHERE topic_id=? AND user_id=?').get(t.topic_id, req.user.id)) {
    bad(res, 'Kein Zugriff auf diese Aufgabe.', 403); return null;
  }
  return t;
}
function ensureSubmission(taskId, userId) {
  db.prepare('INSERT OR IGNORE INTO submissions (task_id,user_id) VALUES (?,?)').run(taskId, userId);
  return db.prepare('SELECT * FROM submissions WHERE task_id=? AND user_id=?').get(taskId, userId);
}
api.put('/tasks/:id/answers', A.requireRole('azubi'), wrap((req, res) => {
  const t = azubiTask(req, res); if (!t) return;
  const s = ensureSubmission(t.id, req.user.id);
  if (s.status !== 'draft') return bad(res, 'Diese Aufgabe wurde bereits abgegeben und ist gesperrt.', 409);
  const incoming = req.body.answers && typeof req.body.answers === 'object' ? req.body.answers : {};
  const answers = jparse(s.answers, {});
  const byId = new Map(t.blocksArr.filter(B.isQuestion).map((b) => [b.id, b]));
  for (const [id, v] of Object.entries(incoming)) {
    const b = byId.get(id);
    if (b) answers[id] = B.sanitizeAnswer(b, v);
  }
  const ts = now();
  db.prepare('UPDATE submissions SET answers=?, updated_at=? WHERE id=?').run(JSON.stringify(answers), ts, s.id);
  res.json({ ok: true, savedAt: ts });
}));
api.post('/tasks/:id/submit', A.requireRole('azubi'), wrap((req, res) => {
  const t = azubiTask(req, res); if (!t) return;
  const s = ensureSubmission(t.id, req.user.id);
  if (s.status !== 'draft') return bad(res, 'Bereits abgegeben.', 409);
  const ts = now();
  db.prepare("UPDATE submissions SET status='submitted', returned=0, submitted_at=?, updated_at=? WHERE id=?").run(ts, ts, s.id);
  res.json({ ok: true });
}));

// ───────────── Ausbilder: Abgaben prüfen ─────────────
api.get('/tasks/:id/submissions', staff, wrap((req, res) => {
  const t = loadTask(req.params.id);
  if (!t) return bad(res, 'Aufgabe nicht gefunden.', 404);
  const azubis = db.prepare(`SELECT u.id, u.display_name FROM users u JOIN topic_access a ON a.user_id=u.id
    WHERE a.topic_id=? AND u.role='azubi' AND u.active=1 ORDER BY u.display_name COLLATE NOCASE`).all(t.topic_id);
  const rows = azubis.map((u) => {
    const s = db.prepare('SELECT * FROM submissions WHERE task_id=? AND user_id=?').get(t.id, u.id);
    const answers = s ? jparse(s.answers, {}) : {};
    let ev = null;
    if (s && s.status !== 'draft') ev = B.evaluate(t.blocksArr, answers, jparse(s.review, {}));
    return {
      userId: u.id, name: u.display_name, submissionId: s ? s.id : null,
      status: !s ? 'open' : s.status === 'draft' ? (Object.keys(answers).length ? (s.returned ? 'returned' : 'started') : 'open') : s.status,
      archived: !!(s && s.archived),
      submittedAt: s && s.submitted_at, score: ev && ev.score, max: ev && ev.max, openBlocks: ev && ev.open,
    };
  });
  res.json({ task: { id: t.id, title: t.title, topicId: t.topic_id }, rows });
}));

api.get('/submissions/:id', staff, wrap((req, res) => {
  const s = db.prepare('SELECT * FROM submissions WHERE id=?').get(req.params.id);
  if (!s) return bad(res, 'Abgabe nicht gefunden.', 404);
  const t = loadTask(s.task_id);
  const u = db.prepare('SELECT id, display_name FROM users WHERE id=?').get(s.user_id);
  const answers = jparse(s.answers, {}), review = jparse(s.review, {});
  res.json({
    task: taskJson(t, t.blocksArr), user: { id: u.id, name: u.display_name },
    submission: { id: s.id, archived: !!s.archived, taskId: s.task_id, status: s.status, returned: !!s.returned, answers, submittedAt: s.submitted_at, reviewedAt: s.reviewed_at, comment: review.comment || '' },
    result: B.evaluate(t.blocksArr, answers, review),
  });
}));
api.put('/submissions/:id/review', staff, wrap((req, res) => {
  const s = db.prepare('SELECT * FROM submissions WHERE id=?').get(req.params.id);
  if (!s) return bad(res, 'Abgabe nicht gefunden.', 404);
  const t = loadTask(s.task_id);
  const qs = new Map(t.blocksArr.filter(B.isQuestion).map((b) => [b.id, b]));
  const review = { comment: String(req.body.comment || '').slice(0, 5000), blocks: {} };
  for (const [id, v] of Object.entries(req.body.blocks || {})) {
    const b = qs.get(id); if (!b || !v) continue;
    const entry = {};
    if (v.points !== null && v.points !== undefined && v.points !== '') {
      const p = Number(v.points);
      if (Number.isFinite(p)) entry.points = Math.min(b.points || 0, Math.max(0, Math.round(p * 100) / 100));
    }
    if (v.comment) entry.comment = String(v.comment).slice(0, 2000);
    if (Object.keys(entry).length) review.blocks[id] = entry;
  }
  const action = req.body.action; // 'save' | 'finish' | 'return' | 'reopen'
  const ts = now();
  let status = s.status, returned = s.returned, reviewedAt = s.reviewed_at, reviewedBy = s.reviewed_by;
  if (action === 'finish') { status = 'reviewed'; returned = 0; reviewedAt = ts; reviewedBy = req.user.id; }
  else if (action === 'return') { status = 'draft'; returned = 1; reviewedAt = null; reviewedBy = req.user.id; }
  else if (action === 'reopen') { status = 'submitted'; reviewedAt = null; }
  db.prepare('UPDATE submissions SET review=?, status=?, returned=?, reviewed_at=?, reviewed_by=?, updated_at=? WHERE id=?')
    .run(JSON.stringify(review), status, returned, reviewedAt, reviewedBy, ts, s.id);
  res.json({ ok: true, status, result: B.evaluate(t.blocksArr, jparse(s.answers, {}), review) });
}));

api.put('/submissions/:id/archive', staff, wrap((req, res) => {
  const r = db.prepare('UPDATE submissions SET archived=? WHERE id=?').run(req.body.archived ? 1 : 0, req.params.id);
  if (!r.changes) return bad(res, 'Abgabe nicht gefunden.', 404);
  res.json({ ok: true });
}));
// Löscht die Abgabe endgültig; der Azubi kann die Aufgabe danach neu bearbeiten.
api.delete('/submissions/:id', staff, wrap((req, res) => {
  const r = db.prepare('DELETE FROM submissions WHERE id=?').run(req.params.id);
  if (!r.changes) return bad(res, 'Abgabe nicht gefunden.', 404);
  res.json({ ok: true });
}));

// ───────────── Lernfortschritt (Ausbilder) ─────────────
api.get('/progress', staff, wrap((req, res) => {
  const azubis = db.prepare("SELECT id, display_name, active FROM users WHERE role='azubi' ORDER BY active DESC, display_name COLLATE NOCASE").all();
  const rows = azubis.map((u) => {
    const topics = db.prepare(`SELECT t.id, t.title, t.color FROM topics t JOIN topic_access a ON a.topic_id=t.id
      WHERE a.user_id=? ORDER BY t.title COLLATE NOCASE`).all(u.id).map((t) => ({ ...t, ...progressFor(u.id, t.id) }));
    const sum = topics.reduce((a, t) => ({
      total: a.total + t.total, done: a.done + t.reviewed + t.submitted, reviewed: a.reviewed + t.reviewed,
      score: a.score + t.score, max: a.max + t.max, submitted: a.submitted + t.submitted,
    }), { total: 0, done: 0, reviewed: 0, score: 0, max: 0, submitted: 0 });
    return { id: u.id, name: u.display_name, active: !!u.active, topics, topicCount: topics.length, ...sum };
  });
  const toReview = db.prepare(`SELECT s.id, s.submitted_at, u.display_name name, t.title task, p.title topic, t.id task_id
    FROM submissions s JOIN users u ON u.id=s.user_id JOIN tasks t ON t.id=s.task_id JOIN topics p ON p.id=t.topic_id
    WHERE s.status='submitted' AND s.archived=0 ORDER BY s.submitted_at`).all();
  res.json({ azubis: rows, toReview });
}));
api.get('/progress/:userId', staff, wrap((req, res) => {
  const u = db.prepare("SELECT id, display_name FROM users WHERE id=? AND role='azubi'").get(req.params.userId);
  if (!u) return bad(res, 'Azubi nicht gefunden.', 404);
  const topics = db.prepare(`SELECT t.id, t.title, t.color FROM topics t JOIN topic_access a ON a.topic_id=t.id
    WHERE a.user_id=? ORDER BY t.title COLLATE NOCASE`).all(u.id).map((t) => {
    const tasks = db.prepare("SELECT * FROM tasks WHERE topic_id=? AND status='published' ORDER BY position, id").all(t.id).map((k) => {
      const blocks = jparse(k.blocks, []);
      const s = db.prepare('SELECT * FROM submissions WHERE task_id=? AND user_id=?').get(k.id, u.id);
      const answers = s ? jparse(s.answers, {}) : {};
      const ev = s && s.status !== 'draft' ? B.evaluate(blocks, answers, jparse(s.review, {})) : null;
      return {
        id: k.id, title: k.title, submissionId: s ? s.id : null,
        status: !s ? 'open' : s.status === 'draft' ? (Object.keys(answers).length ? (s.returned ? 'returned' : 'started') : 'open') : s.status,
        score: ev && ev.score, max: ev ? ev.max : blocks.reduce((x, b) => x + (B.isQuestion(b) ? b.points || 0 : 0), 0),
        submittedAt: s && s.submitted_at,
      };
    });
    return { ...t, ...progressFor(u.id, t.id), tasks };
  });
  res.json({ user: { id: u.id, name: u.display_name }, topics });
}));

// ───────────── Bild-Uploads ─────────────
const MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
function sniff(buf) {
  if (buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length > 6 && buf.toString('ascii', 0, 3) === 'GIF') return 'image/gif';
  return null;
}
api.post('/uploads', staff, express.raw({ type: () => true, limit: '8mb' }), wrap((req, res) => {
  const mime = Buffer.isBuffer(req.body) ? sniff(req.body) : null;
  if (!mime) return bad(res, 'Nur PNG-, JPEG-, WebP- oder GIF-Bilder (max. 8 MB) sind erlaubt.');
  const name = `${crypto.randomUUID()}.${MIME[mime]}`;
  fs.writeFileSync(path.join(DATA_DIR, 'uploads', name), req.body);
  res.status(201).json({ src: `/api/uploads/${name}` });
}));
api.get('/uploads/:name', wrap((req, res) => {
  if (!/^[\w-]+\.(png|jpg|webp|gif)$/.test(req.params.name)) return bad(res, 'Nicht gefunden.', 404);
  const file = path.join(DATA_DIR, 'uploads', req.params.name);
  if (!fs.existsSync(file)) return bad(res, 'Nicht gefunden.', 404);
  res.set('Cache-Control', 'private, max-age=86400').sendFile(file);
}));

api.use((_req, res) => bad(res, 'Nicht gefunden.', 404));
app.use('/api', api);

app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '5m', extensions: ['html'] }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.too.large') return bad(res, 'Die Daten sind zu groß.', 413);
  if (err.type === 'entity.parse.failed') return bad(res, 'Ungültige Anfrage.');
  console.error(err);
  res.status(500).json({ error: 'Interner Fehler.' });
});

// abgelaufene Sessions regelmäßig entfernen
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now()), 3600e3).unref();

const port = Number(process.env.PORT) || 3000;
if (require.main === module) app.listen(port, () => console.log(`[Azubify] läuft auf Port ${port}`));
module.exports = app;
