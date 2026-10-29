// Optional backup/sync file. The browser keeps the data; if you pick a file (for example one inside
// your OneDrive folder) every change is also written there, and you can load it back on another device.
// Uses the File System Access API (Chrome / Edge). Elsewhere the app still works; use Export/Import.
(() => {
  const supported = !!(window.showSaveFilePicker && window.showOpenFilePicker && window.isSecureContext);
  const FORMAT = 'pmo-hub';
  let handle = null;
  let state = { kind: 'off', detail: '', name: '', savedAt: '' }; // off | ok | needs-permission | error | unsupported
  const listeners = new Set();
  let timer = null, writing = false, again = false;

  const set = (kind, detail = '') => {
    state = { kind, detail, name: handle ? handle.name : '', savedAt: kind === 'ok' ? new Date().toISOString() : state.savedAt };
    listeners.forEach(fn => { try { fn(state); } catch (e) { /* ignore */ } });
  };

  const snapshot = async () => {
    const d = await window.pmoLocal.read();
    return { format: FORMAT, version: 1, savedAt: new Date().toISOString(), items: d.items, labels: d.labels, journal: d.journal };
  };

  async function permission(h, ask) {
    const opts = { mode: 'readwrite' };
    if ((await h.queryPermission(opts)) === 'granted') return true;
    return ask && (await h.requestPermission(opts)) === 'granted';
  }

  async function writeNow() {
    if (!handle) return;
    if (writing) { again = true; return; }
    writing = true;
    try {
      if (!(await permission(handle, false))) { set('needs-permission', 'Allow access to the file to keep it up to date.'); return; }
      const w = await handle.createWritable();
      await w.write(JSON.stringify(await snapshot(), null, 1));
      await w.close();
      set('ok');
    } catch (e) {
      set('error', e && e.message ? e.message : 'Could not write the file');
    } finally {
      writing = false;
      if (again) { again = false; schedule(); }
    }
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(writeNow, 800); };

  async function readFile(h) {
    const text = await (await h.getFile()).text();
    let doc;
    try { doc = JSON.parse(text); } catch (e) { throw new Error('That file is not valid JSON.'); }
    if (!doc || doc.format !== FORMAT || !Array.isArray(doc.items)) throw new Error("That file isn't a PMO Hub data file.");
    return doc;
  }

  async function remember(h) {
    handle = h;
    await window.pmoLocal.setMeta('fileHandle', h);
  }

  const api = {
    supported,
    state: () => state,
    onStatus(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); },

    // Start a new file from what is in the browser now.
    async createFile() {
      const h = await window.showSaveFilePicker({ suggestedName: 'pmo-hub-data.json', types: [{ description: 'PMO Hub data', accept: { 'application/json': ['.json'] } }] });
      await remember(h);
      await writeNow();
    },
    // Use a file you already have (for example from another device). Its contents replace what is in the browser.
    async useExisting() {
      const [h] = await window.showOpenFilePicker({ types: [{ description: 'PMO Hub data', accept: { 'application/json': ['.json'] } }] });
      const doc = await readFile(h);
      if (!(await permission(h, true))) throw new Error('Permission to change the file was not granted.');
      await window.pmoLocal.replaceAll(doc);
      await remember(h);
      set('ok');
      return doc;
    },
    // Load the connected file again (after it was changed elsewhere).
    async loadFromFile() {
      if (!handle) throw new Error('No file is connected.');
      if (!(await permission(handle, true))) throw new Error('Permission to read the file was not granted.');
      const doc = await readFile(handle);
      await window.pmoLocal.replaceAll(doc);
      set('ok');
      return doc;
    },
    async fileInfo() {
      if (!handle || !(await permission(handle, false))) return null;
      const f = await handle.getFile();
      return { name: f.name, modified: new Date(f.lastModified).toISOString() };
    },
    async reconnect() {
      if (!handle) return;
      if (await permission(handle, true)) await writeNow();
    },
    async disconnect() {
      handle = null;
      await window.pmoLocal.delMeta('fileHandle');
      set('off');
    },
  };
  window.pmoFile = api;

  (async () => {
    if (!supported) { set('unsupported'); return; }
    try {
      const saved = await window.pmoLocal.getMeta('fileHandle');
      if (saved) {
        handle = saved;
        set((await permission(handle, false)) ? 'ok' : 'needs-permission');
      }
    } catch (e) { /* no stored handle; stay off */ }
    window.pmoLocal.onChange(() => { if (handle) schedule(); });
  })();
})();
