(() => {
  const $ = id => document.getElementById(id);
  const fmt = iso => new Date(iso).toLocaleString();
  const say = (id, text, kind) => { const el = $(id); el.hidden = !text; el.textContent = text || ''; el.dataset.kind = kind || ''; };

  async function counts() {
    const d = await window.pmoLocal.read();
    $('counts').textContent = d.initialized
      ? `Right now: ${d.items.length} ${d.items.length === 1 ? 'entry' : 'entries'} and ${d.journal.length} ${d.journal.length === 1 ? 'note' : 'notes'}.`
      : 'Nothing saved yet — open Summary to get started.';
  }

  /* ---- backup file ---- */

  const file = window.pmoFile;
  async function showFile() {
    const s = file.state();
    $('file-unsupported').hidden = file.supported;
    for (const id of ['f-create', 'f-existing']) $(id).hidden = !file.supported || s.kind !== 'off';
    $('f-reconnect').hidden = s.kind !== 'needs-permission';
    $('f-load').hidden = !(s.kind === 'ok' || s.kind === 'error');
    $('f-off').hidden = s.kind === 'off' || s.kind === 'unsupported';
    let text = '';
    if (s.kind === 'off') text = file.supported ? 'No file chosen. Your data is only in this browser.' : '';
    else if (s.kind === 'ok') {
      const info = await file.fileInfo().catch(() => null);
      text = `Connected to “${s.name}”.` + (info ? ` File last changed ${fmt(info.modified)}.` : '');
    } else if (s.kind === 'needs-permission') text = `“${s.name}” is chosen, but the browser needs your permission again before it can write to it. Changes are still saved in this browser.`;
    else if (s.kind === 'error') text = `Couldn't write to “${s.name}”: ${s.detail}. Changes are still saved in this browser.`;
    say('file-status', text, s.kind === 'error' ? 'error' : '');
  }
  const guard = fn => async () => {
    try { await fn(); } catch (e) { if (e && e.name === 'AbortError') return; say('file-status', e.message || String(e), 'error'); return; }
    await counts(); showFile();
  };
  $('f-create').addEventListener('click', guard(() => file.createFile()));
  $('f-existing').addEventListener('click', guard(async () => {
    const d = await window.pmoLocal.read();
    if (d.items.length + d.journal.length && !confirm('This replaces the entries and notes in this browser with the contents of the file you pick. Continue?')) return;
    await file.useExisting();
  }));
  $('f-reconnect').addEventListener('click', guard(() => file.reconnect()));
  $('f-load').addEventListener('click', guard(async () => {
    if (!confirm('Replace what is in this browser with the contents of the file?')) return;
    await file.loadFromFile();
  }));
  $('f-off').addEventListener('click', guard(() => file.disconnect()));
  file.onStatus(showFile);

  /* ---- download / restore ---- */

  $('b-download').addEventListener('click', async () => {
    const d = await window.pmoLocal.read();
    const doc = { format: 'pmo-hub', version: 1, savedAt: new Date().toISOString(), items: d.items, labels: d.labels, journal: d.journal };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' }));
    a.download = `pmo-hub-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    say('bk-msg', `Downloaded ${d.items.length} entries and ${d.journal.length} notes.`);
  });
  $('b-restore').addEventListener('click', () => $('b-file').click());
  $('b-file').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const doc = JSON.parse(await f.text());
      if (!doc || !Array.isArray(doc.items)) throw new Error("That file isn't a PMO Hub backup or export.");
      const notes = Array.isArray(doc.journal) ? ` and ${doc.journal.length} notes` : ' (no notes in this file — your current notes are kept)';
      if (!confirm(`Replace what is in this browser with ${doc.items.length} entries${notes}?`)) return;
      await window.pmoLocal.replaceAll(doc);
      say('bk-msg', 'Restored.');
      counts();
    } catch (err) { say('bk-msg', err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message, 'error'); }
  });

  counts();
})();
