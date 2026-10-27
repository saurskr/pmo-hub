'use strict';
// PMO Hub server: static files, email/password login, and the Administration (SSO settings) API.
// No dependencies. Users live in data/users.txt, settings in data/config.json.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { manager, cleanState, cleanSync } = require('./server/data');
const mssql = () => require('./server/sqlserver');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.txt');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const SESSION_MS = 8 * 60 * 60 * 1000;
const COOKIE = 'pmo_session';

/* ---------- users (data/users.txt: email|role|salt|hash, one per line) ---------- */

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function readUsers() {
  if (!fs.existsSync(USERS_FILE)) return [];
  return fs.readFileSync(USERS_FILE, 'utf8').split('\n')
    .map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    .map(l => { const [email, role, salt, hash] = l.split('|'); return { email, role, salt, hash }; })
    .filter(u => u.email && u.salt && u.hash);
}

function writeUsers(users) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const lines = ['# email|role|salt|hash  (temporary file store; secure storage comes later)']
    .concat(users.map(u => [u.email, u.role, u.salt, u.hash].join('|')));
  fs.writeFileSync(USERS_FILE, lines.join('\n') + '\n', { mode: 0o600 });
}

function upsertUser(email, password, role) {
  email = email.trim().toLowerCase();
  if (!/^[^\s@|]+@[^\s@|]+\.[^\s@|]+$/.test(email)) throw new Error('Invalid email address');
  if (password.length < 8) throw new Error('Password must be at least 8 characters');
  const users = readUsers().filter(u => u.email !== email);
  users.push({ email, role: role === 'admin' ? 'admin' : 'user', ...hashPassword(password) });
  writeUsers(users);
}

function checkPassword(email, password) {
  const u = readUsers().find(x => x.email === String(email).trim().toLowerCase());
  // Hash even when the user is unknown so response time doesn't reveal which emails exist.
  const { hash } = hashPassword(String(password), u ? u.salt : '0'.repeat(32));
  const a = Buffer.from(hash, 'hex'), b = Buffer.from(u ? u.hash : '0'.repeat(128), 'hex');
  return u && a.length === b.length && crypto.timingSafeEqual(a, b) ? u : null;
}

/* ---------- SSO settings (data/config.json) ---------- */

const DEFAULT_SSO = {
  enabled: false,
  provider: 'entra',
  loginUrl: '',
  issuer: '',
  certificate: '',
  emailClaim: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
  allowedDomains: '',
  baseUrl: '',
};

