(() => {
'use strict';

const KEY = 'pmo-hub-v1';
const DAY = 86400000;
const STALE_DAYS = 14;

/* ---------- status & labels ---------- */

const STATUSES = {
  offtrack:   { label: 'Off track',   color: 'var(--red)',   rank: 0 },
  atrisk:     { label: 'At risk',     color: 'var(--amber)', rank: 1 },
  ontrack:    { label: 'On track',    color: 'var(--green)', rank: 2 },
  onhold:     { label: 'On hold',     color: 'var(--blue)',  rank: 3 },
  notstarted: { label: 'Not started', color: 'var(--grey)',  rank: 4 },
  done:       { label: 'Done',        color: 'var(--done)',  rank: 5 },
};

// Each status has its own glyph so it never relies on colour alone.
const GLYPH = {
  offtrack:   '<circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M5.3 5.3l5.4 5.4M10.7 5.3l-5.4 5.4" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>',
  atrisk:     '<path d="M8 1.2l7 12.6H1z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M8 6v3.6M8 11.4v.2" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/>',
  ontrack:    '<circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M4.8 8.2l2.3 2.3 4.2-4.6" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  onhold:     '<circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M6.2 5.2v5.6M9.8 5.2v5.6" stroke="#fff" stroke-width="1.9" stroke-linecap="round"/>',
  notstarted: '<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-dasharray="2.4 2"/>',
  done:       '<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 8.2l2.2 2.2 3.8-4.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
};

const DEFAULT_LABELS = ['Update', 'Decision', 'Risk', 'Blocker', 'Action', 'Question', 'FYI'];
const LABEL_COLORS = {
  Update: '#3b82c4', Decision: '#7a5af8', Risk: '#e0a100', Blocker: '#d6403a',
  Action: '#2f9e5b', Question: '#c4467d', FYI: '#667085',
};

function statusIcon(s, size = 18) {
  const st = STATUSES[s] || STATUSES.notstarted;
  return `<span class="sic" style="color:${st.color}" title="${st.label}" role="img" aria-label="${st.label}">` +
    `<svg width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true">${GLYPH[s] || GLYPH.notstarted}</svg></span>`;
}

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

let state = load() || seed();
const ui = { q: '', team: '', label: '', sort: 'attention', showDone: true, status: '', range: 'auto', openId: null, noteLabel: '' };

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.items)) return normalise(s);
  } catch (e) { /* storage unavailable or corrupt */ }
  return null;
}
function normalise(s) {
  const labels = Array.isArray(s.labels) ? s.labels.slice() : DEFAULT_LABELS.slice();
  for (const it of s.items) {
    it.notes = Array.isArray(it.notes) ? it.notes : [];
    for (const n of it.notes) if (n.label && !labels.includes(n.label)) labels.push(n.label);
  }
  return { items: s.items, labels };
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}

