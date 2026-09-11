import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { Readable } from 'node:stream';

import {
  db, findUserByName, findUserById,
  saveUsers, saveChannels, saveChat,
  UPLOAD_DIR,
} from './lib/store.js';
import {
  hashPassword, verifyPassword, createSession, destroySession,
  getUserByToken, sessionTokenFromReq, parseCookies,
  publicUser, requireAuth, requireRole,
} from './lib/auth.js';
import {
  uid, rateLimit, clientIp, validUrl, cleanStr, validUsername,
  firstWords, imageTypeFromBytes,
} from './lib/util.js';
import { seedIfEmpty } from './lib/seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = parseInt(process.env.PORT, 10) || 3000;

seedIfEmpty();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '3mb' }));

// security headers. scripts locked to our own files, media/img allowed from
// anywhere since channels point at external video urls and uploaded images
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "img-src 'self' data: https: http:; " +
    "media-src 'self' https: http: blob:; " +
    "frame-src https: http:; " +
    "style-src 'self' 'unsafe-inline'; " +
    "script-src 'self'; " +
    "connect-src 'self' ws: wss:"
  );
  next();
});

// ── auth api ──────────────────────────────────────────────

const ROLE_RE = /^(viewer|broadcaster)$/;

app.post('/api/auth/signup', (req, res) => {
  const ip = clientIp(req);
  const hit = rateLimit(`signup:${ip}`, 5, 3600_000);
  if (!hit.ok) return res.status(429).json({ error: 'Too many sign-ups from this network. Try later.' });

  const { username, password, role } = req.body || {};
  if (!validUsername(username))
    return res.status(400).json({ error: 'Username must be 3-20 letters, numbers or _' });
  if (typeof password !== 'string' || password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (!ROLE_RE.test(String(role || '')))
    return res.status(400).json({ error: 'Pick Viewer or Broadcaster' });
  if (findUserByName(username))
    return res.status(400).json({ error: 'That username is taken' });

  // first ever account becomes the admin, someone has to run the place
  const first = db.users.length === 0;
  const { salt, hash } = hashPassword(password);
  const user = {
    id: uid('u'),
    username: String(username).trim(),
    usernameLower: String(username).toLowerCase().trim(),
    salt, passHash: hash,
    role: first ? 'admin' : role,
    banned: false,
    createdAt: Date.now(),
  };
  db.users.push(user);
  saveUsers();

  const token = createSession(user.id);
  res.cookie('wstv_session', token, cookieOpts());
  res.json({ ok: true, user: publicUser(user), firstAdmin: first });
});

app.post('/api/auth/login', (req, res) => {
  const hit = rateLimit(`login:${clientIp(req)}`, 10, 15 * 60_000);
  if (!hit.ok) return res.status(429).json({ error: 'Too many attempts. Wait a bit.' });

  const { username, password } = req.body || {};
  const user = findUserByName(String(username || ''));
  if (!user || !verifyPassword(user, password))
    return res.status(401).json({ error: 'Wrong username or password' });
  if (user.banned)
    return res.status(403).json({ error: 'This account is banned' });

  const token = createSession(user.id);
  res.cookie('wstv_session', token, cookieOpts());
  res.json({ ok: true, user: publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  destroySession(sessionTokenFromReq(req));
  res.clearCookie('wstv_session');
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  res.json({ ok: true, user: publicUser(getUserByToken(sessionTokenFromReq(req))) });
});

function cookieOpts() {
  return { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 3600 * 1000, path: '/' };
}

// ── channel helpers ───────────────────────────────────────

function canEditChannel(user, ch) {
  if (!user || !ch) return false;
  if (user.role === 'admin') return true;
  if (ch.kind === 'system') return false;          // system channels: admin only
  return ch.ownerId === user.id;                   // user channels: owner or admin
}

function nowNext(ch) {
  const now = Date.now();
  const items = [...(ch.schedule || [])].sort((a, b) => new Date(a.start) - new Date(b.start));
  let nowItem = null, nextItem = null;
  for (const it of items) {
    const s = new Date(it.start).getTime();
    const e = s + (parseInt(it.durationMin, 10) || 0) * 60_000;
    if (s <= now && now < e) nowItem = it;
    else if (s > now && !nextItem) nextItem = it;
  }
  return {
    now: nowItem ? { title: nowItem.title, endsAt: e2s(nowItem) } : null,
    next: nextItem ? { title: nextItem.title, start: nextItem.start } : null,
  };
}

function e2s(it) {
  return new Date(new Date(it.start).getTime() + (parseInt(it.durationMin, 10) || 0) * 60_000).toISOString();
}

// what a channel displays as "next". custom note if the admin/owner wrote one,
// otherwise the channel name capped at a few words
function nextShowText(ch) {
  if (ch.nextShowNote && ch.nextShowNote.trim()) return ch.nextShowNote.trim();
  return firstWords(ch.name, 4);
}

function channelSummary(ch) {
  const nn = nowNext(ch);
  return {
    id: ch.id,
    number: ch.number,
    name: ch.name,
    tagline: ch.tagline,
    kind: ch.kind,
    online: !!ch.online,
    image: ch.image || '',
    viewers: viewersOf(ch.id),
    now: nn.now,
    next: nn.next,
    nextShow: nextShowText(ch),
  };
}

// ── guide / channels api ──────────────────────────────────

app.get('/api/guide', (req, res) => {
  const channels = [...db.channels].sort((a, b) => a.number - b.number);
  res.json({ ok: true, channels: channels.map(channelSummary), serverTime: Date.now() });
});

app.get('/api/channels/:id', (req, res) => {
  const ch = db.channels.find(c => c.id === req.params.id);
  if (!ch) return res.status(404).json({ error: 'Channel not found' });
  const nn = nowNext(ch);
  res.json({
    ok: true,
    channel: {
      ...channelSummary(ch),
      schedule: [...(ch.schedule || [])].sort((a, b) => new Date(a.start) - new Date(b.start)),
      breakVideos: ch.breakVideos || [],
      nextShowNote: ch.nextShowNote || '',
    },
  });
});

app.get('/api/channels/:id/chat', (req, res) => {
  const ch = db.channels.find(c => c.id === req.params.id);
  if (!ch) return res.status(404).json({ error: 'Channel not found' });
  res.json({ ok: true, messages: (db.chat[ch.id] || []).slice(-30) });
});

app.post('/api/channels', requireRole('broadcaster', 'admin'), (req, res) => {
  const hit = rateLimit(`chcreate:${req.user.id}`, 10, 3600_000);
  if (!hit.ok) return res.status(429).json({ error: 'Slow down on channel creation' });

  const name = cleanStr(req.body?.name, 40);
  const tagline = cleanStr(req.body?.tagline, 90);
  if (name.length < 3) return res.status(400).json({ error: 'Channel name needs at least 3 characters' });

  const wantsSystem = req.user.role === 'admin' && req.body?.kind === 'system';
  // user channels start at 200, next free number
  let number;
  if (wantsSystem) {
    number = parseInt(req.body?.number, 10);
    if (!number || number < 100 || number > 199) number = 100 + db.channels.filter(c => c.kind === 'system').length;
  } else {
    number = 200;
    const taken = new Set(db.channels.map(c => c.number));
    while (taken.has(number)) number++;
  }
  if (db.channels.some(c => c.name.toLowerCase() === name.toLowerCase()))
    return res.status(400).json({ error: 'A channel with that name already exists' });

  const ch = {
    id: uid('ch'),
    number,
    name,
    tagline,
    kind: wantsSystem ? 'system' : 'user',
    ownerId: wantsSystem ? null : req.user.id,
    image: '',
    online: false,
    liveUrl: '',
    nextShowNote: '',
    breakVideos: [],
    schedule: [],
    createdAt: Date.now(),
  };
  db.channels.push(ch);
  saveChannels();
  broadcastGuide();
  res.json({ ok: true, channel: channelSummary(ch) });
});

app.patch('/api/channels/:id', requireAuth, async (req, res) => {
  const ch = db.channels.find(c => c.id === req.params.id);
  if (!ch) return res.status(404).json({ error: 'Channel not found' });
  if (!canEditChannel(req.user, ch)) return res.status(403).json({ error: 'You cannot edit this channel' });

  const hit = rateLimit(`chedit:${req.user.id}`, 60, 60_000);
  if (!hit.ok) return res.status(429).json({ error: 'Too many edits, slow down' });

  const b = req.body || {};
  if (b.name !== undefined) {
    const name = cleanStr(b.name, 40);
    if (name.length < 3) return res.status(400).json({ error: 'Channel name needs at least 3 characters' });
    if (db.channels.some(c => c.id !== ch.id && c.name.toLowerCase() === name.toLowerCase()))
      return res.status(400).json({ error: 'A channel with that name already exists' });
    ch.name = name;
  }
  if (b.tagline !== undefined) ch.tagline = cleanStr(b.tagline, 90);
  if (b.nextShowNote !== undefined) ch.nextShowNote = cleanStr(b.nextShowNote, 80);
  if (b.online !== undefined) ch.online = !!b.online;
  if (b.liveUrl !== undefined) {
    if (b.liveUrl === '') ch.liveUrl = '';
    else if (!validUrl(b.liveUrl)) return res.status(400).json({ error: 'Live URL must be a proper http(s) link' });
    else ch.liveUrl = b.liveUrl;
  }
  if (b.breakVideos !== undefined) {
    if (!Array.isArray(b.breakVideos)) return res.status(400).json({ error: 'breakVideos must be a list' });
    if (b.breakVideos.length > 8) return res.status(400).json({ error: 'Max 8 break videos' });
    for (const u of b.breakVideos) {
      if (u !== '' && !validUrl(u)) return res.status(400).json({ error: `Not a valid video url: ${String(u).slice(0, 60)}` });
    }
    ch.breakVideos = b.breakVideos.map(u => String(u).trim()).filter(Boolean);
  }
  if (req.user.role === 'admin' && b.number !== undefined) {
    const n = parseInt(b.number, 10);
    if (!n || n < 1 || n > 999) return res.status(400).json({ error: 'Number must be 1-999' });
    if (db.channels.some(c => c.id !== ch.id && c.number === n))
      return res.status(400).json({ error: 'That channel number is taken' });
    ch.number = n;
  }

  // link health checks -> warnings (don't block the save)
  const warnings = [];
  const toCheck = [];
  if (ch.liveUrl) toCheck.push(['live url', ch.liveUrl]);
  for (const u of (ch.breakVideos || [])) toCheck.push(['break video', u]);
  const results = await Promise.all(toCheck.map(([label, u]) => checkVideoUrl(u).then(w => w ? `${label}: ${w}` : null)));
  warnings.push(...results.filter(Boolean));

  saveChannels();
  broadcastGuide();
  io.to(`ch:${ch.id}`).emit('channel:meta', channelSummary(ch));
  res.json({ ok: true, channel: channelSummary(ch), warnings });
});

app.delete('/api/channels/:id', requireAuth, (req, res) => {
  const ch = db.channels.find(c => c.id === req.params.id);
  if (!ch) return res.status(404).json({ error: 'Channel not found' });
  if (!canEditChannel(req.user, ch)) return res.status(403).json({ error: 'You cannot delete this channel' });
  if (ch.kind === 'system') return res.status(400).json({ error: 'System channels cannot be deleted' });

  db.channels = db.channels.filter(c => c.id !== ch.id);
  delete db.chat[ch.id];
  saveChannels(); saveChat();
  if (ch.image?.startsWith('/uploads/')) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(ch.image))); } catch {}
  }
  broadcastGuide();
  res.json({ ok: true });
});

