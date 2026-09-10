// admin: users + quick channel controls (all via data-act)
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
    document.body.innerHTML = '<div style="display:grid;place-items:center;min-height:100vh;text-align:center"><div><div style="width:64px;height:64px;margin:0 auto 10px;color:var(--red)"><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M5.8 5.8l12.4 12.4"/></svg></div><h2>Admins only</h2><p class="mut">You are signed in as ' + esc(me.username) + ' (' + esc(me.role) + ').</p><a class="btn btn-brand" href="/">Back to guide</a></div></div>';
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
          '<button class="' + (u.role === r ? 'on' : '') + '" data-act="role" data-id="' + esc(u.id) + '" data-role="' + r + '">' + r + '</button>'
        ).join('')
      + '</div></td>'
      + '<td>' + (u.banned ? 'banned' : '—') + '</td>'
      + '<td>' + (u.id === me.id ? '' : '<button class="btn btn-danger btn-sm" data-act="ban" data-id="' + esc(u.id) + '" data-banned="' + (!u.banned) + '">' + (u.banned ? 'Unban' : 'Ban') + '</button>') + '</td>'
      + '</tr>'
    )).join('')
    + '</tbody>';
}

function renderChans() {
  $('chans').innerHTML = overview.channels.map(c => (
    '<div class="qrow">'
    + '<span class="mono mut2" style="font-size:.74rem;width:30px">' + c.number + '</span>'
    + chTile(c, 34)
    + '<div style="flex:1;min-width:140px"><b style="font-size:.88rem">' + esc(c.name) + '</b>'
    + '<div class="mut" style="font-size:.72rem">' + (c.kind === 'system' ? 'system channel' : 'user channel') + ' · next: ' + esc(c.nextShow) + '</div></div>'
    + '<span class="mut mono" style="font-size:.74rem">' + EYE + ' ' + (c.viewers || 0) + '</span>'
    + '<input id="note-' + esc(c.id) + '" value="' + esc(c.nextShowNote || '') + '" maxlength="80" placeholder="next show info" style="width:200px;padding:.4rem .6rem">'
    + '<button class="btn btn-sm ' + (c.online ? 'btn-live' : 'btn-ghost') + '" data-act="ch-live" data-id="' + esc(c.id) + '" data-online="' + (!c.online) + '">' + (c.online ? '● ON AIR' : 'OFF') + '</button>'
    + '<a class="btn btn-ghost btn-sm" href="/studio?ch=' + esc(c.id) + '">Edit</a>'
    + '</div>'
  )).join('');
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

bindActions({
  role: async (ds) => {
    try {
      await api('/api/admin/users/' + encodeURIComponent(ds.id), { method: 'PATCH', body: { role: ds.role } });
      showOk('Role updated');
      load();
    } catch (e) { showErr(e.message); }
  },
  ban: async (ds) => {
    const banned = ds.banned === 'true';
    if (banned && !confirm('Ban this user? They get kicked out of the chat.')) return;
    try {
      await api('/api/admin/users/' + encodeURIComponent(ds.id), { method: 'PATCH', body: { banned } });
      showOk(banned ? 'User banned' : 'User unbanned');
      load();
    } catch (e) { showErr(e.message); }
  },
  'ch-live': async (ds) => {
    try {
      await api('/api/channels/' + encodeURIComponent(ds.id), { method: 'PATCH', body: { online: ds.online === 'true' } });
      load();
    } catch (e) { showErr(e.message); }
  },
});

init();
