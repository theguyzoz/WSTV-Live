// homepage: guide, i-plate, epg. everything updates live over websockets
'use strict';

let GUIDE = [];
let selected = null;
const EPG_HOURS = 4;

const $ = (id) => document.getElementById(id);

function init() {
  // boot splash out
  setTimeout(() => $('splash').classList.add('gone'), 850);
  setInterval(() => { $('clock').textContent = fmtClock(); }, 1000);
  $('clock').textContent = fmtClock();

  api('/api/auth/me').then(d => {
    if (d.user) {
      $('acct').textContent = d.user.username;
      $('acct').href = meRoute(d.user.role);
      $('acct').classList.remove('btn-brand');
      $('acct').classList.add('btn-ghost');
    }
  }).catch(() => {});

  loadGuide(true);

  const socket = io();
  socket.on('guide', (d) => { GUIDE = d.channels; renderAll(); });
  socket.on('viewers', (d) => {
    const ch = GUIDE.find(c => c.id === d.channelId);
    if (ch) { ch.viewers = d.count; renderRail(); renderChips(); if (selected === d.channelId) renderIplate(); }
  });

  const hash = location.hash.replace('#', '');
  if (hash) selected = hash;
}

async function loadGuide(first) {
  try {
    const d = await api('/api/guide');
    GUIDE = d.channels;
    if (!selected) selected = (GUIDE.find(c => c.online) || GUIDE[0] || {}).id || null;
    renderAll();
  } catch (e) {
    $('rail').innerHTML = '<div class="mut" style="padding:12px">' + esc(e.message) + '</div>';
  }
}

function renderAll() {
  renderRail();
  renderChips();
  renderIplate();
  renderEpg();
  renderMoblist();
}

function statusBadge(ch) {
  if (!ch.online) return '<span class="badge badge-off">offline</span>';
  if (ch.now) return '<span class="badge badge-live"><span class="dot"></span>live</span>';
  if (ch.next || ch.scheduleHint) return '<span class="badge badge-break">on break</span>';
  return '<span class="badge badge-live"><span class="dot"></span>live</span>';
}

function renderRail() {
  $('rail').innerHTML = GUIDE.map(ch => (
    '<div class="chrow' + (ch.id === selected ? ' active' : '') + '" onclick="selectCh(\'' + esc(ch.id) + '\')">'
    + '<span class="chnum">' + ch.number + '</span>'
    + chTile(ch, 36)
    + '<div class="chmeta"><div class="chname">' + esc(ch.name) + '</div>'
    + '<div class="chnext">' + (ch.online && ch.now ? '🔴 ' + esc(ch.now.title) : esc(ch.nextShow)) + '</div></div>'
    + '<span class="vw">' + (ch.viewers ? ch.viewers + ' 👁' : '') + '</span>'
    + '</div>'
  )).join('');
}

function renderChips() {
  $('chips').innerHTML = GUIDE.map(ch => (
    '<div class="chip' + (ch.id === selected ? ' active' : '') + '" onclick="selectCh(\'' + esc(ch.id) + '\')">'
    + '<span class="mono" style="color:var(--mut2);font-size:.7rem">' + ch.number + '</span>'
    + esc(ch.name)
    + (ch.online ? ' <span style="width:7px;height:7px;border-radius:50%;background:var(--live);display:inline-block"></span>' : '')
    + '</div>'
  )).join('');
}

