(() => {
'use strict';

const KEY = 'pmo-hub-v1';
const DAY = 86400000;
const STALE_DAYS = 14;

/* ---------- status & labels ---------- */

const { STATUSES, statusIcon } = window.PMOStatus; // defined in status.js

const TYPES = { project: 'Project', vendor: 'Vendor', roadmap: 'Roadmap', quickwin: 'Quick Win' };
const TAB_TITLES = { '': 'Summary', project: 'Projects', vendor: 'Vendors', roadmap: 'Roadmap', quickwin: 'Quick Wins' };

const MAX_FOCUS = 5;
const PIN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>';
const TARGET_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></svg>';

const DEFAULT_LABELS = ['Update', 'Decision', 'Risk', 'Blocker', 'Action', 'Question', 'FYI'];
const LABEL_COLORS = {
  Update: 'var(--blue)', Decision: 'var(--purple)', Risk: 'var(--amber)', Blocker: 'var(--red)',
  Action: 'var(--green)', Question: 'var(--pink)', FYI: 'var(--muted)',
};

function labelColor(l) {
  if (LABEL_COLORS[l]) return LABEL_COLORS[l];
  let h = 0;
  for (const ch of l) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 55% 45%)`;
}
const chip = (l, extra = '') => `<span class="chip" style="--c:${labelColor(l)}"${extra}>${esc(l)}</span>`;

/* ---------- helpers ---------- */

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const pad = n => String(n).padStart(2, '0');
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function toDay(s) { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); }
function fromDay(ms) { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
function addDays(s, n) { return fromDay(toDay(s) + n * DAY); }
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(s) { if (!s) return '—'; const d = new Date(toDay(s)); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`; }
function daysBetween(a, b) { return Math.round((toDay(b) - toDay(a)) / DAY); }
function ago(iso) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / DAY);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d}d ago`;
}
function ageDays(iso) { return Math.floor((Date.now() - new Date(iso).getTime()) / DAY); }

/* ---------- state ---------- */

let state = { items: [], labels: DEFAULT_LABELS.slice() }; // filled by init() from the server
// The address looks like #vendor (a tab) or #vendor/<id> (a tab with that entry open).
const hashParts = () => location.hash.slice(1).split('/');
const hashType = () => { const t = hashParts()[0]; return TYPES[t] ? t : ''; };
const hashId = () => hashParts()[1] || '';
window.pmoHasData = true; // tells shell.js it doesn't need to fetch the entries for the sidebar
let detailsOpen = true; // remembered across entries and visits
try { detailsOpen = localStorage.getItem('pmo-hub-details-open') !== '0'; } catch (e) { /* ignore */ }
const peekText = s => (s || '').split('\n').find(l => l.trim()) || 'No detailed notes yet';
const ui = { type: hashType(), q: '', team: '', label: '', sort: 'attention', showDone: true, status: '', range: 'auto', openId: null, noteLabel: '' };

// Data from before shared storage existed lived in this browser. Only read for a one-time copy.
function loadLocal() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.items)) return normalise(s);
  } catch (e) { /* storage unavailable or corrupt */ }
  return null;
}
function normalise(s) {
  const labels = Array.isArray(s.labels) ? s.labels.slice() : DEFAULT_LABELS.slice();
  for (const it of s.items) {
    if (!TYPES[it.type]) it.type = 'project'; // older data used 'track'
    it.notes = Array.isArray(it.notes) ? it.notes : [];
    for (const n of it.notes) if (n.label && !labels.includes(n.label)) labels.push(n.label);
  }
  return { items: s.items, labels };
}
/* ---------- saving to the server ---------- */

const pending = { upserts: new Set(), deletes: new Set(), labels: false, replace: false };
let syncTimer = null, syncing = false, retryDelay = 1000;

function setSaveStatus(kind, detail) {
  const el = $('#save-status');
  if (!el) return;
  el.dataset.kind = kind;
  el.textContent = { loading: 'Loading…', saving: 'Saving…', saved: 'Saved', error: 'Not saved — retrying' }[kind] || '';
  el.title = detail || '';
}
// Keep showing the error while retries are running; only a successful save clears it.
const showSaving = () => { const el = $('#save-status'); if (!el || el.dataset.kind !== 'error') setSaveStatus('saving'); };
const hasPending = () => pending.replace || pending.labels || pending.upserts.size > 0 || pending.deletes.size > 0;

async function api(method, path, body) {
  const r = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { location.href = '/login.html'; throw new Error('Signed out'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || `Request failed (${r.status})`), { status: r.status });
  return data;
}

function scheduleSync(delay = 500) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(flush, delay);
  if (!syncing) showSaving();
}

async function flush() {
  if (syncing || !hasPending()) return;
  const batch = { upserts: [...pending.upserts], deletes: [...pending.deletes], labels: pending.labels, replace: pending.replace };
  pending.upserts.clear(); pending.deletes.clear(); pending.labels = false; pending.replace = false;
  syncing = true; showSaving();
  try {
    if (batch.replace) await api('PUT', '/api/data', { items: state.items, labels: state.labels });
    else await api('POST', '/api/data/sync', {
      upserts: batch.upserts.map(byId).filter(Boolean),
      deletes: batch.deletes,
      ...(batch.labels ? { labels: state.labels } : {}),
    });
    retryDelay = 1000;
  } catch (e) {
    batch.upserts.forEach(id => pending.upserts.add(id));
    batch.deletes.forEach(id => pending.deletes.add(id));
    pending.labels = pending.labels || batch.labels; pending.replace = pending.replace || batch.replace;
    syncing = false;
    setSaveStatus('error', e.message);
    if (!e.status || e.status >= 500) { scheduleSync(retryDelay); retryDelay = Math.min(retryDelay * 2, 30000); }
    return; // a 4xx means the server rejected the data; retrying the same request won't help
  }
  syncing = false;
  if (hasPending()) scheduleSync(0); else setSaveStatus('saved');
}

const markDirty = id => { pending.deletes.delete(id); pending.upserts.add(id); scheduleSync(); };
const markDeleted = id => { pending.upserts.delete(id); pending.deletes.add(id); scheduleSync(); };
const markLabels = () => { pending.labels = true; scheduleSync(); };
const save = () => { pending.replace = true; scheduleSync(); }; // replace everything (import, sample data, clear)

window.addEventListener('beforeunload', e => { if (hasPending() || syncing) { e.preventDefault(); e.returnValue = ''; } });

async function init() {
  $('#list').innerHTML = '<div class="empty">Loading…</div>';
  setSaveStatus('loading');
  let data;
  try { data = await api('GET', '/api/data'); }
  catch (e) {
    setSaveStatus('error', e.message);
    $('#list').innerHTML = `<div class="empty"><p>Couldn't load your data.</p><p class="muted">${esc(e.message)}</p><button id="retry-load">Try again</button></div>`;
    $('#retry-load').addEventListener('click', init);
    return;
  }
  storageName = data.storage;
  if (data.initialized) {
    state = normalise(data);
  } else {
    // First run on this store: bring over anything saved in this browser, otherwise start with samples.
    const local = loadLocal();
    if (local && local.items.length && confirm(`This browser has ${local.items.length} entries from before shared storage was added.\n\nCopy them into the shared store?`)) state = local;
    else if (local && local.items.length) state = { items: [], labels: DEFAULT_LABELS.slice() };
    else state = seed();
    save();
  }
  renderAll();
  openFromHash();
  if (!hasPending()) setSaveStatus('saved', storageName);
}
let storageName = '';