// full schedule replace. each item: title, start (iso), durationMin, videoUrl
// parse a start time. if it has no timezone info we read it as UTC so the
// result never depends on the server's own timezone (the studio app always
// sends full ISO strings with Z - this is just a safety net for api calls)
function parseStart(v) {
  if (typeof v !== 'string' || !v.trim()) return null;
  const s = /[zZ]$|[+\-]\d{2}:?\d{2}$/.test(v.trim()) ? v.trim() : v.trim() + 'Z';
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// check a video url is reachable and actually looks like a video.
// embed platforms can't be head-checked, so they pass without a look.
const EMBED_HOSTS = /(?:^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com|vimeo\.com|dailymotion\.com|twitch\.tv)$/i;
const _verified = new Map(); // url -> true (skip repeat checks within a run)
async function checkVideoUrl(u) {
  if (!validUrl(u)) return 'Not a valid http(s) link';
  if (EMBED_HOSTS.test(new URL(u).hostname) || _verified.has(u)) return null;
  try {
    let r = await fetch(u, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(8000) });
    if (r.status === 405 || r.status === 501) {
      // some servers refuse HEAD - try a 1kb range read instead
      r = await fetch(u, { headers: { range: 'bytes=0-1023' }, redirect: 'follow', signal: AbortSignal.timeout(8000) });
    }
    if (!r.ok && r.status !== 206) return `Server answered ${r.status}`;
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (ct && !ct.startsWith('video/') && !ct.startsWith('audio/') && ct !== 'application/octet-stream' && !ct.includes('mpegurl') && !ct.includes('quicktime')) {
      return `That link is "${ct}", not a video file`;
    }
    _verified.set(u, true);
    return null;
  } catch (e) {
    return `Could not reach that video url (${e.message})`;
  }
}