function readConfig() {
  try { return { sso: { ...DEFAULT_SSO, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')).sso } }; }
  catch (e) { return { sso: { ...DEFAULT_SSO } }; }
}

function validateSso(input) {
  const s = { ...DEFAULT_SSO };
  const str = (k, max) => {
    const v = input[k] == null ? '' : String(input[k]).trim();
    if (v.length > max) throw new Error(`${k} is too long`);
    return v;
  };
  s.enabled = input.enabled === true;
  s.provider = ['entra', 'saml'].includes(input.provider) ? input.provider : 'entra';
  s.loginUrl = str('loginUrl', 1000);
  s.issuer = str('issuer', 1000);
  s.emailClaim = str('emailClaim', 500) || DEFAULT_SSO.emailClaim;
  s.baseUrl = str('baseUrl', 300).replace(/\/+$/, '');
  s.allowedDomains = str('allowedDomains', 1000);
  s.certificate = str('certificate', 20000).replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');
  if (s.loginUrl && !/^https:\/\/[^\s]+$/i.test(s.loginUrl)) throw new Error('Login URL must start with https://');
  if (s.baseUrl && !/^https?:\/\/[^\s/]+(\/\S*)?$/i.test(s.baseUrl)) throw new Error('Application URL must be a valid http(s) address');
  if (s.certificate && !/^[A-Za-z0-9+/=]+$/.test(s.certificate)) throw new Error('Certificate must be Base64 text');
  const domains = s.allowedDomains.split(/[\s,;]+/).filter(Boolean).map(d => d.toLowerCase());
  if (domains.some(d => !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d))) throw new Error('Allowed domains must look like example.com');
  s.allowedDomains = domains.join(', ');
  if (s.enabled && !(s.loginUrl && s.issuer && s.certificate)) {
    throw new Error('To enable SSO, fill in Login URL, Identifier and Certificate');
  }
  return s;
}

function baseUrl(req, sso) {
  if (sso.baseUrl) return sso.baseUrl;
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${proto}://${req.headers.host}`;
}

/* ---------- sessions & throttling ---------- */

const sessions = new Map();
const failures = new Map();

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function currentUser(req) {
  const t = parseCookies(req)[COOKIE];
  const s = t && sessions.get(t);
  if (!s) return null;
  if (s.exp < Date.now()) { sessions.delete(t); return null; }
  return s;
}

function startSession(res, user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { email: user.email, role: user.role, exp: Date.now() + SESSION_MS });
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}`);
}

function throttled(key) {
  const f = failures.get(key);
  return f && f.count >= 5 && Date.now() - f.last < 5 * 60 * 1000;
}
function noteFailure(key) {
  const f = failures.get(key);
  failures.set(key, { count: (f && Date.now() - f.last < 5 * 60 * 1000 ? f.count : 0) + 1, last: Date.now() });
}

/* ---------- http helpers ---------- */

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

function readJson(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    if (!(req.headers['content-type'] || '').startsWith('application/json')) return reject(Object.assign(new Error('Expected JSON'), { status: 400 }));
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(Object.assign(new Error('Body too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch (e) { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); } });
  });
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const PUBLIC_FILES = new Set(['/login.html', '/login.js', '/theme.css', '/shell.css', '/logo.png']);

function serveStatic(req, res, user) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, 'Not found', 'text/plain');
  const isPublic = PUBLIC_FILES.has(p);
  if (!isPublic && !user) {
    if (p.endsWith('.html')) { res.writeHead(302, { Location: '/login.html' }); return res.end(); }
    return send(res, 401, { error: 'Sign in required' });
  }
  if (p === '/admin.html' && user && user.role !== 'admin') { res.writeHead(302, { Location: '/' }); return res.end(); }
  if (p === '/login.html' && user) { res.writeHead(302, { Location: '/' }); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, data, TYPES[path.extname(file)] || 'application/octet-stream');
  });
}

/* ---------- routes ---------- */

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const user = currentUser(req);

  if (url.pathname === '/api/login' && req.method === 'POST') {
    const body = await readJson(req);
    const key = `${req.socket.remoteAddress}|${String(body.email).toLowerCase()}`;
    if (throttled(key)) return send(res, 429, { error: 'Too many attempts. Try again in a few minutes.' });
    const u = checkPassword(body.email, body.password);
    if (!u) { noteFailure(key); return send(res, 401, { error: 'Incorrect email or password.' }); }
    failures.delete(key);
    startSession(res, u);
    return send(res, 200, { email: u.email, role: u.role });
  }
  if (url.pathname === '/api/logout' && req.method === 'POST') {
    const t = parseCookies(req)[COOKIE];
    if (t) sessions.delete(t);
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    return send(res, 200, { ok: true });
  }
  if (url.pathname === '/api/sso/status' && req.method === 'GET') {
    // Public: tells the login page whether SSO has been configured.
    const { sso } = readConfig();
    return send(res, 200, { enabled: sso.enabled, ready: false });
  }
  if (url.pathname === '/api/me' && req.method === 'GET') {
    return user ? send(res, 200, { email: user.email, role: user.role }) : send(res, 401, { error: 'Sign in required' });
  }
  if (url.pathname === '/api/admin/sso') {
    if (!user) return send(res, 401, { error: 'Sign in required' });
    if (user.role !== 'admin') return send(res, 403, { error: 'Administrators only' });
    if (req.method === 'GET' || req.method === 'PUT') {
      let { sso } = readConfig();
      if (req.method === 'PUT') {
        sso = validateSso(await readJson(req));
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(CONFIG_FILE, JSON.stringify({ sso }, null, 2));
      }
      const base = baseUrl(req, sso);
      return send(res, 200, { sso, derived: { entityId: `${base}/sso/metadata`, replyUrl: `${base}/sso/acs`, signOnUrl: `${base}/` } });
    }
  }
  /* ---- shared project data (any signed-in user) ---- */
  if (url.pathname === '/api/data' || url.pathname === '/api/data/sync') {
    if (!user) return send(res, 401, { error: 'Sign in required' });
    const store = manager.current();
    if (url.pathname === '/api/data' && req.method === 'GET') {
      const all = await store.getAll();
      return send(res, 200, { ...all, storage: store.describe() });
    }
    if (url.pathname === '/api/data' && req.method === 'PUT') {
      await store.replace(cleanState(await readJson(req, BIG_JSON)));
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/data/sync' && req.method === 'POST') {
      await store.sync(cleanSync(await readJson(req, BIG_JSON)));
      return send(res, 200, { ok: true });
    }
  }

  /* ---- storage settings (administrators) ---- */
  if (url.pathname.startsWith('/api/admin/storage')) {
    if (!user) return send(res, 401, { error: 'Sign in required' });
    if (user.role !== 'admin') return send(res, 403, { error: 'Administrators only' });
    return handleStorageAdmin(req, res, url);
  }

  if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
  if (req.method !== 'GET') return send(res, 405, 'Method not allowed', 'text/plain');
  serveStatic(req, res, user);
}

const BIG_JSON = 5 * 1024 * 1024;

// Admin screens show connection problems to the admin (400). Everything else that isn't the
// caller's fault is a server error; ordinary users only get a generic message for those.
function fail(req, res, e) {
  const isAdminApi = req.url.startsWith('/api/admin');
  const status = e.status || (isAdminApi ? 400 : 500);
  let message = String(e.message).replace(/password=[^;]*/gi, 'password=***');
  if (status >= 500 && !isAdminApi) {
    console.error(`${req.method} ${req.url}: ${message}`);
    message = status === 503 ? message : 'The data store had a problem. Your changes will be retried.';
  }
  send(res, status, { error: message });
}

async function handleStorageAdmin(req, res, url) {
  const saved = manager.config.sql;
  if (url.pathname === '/api/admin/storage' && req.method === 'GET') {
    return send(res, 200, {
      mode: manager.config.mode,
      active: manager.store ? manager.store.describe() : null,
      error: manager.error,
      sql: saved ? { server: saved.server, database: saved.database, user: saved.user, encrypt: saved.encrypt, trustServerCertificate: saved.trustServerCertificate, hasPassword: !!saved.password } : null,
      downloadUrl: DOWNLOAD_URL,
    });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  const body = await readJson(req);
  const m = mssql();

  if (url.pathname === '/api/admin/storage/test') {
    const cfg = m.cleanConnection(body, saved);
    return send(res, 200, { ok: true, ...(await m.inspect(cfg)) });
  }
  if (url.pathname === '/api/admin/storage/create-schema') {
    const cfg = m.cleanConnection(body, saved);
    const result = await m.createSchema(cfg, body.createDatabase !== false);
    // Remember the connection details so the form is filled in next time.
    const { writeStorageConfig } = require('./server/data');
    manager.config = { ...manager.config, sql: cfg };
    writeStorageConfig(manager.config);
    return send(res, 200, { ok: true, ...result });
  }
  if (url.pathname === '/api/admin/storage/activate') {
    const copy = body.copyData === true;
    if (body.mode === 'file') {
      const r = await manager.activate('file', null, copy);
      return send(res, 200, { ok: true, ...r, active: manager.store.describe() });
    }
    if (body.mode === 'sqlserver') {
      const cfg = m.cleanConnection(body, saved);
      const r = await manager.activate('sqlserver', cfg, copy);
      return send(res, 200, { ok: true, ...r, active: manager.store.describe() });
    }
    return send(res, 400, { error: 'Unknown storage mode' });
  }
  return send(res, 404, { error: 'Not found' });
}

const DOWNLOAD_URL = 'https://www.microsoft.com/en-us/sql-server/sql-server-downloads';

/* ---------- start / CLI ---------- */

function bootstrapAdmin() {
  if (readUsers().length) return;
  const password = crypto.randomBytes(9).toString('base64url');
  upsertUser('admin@example.com', password, 'admin');
  console.log('\nNo users found. Created the first administrator:');
  console.log('  email:    admin@example.com');
  console.log(`  password: ${password}`);
  console.log('Change it with:  node server.js add-user <email> <password> [admin]\n');
}

if (process.argv[2] === 'add-user') {
  const [, , , email, password, role] = process.argv;
  try { upsertUser(email || '', password || '', role); console.log(`Saved ${email} (${role === 'admin' ? 'admin' : 'user'})`); }
  catch (e) { console.error(e.message + '\nUsage: node server.js add-user <email> <password> [admin]'); process.exit(1); }
} else {
  bootstrapAdmin();
  manager.init().then(() => {
    if (manager.error) console.error(`Storage problem: ${manager.error}\nThe app is running; fix it or switch back to file storage under Administration.`);
    else console.log(`Storage: ${manager.store.describe()}`);
    http.createServer((req, res) => {
      handle(req, res).catch(e => fail(req, res, e));
    }).listen(PORT, () => console.log(`PMO Hub running at http://localhost:${PORT}`));
  });
}
