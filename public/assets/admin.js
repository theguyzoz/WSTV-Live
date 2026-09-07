// admin: users + quick channel controls
'use strict';

let me = null;
let overview = null;
const $ = (id) => document.getElementById(id);

function showErr(m) { $('err').textContent = m; $('err').classList.add('show'); setTimeout(() => $('err').classList.remove('show'), 6000); }
function showOk(m) { $('ok').textContent = m; $('ok').classList.add('show'); setTimeout(() => $('ok').classList.remove('show'), 4000); }

async function init() {
  try { me = (await api('/api/auth/me')).user; } catch { me = null; }
  if (!me) { location.href = '/login'; return; }
  if (me.role !== 'admin') {
    document.body.innerHTML = '<div style="display:grid;place-items:center;min-height:100vh;text-align:center"><div><div style="font-size:3rem">🚫</div><h2>Admins only</h2><p class="mut">You are signed in as ' + esc(me.username) + ' (' + esc(me.role) + ').</p><a class="btn btn-brand" href="/">Back to guide</a></div></div>';
    return;
  }
  await load();
}

async function load() {
  try { overview = await api('/api/admin/overview'); } catch (e) { showErr(e.message); return; }
  renderStats();
  renderUsers();
  renderChans();
}

function renderStats() {
  const c = overview.counts;
  $('stats').innerHTML = [
    ['Users', c.users], ['Broadcasters', c.broadcasters], ['Channels', c.channels], ['On air', c.online],
  ].map(([k, n]) => '<div class="card stat"><div class="n">' + n + '</div><div class="k">' + k + '</div></div>').join('');
}

function renderUsers() {
  $('users-t').innerHTML =
    '<thead><tr><th>User</th><th>Role</th><th>Banned</th><th></th></tr></thead><tbody>'
    + overview.users.map(u => (
      '<tr>'
      + '<td><b>' + esc(u.username) + '</b>' + (u.id === me.id ? ' <span class="mut2" style="font-size:.7rem">(you)</span>' : '') + '</td>'
      + '<td><div class="rolech">'
      + ['viewer', 'broadcaster', 'admin'].map(r =>
          '<button class="' + (u.role === r ? 'on' : '') + '" onclick="setRole(\'' + esc(u.id) + '\',\'' + r + '\')">' + r + '</button>'
        ).join('')
      + '</div></td>'
      + '<td>' + (u.banned ? '🚫' : '—') + '</td>'
      + '<td>' + (u.id === me.id ? '' : '<button class="btn btn-danger btn-sm" onclick="toggleBan(\'' + esc(u.id) + '\',' + (!u.banned) + ')">' + (u.banned ? 'Unban' : 'Ban') + '</button>') + '</td>'
      + '</tr>'
    )).join('')
    + '</tbody>';
}

async function setRole(id, role) {
  try {
    await api('/api/admin/users/' + encodeURIComponent(id), { method: 'PATCH', body: { role } });
    showOk('Role updated');
    load();
  } catch (e) { showErr(e.message); }
}

async function toggleBan(id, banned) {
  if (banned && !confirm('Ban this user? They get kicked out of the chat.')) return;
  try {
    await api('/api/admin/users/' + encodeURIComponent(id), { method: 'PATCH', body: { banned } });
    showOk(banned ? 'User banned' : 'User unbanned');
    load();
  } catch (e) { showErr(e.message); }
}

function renderChans() {
  $('chans').innerHTML = overview.channels.map(c => (
    '<div class="qrow">'
    + '<span class="mono mut2" style="font-size:.74rem;width:30px">' + c.number + '</span>'
    + chTile(c, 34)
    + '<div style="flex:1;min-width:140px"><b style="font-size:.88rem">' + esc(c.name) + '</b>'
    + '<div class="mut" style="font-size:.72rem">' + (c.kind === 'system' ? 'system channel' : 'user channel') + ' · next: ' + esc(c.nextShow) + '</div></div>'
    + '<span class="mut mono" style="font-size:.74rem">' + (c.viewers || 0) + ' 👁</span>'
    + '<input id="note-' + esc(c.id) + '" value="' + esc(c.nextShowNote || '') + '" maxlength="80" placeholder="next show info" style="width:200px;padding:.4rem .6rem">'
    + '<div class="switch" style="position:relative;width:46px;height:26px;flex:none;background:var(--bg2);border:1.5px solid var(--line);border-radius:99px;cursor:pointer;transition:.2s' + (c.online ? ';background:rgba(34,197,94,.25);border-color:var(--live)' : '') + '" onclick="toggleOnline(\'' + esc(c.id) + '\',' + (!c.online) + ')"><span style="position:absolute;top:3px;left:' + (c.online ? '22px' : '3px') + ';width:18px;height:18px;border-radius:50%;background:' + (c.online ? 'var(--live)' : 'var(--mut)') + ';transition:.2s"></span></div>'
    + '<a class="btn btn-ghost btn-sm" href="/studio?ch=' + esc(c.id) + '">Edit</a>'
    + '</div>'
  )).join('');
}

async function toggleOnline(id, online) {
  try {
    await api('/api/channels/' + encodeURIComponent(id), { method: 'PATCH', body: { online } });
    load();
  } catch (e) { showErr(e.message); }
}

// save next-show note when the input loses focus
document.addEventListener('focusout', async (e) => {
  const m = /^note-(.+)$/.exec(e.target.id || '');
  if (!m) return;
  const id = m[1];
  const ch = overview.channels.find(c => c.id === id);
  if (!ch || (e.target.value || '') === (ch.nextShowNote || '')) return;
  try {
    await api('/api/channels/' + encodeURIComponent(id), { method: 'PATCH', body: { nextShowNote: e.target.value } });
    showOk('Next-show info saved');
    load();
  } catch (err) { showErr(err.message); }
});

init();