app.put('/api/channels/:id/schedule', requireAuth, async (req, res) => {
  const ch = db.channels.find(c => c.id === req.params.id);
  if (!ch) return res.status(404).json({ error: 'Channel not found' });
  if (!canEditChannel(req.user, ch)) return res.status(403).json({ error: 'You cannot edit this channel' });

  const list = req.body?.schedule;
  if (!Array.isArray(list) || list.length > 100)
    return res.status(400).json({ error: 'Schedule must be a list (max 100 items)' });

  const clean = [];
  for (const it of list) {
    const title = cleanStr(it?.title, 60);
    const start = parseStart(it?.start);
    const dur = parseInt(it?.durationMin, 10);
    if (!title) return res.status(400).json({ error: 'Every show needs a title' });
    if (!start) return res.status(400).json({ error: `Bad start time for "${title}"` });
    if (!dur || dur < 1 || dur > 24 * 60) return res.status(400).json({ error: `Bad duration for "${title}" (1-1440 min)` });
    if (it?.videoUrl && !validUrl(it.videoUrl)) return res.status(400).json({ error: `Bad video url for "${title}"` });
    clean.push({
      id: it.id || uid('show'),
      title,
      start: start.toISOString(),
      durationMin: dur,
      videoUrl: validUrl(it?.videoUrl) ? it.videoUrl : '',
    });
  }
  clean.sort((a, b) => new Date(a.start) - new Date(b.start));

  // check the links are alive before they go on air. problems come back as
  // warnings, not errors - a temporarily down cdn shouldn't block saving
  const warnings = [];
  const checks = await Promise.all(clean.filter(it => it.videoUrl).map(it => checkVideoUrl(it.videoUrl).then(w => w ? `"${it.title}": ${w}` : null)));
  warnings.push(...checks.filter(Boolean));

  ch.schedule = clean;
  saveChannels();
  broadcastGuide();
  io.to(`ch:${ch.id}`).emit('channel:schedule', clean);
  res.json({ ok: true, schedule: clean, warnings });
});

