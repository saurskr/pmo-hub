// Shared by signed-in pages: builds the sidebar, applies the theme choice, handles sign-out.
(async () => {
  const side = document.getElementById('side');
  if (!side) return;

  let me;
  try {
    const r = await fetch('/api/me');
    if (!r.ok) throw new Error();
    me = await r.json();
  } catch (e) { location.href = '/login.html'; return; }

  const here = location.pathname.endsWith('admin.html') ? 'admin' : 'summary';
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const link = (href, id, text) => `<a href="${href}"${here === id ? ' aria-current="page"' : ''}>${text}</a>`;

  side.innerHTML = `
    <div class="brand">PMO Hub</div>
    <nav aria-label="Main">
      ${link('/', 'summary', 'Summary')}
      ${me.role === 'admin' ? link('/admin.html', 'admin', 'Administration') : ''}
    </nav>
    <div class="side-foot">
      <div class="who">${esc(me.email)}<small>${me.role === 'admin' ? 'Administrator' : 'User'}</small></div>
      <button id="btn-theme" title="Theme: auto / light / dark" aria-label="Switch theme"></button>
      <button id="btn-signout">Sign out</button>
    </div>`;

  const THEMES = ['auto', 'light', 'dark'];
  let theme = 'auto';
  try { theme = localStorage.getItem('pmo-hub-theme') || 'auto'; } catch (e) { /* ignore */ }
  const btn = document.getElementById('btn-theme');
  const apply = t => {
    if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
    btn.textContent = '◐ Theme: ' + t[0].toUpperCase() + t.slice(1);
  };
  apply(theme);
  btn.addEventListener('click', () => {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % 3];
    try { theme === 'auto' ? localStorage.removeItem('pmo-hub-theme') : localStorage.setItem('pmo-hub-theme', theme); } catch (e) { /* ignore */ }
    apply(theme);
  });

  document.getElementById('btn-signout').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    location.href = '/login.html';
  });
})();
