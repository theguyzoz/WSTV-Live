// the player. server only gives info - the actual video plays here
// states: show | break | live | offline | empty
'use strict';

const chId = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '');
let CH = null;          // channel detail
let me = null;
let breakIdx = 0;
let currentState = '';
let currentSrc = '';
const $ = (id) => document.getElementById(id);

if (!chId) location.href = '/';

// hand-drawn stroke icons for the on-screen states
const ICONS = {
  offline: '<svg width="54" height="54" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3v9"/><path d="M6.2 6.6a8 8 0 1 0 11.6 0"/></svg>',
  pause: '<svg width="54" height="54" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="7" y="5" width="3.6" height="14" rx="1.6"/><rect x="13.4" y="5" width="3.6" height="14" rx="1.6"/></svg>',
  clock: '<svg width="54" height="54" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>',
  notfound: '<svg width="54" height="54" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/><path d="M8.7 8.7l4.6 4.6M13.3 8.7l-4.6 4.6"/></svg>',
};

async function init() {
  try { me = (await api('/api/auth/me')).user; } catch { me = null; }
  if (me) {
    $('acct').textContent = me.username;
    $('acct').href = meRoute(me.role);
  }

  try {
    const d = await api('/api/channels/' + encodeURIComponent(chId));
    CH = d.channel;
  } catch (e) {
    $('screen').innerHTML = stateCardHtml(ICONS.notfound, 'Channel not found', e.message, false);
    $('infobar').innerHTML = '<span class="mut">' + esc(e.message) + '</span>';
    return;
  }

  document.title = CH.number + ' ' + CH.name + ' — WSTV Live';
  renderInfo();
  renderChatForm();
  tick();
  setInterval(tick, 5000);

  const socket = io();
  window._socket = socket;
  socket.on('connect', () => socket.emit('tune', chId));
  socket.on('viewers', d => {
    if (d.channelId === chId) {
      $('chatvw').textContent = d.count + ' watching';
      const vn = $('vwnum');
      if (vn) vn.textContent = d.count;
    }
  });
  socket.on('chat:history', renderChat);
  socket.on('chat:new', m => appendChat(m));
  socket.on('chat:error', d => flashChatError(d.error));
  socket.on('channel:meta', c => { if (c.id === chId) { CH = { ...CH, ...c }; renderInfo(); tick(true); } });
  socket.on('channel:schedule', s => { CH.schedule = s; tick(true); });
  window.addEventListener('beforeunload', () => socket.emit('untune'));

  setInterval(renderNextbar, 1000);
}

// work out what should be on screen right now
function computeState() {
  const now = Date.now();
  const items = [...(CH.schedule || [])].sort((a, b) => new Date(a.start) - new Date(b.start));
  let current = null, next = null;
  for (const it of items) {
    const s = new Date(it.start).getTime();
    const e = s + (parseInt(it.durationMin, 10) || 0) * 60_000;
    if (s <= now && now < e) current = it;
    if (s > now && !next) next = it;
  }
  if (!CH.online) return { state: 'offline', next };
  if (current) return { state: 'show', current, next };
  if (next) return { state: 'break', next };
  if (CH.liveUrl) return { state: 'live' };
  return { state: 'empty' };
}

