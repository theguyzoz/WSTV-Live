// broadcaster studio: create channels, go live, schedule shows, break videos
// all buttons go through data-act (csp blocks inline handlers)
'use strict';

let me = null;
let channels = [];       // channels i can edit
let editing = null;      // channel id being edited
let schedDraft = [];     // working copy of the schedule rows
let breaksDraft = [];
const $ = (id) => document.getElementById(id);

function showErr(m) { $('err').textContent = m; $('err').classList.add('show'); setTimeout(() => $('err').classList.remove('show'), 6000); }
function showWarn(m) { const w = $('warn'); if (!w) return showErr(m); w.textContent = m; w.classList.add('show'); setTimeout(() => w.classList.remove('show'), 9000); }
function handleWarnings(d) { if (d && Array.isArray(d.warnings) && d.warnings.length) showWarn('Saved, but check these links: ' + d.warnings.join(' · ')); }
function showOk(m) { $('ok').textContent = m; $('ok').classList.add('show'); setTimeout(() => $('ok').classList.remove('show'), 4000); }

async function init() {
  try {
    me = (await api('/api/auth/me')).user;
  } catch { me = null; }

  if (!me) { location.href = '/login'; return; }
  $('hello').textContent = 'Signed in as ' + me.username + ' (' + me.role + ')';
  if (me.role === 'viewer') {
    $('mych-head').textContent = 'Channels';
    showErr('Your account is a Viewer. An admin can switch you to Broadcaster from the admin panel.');
    $('btn-create').disabled = true;
  }
  if (me.role !== 'admin') {
    $('acct').style.display = 'none';
  }

  await refresh();
  const want = new URLSearchParams(location.search).get('ch');
  if (want && channels.some(c => c.id === want)) openEditor(want);
}

async function refresh() {
  const d = await api('/api/guide');
  const all = d.channels;
  // admins can edit everything, broadcasters only their own
  channels = me.role === 'admin' ? all : all.filter(c => c.kind === 'user' && c.ownerId === me.id);
  renderList();
}

function renderList() {
  const box = $('mych');
  if (!channels.length) {
    box.innerHTML = '<div class="mut" style="grid-column:1/-1;font-size:.88rem">No channels yet. Hit “+ New channel” to start your station.</div>';
    return;
  }
  box.innerHTML = channels.map(c => (
    '<div class="c' + (editing === c.id ? ' active' : '') + '" data-act="edit" data-ch="' + esc(c.id) + '">'
    + chTile(c, 40)
    + '<div style="flex:1;min-width:0"><b style="font-size:.9rem">' + c.number + ' · ' + esc(c.name) + '</b>'
    + '<div class="mut" style="font-size:.72rem">' + (c.online ? 'live' : 'offline') + ' · ' + EYE + ' ' + (c.viewers || 0) + '</div></div>'
    + (c.kind === 'system' ? '<span class="badge badge-sys">sys</span>' : '')
    + '</div>'
  )).join('');
}

async function openEditor(id) {
  editing = id;
  renderList();
  let d;
  try { d = await api('/api/channels/' + encodeURIComponent(id)); } catch (e) { showErr(e.message); return; }
  const c = d.channel;
  $('editor').style.display = '';
  $('ed-title').textContent = c.number + ' · ' + c.name;
  $('ed-badges').innerHTML = (c.online ? '<span class="badge badge-live">live</span>' : '<span class="badge badge-off">offline</span>')
    + (c.kind === 'system' ? '<span class="badge badge-sys">system</span>' : '');
  $('ed-name').value = c.name;
  $('ed-tagline').value = c.tagline || '';
  $('ed-note').value = c.nextShowNote || '';
  $('ed-number').value = c.number;
  $('ed-numwrap').style.display = me.role === 'admin' ? '' : 'none';
  $('ed-liveurl').value = c.liveUrl || '';
  $('ed-online').classList.toggle('on', !!c.online);
  $('ed-del').style.display = c.kind === 'system' ? 'none' : '';
  renderImg(c.image);
  breaksDraft = [...(c.breakVideos || [])];
  drawBreaks();
  schedDraft = (c.schedule || []).map(it => ({ ...it }));
  renderSched();
  $('editor').scrollIntoView({ behavior: 'smooth' });
}

function renderImg(image) {
  $('ed-img').innerHTML = image
    ? '<img src="' + esc(image) + '" style="width:84px;height:56px;border-radius:9px;object-fit:cover;display:block">'
    : '<div class="mut" style="width:84px;height:56px;border-radius:9px;border:1.5px dashed var(--line);display:grid;place-items:center;font-size:.62rem">no image</div>';
}

async function uploadImage(file) {
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) return showErr('Image too big (max 2MB)');
  const dataUri = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
  try {
    const d = await api('/api/channels/' + encodeURIComponent(editing) + '/image', { method: 'POST', body: { dataUri } });
    renderImg(d.image);
    showOk('Image updated');
  } catch (e) { showErr(e.message); }
}

