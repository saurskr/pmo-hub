// Shared by every page: builds the sidebar and applies the theme choice.
(async () => {
  const side = document.getElementById('side');
  if (!side) return;

  const page = location.pathname.endsWith('settings.html') ? 'settings' : location.pathname.endsWith('notes.html') ? 'notes' : 'summary';
  const TABS = [['', 'Summary'], ['project', 'Projects'], ['vendor', 'Vendors'], ['roadmap', 'Roadmap'], ['quickwin', 'Quick Wins']];
  const currentTab = () => location.hash.slice(1).split('/')[0];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const { STATUSES, statusIcon } = window.PMOStatus;

  // --- collapsible entry lists under each type tab ---
  let items = [];
  let activeId = null;
  let open = {};
  try { open = JSON.parse(localStorage.getItem('pmo-hub-nav-open')) || {}; } catch (e) { /* ignore */ }
  const saveOpen = () => { try { localStorage.setItem('pmo-hub-nav-open', JSON.stringify(open)); } catch (e) { /* ignore */ } };

  const entryLinks = id => items
    .filter(i => i.type === id)
    .sort((a, b) => (STATUSES[a.status]?.rank ?? 9) - (STATUSES[b.status]?.rank ?? 9) || (a.name || '').localeCompare(b.name || ''))
    .map(i => `<li><a class="nav-item" href="index.html#${id}/${esc(i.id)}" data-entry="${esc(i.id)}"${i.id === activeId ? ' aria-current="true"' : ''} title="${esc(i.name || 'Untitled')}"><span class="nav-ic">${statusIcon(i.status, 14)}</span><span class="nm">${esc(i.name || 'Untitled')}</span></a></li>`)
    .join('');

  const tabLink = ([id, text]) => {
    const current = page === 'summary' && currentTab() === id ? ' aria-current="page"' : '';
    if (!id) return `<a href="index.html#" data-tab=""${current}>${text}</a>`;
    const count = items.filter(i => i.type === id).length;
    const isOpen = !!open[id];
    return `<div class="nav-group">
      <div class="nav-row">
        <a href="index.html#${id}" data-tab="${id}"${current}>${text}<span class="nav-count" aria-label="${count} entries">${count}</span></a>
        <button class="nav-toggle" data-toggle="${id}" aria-expanded="${isOpen}" aria-controls="nav-list-${id}" aria-label="${isOpen ? 'Hide' : 'Show'} ${text} entries"><span aria-hidden="true">▸</span></button>
      </div>
      <ul class="nav-items" id="nav-list-${id}"${isOpen ? '' : ' hidden'}>${count ? entryLinks(id) : '<li class="nav-empty">No entries yet</li>'}</ul>
    </div>`;
  };

  side.innerHTML = `
    <div class="brand">PMO Hub</div>
    <nav aria-label="Main" id="nav"></nav>
    <div class="side-foot">
      <div class="who">Saved in this browser<small>No account, no server</small></div>
      <button id="btn-theme" title="Theme: auto / light / dark" aria-label="Switch theme"></button>
    </div>`;

  const nav = document.getElementById('nav');
  if (window.pmoItems) items = window.pmoItems;
  const renderNav = () => {
    nav.innerHTML = tabLink(TABS[0]) +
      `<a href="notes.html"${page === 'notes' ? ' aria-current="page"' : ''}>Notes</a>` +
      TABS.slice(1).map(tabLink).join('') +
      `<hr><a href="settings.html"${page === 'settings' ? ' aria-current="page"' : ''}>Settings</a>`;
  };
  renderNav();

  nav.addEventListener('click', e => {
    const t = e.target.closest('[data-toggle]');
    if (t) { open[t.dataset.toggle] = !open[t.dataset.toggle]; saveOpen(); renderNav(); return; }
    // Choosing a tab also reveals its entries.
    const tab = e.target.closest('a[data-tab]');
    if (tab && tab.dataset.tab && !open[tab.dataset.tab]) { open[tab.dataset.tab] = true; saveOpen(); renderNav(); }
  });

  // app.js (Summary page) calls these as entries load, change and open.
  window.pmoNav = {
    update(list) { items = list; renderNav(); },
    setActive(id) {
      activeId = id;
      nav.querySelectorAll('[data-entry]').forEach(a => { if (a.dataset.entry === id) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
    },
  };
  // Pages without their own data (Settings) load the entries just for the menu.
  if (!window.pmoHasData) {
    window.pmoApi('GET', '/api/data').then(d => { if (d && d.items) window.pmoNav.update(d.items); }).catch(() => {});
  }

  window.addEventListener('hashchange', () => {
    nav.querySelectorAll('[data-tab]').forEach(a => {
      if (page === 'summary' && a.dataset.tab === currentTab()) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  });

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
})();
