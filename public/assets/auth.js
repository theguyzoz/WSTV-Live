// login + signup
'use strict';

let role = 'viewer';
const $ = (id) => document.getElementById(id);

function switchTab(t) {
  const in_ = t === 'in';
  $('tab-in').classList.toggle('active', in_);
  $('tab-up').classList.toggle('active', !in_);
  $('panel-in').style.display = in_ ? '' : 'none';
  $('panel-up').style.display = in_ ? 'none' : '';
  hideErr();
}

function pickRole(r) {
  role = r;
  $('role-viewer').classList.toggle('active', r === 'viewer');
  $('role-broadcaster').classList.toggle('active', r === 'broadcaster');
}

function showErr(m) { $('err').textContent = m; $('err').classList.add('show'); }
function hideErr() { $('err').classList.remove('show'); }

// after login, go back where the user came from (?next=/watch/xyz)
function safeNext() {
  const n = new URLSearchParams(location.search).get('next');
  return n && n.startsWith('/') && !n.startsWith('//') ? n : null;
}

async function doLogin() {
  hideErr();
  const btn = $('in-btn');
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const d = await api('/api/auth/login', {
      method: 'POST',
      body: { username: $('l-user').value.trim(), password: $('l-pass').value },
    });
    location.href = safeNext() || meRoute(d.user.role);
  } catch (e) {
    showErr(e.message);
    btn.disabled = false; btn.textContent = 'Sign in';
  }
}

async function doSignup() {
  hideErr();
  const btn = $('up-btn');
  btn.disabled = true; btn.textContent = 'Creating…';
  try {
    const d = await api('/api/auth/signup', {
      method: 'POST',
      body: { username: $('u-user').value.trim(), password: $('u-pass').value, role },
    });
    location.href = safeNext() || meRoute(d.user.role);
  } catch (e) {
    showErr(e.message);
    btn.disabled = false; btn.textContent = 'Create account';
  }
}

bindActions({
  tab: (ds) => switchTab(ds.tab),
  pickrole: (ds) => pickRole(ds.role),
  login: doLogin,
  signup: doSignup,
});
