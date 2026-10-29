// Serverless data layer. Implements the same calls the pages used to make to the Node server
// (GET/PUT /api/data, POST /api/data/sync, GET /api/journal, POST /api/journal/sync),
// but keeps everything in this browser's IndexedDB. Validation mirrors what the server did.
(() => {
  const TYPES = ['project', 'vendor', 'roadmap', 'quickwin'];
  const STATUSES = ['offtrack', 'atrisk', 'ontrack', 'onhold', 'notstarted', 'done'];
  const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

  /* ---------- validation ---------- */

  const bad = msg => Object.assign(new Error(msg), { status: 400 });
  const str = (v, max) => String(v == null ? '' : v).slice(0, max);
  function cleanId(v, what) {
    if (!ID_RE.test(String(v))) throw bad(`Invalid ${what} id`);
    return String(v);
  }
  function cleanDate(v) {
    v = String(v || '');
    if (!v) return '';
    const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T00:00:00Z') : null;
    if (!d || isNaN(d) || d.toISOString().slice(0, 10) !== v) throw bad(`Invalid date "${v.slice(0, 20)}"`);
    return v;
  }
  function cleanIso(v) {
    const d = new Date(v);
    return isNaN(d) ? new Date().toISOString() : d.toISOString();
  }
  function cleanItem(raw) {
    if (!raw || typeof raw !== 'object') throw bad('Invalid entry');
    const effort = raw.effort === '' || raw.effort == null ? '' : Number(raw.effort);
    if (effort !== '' && (!isFinite(effort) || effort < 0 || effort > 1e6)) throw bad('Invalid effort');
    const notes = Array.isArray(raw.notes) ? raw.notes.slice(0, 5000) : [];
    return {
      id: cleanId(raw.id, 'entry'),
      type: TYPES.includes(raw.type) ? raw.type : 'project',
      parentId: raw.parentId ? cleanId(raw.parentId, 'parent') : null,
      name: str(raw.name, 300),
      team: str(raw.team, 200),
      status: STATUSES.includes(raw.status) ? raw.status : 'notstarted',
      start: cleanDate(raw.start),
      end: cleanDate(raw.end),
      effort: effort === '' ? '' : Math.round(effort * 100) / 100,
      focus: raw.focus === true,
      focusWhy: str(raw.focusWhy, 400),
      summary: str(raw.summary, 400),
      details: str(raw.details, 100000),
      notes: notes.map(n => ({ id: cleanId(n && n.id, 'note'), at: cleanIso(n.at), label: str(n.label, 100), text: str(n.text, 20000) })),
      createdAt: cleanIso(raw.createdAt),
      updatedAt: cleanIso(raw.updatedAt),
    };
  }
  function cleanLabels(raw) {
    if (!Array.isArray(raw)) return null;
    return [...new Set(raw.map(l => str(l, 100).trim()).filter(Boolean))].slice(0, 200);
  }
  function cleanJournalNote(raw) {
    if (!raw || typeof raw !== 'object') throw bad('Invalid note');
    const date = cleanDate(raw.date);
    if (!date) throw bad('A note needs a date');
    const text = str(raw.text, 50000);
    if (!text.trim()) throw bad('A note needs some text');
    return { id: cleanId(raw.id, 'note'), date, label: str(raw.label, 100), meeting: str(raw.meeting, 200).trim(), text, createdAt: cleanIso(raw.createdAt), updatedAt: cleanIso(raw.updatedAt) };
  }
  function cleanState(raw) {
    if (!raw || !Array.isArray(raw.items)) throw bad('Invalid data');
    if (raw.items.length > 5000) throw bad('Too many entries');
    return { items: raw.items.map(cleanItem), labels: cleanLabels(raw.labels) || [] };
  }
  function cleanSync(raw) {
    if (!raw || typeof raw !== 'object') throw bad('Invalid request');
    return {
      upserts: Array.isArray(raw.upserts) ? raw.upserts.slice(0, 500).map(cleanItem) : [],
      deletes: Array.isArray(raw.deletes) ? raw.deletes.slice(0, 500).map(d => cleanId(d, 'entry')) : [],
      labels: cleanLabels(raw.labels),
    };
  }
  function cleanJournalSync(raw) {
    if (!raw || typeof raw !== 'object') throw bad('Invalid request');
    return {
      upserts: Array.isArray(raw.upserts) ? raw.upserts.slice(0, 200).map(cleanJournalNote) : [],
      deletes: Array.isArray(raw.deletes) ? raw.deletes.slice(0, 200).map(x => cleanId(x, 'note')) : [],
    };
  }

  /* ---------- IndexedDB: one document holding everything ---------- */

  const DB_NAME = 'pmo-hub', STORE = 'kv', KEY = 'data';
  const empty = () => ({ initialized: false, items: [], labels: [], journal: [] });
  let dbPromise = null;

  function openDb() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        if (!window.indexedDB) { reject(new Error("This browser can't store data locally (IndexedDB is unavailable).")); return; }
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(new Error('Could not open local storage: ' + (req.error && req.error.message || 'unknown error')));
      });
      dbPromise.catch(() => { dbPromise = null; });
    }
    return dbPromise;
  }

  // Read-modify-write in a single transaction, so two open tabs can't overwrite each other's change.
  async function update(fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const os = tx.objectStore(STORE);
      let result;
      const get = os.get(KEY);
      get.onsuccess = () => {
        try {
          const doc = Object.assign(empty(), get.result || {});
          const out = fn(doc);
          if (out !== undefined || fn.writes) doc.modifiedAt = new Date().toISOString();
          result = out === undefined ? doc : out;
          if (out !== undefined || fn.writes) os.put(doc, KEY);
        } catch (e) { reject(e); try { tx.abort(); } catch (_) { /* already finished */ } }
      };
      tx.oncomplete = () => { notify(); resolve(result); };
      tx.onerror = () => reject(new Error('Saving locally failed: ' + (tx.error && tx.error.message || 'unknown error')));
      tx.onabort = () => reject(tx.error || new Error('Saving locally was cancelled'));
    });
  }
  async function read() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const get = db.transaction(STORE).objectStore(STORE).get(KEY);
      get.onsuccess = () => resolve(Object.assign(empty(), get.result || {}));
      get.onerror = () => reject(new Error('Could not read local storage'));
    });
  }

  // Let other code (the file mirror, in a later stage) know the data changed.
  const listeners = new Set();
  const notify = () => listeners.forEach(fn => { try { fn(); } catch (e) { /* a listener's problem */ } });

  /* ---------- the routes ---------- */

  const mut = fn => { fn.writes = true; return fn; };
  const STORAGE_NAME = 'This browser';

  const routes = {
    'GET /api/data': async () => {
      const d = await read();
      return { initialized: d.initialized, items: d.items, labels: d.labels, storage: STORAGE_NAME };
    },
    'PUT /api/data': async body => {
      const s = cleanState(body);
      await update(mut(d => { d.initialized = true; d.items = s.items; d.labels = s.labels; }));
      return { ok: true };
    },
    'POST /api/data/sync': async body => {
      const s = cleanSync(body);
      await update(mut(d => {
        const byId = new Map(d.items.map(i => [i.id, i]));
        s.upserts.forEach(i => byId.set(i.id, i));
        s.deletes.forEach(id => byId.delete(id));
        d.items = [...byId.values()];
        if (s.labels) d.labels = s.labels;
        d.initialized = true;
      }));
      return { ok: true };
    },
    'GET /api/journal': async () => ({ notes: (await read()).journal }),
    'POST /api/journal/sync': async body => {
      const s = cleanJournalSync(body);
      await update(mut(d => {
        const byId = new Map(d.journal.map(n => [n.id, n]));
        s.upserts.forEach(n => byId.set(n.id, n));
        s.deletes.forEach(id => byId.delete(id));
        d.journal = [...byId.values()];
      }));
      return { ok: true };
    },
  };

  // Same shape as the old fetch helper: resolves with the data, rejects with an Error (status 400 = rejected input).
  window.pmoApi = async (method, path, body) => {
    const route = routes[`${method} ${path}`];
    if (!route) throw Object.assign(new Error(`Unknown request ${method} ${path}`), { status: 404 });
    return route(body === undefined ? undefined : JSON.parse(JSON.stringify(body)));
  };

  // For backup, restore and the file mirror: the whole document, and a way to replace it.
  // Small side records (e.g. the chosen backup file) kept beside the data, outside the main document.
  async function meta(op, key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const os = db.transaction(STORE, 'readwrite').objectStore(STORE);
      const req = op === 'get' ? os.get('meta:' + key) : op === 'set' ? os.put(value, 'meta:' + key) : os.delete('meta:' + key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Local storage error'));
    });
  }

  window.pmoLocal = {
    read,
    getMeta: key => meta('get', key),
    setMeta: (key, value) => meta('set', key, value),
    delMeta: key => meta('del', key),
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async replaceAll(doc) {
      const s = cleanState(doc);
      // An entries-only export has no notes; leave the existing notes alone in that case.
      const journal = Array.isArray(doc.journal) ? doc.journal.slice(0, 50000).map(cleanJournalNote) : null;
      await update(mut(d => { d.initialized = true; d.items = s.items; d.labels = s.labels; if (journal) d.journal = journal; }));
    },
  };
})();