function tick(force) {
  if (!CH) return;
  const st = computeState();
  const src = videoSrcFor(st);
  if (!force && st.state === currentState && src === currentSrc) { renderNextbar(); return; }
  currentState = st.state;
  currentSrc = src;

  const scr = $('screen');
  if (st.state === 'show') {
    scr.innerHTML = playerHtml(src) + '<div class="breakbar" style="background:linear-gradient(90deg,rgba(34,197,94,.92),rgba(34,197,94,.7));color:#03210f">● LIVE — ' + esc(st.current.title) + '</div>';
  } else if (st.state === 'break') {
    const bv = (CH.breakVideos || []);
    const v = bv.length ? playerHtml(bv[breakIdx % bv.length], true) : '';
    scr.innerHTML = v + stateCardHtml(ICONS.pause, 'On break', 'Up next: <b>' + esc(st.next.title) + '</b> at ' + fmtDayTime(st.next.start), !!bv.length, true);
    if (bv.length) breakIdx++;
  } else if (st.state === 'live') {
    scr.innerHTML = playerHtml(src) + '<div class="breakbar" style="background:linear-gradient(90deg,rgba(34,197,94,.92),rgba(34,197,94,.7));color:#032210">● LIVE</div>';
  } else if (st.state === 'offline') {
    // offline: the info card on top of the channel's uploaded image
    scr.innerHTML = stateCardHtml(ICONS.offline, 'Channel offline', 'This channel is off air right now.<br>Next up: ' + esc(nextShowText()), false);
  } else {
    scr.innerHTML = stateCardHtml(ICONS.clock, 'Tune in soon', 'Nothing scheduled on ' + esc(CH.name) + ' yet. Check the guide later.', false);
  }
  renderNextbar();
}

function nextShowText() {
  return CH.nextShowNote && CH.nextShowNote.trim() ? CH.nextShowNote : CH.name;
}

function videoSrcFor(st) {
  if (st.state === 'show') return st.current.videoUrl || '';
  if (st.state === 'live') return CH.liveUrl || '';
  if (st.state === 'break') {
    const bv = CH.breakVideos || [];
    return bv.length ? bv[breakIdx % bv.length] : '';
  }
  return '';
}

function playerHtml(url, muted) {
  const yt = youtubeId(url);
  if (yt) {
    return '<iframe src="https://www.youtube.com/embed/' + yt + '?autoplay=1&rel=0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>';
  }
  return '<video src="' + esc(url) + '" controls autoplay playsinline' + (muted ? ' muted' : '') + '></video>';
}

function stateCardHtml(icon, big, subHtml, behindVideo, isBreak) {
  const img = CH && CH.image ? '<img class="bg" src="' + esc(CH.image) + '" alt="">' : '';
  return '<div class="statecard"' + (behindVideo ? ' style="background:transparent;pointer-events:none;justify-content:flex-end;align-items:flex-start;padding:14px"' : '') + '>'
    + (behindVideo ? '' : img)
    + '<div class="inner"'
    + (behindVideo ? ' style="background:rgba(8,12,22,.55);border-radius:12px;padding:12px 16px;backdrop-filter:blur(4px)"' : '') + '>'
    + (behindVideo ? '' : '<div style="width:54px;height:54px;color:#e7ecf6;display:flex;justify-content:center">' + icon + '</div>')
    + '<div class="bigmsg">' + big + '</div>'
    + '<div class="submsg">' + subHtml + '</div>'
    + (isBreak ? '' : '<div style="margin-top:16px;display:flex;gap:10px;justify-content:center"><a class="btn btn-ghost btn-sm" href="/">← Back to guide</a></div>')
    + '</div></div>';
}

function renderInfo() {
  const st = computeState();
  const badge = !CH.online
    ? '<span class="badge badge-off">offline</span>'
    : (st.state === 'break' ? '<span class="badge badge-break">on break</span>' : '<span class="badge badge-live"><span class="dot"></span>live</span>');
  $('infobar').innerHTML =
    chTile(CH, 40)
    + '<div style="flex:1;min-width:140px"><div class="nm">' + CH.number + ' · ' + esc(CH.name) + '</div>'
    + '<div class="mut" style="font-size:.76rem">' + esc(CH.tagline || '') + '</div></div>'
    + badge
    + '<span class="vwcount">' + EYE + ' <span id="vwnum">' + (CH.viewers || 0) + '</span></span>';
}