// Pick up other people's changes when returning to the tab (only if nothing of ours is waiting).
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || hasPending() || syncing || ui.openId) return;
  try {
    const data = await api('GET', '/api/data');
    if (hasPending() || syncing || ui.openId || !data.initialized) return;
    state = normalise(data); renderAll(); setSaveStatus('saved', storageName);
  } catch (e) { /* try again next time */ }
});

function blankItem(over = {}) {
  const now = new Date().toISOString();
  return Object.assign({
    id: uid(), type: 'project', parentId: null, name: '', team: '', status: 'notstarted',
    start: '', end: '', effort: '', focus: false, focusWhy: '', summary: '', details: '', notes: [], createdAt: now, updatedAt: now,
  }, over);
}

function seed() {
  const t = todayStr();
  const d = n => addDays(t, n);
  const ago_ = n => new Date(Date.now() - n * DAY).toISOString();
  const mk = (over, notes = []) => blankItem(Object.assign({
    notes: notes.map(([days, label, text]) => ({ id: uid(), at: ago_(days), label, text })),
    updatedAt: notes.length ? ago_(Math.min(...notes.map(n => n[0]))) : ago_(0),
  }, over));
  const erp = mk({ name: 'ERP migration', focus: true, focusWhy: 'Cutover date locked, mapping sign-off late.', team: 'Finance Systems', status: 'atrisk', start: d(-120), end: d(150),
    summary: 'Cutover date holding, but data-mapping sign-off is late.',
    details: 'Sponsor: CFO. Vendor is running two workstreams in parallel.\n\nKey dependency: finance sign-off on chart-of-accounts mapping before UAT can start.' },
    [[2, 'Risk', 'Mapping sign-off now 2 weeks late. If not signed by month end UAT slips into the freeze window.'],
     [9, 'Decision', 'Agreed to keep big-bang cutover rather than phase by entity.'],
     [20, 'Update', 'Vendor confirmed second environment is ready.']]);
  const erpData = mk({ name: 'Data mapping sign-off', focus: true, focusWhy: 'Blocks UAT start.', type: 'project', parentId: erp.id, team: 'Finance', status: 'offtrack', start: d(-40), end: d(-5),
    summary: 'Waiting on Finance controller review.' },
    [[3, 'Blocker', 'Controller out until next week; asked deputy to review in the meantime.']]);
  const erpUat = mk({ name: 'UAT & cutover rehearsal', type: 'project', parentId: erp.id, team: 'QA / Finance', status: 'notstarted', start: d(10), end: d(80),
    summary: 'Starts once mapping is signed off.' });
  const sec = mk({ name: 'Zero-trust network rollout', team: 'Infrastructure', status: 'ontrack', start: d(-60), end: d(90),
    summary: 'Phase 1 (HQ) complete, branch sites next.' },
    [[6, 'Update', 'HQ cutover finished with no major incidents.'], [30, 'Decision', 'Branch rollout to be done by region, EMEA first.']]);
  const vendor = mk({ name: 'Cloud vendor contract renewal', focus: true, focusWhy: '3-year commit decision due.', type: 'vendor', team: 'Procurement', status: 'atrisk', start: d(-14), end: d(35),
    summary: 'Pricing discussion open; they want 3-year commit.' },
    [[1, 'Question', 'Can we get a 2-year term with the same discount? Procurement to ask.'], [12, 'Action', 'Send usage forecast to vendor.']]);
  const helpdesk = mk({ name: 'Service desk tooling review', type: 'roadmap', team: 'End User Services', status: 'onhold', start: d(-30), end: d(60),
    summary: 'Paused until budget cycle completes.' },
    [[25, 'Decision', 'Pause until FY budget is confirmed.']]);
  const mfa = mk({ name: 'MFA for contractors', team: 'Security', status: 'done', start: d(-90), end: d(-12), summary: 'Completed; 98% enrolled.' },
    [[12, 'Update', 'Closed out. Remaining accounts are dormant and will be disabled.']]);
  const dr = mk({ name: 'DR test — Q1', type: 'roadmap', team: 'Infrastructure', status: 'notstarted', start: d(120), end: d(150), summary: 'Scope to be agreed with app owners.' });
  const msp = mk({ name: 'Managed print provider', type: 'vendor', team: 'End User Services', status: 'ontrack', start: d(-200), end: d(160),
    summary: 'Service levels met for the last two quarters.' },
    [[15, 'Update', 'Quarterly service review held; no open escalations.']]);
  const ai = mk({ name: 'AI adoption program', focus: true, focusWhy: 'Agree sponsor before budget cycle.', type: 'roadmap', team: 'IT Leadership', status: 'notstarted', start: d(30), end: d(300),
    summary: 'Not yet an official project; agree scope and sponsor first.',
    details: 'Idea: structured program to help teams adopt AI tooling safely.\n\nOpen questions: sponsor, budget, policy owner.' },
    [[4, 'Question', 'Who owns the AI usage policy — Security or Legal?']]);
  const qw1 = mk({ name: 'Automate new-starter laptop checklist', type: 'quickwin', team: 'End User Services', status: 'ontrack', start: d(-5), end: d(9), effort: 12,
    summary: 'Script drafted, needs testing.' },
    [[2, 'Update', 'Draft script works for Windows; Mac version next.']]);
  const qw2 = mk({ name: 'Remove unused SaaS licences', type: 'quickwin', team: 'IT Operations', status: 'notstarted', start: d(7), end: d(21), effort: 6,
    summary: 'Export usage report and cancel dormant seats.' });
  return { items: [erp, erpData, erpUat, sec, vendor, msp, helpdesk, mfa, dr, ai, qw1, qw2], labels: DEFAULT_LABELS.slice() };
}

