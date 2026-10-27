const $ = id => document.getElementById(id);
const FIELDS = ['provider', 'loginUrl', 'issuer', 'certificate', 'emailClaim', 'allowedDomains', 'baseUrl'];
const msg = (text, kind = 'ok') => { const m = $('msg'); m.textContent = text; m.className = 'msg ' + kind; m.hidden = !text; };

function fill({ sso, derived }) {
  $('enabled').checked = sso.enabled;
  FIELDS.forEach(f => { $(f).value = sso[f] || ''; });
  $('d-entity').value = derived.entityId;
  $('d-reply').value = derived.replyUrl;
  $('d-signon').value = derived.signOnUrl;
  providerLabels();
}

function providerLabels() {
  const entra = $('provider').value === 'entra';
  $('l-login').textContent = entra ? 'Login URL' : 'Single sign-on URL';
  $('l-issuer').textContent = entra ? 'Microsoft Entra Identifier' : 'Identity provider issuer';
  $('help-give').textContent = entra
    ? 'In Entra: Enterprise applications → New application → Create your own → Single sign-on → SAML, then paste these into Basic SAML Configuration.'
    : 'Enter these in your provider\'s SAML application settings.';
  $('help-get').textContent = entra
    ? 'In Entra: copy them from the SAML Certificates (Certificate, Base64) and Set up (Login URL, Microsoft Entra Identifier) sections of the same page.'
    : 'Copy these from your provider\'s SAML metadata or setup page.';
}

async function load() {
  const r = await fetch('/api/admin/sso');
  if (!r.ok) { msg((await r.json()).error || 'Could not load settings.', 'err'); return; }
  fill(await r.json());
}

$('provider').addEventListener('change', providerLabels);

document.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($(b.dataset.copy).value); b.textContent = 'Copied'; }
  catch (e) { $(b.dataset.copy).select(); }
  setTimeout(() => { b.textContent = 'Copy'; }, 1500);
}));

$('sso-form').addEventListener('submit', async e => {
  e.preventDefault();
  msg('');
  const body = { enabled: $('enabled').checked };
  FIELDS.forEach(f => { body[f] = $(f).value; });
  $('save').disabled = true;
  try {
    const r = await fetch('/api/admin/sso', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json();
    if (!r.ok) msg(data.error || 'Could not save.', 'err');
    else { fill(data); msg('Settings saved.'); }
  } catch (err) { msg('Could not reach the server.', 'err'); }
  $('save').disabled = false;
});

load();