function renderNextbar() {
  const el = $('nextbar');
  if (!CH || !el) return;
  const st = computeState();
  if (st.state === 'show' && st.current) {
    const end = new Date(st.current.start).getTime() + st.current.durationMin * 60_000;
    const left = Math.max(0, end - Date.now());
    el.innerHTML = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--live);margin-right:5px"></span>Now: <b>' + esc(st.current.title) + '</b> · ends in ' + mmss(left) + (st.next ? ' · up next: ' + esc(st.next.title) : '');
  } else if (st.state === 'break' && st.next) {
    const left = Math.max(0, new Date(st.next.start).getTime() - Date.now());
    el.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:-1px;margin-right:4px"><rect x="6" y="4" width="4" height="16" rx="1.5"/><rect x="14" y="4" width="4" height="16" rx="1.5"/></svg>On break · <b>' + esc(st.next.title) + '</b> starts in ' + mmss(left);
  } else if (st.state === 'offline') {
    el.innerHTML = 'Channel offline · next: ' + esc(nextShowText());
  } else {
    el.innerHTML = CH.online ? 'Live stream' : '';
  }
  renderUpnext();
}

function mmss(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 3600) return Math.floor(s / 60) + 'm ' + ('0' + (s % 60)).slice(-2) + 's';
  return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
}

function renderUpnext() {
  const items = [...(CH.schedule || [])].filter(it => new Date(it.start).getTime() > Date.now()).slice(0, 5);
  $('upnext').innerHTML = items.length
    ? '<div class="k" style="font-size:.66rem;font-weight:800;color:var(--mut2);letter-spacing:.1em;text-transform:uppercase;margin:6px 0 2px">Coming up</div>'
      + items.map(it => '<div class="uprow"><span class="tm mono">' + fmtDayTime(it.start) + '</span><span>' + esc(it.title) + '</span></div>').join('')
    : '';
}

// ── chat ──────────────────────────────────────────────────

function renderChatForm() {
  if (me) {
    $('chatform').innerHTML =
      '<input id="chat-in" maxlength="240" placeholder="Say something…" data-enter="sendchat">'
      + '<button class="btn btn-brand btn-sm" data-act="sendchat">Send</button>';
  } else {
    // bounce back here after signing in
    const next = encodeURIComponent('/watch/' + chId);
    $('chatform').innerHTML =
      '<div class="mut" style="display:flex;gap:10px;align-items:center;width:100%"><span style="flex:1;font-size:.8rem">Sign in to join the chat</span><a class="btn btn-brand btn-sm" href="/login?next=' + next + '">Sign in</a></div>';
  }
}

function renderChat(msgs) {
  $('chatlog').innerHTML = msgs.length
    ? msgs.map(m => '<div class="cmsg"><b>' + esc(m.username) + '</b><span class="t">' + fmtClock(m.ts) + '</span><br>' + esc(m.text) + '</div>').join('')
    : '<div class="mut" style="text-align:center;padding:20px">No messages yet. Say hi 👋</div>';
  const log = $('chatlog');
  log.scrollTop = log.scrollHeight;
}

function appendChat(m) {
  const log = $('chatlog');
  if (log.querySelector('.mut')) log.innerHTML = '';
  log.insertAdjacentHTML('beforeend', '<div class="cmsg"><b>' + esc(m.username) + '</b><span class="t">' + fmtClock(m.ts) + '</span><br>' + esc(m.text) + '</div>');
  log.scrollTop = log.scrollHeight;
}

function flashChatError(msg) {
  const log = $('chatlog');
  const div = document.createElement('div');
  div.className = 'mut';
  div.style.cssText = 'text-align:center;color:#fca5a5;font-size:.76rem;padding:4px';
  div.textContent = msg;
  log.appendChild(div);
  setTimeout(() => div.remove(), 2500);
}

function sendChat() {
  const inp = $('chat-in');
  if (!inp) return;
  const text = inp.value.trim();
  if (!text || !window._socket) return;
  window._socket.emit('chat:send', { text });
  inp.value = '';
}

function toast(msg) {
  let t = $('wstv-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'wstv-toast';
    t.style.cssText = 'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:var(--panel2);border:1px solid var(--line);border-radius:99px;padding:8px 18px;font-size:.82rem;font-weight:700;z-index:120;transition:opacity .3s;pointer-events:none';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  setTimeout(() => { t.style.opacity = '0'; }, 1600);
}

async function shareChannel() {
  const url = location.href;
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied to clipboard');
  } catch {
    prompt('Copy this channel link:', url);
  }
}

bindActions({
  sendchat: sendChat,
  share: shareChannel,
});

init();