const byId = id => state.items.find(i => i.id === id);
const hasChildren = id => state.items.some(i => i.parentId === id);
const lastNote = it => it.notes.length ? it.notes.reduce((a, b) => (a.at > b.at ? a : b)) : null;

const focusItems = () => state.items.filter(i => i.focus);
const pinBtn = it => `<button class="tg pin${it.focus ? ' on' : ''}" data-pin="${it.id}" aria-pressed="${!!it.focus}" aria-label="${it.focus ? 'Remove from Focus' : 'Add to Focus'}" title="${it.focus ? 'In Focus — click to remove' : 'Add to Focus'}">${PIN_SVG}</button>`;

const fmtHours = n => `${Number(n)}h`;
const hasEffort = it => it.effort !== '' && it.effort != null && !isNaN(Number(it.effort));

function touch(it) { it.updatedAt = new Date().toISOString(); markDirty(it.id); }

/* ---------- filtering / ordering ---------- */

function matches(it) {
  if (ui.type && it.type !== ui.type) return false;
  if (ui.status && it.status !== ui.status) return false;
  if (!ui.showDone && it.status === 'done') return false;
  if (ui.team && it.team !== ui.team) return false;
  if (ui.label && !it.notes.some(n => n.label === ui.label)) return false;
  if (ui.q) {
    const q = ui.q.toLowerCase();
    const hay = [it.name, it.team, it.summary, it.details, ...it.notes.map(n => n.text)].join('\n').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function cmp(a, b) {
  const r = STATUSES[a.status].rank - STATUSES[b.status].rank;
  const endA = a.end || '9999', endB = b.end || '9999';
  switch (ui.sort) {
    case 'end': return endA.localeCompare(endB) || a.name.localeCompare(b.name);
    case 'start': return (a.start || '9999').localeCompare(b.start || '9999') || a.name.localeCompare(b.name);
    case 'updated': return b.updatedAt.localeCompare(a.updatedAt);
    case 'name': return a.name.localeCompare(b.name);
    default: return r || endA.localeCompare(endB) || a.name.localeCompare(b.name);
  }
}

// Top-level entries sorted, each followed by its (sorted) tracks. If a parent is
// filtered out but a child matches, the child is shown on its own.
function visibleRows() {
  const ids = new Set(state.items.map(i => i.id));
  const isRoot = i => !i.parentId || !ids.has(i.parentId);
  const roots = state.items.filter(isRoot).sort(cmp);
  const rows = [];
  for (const r of roots) {
    const kids = state.items.filter(i => i.parentId === r.id).sort(cmp).filter(matches);
    if (matches(r)) {
      rows.push({ it: r, child: false });
      kids.forEach(k => rows.push({ it: k, child: true }));
    } else {
      kids.forEach(k => rows.push({ it: k, child: false }));
    }
  }
  return rows;
}

/* ---------- render: stats / filters ---------- */

function renderStats() {
  const counts = {};
  state.items.filter(i => !ui.type || i.type === ui.type).forEach(i => { counts[i.status] = (counts[i.status] || 0) + 1; });
  $('#stats').innerHTML = Object.keys(STATUSES).map(k => {
    const n = counts[k] || 0;
    return `<button class="stat${ui.status === k ? ' on' : ''}${n ? '' : ' zero'}" data-status="${k}" aria-pressed="${ui.status === k}">` +
      `${statusIcon(k, 20)}<b>${n}</b><span>${STATUSES[k].label}</span></button>`;
  }).join('');
}

function renderFilters() {
  const teams = [...new Set(state.items.map(i => i.team).filter(Boolean))].sort();
  if (ui.team && !teams.includes(ui.team)) ui.team = '';
  $('#f-team').innerHTML = `<option value="">All teams</option>` + teams.map(t => `<option${t === ui.team ? ' selected' : ''}>${esc(t)}</option>`).join('');
  if (ui.label && !state.labels.includes(ui.label)) ui.label = '';
  $('#f-label').innerHTML = `<option value="">Any note label</option>` + state.labels.map(l => `<option${l === ui.label ? ' selected' : ''}>${esc(l)}</option>`).join('');
}

/* ---------- render: focus panel ---------- */

function focusDate(it) {
  const t = todayStr();
  if (it.status === 'done') return '';
  if (it.end && daysBetween(t, it.end) < 0) return `<span class="warn">Overdue ${-daysBetween(t, it.end)}d</span>`;
  if (it.start && daysBetween(t, it.start) > 0) return `Starts in ${daysBetween(t, it.start)}d`;
  if (it.end) return `Ends in ${daysBetween(t, it.end)}d`;
  return '';
}

function renderFocus() {
  const host = $('#focus');
  host.hidden = !!ui.type; // shown on the all-items Summary only
  if (host.hidden) return;
  const items = focusItems();
  const dots = Array.from({ length: MAX_FOCUS }, (_, i) => `<i class="${i < items.length ? '' : 'e'}"></i>`).join('');
  const cards = items.map(it => {
    const n = lastNote(it);
    const stale = it.status !== 'done' && it.status !== 'notstarted' && ageDays(it.updatedAt) > STALE_DAYS;
    return `<div class="fc" data-id="${it.id}" tabindex="0" role="button">
      <div class="t">${statusIcon(it.status, 16)}${TYPES[it.type]}</div>
      <div class="n">${esc(it.name || 'Untitled')}</div>
      <div class="w">${it.focusWhy ? esc(it.focusWhy) : (it.summary ? `<span class="muted">${esc(it.summary)}</span>` : '<span class="muted">No “why now” yet</span>')}</div>
      <div class="l">${n ? `<span>${chip(n.label || 'Note')} ${ago(n.at)}</span>` : '<span>No notes</span>'}<span>${focusDate(it)}</span>${stale ? `<span class="stale">No update in ${ageDays(it.updatedAt)}d</span>` : ''}</div>
    </div>`;
  }).join('');
  const free = MAX_FOCUS - items.length;
  const empty = free > 0 ? `<div class="fc empty"><div>${free === MAX_FOCUS ? 'Nothing in Focus yet' : free === 1 ? 'One slot free' : free + ' slots free'}<br><small>Use the pin on any entry to add it</small></div></div>` : '';
  host.innerHTML = `<div class="panel-head"><h2>Focus</h2><span class="muted">The five things that need you most right now</span>
    <span class="count"><span class="dots" aria-hidden="true">${dots}</span>${items.length} of ${MAX_FOCUS}</span></div>
    <div class="cards">${cards}${empty}</div>`;
}

/* ---------- pinning ---------- */

function togglePin(id) {
  const it = byId(id);
  if (!it) return;
  if (it.focus) { it.focus = false; touch(it); return afterPin(); }
  if (focusItems().length >= MAX_FOCUS) return openSwap(it);
  it.focus = true; touch(it); afterPin();
}

function afterPin() {
  renderAll();
  if (ui.openId) refreshDrawerKeepScroll();
}

function refreshDrawerKeepScroll() {
  const y = $('#drawer').scrollTop;
  renderDrawer();
  $('#drawer').scrollTop = y;
}

function openSwap(incoming) {
  const dlg = $('#swap');
  dlg.innerHTML = `<form method="dialog"><h3>Focus is full</h3>
    <p>Choose one to take out so “${esc(incoming.name || 'Untitled')}” can go in.</p>
    <div class="swap-list">${focusItems().map(f => `<button type="button" data-out="${f.id}">${statusIcon(f.status, 16)}<span class="nm">${esc(f.name || 'Untitled')}</span><small>${TYPES[f.type]}</small></button>`).join('')}</div>
    <div class="swap-actions"><button value="cancel">Cancel</button></div></form>`;
  dlg.dataset.incoming = incoming.id;
  dlg.showModal();
}

/* ---------- render: summary list ---------- */

function dateInfo(it) {
  if (!it.start && !it.end) return '<span class="muted">No dates</span>';
  let extra = '';
  const t = todayStr();
  if (it.end && it.status !== 'done') {
    const left = daysBetween(t, it.end);
    if (left < 0) extra = `<div class="warn">Overdue ${-left}d</div>`;
    else if (left <= 30) extra = `<div class="muted">Ends in ${left}d</div>`;
  }
  return `<div>${fmtDate(it.start)} → ${fmtDate(it.end)}</div>${extra}`;
}

function renderList() {
  const rows = visibleRows();
  const total = state.items.filter(i => !ui.type || i.type === ui.type).length;
  const hours = rows.filter(r => r.it.type === 'quickwin' && hasEffort(r.it)).reduce((s, r) => s + Number(r.it.effort), 0);
  $('#count').textContent = `${rows.length} of ${total}` + (ui.type === 'quickwin' && hours ? ` · ~${fmtHours(hours)} estimated` : '');
  if (!total) { $('#list').innerHTML = `<div class="empty">Nothing here yet. Add one with “+ New entry”.</div>`; return; }
  if (!rows.length) { $('#list').innerHTML = `<div class="empty">No entries match the current filters.</div>`; return; }
  $('#list').innerHTML = rows.map(({ it, child }) => {
    const n = lastNote(it);
    const parent = it.parentId && !child ? byId(it.parentId) : null;
    const stale = it.status !== 'done' && it.status !== 'notstarted' && ageDays(it.updatedAt) > STALE_DAYS;
    return `<div class="row${child ? ' child' : ''}${it.focus ? ' focused' : ''}" data-id="${it.id}" tabindex="0" role="button">
      <div>${statusIcon(it.status)}</div>
      <div><div class="name">${esc(it.name || 'Untitled')}</div>
        <div class="sub"><span class="tag">${TYPES[it.type]}</span>${it.team ? esc(it.team) : ''}${parent ? ` · in ${esc(parent.name)}` : ''}${it.type === 'quickwin' && hasEffort(it) ? ` · <b>~${fmtHours(it.effort)}</b>` : ''}</div></div>
      <div class="clamp">${it.summary ? esc(it.summary) : '<span class="muted">No summary yet</span>'}</div>
      <div class="dates">${dateInfo(it)}</div>
      <div>${n ? `${chip(n.label || 'Note')} <span class="muted">${ago(n.at)}</span><div class="clamp muted">${esc(n.text)}</div>` : '<span class="muted">No notes</span>'}
        ${stale ? `<div class="stale">No update in ${ageDays(it.updatedAt)}d</div>` : ''}</div>
      <div class="pin-cell">${pinBtn(it)}</div>
    </div>`;
  }).join('');
}

/* ---------- render: gantt ---------- */

const LABEL_W = 220;

function renderGantt() {
  const host = $('#gantt');
  const rows = visibleRows();
  const dated = rows.filter(r => r.it.start || r.it.end);
  if (!rows.length) { host.innerHTML = `<div class="empty">Nothing to show.</div>`; return; }
  if (!dated.length) { host.innerHTML = `<div class="empty">Add start and end dates to see entries on the timeline.</div>`; return; }

  const today = todayStr();
  let rs, re;
  if (ui.range === 'auto') {
    const all = dated.flatMap(r => [r.it.start || r.it.end, r.it.end || r.it.start]).concat(today);
    rs = all.reduce((a, b) => (a < b ? a : b));
    re = all.reduce((a, b) => (a > b ? a : b));
    rs = addDays(rs, -7); re = addDays(re, 14);
  } else {
    rs = addDays(today, -14);
    re = addDays(rs, Math.round(Number(ui.range) * 30.44));
  }
  const days = daysBetween(rs, re) + 1;
  const avail = Math.max(host.clientWidth - LABEL_W - 2, 360);
  const ppd = Math.max(avail / days, 1.2);
  const tw = Math.round(days * ppd);
  const x = s => (daysBetween(rs, s)) * ppd;

  // months
  let months = '', lines = '';
  const first = new Date(toDay(rs));
  let cur = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1);
  while (cur <= toDay(re)) {
    const d = new Date(cur);
    const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    const l = Math.max(0, (cur - toDay(rs)) / DAY * ppd);
    const r = Math.min(tw, (next - toDay(rs)) / DAY * ppd);
    if (r > l) {
      const wide = r - l > 70;
      const text = d.getUTCMonth() === 0 || cur === Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1) || wide
        ? `${MON[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}` : MON[d.getUTCMonth()];
      months += `<div class="g-month" style="left:${l}px;width:${r - l}px">${r - l > 34 ? text : ''}</div>`;
      lines += `<div class="g-line" style="left:${l}px"></div>`;
    }
    cur = next;
  }

  const body = rows.map(({ it, child }) => {
    const st = STATUSES[it.status];
    const label = `<div class="g-label${child ? ' child' : ''}" data-id="${it.id}" title="${esc(it.name)}">${statusIcon(it.status, 16)}<span class="t">${esc(it.name || 'Untitled')}</span></div>`;
    if (!it.start && !it.end) return `<div class="g-row">${label}<div class="g-time g-nodate" style="width:${tw}px">no dates</div></div>`;
    const s = it.start || it.end, e = it.end || it.start;
    let l = x(s), r = x(e) + ppd;
    const cutL = l < 0, cutR = r > tw;
    l = Math.max(0, l); r = Math.min(tw, r);
    let bar = '';
    if (r > l) {
      const cls = ['g-bar', it.status === 'notstarted' || it.status === 'onhold' ? 'hollow' : '', !it.parentId && hasChildren(it.id) ? 'proj' : '', cutL ? 'cut-l' : '', cutR ? 'cut-r' : ''].join(' ');
      bar = `<button class="${cls}" data-id="${it.id}" style="left:${l}px;width:${Math.max(r - l, 8)}px;--c:${st.color}" title="${esc(it.name)} — ${st.label}\n${fmtDate(it.start)} → ${fmtDate(it.end)}" aria-label="${esc(it.name)}, ${st.label}, ${fmtDate(it.start)} to ${fmtDate(it.end)}"></button>`;
    }
    return `<div class="g-row">${label}<div class="g-time" style="width:${tw}px">${bar}</div></div>`;
  }).join('');

  const tx = daysBetween(rs, today) * ppd;
  const todayLine = tx >= 0 && tx <= tw ? `<div class="g-today" style="left:${tx}px"></div>` : '';

  host.innerHTML = `<div class="gantt-scroll"><div class="gantt" style="--lw:${LABEL_W}px;width:${LABEL_W + tw}px">
    <div class="g-row head"><div class="g-label">Entry</div><div class="g-time" style="width:${tw}px">${months}</div></div>
    ${body}
    <div class="g-overlay" style="width:${tw}px">${lines}${todayLine}</div>
  </div></div>`;
}

