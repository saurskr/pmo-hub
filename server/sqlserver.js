'use strict';
// SQL Server (Express) storage: connection checks, schema creation, and the store itself.
// Uses the "mssql" package, loaded lazily so the app still runs without it.

const SCHEMA_VERSION = 2; // 2 added pmo.JournalNote (general notes)
const DB_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

function driver() {
  try { return require('mssql'); }
  catch (e) { throw new Error('The SQL Server driver is not installed. Run "npm install" in the PMO Hub folder, then restart the server.'); }
}

/* ---------- connection settings ---------- */

// Accepts: host, host\INSTANCE, host,port, "." and "(local)".
function parseServer(input) {
  let s = String(input || '').trim();
  if (!s) throw new Error('Enter the server name, for example localhost\\SQLEXPRESS');
  s = s.replace(/^tcp:/i, '');
  let port, instanceName;
  const comma = s.indexOf(',');
  if (comma >= 0) { port = Number(s.slice(comma + 1)); s = s.slice(0, comma); }
  const slash = s.indexOf('\\');
  if (slash >= 0) { instanceName = s.slice(slash + 1); s = s.slice(0, slash); }
  if (s === '.' || /^\(local\)$/i.test(s)) s = 'localhost';
  if (!/^[A-Za-z0-9_.-]+$/.test(s)) throw new Error('Server name contains characters that are not allowed');
  if (instanceName !== undefined && !/^[A-Za-z0-9_$#]+$/.test(instanceName)) throw new Error('Instance name contains characters that are not allowed');
  if (port !== undefined && !(Number.isInteger(port) && port > 0 && port < 65536)) throw new Error('Port must be a number between 1 and 65535');
  if (port !== undefined && instanceName) throw new Error('Use either an instance name or a port, not both');
  return { host: s, port, instanceName };
}

// Normalise what the admin form sends. A blank password means "keep the saved one".
function cleanConnection(raw, saved) {
  raw = raw || {};
  const server = String(raw.server || '').trim();
  parseServer(server);
  const database = String(raw.database || '').trim();
  if (!DB_NAME_RE.test(database)) throw new Error('Database name must start with a letter and use only letters, numbers and underscores (max 64)');
  const user = String(raw.user || '').trim();
  if (!user) throw new Error('Enter the SQL login name');
  let password = String(raw.password || '');
  if (!password && saved && saved.user === user && saved.server === server) password = saved.password || '';
  if (!password) throw new Error('Enter the password for the SQL login');
  return {
    server, database, user, password,
    encrypt: raw.encrypt !== false,
    trustServerCertificate: raw.trustServerCertificate !== false,
  };
}

function poolConfig(cfg, database) {
  const { host, port, instanceName } = parseServer(cfg.server);
  return {
    server: host,
    ...(port ? { port } : {}),
    user: cfg.user,
    password: cfg.password,
    database,
    connectionTimeout: 8000,
    requestTimeout: 20000,
    options: { encrypt: cfg.encrypt, trustServerCertificate: cfg.trustServerCertificate, ...(instanceName ? { instanceName } : {}) },
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
  };
}

async function connect(cfg, database) {
  const sql = driver();
  const pool = new sql.ConnectionPool(poolConfig(cfg, database));
  pool.on('error', () => {}); // surfaced on the next request instead
  await pool.connect();
  return pool;
}

// Turn driver errors into something an admin can act on.
function explain(e) {
  const m = String((e && e.message) || e);
  const code = e && e.code;
  if (code === 'ELOGIN' || /login failed/i.test(m)) return `Login failed. Check the user name and password, and that SQL Server accepts SQL logins (mixed-mode authentication). (${m})`;
  if (/self[- ]signed|certificate/i.test(m)) return `The server's certificate isn't trusted. Tick "Trust server certificate" (SQL Server Express uses a self-signed certificate by default). (${m})`;
  if (code === 'ESOCKET' || code === 'ETIMEOUT' || code === 'ECONNREFUSED' || /Failed to connect|Could not connect|timeout/i.test(m)) {
    return `Couldn't reach SQL Server. Check the server name, that the service is running, that TCP/IP is enabled in SQL Server Configuration Manager, and that no firewall blocks it. For a named instance, SQL Server Browser must be running, or use host,port instead. (${m})`;
  }
  if (code === 'ENOTFOUND' || /getaddrinfo/i.test(m)) return `The server name wasn't found. (${m})`;
  return m;
}

/* ---------- inspecting and creating the schema ---------- */

async function inspect(cfg) {
  let master;
  try { master = await connect(cfg, 'master'); } catch (e) { throw new Error(explain(e)); }
  try {
    const r = (await master.request().input('db', driver().NVarChar(128), cfg.database).query(
      `SELECT CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(50)) AS version,
              CAST(SERVERPROPERTY('Edition') AS nvarchar(100)) AS edition,
              DB_ID(@db) AS dbId,
              IS_SRVROLEMEMBER('dbcreator') AS dbcreator,
              IS_SRVROLEMEMBER('sysadmin') AS sysadmin`)).recordset[0];
    const out = {
      serverVersion: r.version, edition: r.edition,
      databaseExists: r.dbId != null,
      canCreateDatabase: r.dbcreator === 1 || r.sysadmin === 1,
      schemaInstalled: false, schemaVersion: null, needsUpdate: false, hasData: false,
    };
    if (out.databaseExists) {
      let db;
      try { db = await connect(cfg, cfg.database); } catch (e) { throw new Error(`The database exists but this login can't open it. ${explain(e)}`); }
      try {
        const t = (await db.request().query(`SELECT OBJECT_ID(N'pmo.Item', N'U') AS item, OBJECT_ID(N'pmo.Meta', N'U') AS meta`)).recordset[0];
        if (t.item && t.meta) {
          out.schemaInstalled = true;
          const v = (await db.request().query(`SELECT V FROM pmo.Meta WHERE K = N'schemaVersion'`)).recordset[0];
          out.schemaVersion = v ? Number(v.V) : null;
          out.needsUpdate = (out.schemaVersion || 0) < SCHEMA_VERSION;
          out.hasData = (await db.request().query(`SELECT COUNT(*) AS n FROM pmo.Item`)).recordset[0].n > 0;
        }
      } finally { await db.close(); }
    }
    return out;
  } finally { await master.close(); }
}

// Each statement runs as its own batch (CREATE SCHEMA must be alone in a batch).
const DDL = [
  `IF SCHEMA_ID(N'pmo') IS NULL EXEC(N'CREATE SCHEMA pmo')`,

  `IF OBJECT_ID(N'pmo.Item', N'U') IS NULL
   CREATE TABLE pmo.Item (
     Id          nvarchar(32)  NOT NULL CONSTRAINT PK_pmo_Item PRIMARY KEY,
     Type        nvarchar(20)  NOT NULL,
     ParentId    nvarchar(32)  NULL,
     Name        nvarchar(300) NOT NULL CONSTRAINT DF_pmo_Item_Name DEFAULT N'',
     Team        nvarchar(200) NOT NULL CONSTRAINT DF_pmo_Item_Team DEFAULT N'',
     Status      nvarchar(20)  NOT NULL,
     StartDate   date          NULL,
     EndDate     date          NULL,
     EffortHours decimal(9,2)  NULL,
     IsFocus     bit           NOT NULL CONSTRAINT DF_pmo_Item_IsFocus DEFAULT 0,
     FocusWhy    nvarchar(400) NOT NULL CONSTRAINT DF_pmo_Item_FocusWhy DEFAULT N'',
     Summary     nvarchar(400) NOT NULL CONSTRAINT DF_pmo_Item_Summary DEFAULT N'',
     Details     nvarchar(max) NOT NULL CONSTRAINT DF_pmo_Item_Details DEFAULT N'',
     CreatedAt   datetime2(3)  NOT NULL,
     UpdatedAt   datetime2(3)  NOT NULL
   )`,

  `IF OBJECT_ID(N'pmo.Note', N'U') IS NULL
   CREATE TABLE pmo.Note (
     Id        nvarchar(32)  NOT NULL CONSTRAINT PK_pmo_Note PRIMARY KEY,
     ItemId    nvarchar(32)  NOT NULL CONSTRAINT FK_pmo_Note_Item REFERENCES pmo.Item (Id) ON DELETE CASCADE,
     Label     nvarchar(100) NOT NULL CONSTRAINT DF_pmo_Note_Label DEFAULT N'',
     Body      nvarchar(max) NOT NULL,
     CreatedAt datetime2(3)  NOT NULL
   )`,

  `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_pmo_Note_ItemId' AND object_id = OBJECT_ID(N'pmo.Note'))
   CREATE INDEX IX_pmo_Note_ItemId ON pmo.Note (ItemId)`,

  `IF OBJECT_ID(N'pmo.Label', N'U') IS NULL
   CREATE TABLE pmo.Label (
     Name      nvarchar(100) NOT NULL CONSTRAINT PK_pmo_Label PRIMARY KEY,
     SortOrder int           NOT NULL
   )`,

  `IF OBJECT_ID(N'pmo.Meta', N'U') IS NULL
   CREATE TABLE pmo.Meta (
     K nvarchar(50)  NOT NULL CONSTRAINT PK_pmo_Meta PRIMARY KEY,
     V nvarchar(200) NOT NULL
   )`,

  `IF OBJECT_ID(N'pmo.JournalNote', N'U') IS NULL
   CREATE TABLE pmo.JournalNote (
     Id        nvarchar(32)  NOT NULL CONSTRAINT PK_pmo_JournalNote PRIMARY KEY,
     Owner     nvarchar(320) NOT NULL,
     NoteDate  date          NOT NULL,
     Label     nvarchar(100) NOT NULL CONSTRAINT DF_pmo_JournalNote_Label DEFAULT N'',
     Body      nvarchar(max) NOT NULL,
     CreatedAt datetime2(3)  NOT NULL,
     UpdatedAt datetime2(3)  NOT NULL
   )`,

  `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_pmo_JournalNote_OwnerDate' AND object_id = OBJECT_ID(N'pmo.JournalNote'))
   CREATE INDEX IX_pmo_JournalNote_OwnerDate ON pmo.JournalNote (Owner, NoteDate)`,

  // Always last: records which version of the schema is now in place.
  `IF EXISTS (SELECT 1 FROM pmo.Meta WHERE K = N'schemaVersion') UPDATE pmo.Meta SET V = N'${SCHEMA_VERSION}' WHERE K = N'schemaVersion'
   ELSE INSERT INTO pmo.Meta (K, V) VALUES (N'schemaVersion', N'${SCHEMA_VERSION}')`,
];

async function createSchema(cfg, createDatabase) {
  const info = await inspect(cfg);
  const done = [];
  const before = info.schemaVersion;
  if (!info.databaseExists) {
    if (!createDatabase) throw new Error(`The database "${cfg.database}" doesn't exist. Tick "Create the database if it doesn't exist", or create it first.`);
    if (!info.canCreateDatabase) throw new Error(`This login isn't allowed to create databases. Ask your SQL Server admin to create "${cfg.database}" (or add the login to the dbcreator role), then try again.`);
    const master = await connect(cfg, 'master');
    try { await master.request().batch(`CREATE DATABASE [${cfg.database}]`); } finally { await master.close(); }
    done.push(`Created database ${cfg.database}`);
  }
  let db;
  try { db = await connect(cfg, cfg.database); } catch (e) { throw new Error(explain(e)); }
  try {
    for (const stmt of DDL) await db.request().batch(stmt);
  } catch (e) {
    throw new Error(`Couldn't create the tables. The login needs permission to create tables in "${cfg.database}" (db_owner is simplest). (${e.message})`);
  } finally { await db.close(); }
  done.push(!info.schemaInstalled ? 'Created schema pmo with tables Item, Note, Label, JournalNote and Meta'
    : (before || 0) < SCHEMA_VERSION ? `Updated the schema from version ${before} to ${SCHEMA_VERSION}; your data was left alone`
    : 'Schema was already up to date; checked and left your data alone');
  return { steps: done, ...(await inspect(cfg)) };
}

/* ---------- the store ---------- */

const ITEM_COLS = `Id, Type, ParentId, Name, Team, Status,
  CONVERT(char(10), StartDate, 23) AS StartDate, CONVERT(char(10), EndDate, 23) AS EndDate,
  EffortHours, IsFocus, FocusWhy, Summary, Details,
  CONVERT(char(23), CreatedAt, 126) AS CreatedAt, CONVERT(char(23), UpdatedAt, 126) AS UpdatedAt`;

// SQL Server omits a zero fraction and pads char(23) with spaces, so parse rather than concatenate.
const iso = v => new Date(String(v).trim() + 'Z').toISOString();

class SqlStore {
  constructor(cfg) { this.kind = 'sqlserver'; this.cfg = cfg; this.pool = null; }

  describe() { return `SQL Server — ${this.cfg.server} / ${this.cfg.database}`; }

  async init() {
    try { this.pool = await connect(this.cfg, this.cfg.database); } catch (e) { throw new Error(explain(e)); }
    const t = (await this.pool.request().query(`SELECT OBJECT_ID(N'pmo.Item', N'U') AS item`)).recordset[0];
    if (!t.item) { await this.close(); throw new Error(`The PMO Hub schema isn't installed in "${this.cfg.database}". Create it from Administration first.`); }
  }

  // Schema version 1 databases don't have the notes table until an admin presses "Create schema" again.
  async _journalReady() {
    if (!this.hasJournal) {
      const t = (await this.pool.request().query(`SELECT OBJECT_ID(N'pmo.JournalNote', N'U') AS t`)).recordset[0];
      this.hasJournal = !!t.t;
    }
    if (!this.hasJournal) throw this._needsUpdate();
  }

  _needsUpdate() {
    return Object.assign(new Error('Notes need a database update. An administrator should open Administration → Data storage and press "Create schema" to update it.'), { status: 503 });
  }

  // Run a notes query; if the table turns out to be missing, report the same friendly message.
  async _journal(fn) {
    await this._journalReady();
    try { return await fn(); }
    catch (e) {
      if (/Invalid object name 'pmo\.JournalNote'/i.test(e.message)) { this.hasJournal = false; throw this._needsUpdate(); }
      throw e;
    }
  }

  async getJournal(owner) {
    return this._journal(async () => {
    const r = await this.pool.request().input('o', driver().NVarChar(320), owner).query(
      `SELECT Id, CONVERT(char(10), NoteDate, 23) AS NoteDate, Label, Body,
              CONVERT(char(23), CreatedAt, 126) AS CreatedAt, CONVERT(char(23), UpdatedAt, 126) AS UpdatedAt
       FROM pmo.JournalNote WHERE Owner = @o ORDER BY NoteDate, CreatedAt`);
    return r.recordset.map(n => ({ id: n.Id, date: n.NoteDate, label: n.Label, text: n.Body, createdAt: iso(n.CreatedAt), updatedAt: iso(n.UpdatedAt) }));
    });
  }

  async syncJournal(owner, { upserts, deletes }) {
    return this._journal(() => this._tx(async (sql, tx) => {
      for (const n of upserts) {
        const r = new sql.Request(tx);
        r.input('id', sql.NVarChar(32), n.id); r.input('o', sql.NVarChar(320), owner);
        r.input('d', sql.VarChar(10), n.date); r.input('label', sql.NVarChar(100), n.label);
        r.input('body', sql.NVarChar(sql.MAX), n.text);
        r.input('c', sql.VarChar(30), n.createdAt); r.input('u', sql.VarChar(30), n.updatedAt);
        // Update only your own note; insert only if nobody (including someone else) already has that id.
        await r.query(
          `UPDATE pmo.JournalNote SET NoteDate = CONVERT(date, @d, 23), Label = @label, Body = @body, UpdatedAt = CONVERT(datetime2(3), @u, 127)
           WHERE Id = @id AND Owner = @o;
           IF @@ROWCOUNT = 0 AND NOT EXISTS (SELECT 1 FROM pmo.JournalNote WHERE Id = @id)
             INSERT INTO pmo.JournalNote (Id, Owner, NoteDate, Label, Body, CreatedAt, UpdatedAt)
             VALUES (@id, @o, CONVERT(date, @d, 23), @label, @body, CONVERT(datetime2(3), @c, 127), CONVERT(datetime2(3), @u, 127))`);
      }
      for (const id of deletes) {
        await new sql.Request(tx).input('id', sql.NVarChar(32), id).input('o', sql.NVarChar(320), owner)
          .query(`DELETE FROM pmo.JournalNote WHERE Id = @id AND Owner = @o`);
      }
    }));
  }

  async exportJournal() {
    return this._journal(async () => {
    const r = await this.pool.request().query(
      `SELECT Id, Owner, CONVERT(char(10), NoteDate, 23) AS NoteDate, Label, Body,
              CONVERT(char(23), CreatedAt, 126) AS CreatedAt, CONVERT(char(23), UpdatedAt, 126) AS UpdatedAt FROM pmo.JournalNote`);
    return r.recordset.map(n => ({ id: n.Id, owner: n.Owner, date: n.NoteDate, label: n.Label, text: n.Body, createdAt: iso(n.CreatedAt), updatedAt: iso(n.UpdatedAt) }));
    });
  }

  async importJournal(notes) {
    return this._journal(() => this._tx(async (sql, tx) => {
      await new sql.Request(tx).query(`DELETE FROM pmo.JournalNote`);
      for (const n of notes) {
        await new sql.Request(tx)
          .input('id', sql.NVarChar(32), n.id).input('o', sql.NVarChar(320), n.owner)
          .input('d', sql.VarChar(10), n.date).input('label', sql.NVarChar(100), n.label)
          .input('body', sql.NVarChar(sql.MAX), n.text)
          .input('c', sql.VarChar(30), n.createdAt).input('u', sql.VarChar(30), n.updatedAt)
          .query(`INSERT INTO pmo.JournalNote (Id, Owner, NoteDate, Label, Body, CreatedAt, UpdatedAt)
                  VALUES (@id, @o, CONVERT(date, @d, 23), @label, @body, CONVERT(datetime2(3), @c, 127), CONVERT(datetime2(3), @u, 127))`);
      }
    }));
  }

  async close() { if (this.pool) { const p = this.pool; this.pool = null; await p.close().catch(() => {}); } }

  async getAll() {
    const r = () => this.pool.request();
    const [items, notes, labels, meta] = await Promise.all([
      r().query(`SELECT ${ITEM_COLS} FROM pmo.Item`),
      r().query(`SELECT Id, ItemId, Label, Body, CONVERT(char(23), CreatedAt, 126) AS CreatedAt FROM pmo.Note ORDER BY CreatedAt`),
      r().query(`SELECT Name FROM pmo.Label ORDER BY SortOrder`),
      r().query(`SELECT V FROM pmo.Meta WHERE K = N'initialized'`),
    ]);
    const byItem = new Map();
    for (const n of notes.recordset) {
      if (!byItem.has(n.ItemId)) byItem.set(n.ItemId, []);
      byItem.get(n.ItemId).push({ id: n.Id, at: iso(n.CreatedAt), label: n.Label, text: n.Body });
    }
    return {
      initialized: meta.recordset.length > 0 && meta.recordset[0].V === '1',
      labels: labels.recordset.map(l => l.Name),
      items: items.recordset.map(i => ({
        id: i.Id, type: i.Type, parentId: i.ParentId, name: i.Name, team: i.Team, status: i.Status,
        start: i.StartDate || '', end: i.EndDate || '',
        effort: i.EffortHours == null ? '' : Number(i.EffortHours),
        focus: !!i.IsFocus, focusWhy: i.FocusWhy, summary: i.Summary, details: i.Details,
        notes: byItem.get(i.Id) || [],
        createdAt: iso(i.CreatedAt), updatedAt: iso(i.UpdatedAt),
      })),
    };
  }

  async _tx(fn) {
    const sql = driver();
    const tx = new sql.Transaction(this.pool);
    await tx.begin();
    try { await fn(sql, tx); await tx.commit(); } catch (e) { await tx.rollback().catch(() => {}); throw e; }
  }

  async _saveItem(sql, tx, it) {
    const req = () => {
      const r = new sql.Request(tx);
      r.input('id', sql.NVarChar(32), it.id);
      r.input('type', sql.NVarChar(20), it.type);
      r.input('parentId', sql.NVarChar(32), it.parentId);
      r.input('name', sql.NVarChar(300), it.name);
      r.input('team', sql.NVarChar(200), it.team);
      r.input('status', sql.NVarChar(20), it.status);
      r.input('start', sql.VarChar(10), it.start || null);
      r.input('end', sql.VarChar(10), it.end || null);
      r.input('effort', sql.Decimal(9, 2), it.effort === '' ? null : it.effort);
      r.input('focus', sql.Bit, it.focus);
      r.input('focusWhy', sql.NVarChar(400), it.focusWhy);
      r.input('summary', sql.NVarChar(400), it.summary);
      r.input('details', sql.NVarChar(sql.MAX), it.details);
      r.input('createdAt', sql.VarChar(30), it.createdAt);
      r.input('updatedAt', sql.VarChar(30), it.updatedAt);
      return r;
    };
    await req().query(
      `UPDATE pmo.Item SET Type = @type, ParentId = @parentId, Name = @name, Team = @team, Status = @status,
         StartDate = CONVERT(date, @start, 23), EndDate = CONVERT(date, @end, 23), EffortHours = @effort,
         IsFocus = @focus, FocusWhy = @focusWhy, Summary = @summary, Details = @details,
         UpdatedAt = CONVERT(datetime2(3), @updatedAt, 127)
       WHERE Id = @id;
       IF @@ROWCOUNT = 0
         INSERT INTO pmo.Item (Id, Type, ParentId, Name, Team, Status, StartDate, EndDate, EffortHours, IsFocus, FocusWhy, Summary, Details, CreatedAt, UpdatedAt)
         VALUES (@id, @type, @parentId, @name, @team, @status, CONVERT(date, @start, 23), CONVERT(date, @end, 23), @effort,
                 @focus, @focusWhy, @summary, @details, CONVERT(datetime2(3), @createdAt, 127), CONVERT(datetime2(3), @updatedAt, 127))`);
    await new sql.Request(tx).input('id', sql.NVarChar(32), it.id).query(`DELETE FROM pmo.Note WHERE ItemId = @id`);
    for (const n of it.notes) {
      await new sql.Request(tx)
        .input('id', sql.NVarChar(32), n.id).input('item', sql.NVarChar(32), it.id)
        .input('label', sql.NVarChar(100), n.label).input('body', sql.NVarChar(sql.MAX), n.text)
        .input('at', sql.VarChar(30), n.at)
        .query(`DELETE FROM pmo.Note WHERE Id = @id;
                INSERT INTO pmo.Note (Id, ItemId, Label, Body, CreatedAt) VALUES (@id, @item, @label, @body, CONVERT(datetime2(3), @at, 127))`);
    }
  }

  async _saveLabels(sql, tx, labels) {
    await new sql.Request(tx).query(`DELETE FROM pmo.Label`);
    let i = 0;
    for (const name of labels) {
      await new sql.Request(tx).input('n', sql.NVarChar(100), name).input('o', sql.Int, i++)
        .query(`INSERT INTO pmo.Label (Name, SortOrder) VALUES (@n, @o)`);
    }
  }

  async _markInitialized(sql, tx) {
    await new sql.Request(tx).query(
      `IF EXISTS (SELECT 1 FROM pmo.Meta WHERE K = N'initialized') UPDATE pmo.Meta SET V = N'1' WHERE K = N'initialized'
       ELSE INSERT INTO pmo.Meta (K, V) VALUES (N'initialized', N'1')`);
  }

  async sync({ upserts, deletes, labels }) {
    await this._tx(async (sql, tx) => {
      for (const it of upserts) await this._saveItem(sql, tx, it);
      for (const id of deletes) await new sql.Request(tx).input('id', sql.NVarChar(32), id).query(`DELETE FROM pmo.Item WHERE Id = @id`);
      if (labels) await this._saveLabels(sql, tx, labels);
      await this._markInitialized(sql, tx);
    });
  }

  async replace({ items, labels }) {
    await this._tx(async (sql, tx) => {
      await new sql.Request(tx).query(`DELETE FROM pmo.Note; DELETE FROM pmo.Item;`);
      for (const it of items) await this._saveItem(sql, tx, it);
      await this._saveLabels(sql, tx, labels);
      await this._markInitialized(sql, tx);
    });
  }
}

module.exports = { SqlStore, inspect, createSchema, cleanConnection, parseServer, explain, SCHEMA_VERSION };
