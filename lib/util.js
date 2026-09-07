import crypto from 'crypto';

export function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
}

// sliding window rate limiter, per key
const buckets = new Map();
export function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let arr = (buckets.get(key) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) {
    buckets.set(key, arr);
    return { ok: false, retryAfter: Math.ceil((windowMs - (now - arr[0])) / 1000) };
  }
  arr.push(now);
  buckets.set(key, arr);
  if (buckets.size > 5000) buckets.clear();
  return { ok: true };
}

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) return fwd.split(',')[0].trim();
  return req.ip || 'unknown';
}

export function validUrl(u, maxLen = 500) {
  if (typeof u !== 'string') return false;
  if (!u.length || u.length > maxLen) return false;
  try {
    const url = new URL(u);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function cleanStr(v, maxLen) {
  if (typeof v !== 'string') return '';
  // strip control chars + zero width junk
  return v.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029]/g, '').trim().slice(0, maxLen);
}

export function validUsername(u) {
  return typeof u === 'string' && /^[a-zA-Z0-9_]{3,20}$/.test(u);
}

export function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

// first n words of a name, used when no next-show note is set
export function firstWords(s, n = 4) {
  const w = String(s || '').trim().split(/\s+/).filter(Boolean);
  if (w.length <= n) return w.join(' ');
  return w.slice(0, n).join(' ') + '…';
}

// image sniffing so nobody uploads a renamed script
export function imageTypeFromBytes(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'gif';
  const riff = buf.slice(0, 4).toString('ascii');
  const webp = buf.slice(8, 12).toString('ascii');
  if (riff === 'RIFF' && webp === 'WEBP') return 'webp';
  return null;
}
