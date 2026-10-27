// Administration → Data storage: connect to SQL Server Express, create the schema, switch stores.
(() => {
  const $ = id => document.getElementById(id);
  const show = (id, text, kind) => { const m = $(id); m.textContent = text; m.className = 'msg ' + (kind || 'info'); m.hidden = !text; };
  let hasSavedPassword = false;

  const conn = () => ({
    server: $('st-server').value, database: $('st-database').value, user: $('st-user').value,
    password: $('st-password').value, encrypt: $('st-encrypt').checked, trustServerCertificate: $('st-trust').checked,
  });

  async function post(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
    return data;
  }

  // Disable the buttons while a request runs so it can't be sent twice.
  async function busy(buttonIds, fn) {
    const btns = buttonIds.map($);
    btns.forEach(b => { b.disabled = true; });
    try { await fn(); } finally { btns.forEach(b => { b.disabled = false; }); }
  }

  async function refresh() {
    const r = await fetch('/api/admin/storage');
    if (!r.ok) { show('st-status', 'Could not load storage settings.', 'err'); return; }
    const s = await r.json();
    if (s.error) show('st-status', `Storage is unavailable: ${s.error}\n\nThe server is running, but data can't be loaded until this is fixed. You can switch back to file storage below.`, 'err');
    else show('st-status', `Currently storing data in: ${s.active}`, 'ok');
    $('st-activate').textContent = s.mode === 'sqlserver' ? 'Re-connect using these settings' : 'Use SQL Server for storage';
    $('st-file').hidden = s.mode === 'file';
    if (s.sql) {
      $('st-server').value = s.sql.server; $('st-database').value = s.sql.database; $('st-user').value = s.sql.user;
      $('st-encrypt').checked = s.sql.encrypt; $('st-trust').checked = s.sql.trustServerCertificate;
      hasSavedPassword = s.sql.hasPassword;
      $('st-password').placeholder = hasSavedPassword ? '(saved — leave blank to keep)' : '';
    }
  }

  const describe = i =>
    `Connected to SQL Server ${i.serverVersion} (${i.edition}).\n` +
    (i.databaseExists ? 'The database exists. ' : `The database doesn't exist yet${i.canCreateDatabase ? ', but this login can create it.' : ' and this login is not allowed to create databases.'} `) +
    (i.schemaInstalled ? (i.needsUpdate ? `PMO Hub schema is installed (version ${i.schemaVersion}) but is out of date. Press Create schema in step 3 to update it; your data is left alone.` : `PMO Hub schema is installed (version ${i.schemaVersion})${i.hasData ? ' and already holds data.' : '.'}`) : (i.databaseExists ? 'PMO Hub schema is not installed yet.' : ''));

  $('st-test').addEventListener('click', () => busy(['st-test'], async () => {
    show('st-test-msg', 'Connecting…', 'info');
    try { show('st-test-msg', describe(await post('/api/admin/storage/test', conn())), 'ok'); }
    catch (e) { show('st-test-msg', e.message, 'err'); }
  }));

  $('st-create').addEventListener('click', () => busy(['st-create'], async () => {
    show('st-create-msg', 'Creating…', 'info');
    try {
      const r = await post('/api/admin/storage/create-schema', { ...conn(), createDatabase: $('st-createdb').checked });
      show('st-create-msg', r.steps.join('\n') + `\n\nSchema version ${r.schemaVersion}. Next: step 4 to start using it.`, 'ok');
      show('st-test-msg', describe(r), 'ok'); // keep step 2's summary in line with what step 3 just did
      $('st-password').value = ''; await refresh();
    } catch (e) { show('st-create-msg', e.message, 'err'); }
  }));

  $('st-activate').addEventListener('click', () => busy(['st-activate', 'st-file'], async () => {
    if (!confirm('Switch PMO Hub to SQL Server storage?\n\nEveryone will use the new store straight away.')) return;
    show('st-activate-msg', 'Switching…', 'info');
    try {
      const r = await post('/api/admin/storage/activate', { mode: 'sqlserver', ...conn(), copyData: $('st-copy').checked });
      show('st-activate-msg', `Now storing data in: ${r.active}\n` + (r.copied ? 'The existing data was copied across.' : 'Nothing was copied (the new store already held data, or copying was off).'), 'ok');
      $('st-password').value = ''; await refresh();
    } catch (e) { show('st-activate-msg', e.message, 'err'); }
  }));

  $('st-file').addEventListener('click', () => busy(['st-activate', 'st-file'], async () => {
    if (!confirm('Switch back to file storage on the server?\n\nData already in SQL Server stays there, but new changes will be saved to the file.')) return;
    try {
      const r = await post('/api/admin/storage/activate', { mode: 'file', copyData: $('st-copy').checked });
      show('st-activate-msg', `Now storing data in: ${r.active}\n` + (r.copied ? 'The SQL Server data was copied across.' : 'Nothing was copied (the file already held data, or copying was off).'), 'ok');
      await refresh();
    } catch (e) { show('st-activate-msg', e.message, 'err'); }
  }));

  refresh();
})();
