import crypto from 'crypto';
import { db, findUserById, saveSessions } from './store.js';

// scrypt hashing, no plaintext ever touches disk
export function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

export function verifyPassword(user, password) {
  if (!user || !user.salt || !user.passHash) return false;
  const check = crypto.scryptSync(String(password), user.salt, 64);
  const want = Buffer.from(user.passHash, 'hex');
  return check.length === want.length && crypto.timingSafeEqual(check, want);
}

const SESSION_TTL = 7 * 24 * 3600 * 1000;

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions[token] = { userId, createdAt: Date.now(), lastSeen: Date.now() };
  saveSessions();
  return token;
}

export function destroySession(token) {
  if (token && db.sessions[token]) {
    delete db.sessions[token];
    saveSessions();
  }
}

export function getUserByToken(token) {
  if (!token || !db.sessions[token]) return null;
  const s = db.sessions[token];
  if (Date.now() - s.lastSeen > SESSION_TTL) {
    delete db.sessions[token];
    saveSessions();
    return null;
  }
  s.lastSeen = Date.now();
  const user = findUserById(s.userId);
  if (!user || user.banned) return null;
  return user;
}

export function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionTokenFromReq(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return parseCookies(req).wstv_session || null;
}

export function publicUser(u) {
  if (!u) return null;
  return { id: u.id, username: u.username, role: u.role, createdAt: u.createdAt };
}

// guards. attach req.user or reject
export function requireAuth(req, res, next) {
  const user = getUserByToken(sessionTokenFromReq(req));
  if (!user) return res.status(401).json({ error: 'Sign in first' });
  req.user = user;
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    const user = getUserByToken(sessionTokenFromReq(req));
    if (!user) return res.status(401).json({ error: 'Sign in first' });
    if (!roles.includes(user.role)) return res.status(403).json({ error: 'Not allowed for your account' });
    req.user = user;
    next();
  };
}