async function saveBasics(silent) {
  const liveUrl = $('ed-liveurl').value.trim();
  // quick sanity warn before the round trip
  if (liveUrl && !/^https?:\/\//i.test(liveUrl)) return showErr('Live URL must start with http:// or https://');
  const body = {
    name: $('ed-name').value.trim(),
    tagline: $('ed-tagline').value.trim(),
    nextShowNote: $('ed-note').value.trim(),
    liveUrl: $('ed-liveurl').value.trim(),
    online: $('ed-online').classList.contains('on'),
  };
  if (me.role === 'admin') body.number = parseInt($('ed-number').value, 10) || undefined;
  try {
    const d = await api('/api/channels/' + encodeURIComponent(editing), { method: 'PATCH', body });
    if (!silent) showOk('Channel saved');
    handleWarnings(d);
    refresh();
  } catch (e) { showErr(e.message); }
}

async function deleteChannel() {
  if (!confirm('Delete this channel? Schedules and chat go with it.')) return;
  try {
    await api('/api/channels/' + encodeURIComponent(editing), { method: 'DELETE' });
    editing = null;
    $('editor').style.display = 'none';
    showOk('Channel deleted');
    refresh();
  } catch (e) { showErr(e.message); }
}

// ── schedule editor ───────────────────────────────────────

function renderSched() {
  $('ed-sched').innerHTML = schedDraft.map((it, i) => (
    '<div class="sched-row">'
    + '<input value="' + esc(it.title) + '" maxlength="60" placeholder="Show title" data-oninput="sched" data-idx="' + i + '" data-field="title">'
    + '<input type="datetime-local" value="' + esc(toLocalInput(it.start)) + '" data-oninput="sched" data-idx="' + i + '" data-field="start">'
    + '<input type="number" min="1" max="1440" value="' + (it.durationMin || 30) + '" title="minutes" data-oninput="sched" data-idx="' + i + '" data-field="durationMin">'
    + '<input value="' + esc(it.videoUrl || '') + '" placeholder="Video url (youtube, mp4)" data-oninput="sched" data-idx="' + i + '" data-field="videoUrl">'
    + '<button class="btn btn-danger btn-sm" data-act="sched-del" data-idx="' + i + '">✕</button>'
    + '</div>'
  )).join('') || '<div class="mut" style="font-size:.84rem;padding:6px 0">Nothing scheduled yet.</div>';
}

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = n => ('0' + n).slice(-2);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}

async function saveSchedule() {
  try {
    // datetime-local strings are browser-local - convert to real UTC before
    // sending, otherwise the server guesses a timezone and times shift
    const payload = schedDraft.map(it => {
      let start = it.start;
      if (start) {
        const d = new Date(start);
        if (!isNaN(d.getTime())) start = d.toISOString();
      }
      return { ...it, start };
    });
    const d = await api('/api/channels/' + encodeURIComponent(editing) + '/schedule', { method: 'PUT', body: { schedule: payload } });
    schedDraft = d.schedule.map(it => ({ ...it }));
    renderSched();
    showOk('Schedule saved (' + schedDraft.length + ' shows)');
    handleWarnings(d);
  } catch (e) { showErr(e.message); }
}

// ── break videos ──────────────────────────────────────────

function drawBreaks() {
  $('ed-breaks').innerHTML = breaksDraft.map((u, i) => (
    '<div class="bv-row"><span class="mut2" style="font-size:.7rem;width:16px">' + (i + 1) + '</span>'
    + '<input value="' + esc(u) + '" readonly style="flex:1">'
    + '<button class="btn btn-danger btn-sm" data-act="break-del" data-idx="' + i + '">✕</button></div>'
  )).join('') || '<div class="mut" style="font-size:.8rem;margin-bottom:8px">No break videos — viewers see a “on break” card between shows.</div>';
}

async function saveBreaks() {
  try {
    const d = await api('/api/channels/' + encodeURIComponent(editing), { method: 'PATCH', body: { breakVideos: breaksDraft } });
    handleWarnings(d);
  } catch (e) { showErr(e.message); }
}

// ── create channel ────────────────────────────────────────

async function openCreate() {
  const name = prompt('Channel name?');
  if (!name) return;
  const tagline = prompt('Tagline (optional)') || '';
  try {
    const d = await api('/api/channels', { method: 'POST', body: { name: name.trim(), tagline: tagline.trim() } });
    showOk('Channel ' + d.channel.number + ' “' + d.channel.name + '” created');
    await refresh();
    openEditor(d.channel.id);
  } catch (e) { showErr(e.message); }
}

// ── actions (wired via data-act) ──────────────────────────

bindActions({
  create: openCreate,
  edit: (ds) => openEditor(ds.ch),
  'toggle-live': () => {
    const el = $('ed-online');
    el.classList.toggle('on');
    saveBasics(true);
  },
  save: () => saveBasics(false),
  watch: () => { location.href = '/watch/' + encodeURIComponent(editing); },
  delete: deleteChannel,
  addshow: () => { schedDraft.push({ title: '', start: '', durationMin: 30, videoUrl: '' }); renderSched(); },
  savesched: saveSchedule,
  'sched-del': (ds) => { schedDraft.splice(+ds.idx, 1); renderSched(); },
  sched: (ds, el) => {
    const row = schedDraft[+ds.idx];
    if (!row) return;
    if (ds.field === 'durationMin') row.durationMin = parseInt(el.value, 10) || 30;
    else row[ds.field] = el.value;
  },
  addbreak: () => {
    const u = $('ed-newbreak').value.trim();
    if (!u) return;
    breaksDraft.push(u);
    $('ed-newbreak').value = '';
    drawBreaks();
    saveBreaks();
  },
  'break-del': (ds) => { breaksDraft.splice(+ds.idx, 1); drawBreaks(); saveBreaks(); },
});

$('ed-imgfile').addEventListener('change', e => uploadImage(e.target.files[0]));
init();
