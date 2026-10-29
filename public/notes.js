// Notes: a month calendar plus a day-by-day diary of general notes. Each person's notes are private to them.
(() => {
  'use strict';
  const { labelColor } = window.PMOStatus;
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const pad = n => String(n).padStart(2, '0');
  const ymd = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const fromYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const dateStr = d => ymd(d.getFullYear(), d.getMonth(), d.getDate());
  const todayStr = () => dateStr(new Date());
  const LABELS = ['Idea', 'Decision', 'Follow-up', 'Reminder', 'Personal']; // the meeting itself has its own field

  // Week starts on the viewer's locale default (Monday if the browser can't say).
  const firstDay = (() => {
    try {
      const loc = new Intl.Locale(navigator.language);
      const wi = loc.weekInfo || (loc.getWeekInfo && loc.getWeekInfo());
      if (wi && wi.firstDay) return wi.firstDay % 7; // 1 = Monday … 7 = Sunday  →  JS: 0 = Sunday
    } catch (e) { /* fall through */ }
    return 1;
  })();

  let notes = [];
  let selected = /^\d{4}-\d{2}-\d{2}$/.test(location.hash.slice(1)) ? location.hash.slice(1) : todayStr();
  let view = { y: fromYmd(selected).getFullYear(), m: fromYmd(selected).getMonth() };
  let query = '';
  let editingId = null;
  let draft = { text: '', label: '', meeting: '' };
  let meetingView = ''; // when set, show every note for that meeting instead of a single day
  let error = '';

  /* ---------- server ---------- */

  function setStatus(kind, detail) {
    const el = $('#save-status');
    el.dataset.kind = kind;
    el.textContent = { loading: 'Loading…', saving: 'Saving…', saved: 'Saved', error: 'Not saved' }[kind] || '';
    el.title = detail || '';
  }
  async function api(method, path, body) {
    return window.pmoApi(method, path, body);
  }
  // Wait for the server before changing the screen, so what you see is what was saved.
  async function save(change) {
    setStatus('saving'); error = '';
    try { await api('POST', '/api/journal/sync', change); setStatus('saved'); return true; }
    catch (e) { error = e.message; setStatus('error', e.message); return false; }
  }

  /* ---------- helpers ---------- */

  const byDate = () => {
    const m = new Map();
    for (const n of notes) { if (!m.has(n.date)) m.set(n.date, []); m.get(n.date).push(n); }
    return m;
  };
  const longDate = s => fromYmd(s).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const shortDate = s => fromYmd(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const mkey = s => String(s || '').trim().toLowerCase();
  // Meeting names you've used before, most recently used first, for the suggestion list.
  function meetingNames() {
    const seen = new Map();
    for (const n of notes.slice().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))) {
      if (n.meeting && !seen.has(mkey(n.meeting))) seen.set(mkey(n.meeting), n.meeting);
    }
    return [...seen.values()];
  }
  const meetingOptions = () => `<datalist id="meetings">${meetingNames().map(m => `<option value="${esc(m)}">`).join('')}</datalist>`;
  const meetingBtn = n => (n.meeting ? `<button class="mtg" data-meeting="${esc(n.meeting)}" title="Show all notes for this meeting">${esc(n.meeting)}</button>` : '');
  const chip = l => (l ? `<span class="chip" style="--c:${labelColor(l)}">${esc(l)}</span>` : '');

  // A diary entry shows its time if it was written on the day it belongs to, otherwise when it was added.
  function whenText(n) {
    const created = new Date(n.createdAt);
    if (dateStr(created) === n.date) return created.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `added ${shortDate(dateStr(created))}`;
  }

  function select(date, focus = false) {
    selected = date; editingId = null; error = ''; meetingView = '';
    const d = fromYmd(date);
    view = { y: d.getFullYear(), m: d.getMonth() };
    history.replaceState(null, '', location.pathname + (date === todayStr() ? '' : '#' + date));
    renderCalendar(); renderDay();
    if (focus) { const b = $(`[data-date="${date}"]`); if (b) b.focus(); }
  }

  /* ---------- calendar ---------- */

  function renderCalendar() {
    const counts = byDate();
    const first = new Date(view.y, view.m, 1);
    $('#cal-title').textContent = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const offset = (first.getDay() - firstDay + 7) % 7;
    const wd = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(2023, 0, 1 + ((firstDay + i) % 7)); // 1 Jan 2023 was a Sunday
      return `<div class="cal-wd" aria-hidden="true">${d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2)}</div>`;
    }).join('');
    const today = todayStr();
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = new Date(view.y, view.m, 1 - offset + i);
      const s = dateStr(d);
      const n = (counts.get(s) || []).length;
      const cls = ['cal-day', d.getMonth() !== view.m ? 'out' : '', s === today ? 'today' : '', s === selected ? 'sel' : ''].join(' ');
      const dots = n ? `<span class="cal-dots">${'<i></i>'.repeat(Math.min(n, 3))}</span>` : '<span class="cal-dots"></span>';
      cells += `<button class="${cls}" data-date="${s}" tabindex="${s === selected ? 0 : -1}" aria-pressed="${s === selected}" aria-label="${esc(longDate(s))}${n ? `, ${n} note${n > 1 ? 's' : ''}` : ''}">${d.getDate()}${dots}</button>`;
    }
    $('#cal-grid').innerHTML = wd + cells;
  }

  /* ---------- day (or search results) ---------- */

  function renderDay() {
    const body = $('#day-body');
    if (query) return renderSearch(body);
    if (meetingView) return renderMeeting(body);
    const list = (byDate().get(selected) || []).slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    $('#day-title').textContent = longDate(selected);
    $('#day-sub').textContent = (selected === todayStr() ? 'Today · ' : '') + `${list.length} note${list.length === 1 ? '' : 's'}`;
    body.innerHTML = `
      <div class="composer">
        <textarea id="n-text" rows="3" placeholder="Write a note for this day…  (Ctrl/⌘+Enter to save)">${esc(draft.text)}</textarea>
        <div class="bar">
          <input id="n-meeting" list="meetings" maxlength="200" autocomplete="off" placeholder="Meeting (optional)" aria-label="Meeting name" value="${esc(draft.meeting)}">
          <select id="n-label" aria-label="Label"><option value="">No label</option>${LABELS.map(l => `<option${draft.label === l ? ' selected' : ''}>${l}</option>`).join('')}</select>
          <button class="primary" id="n-add">Add note</button>
        </div>
        ${meetingOptions()}
      </div>
      ${error ? `<div class="err-msg" role="alert">Couldn't save: ${esc(error)}</div>` : ''}
      <div id="entries">${list.length ? list.map(entryHtml).join('') : '<div class="diary-empty">Nothing written for this day yet.</div>'}</div>`;
  }

  function entryHtml(n) {
    if (n.id === editingId) {
      return `<div class="entry" data-id="${n.id}">
        <textarea rows="4" id="e-text">${esc(n.text)}</textarea>
        <div class="bar" style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap">
          <input id="e-meeting" list="meetings" maxlength="200" autocomplete="off" placeholder="Meeting (optional)" aria-label="Meeting name" value="${esc(n.meeting)}">
          <select id="e-label"><option value="">No label</option>${[...new Set([...LABELS, n.label].filter(Boolean))].map(l => `<option${n.label === l ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
          <button class="primary" data-act="save">Save</button><button data-act="cancel">Cancel</button>
        </div>${meetingOptions()}</div>`;
    }
    return `<div class="entry" data-id="${n.id}">
      <div class="entry-head">${meetingBtn(n)}${chip(n.label)}<span>${esc(whenText(n))}</span><span class="sp"></span>
        <span class="entry-actions"><button data-act="edit">Edit</button><button data-act="del">Delete</button></span></div>
      <div class="entry-body">${esc(n.text)}</div></div>`;
  }

  function renderSearch(body) {
    const q = query.toLowerCase();
    const hits = notes.filter(n => n.text.toLowerCase().includes(q) || (n.label || '').toLowerCase().includes(q) || (n.meeting || '').toLowerCase().includes(q))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
    $('#day-title').textContent = 'Search results';
    $('#day-sub').textContent = `${hits.length}${hits.length === 100 ? '+' : ''} match${hits.length === 1 ? '' : 'es'} for “${query}”`;
    body.innerHTML = hits.length
      ? hits.map(n => `<button class="result" data-goto="${n.date}"><div class="when">${esc(longDate(n.date))} ${n.meeting ? `<span class="mtg-tag">${esc(n.meeting)}</span>` : ''} ${chip(n.label)}</div><div class="snip">${esc(n.text)}</div></button>`).join('')
      : '<div class="diary-empty">No notes match.</div>';
  }

  // Every note recorded against one meeting, newest first, so you can follow it over time.
  function renderMeeting(body) {
    const k = mkey(meetingView);
    const list = notes.filter(n => mkey(n.meeting) === k).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    const name = (list[0] && list[0].meeting) || meetingView;
    $('#day-title').textContent = name;
    $('#day-sub').textContent = list.length ? `${list.length} note${list.length === 1 ? '' : 's'} · ${shortDate(list[list.length - 1].date)} to ${shortDate(list[0].date)}` : 'No notes for this meeting';
    body.innerHTML = `<div><button data-act="close-meeting">← Back to ${esc(longDate(selected))}</button></div>` +
      (list.length ? list.map(n => `<button class="result" data-goto="${n.date}"><div class="when">${esc(longDate(n.date))} ${chip(n.label)}</div><div class="snip">${esc(n.text)}</div></button>`).join('') : '<div class="diary-empty">Nothing recorded yet.</div>');
  }

  /* ---------- actions ---------- */

  async function addNote() {
    const text = $('#n-text').value.trim();
    draft = { text: $('#n-text').value, label: $('#n-label').value, meeting: $('#n-meeting').value.trim() };
    if (!text) return;
    const now = new Date().toISOString();
    const note = { id: uid(), date: selected, label: draft.label, meeting: draft.meeting, text, createdAt: now, updatedAt: now };
    $('#n-add').disabled = true;
    if (await save({ upserts: [note] })) { notes.push(note); draft = { text: '', label: draft.label, meeting: draft.meeting }; renderCalendar(); } // keep the meeting for a run of notes from the same meeting
    renderDay();
    $('#n-text').focus();
  }

  async function saveEdit(id) {
    const n = notes.find(x => x.id === id);
    const text = $('#e-text').value.trim();
    if (!n || !text) return;
    const updated = { ...n, text, label: $('#e-label').value, meeting: $('#e-meeting').value.trim(), updatedAt: new Date().toISOString() };
    if (await save({ upserts: [updated] })) { Object.assign(n, updated); editingId = null; }
    renderDay();
  }

  async function deleteNote(id) {
    if (!confirm('Delete this note?')) return;
    if (await save({ deletes: [id] })) { notes = notes.filter(n => n.id !== id); renderCalendar(); }
    renderDay();
  }

  /* ---------- events ---------- */

  $('#cal-prev').addEventListener('click', () => { view = view.m === 0 ? { y: view.y - 1, m: 11 } : { y: view.y, m: view.m - 1 }; renderCalendar(); });
  $('#cal-next').addEventListener('click', () => { view = view.m === 11 ? { y: view.y + 1, m: 0 } : { y: view.y, m: view.m + 1 }; renderCalendar(); });
  $('#btn-today').addEventListener('click', () => { query = ''; $('#search').value = ''; select(todayStr(), true); });

  $('#cal-grid').addEventListener('click', e => {
    const b = e.target.closest('[data-date]');
    if (b) { query = ''; $('#search').value = ''; select(b.dataset.date); }
  });
  // Arrow keys move between days, as in a standard calendar grid.
  $('#cal-grid').addEventListener('keydown', e => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!step) return;
    e.preventDefault();
    const d = fromYmd(selected); d.setDate(d.getDate() + step);
    query = ''; $('#search').value = '';
    select(dateStr(d), true);
  });

  let searchTimer;
  $('#search').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { query = e.target.value.trim(); editingId = null; meetingView = ''; renderDay(); }, 150);
  });

  const body = $('#day-body');
  body.addEventListener('input', e => {
    if (e.target.id === 'n-text') draft.text = e.target.value;
    if (e.target.id === 'n-label') draft.label = e.target.value;
    if (e.target.id === 'n-meeting') draft.meeting = e.target.value;
  });
  body.addEventListener('keydown', e => {
    if (e.target.id === 'n-text' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addNote(); }
  });
  body.addEventListener('click', e => {
    const mt = e.target.closest('[data-meeting]');
    if (mt) { meetingView = mt.dataset.meeting; editingId = null; return renderDay(); }
    if (e.target.closest('[data-act="close-meeting"]')) { meetingView = ''; return renderDay(); }
    const go = e.target.closest('[data-goto]');
    if (go) { query = ''; $('#search').value = ''; return select(go.dataset.goto); }
    if (e.target.closest('#n-add')) return addNote();
    const act = e.target.closest('[data-act]');
    const entry = e.target.closest('.entry');
    if (!act || !entry) return;
    const id = entry.dataset.id;
    if (act.dataset.act === 'edit') { editingId = id; renderDay(); const t = $('#e-text'); if (t) t.focus(); }
    else if (act.dataset.act === 'cancel') { editingId = null; renderDay(); }
    else if (act.dataset.act === 'save') saveEdit(id);
    else if (act.dataset.act === 'del') deleteNote(id);
  });

  window.addEventListener('hashchange', () => {
    const h = location.hash.slice(1);
    if (/^\d{4}-\d{2}-\d{2}$/.test(h) && h !== selected) select(h);
  });

  /* ---------- start ---------- */

  (async () => {
    setStatus('loading');
    renderCalendar(); renderDay();
    try { notes = (await api('GET', '/api/journal')).notes; setStatus('saved'); }
    catch (e) { error = e.message; setStatus('error', e.message); body.innerHTML = `<div class="err-msg" role="alert">Couldn't load your notes: ${esc(e.message)}</div>`; return; }
    renderCalendar(); renderDay();
  })();
})();
