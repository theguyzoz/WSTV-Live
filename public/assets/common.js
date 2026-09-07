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
    const safe = esc(ch.image);
    return '<img src="' + safe + '" alt="" style="width:' + size + 'px;height:' + size + 'px;border-radius:10px;object-fit:cover;display:block">';
  }
  const initials = String(ch.name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const hue = [...String(ch.id || ch.name || 'x')].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return '<div style="width:' + size + 'px;height:' + size + 'px;border-radius:10px;background:linear-gradient(135deg,hsl(' + hue + ',60%,42%),hsl(' + ((hue + 60) % 360) + ',60%,30%));display:grid;place-items:center;font-weight:900;color:#fff;font-size:' + Math.round(size / 2.8) + 'px">' + esc(initials) + '</div>';
}

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

function haveSession() {
  return document.cookie.includes('wstv_session=');
}