/* ---------- drawer ---------- */

function openDrawer(id, focusName = false) {
  ui.openId = id; ui.noteLabel = '';
  if (window.pmoNav) pmoNav.setActive(id);
  renderDrawer();
  $('#drawer').hidden = false; $('#scrim').hidden = false;
  if (focusName) { const n = $('#d-name'); n.focus(); n.select(); }
}
function closeDrawer(keepHash = false) {
  ui.openId = null;
  $('#drawer').hidden = true; $('#scrim').hidden = true;
  if (window.pmoNav) pmoNav.setActive(null);
  // Drop the entry id from the address so the same entry can be opened again from the sidebar.
  if (!keepHash && hashId()) history.replaceState(null, '', location.pathname + '#' + hashType());
  cleanupBlank();
  renderAll();
}
function openFromHash() {
  const id = hashId();
  if (id && byId(id) && ui.openId !== id) openDrawer(id);
}
// Drop a just-created entry that was never filled in.
function cleanupBlank() {
  const keep = i => i.name || i.summary || i.details || i.notes.length || i.team || i.start || i.end || i.status !== 'notstarted' || i.id !== ui.lastNewId;
  state.items.filter(i => !keep(i)).forEach(i => markDeleted(i.id));
  state.items = state.items.filter(keep);
  ui.lastNewId = null;
}