function blankItem(over = {}) {
  const now = new Date().toISOString();
  return Object.assign({
    id: uid(), type: 'project', parentId: null, name: '', team: '', status: 'notstarted',
    start: '', end: '', summary: '', details: '', notes: [], createdAt: now, updatedAt: now,
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
  const erp = mk({ name: 'ERP migration', team: 'Finance Systems', status: 'atrisk', start: d(-120), end: d(150),
    summary: 'Cutover date holding, but data-mapping sign-off is late.',
    details: 'Sponsor: CFO. Vendor is running two workstreams in parallel.\n\nKey dependency: finance sign-off on chart-of-accounts mapping before UAT can start.' },
    [[2, 'Risk', 'Mapping sign-off now 2 weeks late. If not signed by month end UAT slips into the freeze window.'],
     [9, 'Decision', 'Agreed to keep big-bang cutover rather than phase by entity.'],
     [20, 'Update', 'Vendor confirmed second environment is ready.']]);
  const erpData = mk({ name: 'Data mapping sign-off', type: 'track', parentId: erp.id, team: 'Finance', status: 'offtrack', start: d(-40), end: d(-5),
    summary: 'Waiting on Finance controller review.' },
    [[3, 'Blocker', 'Controller out until next week; asked deputy to review in the meantime.']]);
  const erpUat = mk({ name: 'UAT & cutover rehearsal', type: 'track', parentId: erp.id, team: 'QA / Finance', status: 'notstarted', start: d(10), end: d(80),
    summary: 'Starts once mapping is signed off.' });
  const sec = mk({ name: 'Zero-trust network rollout', team: 'Infrastructure', status: 'ontrack', start: d(-60), end: d(90),
    summary: 'Phase 1 (HQ) complete, branch sites next.' },
    [[6, 'Update', 'HQ cutover finished with no major incidents.'], [30, 'Decision', 'Branch rollout to be done by region, EMEA first.']]);
  const vendor = mk({ name: 'Cloud vendor contract renewal', type: 'track', team: 'Procurement', status: 'atrisk', start: d(-14), end: d(35),
    summary: 'Pricing discussion open; they want 3-year commit.' },
    [[1, 'Question', 'Can we get a 2-year term with the same discount? Procurement to ask.'], [12, 'Action', 'Send usage forecast to vendor.']]);
  const helpdesk = mk({ name: 'Service desk tooling review', type: 'track', team: 'End User Services', status: 'onhold', start: d(-30), end: d(60),
    summary: 'Paused until budget cycle completes.' },
    [[25, 'Decision', 'Pause until FY budget is confirmed.']]);
  const mfa = mk({ name: 'MFA for contractors', team: 'Security', status: 'done', start: d(-90), end: d(-12), summary: 'Completed; 98% enrolled.' },
    [[12, 'Update', 'Closed out. Remaining accounts are dormant and will be disabled.']]);
  const dr = mk({ name: 'DR test — Q1', team: 'Infrastructure', status: 'notstarted', start: d(120), end: d(150), summary: 'Scope to be agreed with app owners.' });
  return { items: [erp, erpData, erpUat, sec, vendor, helpdesk, mfa, dr], labels: DEFAULT_LABELS.slice() };
}

const byId = id => state.items.find(i => i.id === id);
const hasChildren = id => state.items.some(i => i.parentId === id);
const lastNote = it => it.notes.length ? it.notes.reduce((a, b) => (a.at > b.at ? a : b)) : null;

function touch(it) { it.updatedAt = new Date().toISOString(); save(); }

/* ---------- filtering / ordering ---------- */

function matches(it) {
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
  state.items.forEach(i => { counts[i.status] = (counts[i.status] || 0) + 1; });
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
  $('#count').textContent = `${rows.length} of ${state.items.length}`;
  if (!state.items.length) { $('#list').innerHTML = `<div class="empty">Nothing here yet. Add your first entry with “+ New entry”.</div>`; return; }
  if (!rows.length) { $('#list').innerHTML = `<div class="empty">No entries match the current filters.</div>`; return; }
  $('#list').innerHTML = rows.map(({ it, child }) => {
    const n = lastNote(it);
    const parent = it.parentId && !child ? byId(it.parentId) : null;
    const stale = it.status !== 'done' && it.status !== 'notstarted' && ageDays(it.updatedAt) > STALE_DAYS;
    return `<div class="row${child ? ' child' : ''}" data-id="${it.id}" tabindex="0" role="button">
      <div>${statusIcon(it.status)}</div>
      <div><div class="name">${esc(it.name || 'Untitled')}</div>
        <div class="sub"><span class="tag">${it.type === 'track' ? 'Track' : 'Project'}</span>${it.team ? esc(it.team) : ''}${parent ? ` · in ${esc(parent.name)}` : ''}</div></div>
      <div class="clamp">${it.summary ? esc(it.summary) : '<span class="muted">No summary yet</span>'}</div>
      <div class="dates">${dateInfo(it)}</div>
      <div>${n ? `${chip(n.label || 'Note')} <span class="muted">${ago(n.at)}</span><div class="clamp muted">${esc(n.text)}</div>` : '<span class="muted">No notes</span>'}
        ${stale ? `<div class="stale">No update in ${ageDays(it.updatedAt)}d</div>` : ''}</div>
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
  renderDrawer();
  $('#drawer').hidden = false; $('#scrim').hidden = false;
  if (focusName) { const n = $('#d-name'); n.focus(); n.select(); }
}
function closeDrawer() {
  ui.openId = null;
  $('#drawer').hidden = true; $('#scrim').hidden = true;
  cleanupBlank();
  renderAll();
}
// Drop a just-created entry that was never filled in.
function cleanupBlank() {
  const before = state.items.length;
  state.items = state.items.filter(i => i.name || i.summary || i.details || i.notes.length || i.team || i.start || i.end || i.status !== 'notstarted' || i.id !== ui.lastNewId);
  if (state.items.length !== before) save();
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
      <button id="d-close" aria-label="Close">✕</button>
    </div>
    <div class="grid2">
      <label>Type<select data-f="type">
        <option value="project"${it.type === 'project' ? ' selected' : ''}>Project</option>
        <option value="track"${it.type === 'track' ? ' selected' : ''}>Track (major item)</option></select></label>
      <label>Status<select data-f="status">${Object.entries(STATUSES).map(([k, v]) => `<option value="${k}"${it.status === k ? ' selected' : ''}>${v.label}</option>`).join('')}</select></label>
      <label>Team / owner<input data-f="team" value="${esc(it.team)}" list="teams" placeholder="e.g. Infrastructure"></label>
      <label>Part of<select data-f="parentId"${canNest ? '' : ' disabled'}>
        <option value="">— standalone —</option>${parents.map(p => `<option value="${p.id}"${it.parentId === p.id ? ' selected' : ''}>${esc(p.name || 'Untitled')}</option>`).join('')}</select></label>
      <label>Start<input type="date" data-f="start" value="${esc(it.start)}"></label>
      <label>End<input type="date" data-f="end" value="${esc(it.end)}"></label>
      <label class="field full">Where it stands (one line)<input data-f="summary" maxlength="160" value="${esc(it.summary)}" placeholder="The one thing you need to know right now"></label>
    </div>
    <datalist id="teams">${[...new Set(state.items.map(i => i.team).filter(Boolean))].map(t => `<option value="${esc(t)}">`).join('')}</datalist>
    <div class="d-section">
      <h3>Detailed notes</h3>
      <textarea data-f="details" rows="6" placeholder="Background, stakeholders, context — anything you want kept with this entry">${esc(it.details)}</textarea>
    </div>
    <div class="d-section">
      <h3>Notes log</h3>
      <div class="composer">
        <textarea id="n-text" rows="3" placeholder="Add a note…  (Ctrl/⌘+Enter to save)"></textarea>
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
  state.labels.push(name); save();
  return name;
}

/* ---------- events ---------- */

function renderAll() {
  renderStats(); renderFilters(); renderList(); renderGantt();
}

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
$('#list').addEventListener('click', openFrom);
$('#list').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { if (e.target.matches('.row')) { e.preventDefault(); openFrom(e); } } });
$('#gantt').addEventListener('click', openFrom);

$('#btn-new').addEventListener('click', () => {
  const it = blankItem();
  state.items.push(it); save();
  ui.lastNewId = it.id;
  openDrawer(it.id, true);
});
$('#scrim').addEventListener('click', closeDrawer);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && ui.openId) closeDrawer(); });

const drawer = $('#drawer');
drawer.addEventListener('input', e => {
  const it = byId(ui.openId); if (!it) return;
  if (e.target.id === 'd-name') { it.name = e.target.value; touch(it); renderList(); renderGantt(); return; }
  const f = e.target.dataset.f;
  if (f && ['summary', 'details', 'team'].includes(f)) { it[f] = e.target.value; touch(it); refreshSoft(); }
});
drawer.addEventListener('change', e => {
  const it = byId(ui.openId); if (!it) return;
  const f = e.target.dataset.f;
  if (f && !['summary', 'details', 'team'].includes(f)) {
    let v = e.target.value;
    if (f === 'parentId') v = v || null;
    it[f] = v;
    if ((f === 'start' || f === 'end') && it.start && it.end && it.end < it.start) {
      // keep the range sensible: move the other date along
      if (f === 'start') { it.end = it.start; } else { it.start = it.end; }
      renderDrawer();
    }
    touch(it);
    if (f === 'status') $('#d-icon').innerHTML = statusIcon(it.status, 24);
    renderAll();
  } else if (f === 'team') { renderAll(); }
  if (e.target.id === 'n-label' && e.target.value === '__new') {
    const l = newLabel();
    renderDrawerKeepComposer(l);
  }
});
function refreshSoft() { renderStats(); renderList(); renderGantt(); }
function renderDrawerKeepComposer(label) {
  const text = $('#n-text').value;
  renderDrawer();
  $('#n-text').value = text;
  if (label) $('#n-label').value = label;
  $('#n-text').focus();
}
drawer.addEventListener('keydown', e => {
  if (e.target.id === 'n-text' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addNote(); }
});
drawer.addEventListener('click', e => {
  const it = byId(ui.openId); if (!it) return;
  if (e.target.closest('#d-close')) return closeDrawer();
  if (e.target.closest('#n-add')) return addNote();
  if (e.target.closest('#d-delete')) {
    if (!confirm(`Delete “${it.name || 'Untitled'}” and all its notes?`)) return;
    state.items = state.items.filter(i => i.id !== it.id);
    state.items.forEach(i => { if (i.parentId === it.id) i.parentId = null; });
    save(); ui.lastNewId = null; closeDrawer(); return;
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

renderAll();
})();
