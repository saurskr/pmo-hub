'use strict';
// Shared project data: validation, the file-based store, and the manager that
// decides which store (file or SQL Server) is active.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const STORAGE_CONFIG_FILE = path.join(DATA_DIR, 'storage.json');

const TYPES = ['project', 'vendor', 'roadmap', 'quickwin'];
const STATUSES = ['offtrack', 'atrisk', 'ontrack', 'onhold', 'notstarted', 'done'];
const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

/* ---------- validation (the browser is not trusted) ---------- */

// Rejected input is the caller's fault (400). Anything else that goes wrong is a server problem (5xx).
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
    notes: notes.map(n => ({
      id: cleanId(n && n.id, 'note'),
      at: cleanIso(n.at),
      label: str(n.label, 100),
      text: str(n.text, 20000),
    })),
    createdAt: cleanIso(raw.createdAt),
    updatedAt: cleanIso(raw.updatedAt),
  };
}

function cleanLabels(raw) {
  if (!Array.isArray(raw)) return null;
  return [...new Set(raw.map(l => str(l, 100).trim()).filter(Boolean))].slice(0, 200);
}

// General notes (the diary). Owner is set by the server from the signed-in user, never by the browser.
function cleanJournalNote(raw) {
  if (!raw || typeof raw !== 'object') throw bad('Invalid note');
  const date = cleanDate(raw.date);
  if (!date) throw bad('A note needs a date');
  const text = str(raw.text, 50000);
  if (!text.trim()) throw bad('A note needs some text');
  return { id: cleanId(raw.id, 'note'), date, label: str(raw.label, 100), text, createdAt: cleanIso(raw.createdAt), updatedAt: cleanIso(raw.updatedAt) };
}
function cleanJournalSync(raw) {
  if (!raw || typeof raw !== 'object') throw bad('Invalid request');
  return {
    upserts: Array.isArray(raw.upserts) ? raw.upserts.slice(0, 200).map(cleanJournalNote) : [],
    deletes: Array.isArray(raw.deletes) ? raw.deletes.slice(0, 200).map(x => cleanId(x, 'note')) : [],
  };
}

function cleanState(raw) {
  if (!raw || !Array.isArray(raw.items)) throw bad('Invalid data');
  if (raw.items.length > 5000) throw bad('Too many entries');
  return { items: raw.items.map(cleanItem), labels: cleanLabels(raw.labels) || [] };
}

function cleanSync(raw) {
  if (!raw || typeof raw !== 'object') throw bad('Invalid request');
  const upserts = Array.isArray(raw.upserts) ? raw.upserts.slice(0, 500).map(cleanItem) : [];
  const deletes = Array.isArray(raw.deletes) ? raw.deletes.slice(0, 500).map(d => cleanId(d, 'entry')) : [];
  return { upserts, deletes, labels: cleanLabels(raw.labels) };
}

/* ---------- file store (data/store.json) ---------- */

class FileStore {
  constructor() { this.kind = 'file'; this.queue = Promise.resolve(); this.data = null; }

  describe() { return 'Server file (data/store.json)'; }

  async init() {
    try { this.data = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')); }
    catch (e) { this.data = { initialized: false, items: [], labels: [], journal: [] }; }
    if (!Array.isArray(this.data.journal)) this.data.journal = [];
  }

  _write() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = STORE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
    fs.renameSync(tmp, STORE_FILE);
  }

  // Run mutations one at a time so two requests can't interleave a read-modify-write.
  _serial(fn) {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => {});
    return run;
  }

  async getAll() {
    const { journal, ...rest } = this.data; // general notes are served separately, per user
    return JSON.parse(JSON.stringify(rest));
  }

  async sync({ upserts, deletes, labels }) {
    return this._serial(() => {
      const byId = new Map(this.data.items.map(i => [i.id, i]));
      upserts.forEach(i => byId.set(i.id, i));
      deletes.forEach(id => byId.delete(id));
      this.data.items = [...byId.values()];
      if (labels) this.data.labels = labels;
      this.data.initialized = true;
      this._write();
    });
  }

  async replace({ items, labels }) {
    return this._serial(() => {
      this.data = { ...this.data, initialized: true, items, labels };
      this._write();
    });
  }

  /* general notes: each person only ever sees their own */
  async getJournal(owner) {
    return this.data.journal.filter(n => n.owner === owner).map(({ owner: _o, ...n }) => n);
  }

  async syncJournal(owner, { upserts, deletes }) {
    return this._serial(() => {
      const byId = new Map(this.data.journal.map(n => [n.id, n]));
      upserts.forEach(n => { const ex = byId.get(n.id); if (!ex || ex.owner === owner) byId.set(n.id, { ...n, owner }); });
      deletes.forEach(id => { const ex = byId.get(id); if (ex && ex.owner === owner) byId.delete(id); });
      this.data.journal = [...byId.values()];
      this._write();
    });
  }

  // Whole-store copy (used when switching stores); includes every owner.
  async exportJournal() { return JSON.parse(JSON.stringify(this.data.journal)); }
  async importJournal(notes) { return this._serial(() => { this.data.journal = notes; this._write(); }); }

  async close() {}
}

/* ---------- which store is active ---------- */

function readStorageConfig() {
  try { return JSON.parse(fs.readFileSync(STORAGE_CONFIG_FILE, 'utf8')); } catch (e) { return { mode: 'file', sql: null }; }
}
function writeStorageConfig(cfg) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORAGE_CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

const manager = {
  config: readStorageConfig(),
  store: null,
  error: null, // set when the configured SQL Server can't be reached at start-up

  async init() {
    this.store = null; this.error = null;
    if (this.config.mode === 'sqlserver' && this.config.sql) {
      try {
        const { SqlStore } = require('./sqlserver');
        const s = new SqlStore(this.config.sql);
        await s.init();
        this.store = s;
      } catch (e) {
        this.error = e.message;
      }
      return;
    }
    const f = new FileStore();
    await f.init();
    this.store = f;
  },

  current() {
    if (!this.store) throw Object.assign(new Error(this.error ? `Storage is unavailable: ${this.error}` : 'Storage is not ready'), { status: 503 });
    return this.store;
  },

  // Switch the active store. If copy is true and the destination has never held data,
  // the current data is copied across first.
  async activate(mode, sqlCfg, copy) {
    let next;
    if (mode === 'sqlserver') {
      const { SqlStore } = require('./sqlserver');
      next = new SqlStore(sqlCfg);
    } else {
      next = new FileStore();
    }
    await next.init();
    let copied = false;
    if (copy && this.store) {
      const dest = await next.getAll();
      if (!dest.initialized) {
        const src = await this.store.getAll();
        await next.replace({ items: src.items, labels: src.labels });
        await next.importJournal(await this.store.exportJournal());
        copied = true;
      }
    }
    const old = this.store;
    this.store = next; this.error = null;
    this.config = { mode, sql: mode === 'sqlserver' ? sqlCfg : (this.config.sql || null) };
    writeStorageConfig(this.config);
    if (old && old !== next) old.close().catch(() => {});
    return { copied };
  },
};

module.exports = { manager, FileStore, cleanState, cleanSync, cleanJournalSync, writeStorageConfig };