function renderDrawer() {
  const it = byId(ui.openId);
  if (!it) return;
  const parents = state.items.filter(p => p.id !== it.id && !p.parentId);
  const canNest = !hasChildren(it.id);
  $('#drawer').innerHTML = `
    <div class="d-head">
      <span id="d-icon">${statusIcon(it.status, 24)}</span>
      <input id="d-name" value="${esc(it.name)}" placeholder="Name" aria-label="Name">
      <button id="d-focus" class="tg pill${it.focus ? ' on' : ''}" aria-pressed="${!!it.focus}">${TARGET_SVG}${it.focus ? 'In Focus' : 'Add to Focus'} <small>${focusItems().length}/${MAX_FOCUS}</small></button>
      <button id="d-close" aria-label="Close">✕</button>
    </div>
    <div class="grid2">
      <label>Type<select data-f="type">
        ${Object.entries(TYPES).map(([k, v]) => `<option value="${k}"${it.type === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Status<select data-f="status">${Object.entries(STATUSES).map(([k, v]) => `<option value="${k}"${it.status === k ? ' selected' : ''}>${v.label}</option>`).join('')}</select></label>
      <label>Team / owner<input data-f="team" value="${esc(it.team)}" list="teams" placeholder="e.g. Infrastructure"></label>
      <label>Part of<select data-f="parentId"${canNest ? '' : ' disabled'}>
        <option value="">— standalone —</option>${parents.map(p => `<option value="${p.id}"${it.parentId === p.id ? ' selected' : ''}>${esc(p.name || 'Untitled')}</option>`).join('')}</select></label>
      ${it.type === 'quickwin' ? `<label>Estimated effort (hours)<input type="number" data-f="effort" min="0" step="0.5" inputmode="decimal" value="${esc(it.effort)}" placeholder="e.g. 12"></label>` : ''}
      <label>Start<input type="date" data-f="start" value="${esc(it.start)}"></label>
      <label>End<input type="date" data-f="end" value="${esc(it.end)}"></label>
      ${it.focus ? `<label class="field full">Why it's a focus right now<input data-f="focusWhy" maxlength="160" value="${esc(it.focusWhy)}" placeholder="What makes this one of your five?"></label>` : ''}
      <label class="field full">Where it stands (one line)<input data-f="summary" maxlength="160" value="${esc(it.summary)}" placeholder="The one thing you need to know right now"></label>
    </div>
    <datalist id="teams">${[...new Set(state.items.map(i => i.team).filter(Boolean))].map(t => `<option value="${esc(t)}">`).join('')}</datalist>
    <details class="d-section collapsible" id="d-details"${detailsOpen ? ' open' : ''}>
      <summary><h3>Detailed notes</h3><span class="peek" id="d-peek">${esc(peekText(it.details))}</span></summary>
      <textarea data-f="details" rows="9" placeholder="Background, stakeholders, context — anything you want kept with this entry">${esc(it.details)}</textarea>
    </details>
    <div class="d-section">
      <h3>Notes log</h3>
      <div class="composer">
        <textarea id="n-text" rows="4" placeholder="Add a note…  (Ctrl/⌘+Enter to save)"></textarea>
        <div class="bar">
          <select id="n-label" aria-label="Label">${state.labels.map(l => `<option>${esc(l)}</option>`).join('')}<option value="__new">+ New label…</option></select>
          <button id="n-add" class="primary">Add note</button>
        </div>
      </div>
      <div id="n-list"></div>
    </div>
    <div><button id="d-delete" class="danger">Delete entry</button></div>`;
  renderNotes();
}

function renderNotes() {
  const it = byId(ui.openId);
  if (!it) return;
  const used = [...new Set(it.notes.map(n => n.label).filter(Boolean))];
  if (ui.noteLabel && !used.includes(ui.noteLabel)) ui.noteLabel = '';
  const notes = it.notes.slice().sort((a, b) => b.at.localeCompare(a.at)).filter(n => !ui.noteLabel || n.label === ui.noteLabel);
  $('#n-list').innerHTML =
    (used.length > 1 ? `<div class="chips">${used.map(l => `<button class="chip${ui.noteLabel && ui.noteLabel !== l ? ' off' : ''}" style="--c:${labelColor(l)}" data-filter="${esc(l)}">${esc(l)}</button>`).join('')}</div>` : '') +
    (notes.length ? notes.map(n => `<div class="note" data-nid="${n.id}">
      <div class="note-head">${n.label ? chip(n.label) : ''}<span>${new Date(n.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span><span class="sp"></span>
        <span class="note-actions"><button class="link" data-act="edit">Edit</button><button class="link" data-act="del">Delete</button></span></div>
      <div class="note-body">${esc(n.text)}</div></div>`).join('') : `<div class="muted" style="padding:10px 0">No notes yet.</div>`);
}

function addNote() {
  const it = byId(ui.openId);
  const text = $('#n-text').value.trim();
  if (!it || !text) return;
  it.notes.push({ id: uid(), at: new Date().toISOString(), label: $('#n-label').value, text });
  touch(it);
  $('#n-text').value = '';
  renderNotes(); renderAll();
}

function editNote(nid) {
  const it = byId(ui.openId);
  const n = it.notes.find(x => x.id === nid);
  const el = $(`.note[data-nid="${nid}"] .note-body`);
  el.innerHTML = `<textarea rows="4">${esc(n.text)}</textarea>
    <div style="display:flex;gap:8px;margin-top:6px"><select>${state.labels.map(l => `<option${l === n.label ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
    <button class="primary" data-act="save">Save</button><button data-act="cancel">Cancel</button></div>`;
  el.querySelector('textarea').focus();
}

function newLabel() {
  const name = (prompt('New label name') || '').trim();
  if (!name) return null;
  const existing = state.labels.find(l => l.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  state.labels.push(name); markLabels();
  return name;
}

/* ---------- events ---------- */

function renderAll() {
  document.querySelector('.top h1').textContent = TAB_TITLES[ui.type];
  document.title = `${TAB_TITLES[ui.type]} – PMO Hub`;
  renderFocus(); renderStats(); renderFilters(); renderList(); renderGantt();
  window.pmoItems = state.items; // for a sidebar that finishes loading after the data does
  if (window.pmoNav) pmoNav.update(state.items);
}

window.addEventListener('hashchange', () => {
  if (ui.openId) closeDrawer(true);
  ui.type = hashType(); ui.status = '';
  renderAll();
  openFromHash();
});

const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

$('#stats').addEventListener('click', e => {
  const b = e.target.closest('[data-status]'); if (!b) return;
  ui.status = ui.status === b.dataset.status ? '' : b.dataset.status;
  renderAll();
});
$('#f-q').addEventListener('input', debounce(e => { ui.q = e.target.value; renderList(); renderGantt(); }, 120));
$('#f-team').addEventListener('change', e => { ui.team = e.target.value; renderAll(); });
$('#f-label').addEventListener('change', e => { ui.label = e.target.value; renderAll(); });
$('#f-sort').addEventListener('change', e => { ui.sort = e.target.value; renderAll(); });
$('#f-done').addEventListener('change', e => { ui.showDone = e.target.checked; renderAll(); });
$('#f-range').addEventListener('change', e => { ui.range = e.target.value; renderGantt(); });
window.addEventListener('resize', debounce(renderGantt, 150));

const openFrom = e => { const t = e.target.closest('[data-id]'); if (t) openDrawer(t.dataset.id); };
$('#list').addEventListener('click', e => {
  const pin = e.target.closest('[data-pin]');
  if (pin) { e.stopPropagation(); return togglePin(pin.dataset.pin); }
  openFrom(e);
});
$('#focus').addEventListener('click', openFrom);
$('#focus').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.fc')) { e.preventDefault(); openFrom(e); } });
$('#swap').addEventListener('click', e => {
  const out = e.target.closest('[data-out]');
  if (!out) return;
  const dlg = $('#swap');
  const outgoing = byId(out.dataset.out), incoming = byId(dlg.dataset.incoming);
  if (outgoing && incoming) { outgoing.focus = false; incoming.focus = true; touch(outgoing); touch(incoming); }
  dlg.close();
  afterPin();
});
$('#list').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { if (e.target.matches('.row')) { e.preventDefault(); openFrom(e); } } });
$('#gantt').addEventListener('click', openFrom);

$('#btn-new').addEventListener('click', () => {
  const it = blankItem({ type: ui.type || 'project' });
  state.items.push(it); // saved once it's edited
  ui.lastNewId = it.id;
  openDrawer(it.id, true);
});
$('#scrim').addEventListener('click', closeDrawer);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && ui.openId && !$('#swap').open) closeDrawer(); });

const drawer = $('#drawer');
drawer.addEventListener('input', e => {
  const it = byId(ui.openId); if (!it) return;
  if (e.target.id === 'd-name') { it.name = e.target.value; touch(it); renderList(); renderGantt(); syncNav(); return; }
  const f = e.target.dataset.f;
  if (f === 'effort') { const n = parseFloat(e.target.value); it.effort = isNaN(n) ? '' : Math.max(0, n); touch(it); refreshSoft(); return; }
  if (f && ['summary', 'details', 'team', 'focusWhy'].includes(f)) {
    it[f] = e.target.value; touch(it); refreshSoft();
    if (f === 'details') $('#d-peek').textContent = peekText(it.details);
  }
});
drawer.addEventListener('change', e => {
  const it = byId(ui.openId); if (!it) return;
  const f = e.target.dataset.f;
  if (f && !['summary', 'details', 'team', 'effort', 'focusWhy'].includes(f)) {
    let v = e.target.value;
    if (f === 'parentId') v = v || null;
    it[f] = v;
    if ((f === 'start' || f === 'end') && it.start && it.end && it.end < it.start) {
      // keep the range sensible: move the other date along
      if (f === 'start') { it.end = it.start; } else { it.start = it.end; }
      renderDrawer();
    }
    touch(it);
    if (f === 'type') renderDrawer(); // effort field only applies to quick wins
    if (f === 'status') $('#d-icon').innerHTML = statusIcon(it.status, 24);
    renderAll();
  } else if (f === 'team') { renderAll(); }
  if (e.target.id === 'n-label' && e.target.value === '__new') {
    const l = newLabel();
    renderDrawerKeepComposer(l);
  }
});
const syncNav = () => { if (window.pmoNav) pmoNav.update(state.items); };
function refreshSoft() { renderFocus(); renderStats(); renderList(); renderGantt(); syncNav(); }
function renderDrawerKeepComposer(label) {
  const text = $('#n-text').value;
  renderDrawer();
  $('#n-text').value = text;
  if (label) $('#n-label').value = label;
  $('#n-text').focus();
}
// 'toggle' doesn't bubble, so listen in the capture phase.
drawer.addEventListener('toggle', e => {
  if (e.target.id !== 'd-details') return;
  detailsOpen = e.target.open;
  try { localStorage.setItem('pmo-hub-details-open', detailsOpen ? '1' : '0'); } catch (err) { /* ignore */ }
}, true);
drawer.addEventListener('keydown', e => {
  if (e.target.id === 'n-text' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addNote(); }
});
drawer.addEventListener('click', e => {
  const it = byId(ui.openId); if (!it) return;
  if (e.target.closest('#d-close')) return closeDrawer();
  if (e.target.closest('#d-focus')) return togglePin(it.id);
  if (e.target.closest('#n-add')) return addNote();
  if (e.target.closest('#d-delete')) {
    if (!confirm(`Delete “${it.name || 'Untitled'}” and all its notes?`)) return;
    state.items = state.items.filter(i => i.id !== it.id);
    state.items.forEach(i => { if (i.parentId === it.id) { i.parentId = null; touch(i); } });
    markDeleted(it.id); ui.lastNewId = null; closeDrawer(); return;
  }
  const flt = e.target.closest('[data-filter]');
  if (flt) { ui.noteLabel = ui.noteLabel === flt.dataset.filter ? '' : flt.dataset.filter; return renderNotes(); }
  const act = e.target.closest('[data-act]');
  const noteEl = e.target.closest('.note');
  if (act && noteEl) {
    const n = it.notes.find(x => x.id === noteEl.dataset.nid);
    if (act.dataset.act === 'del') {
      if (!confirm('Delete this note?')) return;
      it.notes = it.notes.filter(x => x !== n); touch(it); renderNotes(); renderAll();
    } else if (act.dataset.act === 'edit') editNote(n.id);
    else if (act.dataset.act === 'cancel') renderNotes();
    else if (act.dataset.act === 'save') {
      const t = noteEl.querySelector('textarea').value.trim();
      if (t) { n.text = t; n.label = noteEl.querySelector('select').value; touch(it); }
      renderNotes(); renderAll();
    }
  }
});

/* ---------- data menu ---------- */

$('#btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pmo-hub-${todayStr()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('#btn-import').addEventListener('click', () => $('#file-import').click());
$('#file-import').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const s = JSON.parse(await f.text());
    if (!s || !Array.isArray(s.items)) throw new Error('bad shape');
    if (!confirm(`Replace current data with ${s.items.length} imported entries?`)) return;
    state = normalise(s); save(); renderAll();
  } catch (err) { alert('That file is not a valid PMO Hub export.'); }
});
$('#btn-sample').addEventListener('click', () => {
  if (state.items.length && !confirm('Replace current data with sample data?')) return;
  state = seed(); save(); renderAll();
});
$('#btn-clear').addEventListener('click', () => {
  if (!confirm('Delete all entries and notes? Export first if you want a backup.')) return;
  state = { items: [], labels: DEFAULT_LABELS.slice() }; save(); renderAll();
});
document.addEventListener('click', e => {
  const m = $('.menu'); if (m.open && !m.contains(e.target)) m.open = false;
  if (e.target.closest('.menu-pop button')) m.open = false;
});

init();
})();
