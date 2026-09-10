// shared helpers for all wstv pages
'use strict';

async function api(url, opts) {
  opts = opts || {};
  const headers = Object.assign({}, opts.headers || {});
  if (opts.body !== undefined && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const r = await fetch(url, {
    method: opts.method || 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  let d = null;
  try { d = await r.json(); } catch {}
  if (!r.ok) throw new Error((d && d.error) || ('Request failed (' + r.status + ')'));
  return d;
}

function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function fmtClock(ts) {
  const d = ts ? new Date(ts) : new Date();
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function fmtDayTime(ts) {
  const d = ts ? new Date(ts) : new Date();
  return d.toLocaleDateString([], { weekday: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// channel avatar: uploaded image or gradient initials tile
function chTile(ch, size) {
  size = size || 44;
  if (ch.image) {
    return '<img src="' + esc(ch.image) + '" alt="" style="width:' + size + 'px;height:' + size + 'px;border-radius:10px;object-fit:cover;display:block">';
  }
  const initials = String(ch.name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const hue = [...String(ch.id || ch.name || 'x')].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return '<div style="width:' + size + 'px;height:' + size + 'px;border-radius:10px;background:linear-gradient(135deg,hsl(' + hue + ',60%,42%),hsl(' + ((hue + 60) % 360) + ',60%,30%));display:grid;place-items:center;font-weight:900;color:#fff;font-size:' + Math.round(size / 2.8) + 'px">' + esc(initials) + '</div>';
}

// small eye icon (viewer counts)
const EYE = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/></svg>';

// youtube links become embeds, everything else goes to <video>
function youtubeId(url) {
  const m = String(url || '').match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : null;
}

function meRoute(role) {
  if (role === 'admin') return '/admin';
  if (role === 'broadcaster') return '/studio';
  return '/';
}

// ── event delegation ──────────────────────────────────────
// the CSP blocks inline onclick handlers, so everything goes through
// data-act / data-enter / data-oninput attributes and one listener.
// html: <button data-act="save">…</button>  <input data-enter="send">
//       <input data-oninput="sched" data-idx="3" data-field="title">

const COMMON_ACTIONS = {
  async logout() {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
    location.href = '/login';
  },
  go(ds) {
    if (ds.href && ds.href.startsWith('/')) location.href = ds.href;
  },
};

function bindActions(actions) {
  const all = Object.assign({}, COMMON_ACTIONS, actions || {});

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const fn = all[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el.dataset, el); }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const el = e.target.closest('[data-enter]');
    if (!el) return;
    const fn = all[el.dataset.enter];
    if (fn) { e.preventDefault(); fn(el.dataset, el); }
  });

  document.addEventListener('input', (e) => {
    const el = e.target.closest('[data-oninput]');
    if (!el) return;
    const fn = all[el.dataset.oninput];
    if (fn) fn(el.dataset, el);
  });
}
