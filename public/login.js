const $ = id => document.getElementById(id);
const msg = (text, kind = 'err') => { const m = $('msg'); m.textContent = text; m.className = 'msg ' + kind; m.hidden = !text; };

$('form').addEventListener('submit', async e => {
  e.preventDefault();
  msg('');
  if (!$('email').value.trim() || !$('password').value) return msg('Enter your email and password.');
  $('submit').disabled = true;
  try {
    const r = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: $('email').value, password: $('password').value }),
    });
    if (r.ok) { location.href = '/'; return; }
    msg((await r.json()).error || 'Sign-in failed.');
  } catch (err) { msg('Could not reach the server.'); }
  $('submit').disabled = false;
});

$('sso').addEventListener('click', async () => {
  msg('');
  try {
    const s = await (await fetch('/api/sso/status')).json();
    if (!s.enabled) msg('Single sign-on is not set up yet. An administrator can configure it under Administration.', 'info');
    else if (!s.ready) msg('SSO is configured, but the sign-in flow is not available yet.', 'info');
  } catch (err) { msg('Could not reach the server.'); }
});