// channel image upload. accepts a data uri, sniffs the real type, saves the file
app.post('/api/channels/:id/image', requireAuth, (req, res) => {
  const ch = db.channels.find(c => c.id === req.params.id);
  if (!ch) return res.status(404).json({ error: 'Channel not found' });
  if (!canEditChannel(req.user, ch)) return res.status(403).json({ error: 'You cannot edit this channel' });

  const dataUri = String(req.body?.dataUri || '');
  const m = /^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/i.exec(dataUri);
  if (!m) return res.status(400).json({ error: 'Send a png, jpg, gif or webp image' });

  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 2 * 1024 * 1024) return res.status(400).json({ error: 'Image too big (max 2MB)' });
  const realType = imageTypeFromBytes(buf);
  if (!realType) return res.status(400).json({ error: 'That file is not a real image' });

  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const fname = `${ch.id}_${Date.now()}.${realType}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, fname), buf);

  // drop the old file if it was one of ours
  if (ch.image?.startsWith('/uploads/')) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(ch.image))); } catch {}
  }
  ch.image = `/uploads/${fname}`;
  saveChannels();
  broadcastGuide();
  res.json({ ok: true, image: ch.image });
});


// ── media proxy ───────────────────────────────────────────
// the server fetches a saved video url and streams it to the viewers
// (with seek/range support). only urls that exist in some channel's
// schedule / breaks / live url are allowed - never an open proxy,
// nothing is written to disk.

function mediaAllowList() {
  const set = new Set();
  for (const ch of db.channels) {
    if (ch.liveUrl) set.add(ch.liveUrl);
    for (const v of (ch.breakVideos || [])) set.add(v);
    for (const it of (ch.schedule || [])) if (it.videoUrl) set.add(it.videoUrl);
  }
  return set;
}

app.get('/api/media', async (req, res) => {
  const u = String(req.query.u || '');
  if (!validUrl(u) || !mediaAllowList().has(u)) {
    return res.status(403).json({ error: 'Not allowed' });
  }
  const hit = rateLimit(`media:${clientIp(req)}`, 60, 60_000);
  if (!hit.ok) return res.status(429).json({ error: 'Too many requests' });

  try {
    const headers = {};
    if (req.headers.range) headers.range = req.headers.range;
    const up = await fetch(u, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });
    if (!up.ok && up.status !== 206) {
      return res.status(502).json({ error: 'Video source unavailable' });
    }
    res.status(up.status);
    const ct = up.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    const cl = up.headers.get('content-length');
    if (cl) res.setHeader('Content-Length', cl);
    const cr = up.headers.get('content-range');
    if (cr) res.setHeader('Content-Range', cr);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    const stream = Readable.fromWeb(up.body);
    stream.pipe(res);
    req.on('close', () => stream.destroy());
  } catch (e) {
    if (!res.headersSent) res.status(502).json({ error: 'Video source unavailable' });
    else res.end();
  }
});

// ── admin api ─────────────────────────────────────────────

app.get('/api/admin/overview', requireRole('admin'), (req, res) => {
  res.json({
    ok: true,
    users: db.users.map(publicUser).map(u => ({ ...u, banned: db.users.find(x => x.id === u.id).banned })),
    channels: db.channels.map(c => ({ ...channelSummary(c), ownerId: c.ownerId })),
    counts: {
      users: db.users.length,
      broadcasters: db.users.filter(u => u.role === 'broadcaster').length,
      channels: db.channels.length,
      online: db.channels.filter(c => c.online).length,
    },
  });
});

app.patch('/api/admin/users/:id', requireRole('admin'), (req, res) => {
  const target = findUserById(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });

  const b = req.body || {};
  if (b.role !== undefined) {
    if (!['viewer', 'broadcaster', 'admin'].includes(b.role))
      return res.status(400).json({ error: 'Bad role' });
    if (target.id === req.user.id && b.role !== 'admin')
      return res.status(400).json({ error: 'You cannot demote yourself' });
    target.role = b.role;
  }
  if (b.banned !== undefined) {
    if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot ban yourself' });
    target.banned = !!b.banned;
  }
  saveUsers();
  res.json({ ok: true, user: { ...publicUser(target), banned: target.banned } });
});

// ── static + pages ────────────────────────────────────────

app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));
app.use(express.static(PUBLIC_DIR, { etag: true, maxAge: '10m' }));

const pages = {
  '/': 'index.html',
  '/login': 'login.html',
  '/studio': 'studio.html',
  '/admin': 'admin.html',
};
for (const [route, file] of Object.entries(pages)) {
  app.get(route, (req, res) => res.sendFile(path.join(PUBLIC_DIR, file)));
}
app.get('/watch/:id', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'watch.html')));

// anything unknown: proper 404. html page for pages, json for api
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
});

// ── websockets: the "television" part ─────────────────────

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false } });

// per channel viewer sets, in memory only
const viewers = new Map();   // chId -> Set<socketId>
const socketChannel = new Map(); // socketId -> chId

function viewersOf(chId) {
  if (!io || !viewers.get(chId)) return 0;
  let n = 0;
  for (const sid of viewers.get(chId)) if (io.sockets.sockets.has(sid)) n++;
  return n;
}

function broadcastViewers(chId) {
  io.to(`ch:${chId}`).emit('viewers', { channelId: chId, count: viewersOf(chId) });
}

function broadcastGuide() {
  io.emit('guide', {
    channels: [...db.channels].sort((a, b) => a.number - b.number).map(channelSummary),
    serverTime: Date.now(),
  });
}

io.on('connection', (socket) => {
  const user = getUserByToken(parseCookies({ headers: { cookie: socket.handshake.headers.cookie || '' } }).wstv_session);

  socket.data.user = user ? publicUser(user) : null;

  socket.on('tune', (chId) => {
    if (typeof chId !== 'string' || chId.length > 40) return;
    if (!db.channels.some(c => c.id === chId)) return;
    const prev = socketChannel.get(socket.id);
    if (prev === chId) return;
    if (prev) {
      socket.leave(`ch:${prev}`);
      viewers.get(prev)?.delete(socket.id);
      broadcastViewers(prev);
    }
    socket.join(`ch:${chId}`);
    if (!viewers.has(chId)) viewers.set(chId, new Set());
    viewers.get(chId).add(socket.id);
    socketChannel.set(socket.id, chId);
    broadcastViewers(chId);
    socket.emit('chat:history', (db.chat[chId] || []).slice(-30));
  });

  socket.on('untune', () => {
    const prev = socketChannel.get(socket.id);
    if (!prev) return;
    socket.leave(`ch:${prev}`);
    viewers.get(prev)?.delete(socket.id);
    socketChannel.delete(socket.id);
    broadcastViewers(prev);
  });

  socket.on('chat:send', (msg) => {
    const u = socket.data.user;
    const chId = socketChannel.get(socket.id);
    if (!chId) return;                               // not tuned to anything
    if (!u) {
      socket.emit('chat:error', { error: 'Sign in to chat' });
      return;
    }
    const text = String(msg?.text || '').slice(0, 240).trim();
    if (!text) return;
    if (!rateLimit(`chat:${u.id}`, 6, 10_000).ok) {
      socket.emit('chat:error', { error: 'Too fast, hold on' });
      return;
    }
    const m = { id: uid('m'), userId: u.id, username: u.username, text, ts: Date.now() };
    if (!db.chat[chId]) db.chat[chId] = [];
    db.chat[chId].push(m);
    if (db.chat[chId].length > 50) db.chat[chId].splice(0, db.chat[chId].length - 50);
    saveChat();
    io.to(`ch:${chId}`).emit('chat:new', m);
  });

  socket.on('disconnect', () => {
    const prev = socketChannel.get(socket.id);
    if (prev) {
      viewers.get(prev)?.delete(socket.id);
      socketChannel.delete(socket.id);
      broadcastViewers(prev);
    }
  });
});

// keep viewer counts honest even if tabs die weirdly
setInterval(() => {
  for (const [chId, set] of viewers) {
    let changed = false;
    for (const sid of [...set]) {
      if (!io.sockets.sockets.has(sid)) { set.delete(sid); changed = true; }
    }
    if (changed) broadcastViewers(chId);
  }
}, 30_000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`WSTV Live on 0.0.0.0:${PORT}`);
  if (!db.users.length) console.log('no accounts yet - the first signup becomes admin');
});
