'use strict';
const crypto = require('node:crypto');
const { db } = require('./db');

const SESSION_DAYS = 14;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [alg, saltHex, keyHex] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const key = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(keyHex, 'hex');
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)')
    .run(sha(token), userId, Date.now() + SESSION_DAYS * 864e5);
  return token;
}
function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(token));
}
function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function cookieOptions(req, maxAgeSec) {
  const secure = req.secure || process.env.COOKIE_SECURE === 'true';
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}
function setSessionCookie(req, res, token) {
  res.append('Set-Cookie', `azubify_sid=${token}; ${cookieOptions(req, SESSION_DAYS * 86400)}`);
}
function clearSessionCookie(req, res) {
  res.append('Set-Cookie', `azubify_sid=; ${cookieOptions(req, 0)}`);
}

const publicUser = (u) => u && ({
  id: u.id, username: u.username, displayName: u.display_name, role: u.role,
  active: !!u.active, mustChangePw: !!u.must_change_pw, createdAt: u.created_at,
});

function loadUser(req, _res, next) {
  const token = parseCookies(req.headers.cookie).azubify_sid;
  req.sessionToken = token;
  if (token) {
    const row = db.prepare(`SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=?`).get(sha(token));
    if (row && row.expires_at > Date.now() && row.active) req.user = row;
    else if (row) destroySession(token);
  }
  next();
}
const requireAuth = (req, res, next) =>
  req.user ? next() : res.status(401).json({ error: 'Nicht angemeldet.' });
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Nicht angemeldet.' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Keine Berechtigung.' });
  next();
};
const isStaff = (u) => u.role === 'admin' || u.role === 'ausbilder';

// einfacher In-Memory-Schutz gegen Brute-Force
const attempts = new Map();
function loginThrottle(key) {
  const e = attempts.get(key);
  if (e && e.until > Date.now()) return Math.ceil((e.until - Date.now()) / 1000);
  return 0;
}
function loginFailed(key) {
  const e = attempts.get(key) || { n: 0, until: 0 };
  e.n += 1;
  if (e.n >= 5) e.until = Date.now() + Math.min(15 * 60e3, 30e3 * 2 ** (e.n - 5));
  attempts.set(key, e);
}
const loginOk = (key) => attempts.delete(key);

function ensureAdmin() {
  const count = db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin'").get().c;
  if (count) return;
  const username = process.env.ADMIN_USER || 'admin';
  let password = process.env.ADMIN_PASSWORD;
  let generated = false;
  if (!password) { password = crypto.randomBytes(9).toString('base64url'); generated = true; }
  db.prepare(`INSERT INTO users (username,display_name,role,password_hash,must_change_pw)
    VALUES (?,?,?,?,?)`).run(username, 'Administrator', 'admin', hashPassword(password), generated ? 1 : 0);
  console.log(`\n[Azubify] Admin-Benutzer angelegt: ${username}`);
  if (generated) console.log(`[Azubify] Einmal-Passwort: ${password}  (bitte nach dem Login ändern)\n`);
}

module.exports = {
  hashPassword, verifyPassword, createSession, destroySession, setSessionCookie, clearSessionCookie,
  publicUser, loadUser, requireAuth, requireRole, isStaff, loginThrottle, loginFailed, loginOk, ensureAdmin,
};