function selectCh(id) {
  selected = id;
  history.replaceState(null, '', '#' + id);
  renderRail(); renderChips(); renderIplate();
  document.querySelector('.iplate').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderIplate() {
  const ch = GUIDE.find(c => c.id === selected);
  if (!ch) { $('ip-screen').innerHTML = ''; return; }

  let badges = statusBadge(ch);
  if (ch.kind === 'system') badges += ' <span class="badge badge-sys">wstv</span>';
  if (ch.viewers) badges += ' <span class="badge badge-off">' + ch.viewers + ' watching</span>';

  let title, sub, action;
  if (!ch.online) {
    title = esc(ch.name);
    sub = 'Channel is offline right now. Next up: ' + esc(ch.nextShow);
    action = '';
  } else if (ch.now) {
    title = '🔴 On now: ' + esc(ch.now.title);
    sub = esc(ch.tagline || '');
    action = '<a class="btn btn-pink" href="/watch/' + esc(ch.id) + '">▶ Watch live</a>';
  } else if (ch.next) {
    title = '⏸ On break';
    sub = 'Up next: ' + esc(ch.next.title) + ' at ' + fmtClock(ch.next.start);
    action = '<a class="btn btn-pink" href="/watch/' + esc(ch.id) + '">▶ Tune in</a>';
  } else {
    title = '🔴 ' + esc(ch.name) + ' is live';
    sub = esc(ch.tagline || 'Tune in and see what\'s on.');
    action = '<a class="btn btn-pink" href="/watch/' + esc(ch.id) + '">▶ Watch live</a>';
  }

  $('ip-screen').innerHTML =
    (ch.image ? '<img class="bg" src="' + esc(ch.image) + '" alt="">' : '')
    + '<div class="shade"></div>'
    + '<div class="ip-content">'
    + '<div class="ip-badges">' + badges + '</div>'
    + '<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">'
    + chTile(ch, 46)
    + '<div><div class="ip-title">' + title + '</div></div></div>'
    + '<div class="ip-sub">' + sub + '</div>'
    + '<div class="ip-actions">' + action
    + '<a class="btn btn-ghost" href="/watch/' + esc(ch.id) + '">Channel page</a>'
    + '</div></div>';

  const nextTxt = ch.now
    ? esc(ch.now.title) + ' · until ' + fmtClock(ch.now.endsAt)
    : (ch.next ? 'Up next: ' + esc(ch.next.title) + ' · ' + fmtClock(ch.next.start) : 'Next: ' + esc(ch.nextShow));
  $('ip-strip').innerHTML =
    '<div class="ip-cell"><div class="k">' + ch.number + ' · ' + esc(ch.name) + '</div><div class="v mono">' + fmtClock() + '</div></div>'
    + '<div class="ip-cell"><div class="k">Now / next</div><div class="v">' + nextTxt + '</div></div>'
    + '<div class="ip-cell"><div class="k">Viewers</div><div class="v mono">' + (ch.viewers || 0) + '</div></div>'
    + '<div class="ip-cell"><div class="k">Status</div><div class="v">' + (ch.online ? 'Live' : 'Offline') + '</div></div>';
}

// epg: rows per channel, blocks positioned by time inside a 4.5h window
function renderEpg() {
  const now = Date.now();
  const winStart = now - 30 * 60_000;
  const winSpan = (EPG_HOURS + 0.5) * 3600_000;

  $('epg').innerHTML = '';

  const head = document.createElement('div');
  head.className = 'epg-hours';
  let hh = '<div style="width:170px;flex:none"></div><div class="epg-lane" style="display:flex">';
  for (let i = 0; i < EPG_HOURS; i++) {
    const t = new Date(now + i * 3600_000);
    hh += '<div class="hlab mono">' + ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2) + '</div>';
  }
  hh += '</div>';
  head.innerHTML = hh;
  $('epg').appendChild(head);

  for (const ch of GUIDE) {
    const row = document.createElement('div');
    row.className = 'epg-row';
    let lane = '';
    for (const it of (ch.epgSchedule || [])) {
      const s = new Date(it.start).getTime(), e = s + it.durationMin * 60_000;
      if (e < winStart || s > winStart + winSpan) continue;
      const left = Math.max(0, (s - winStart) / winSpan * 100);
      const right = Math.min(100, (e - winStart) / winSpan * 100);
      const on = s <= now && now < e;
      lane += '<div class="epg-block' + (on ? ' on' : '') + '" style="left:' + left.toFixed(2) + '%;width:' + (right - left).toFixed(2) + '%" title="' + esc(it.title) + ' — ' + fmtDayTime(it.start) + '" onclick="selectCh(\'' + esc(ch.id) + '\')">' + esc(it.title) + '</div>';
    }
    row.innerHTML =
      '<div class="epg-ch" onclick="selectCh(\'' + esc(ch.id) + '\')">'
      + '<span class="chnum" style="width:auto">' + ch.number + '</span>'
      + chTile(ch, 26)
      + '<span class="n">' + esc(ch.name) + '</span></div>'
      + '<div class="epg-lane">' + lane + '</div>';
    $('epg').appendChild(row);
  }
  const line = document.createElement('div');
  line.className = 'nowline';
  line.style.left = 'calc(170px + (100% - 170px) * ' + ((now - winStart) / winSpan).toFixed(4) + ')';
  $('epg').appendChild(line);
}

// mobile: simple now/next list
function renderMoblist() {
  const wrap = $('mobwrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="moblist">' + GUIDE.map(ch => (
    '<div class="mobrow" onclick="location.href=\'/watch/' + esc(ch.id) + '\'">'
    + chTile(ch, 42)
    + '<div style="flex:1;min-width:0">'
    + '<div style="display:flex;gap:7px;align-items:center"><span class="mono mut2" style="font-size:.68rem">' + ch.number + '</span><b style="font-size:.88rem">' + esc(ch.name) + '</b>' + (ch.online ? '<span style="width:7px;height:7px;border-radius:50%;background:var(--live)"></span>' : '') + '</div>'
    + '<div class="mut" style="font-size:.74rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (ch.now ? '🔴 ' + esc(ch.now.title) : esc(ch.nextShow)) + '</div>'
    + '</div><span class="mut2" style="font-size:.7rem">' + (ch.viewers || '') + '</span></div>'
  )).join('') + '</div>';
}

// schedule for the epg comes with the channel detail; fetch once for lanes
async function hydrateEpgSchedules() {
  for (const ch of GUIDE) {
    if (ch.epgSchedule) continue;
    try {
      const d = await api('/api/channels/' + encodeURIComponent(ch.id));
      ch.epgSchedule = d.channel.schedule;
      renderEpg();
    } catch {}
  }
}

init();
hydrateEpgSchedules();
setInterval(renderEpg, 60_000); // nudge the now-line along
