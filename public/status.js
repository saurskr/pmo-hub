// Status definitions and icons, shared by the app and the sidebar.
(() => {
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
  offtrack:   '<circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M5.3 5.3l5.4 5.4M10.7 5.3l-5.4 5.4" class="cut" stroke-width="1.8" stroke-linecap="round"/>',
  atrisk:     '<path d="M8 1.2l7 12.6H1z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M8 6v3.6M8 11.4v.2" class="cut" stroke-width="1.7" stroke-linecap="round"/>',
  ontrack:    '<circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M4.8 8.2l2.3 2.3 4.2-4.6" fill="none" class="cut" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  onhold:     '<circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M6.2 5.2v5.6M9.8 5.2v5.6" class="cut" stroke-width="1.9" stroke-linecap="round"/>',
  notstarted: '<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-dasharray="2.4 2"/>',
  done:       '<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 8.2l2.2 2.2 3.8-4.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
};

function statusIcon(s, size = 18) {
  const st = STATUSES[s] || STATUSES.notstarted;
  return `<span class="sic" style="color:${st.color}" title="${st.label}" role="img" aria-label="${st.label}">` +
    `<svg width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true">${GLYPH[s] || GLYPH.notstarted}</svg></span>`;
}

window.PMOStatus = { STATUSES, statusIcon };
})();
