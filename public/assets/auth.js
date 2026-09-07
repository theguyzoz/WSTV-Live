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

async function doLogin() {
  hideErr();
  const btn = $('in-btn');
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const d = await api('/api/auth/login', {
      method: 'POST',
      body: { username: $('l-user').value.trim(), password: $('l-pass').value },
    });
    location.href = meRoute(d.user.role);
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
    location.href = meRoute(d.user.role);
  } catch (e) {
    showErr(e.message);
    btn.disabled = false; btn.textContent = 'Create account';
  }
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  if ($('panel-in').style.display === 'none') doSignup(); else doLogin();
});
