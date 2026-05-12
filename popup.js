/**
 * Inkwell - Digital Heirloom Stationery
 * Production Core Logic v2.1
 */

// --- Constants & Global Configuration ---
const CONFIG = {
  DEBOUNCE_DELAY: 1000,
  MAX_CHARS: 50000,
  KEYS: {
    CURRENT_NOTE: 'inkwell_current_note',
    ALL_NOTES: 'inkwell_all_notes',
    SETTINGS: 'inkwell_settings',
    SIDEBAR_STATE: 'inkwell_sidebar_collapsed'
  },
  DEFAULTS: {
    PAPER_STYLE: 'ruled',
    FONT: 'playfair',
    FONT_SIZE: '1.75rem',
    INK_COLOR: '#1a1b1e'
  }
};

// --- App State ---
const state = {
  currentNoteId: null,
  saveTimeout: null,
  isSidebarCollapsed: false
};

// --- DOM Cache ---
const dom = {
  editor: document.getElementById('note-editor'),
  saveStatus: document.getElementById('save-status'),
  sidebar: document.getElementById('sidebar'),
  newNoteBtn: document.getElementById('new-note-btn'),
  listBtn: document.getElementById('list-btn'),
  settingsBtn: document.getElementById('settings-btn'),
  writeBtn: document.getElementById('write-btn'),
  toggleSidebarBtn: document.getElementById('toggle-sidebar'),
  boldBtn: document.getElementById('bold-btn'),
  italicBtn: document.getElementById('italic-btn'),
  checkBtn: document.getElementById('check-btn'),
  deleteBtn: document.getElementById('delete-btn'),
  clearArchiveBtn: document.getElementById('clear-archive-btn'),
  archiveOverlay: document.getElementById('archive-overlay'),
  settingsOverlay: document.getElementById('settings-overlay'),
  notesList: document.getElementById('notes-list'),
  archiveSearch: document.getElementById('archive-search'),
  paperSheet: document.querySelector('.paper-sheet'),
  paperStyleOptions: document.getElementById('paper-style-options'),
  fontOptions: document.getElementById('font-options'),
  fontSizeOptions: document.getElementById('font-size-options'),
  inkColorOptions: document.getElementById('ink-color-options')
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', init);

async function init() {
  if (typeof lucide !== 'undefined') lucide.createIcons();
  
  await Promise.all([
    loadSettings(),
    loadNote(),
    loadSidebarState()
  ]);
  
  registerEventListeners();
  setupKeyboardShortcuts();
}

// --- Event Management ---
function registerEventListeners() {
  // Input tracking
  dom.editor.addEventListener('input', handleEditorInput);
  dom.editor.addEventListener('blur', () => saveNote(true));
  
  // Interactive elements
  dom.editor.addEventListener('click', handleEditorInteraction);

  // Formatting & Actions
  dom.boldBtn.addEventListener('click', () => execFormat('bold'));
  dom.italicBtn.addEventListener('click', () => execFormat('italic'));
  dom.checkBtn.addEventListener('click', insertChecklistItem);
  dom.deleteBtn.addEventListener('click', deleteCurrentNote);

  // Navigation
  dom.newNoteBtn.addEventListener('click', startNewNote);
  dom.listBtn.addEventListener('click', toggleArchiveOverlay);
  dom.settingsBtn.addEventListener('click', toggleSettingsOverlay);
  dom.writeBtn.addEventListener('click', () => { closeAllOverlays(); dom.editor.focus(); });
  dom.toggleSidebarBtn.addEventListener('click', toggleSidebarState);

  // Overlays
  document.querySelectorAll('.close-overlay').forEach(btn => {
    btn.addEventListener('click', closeAllOverlays);
  });

  // Settings Tiling
  bindSettingGroup(dom.paperStyleOptions, (v) => { updatePaperVisuals(v); saveSettings(); });
  bindSettingGroup(dom.fontOptions, (v) => { updateTypography(v); saveSettings(); });
  bindSettingGroup(dom.fontSizeOptions, (v) => { updateFontSize(v); saveSettings(); });
  bindSettingGroup(dom.inkColorOptions, (v) => { updateInkColor(v); saveSettings(); });

  // Archive Features
  dom.clearArchiveBtn.addEventListener('click', handleClearArchive);
  dom.archiveSearch.addEventListener('input', (e) => renderNotes(e.target.value));

  // Exit Guard
  window.addEventListener('beforeunload', () => saveNote(true));
}

// --- Primary Logic ---

function handleEditorInput() {
  const innerText = dom.editor.innerText;
  
  if (innerText.length > CONFIG.MAX_CHARS) {
    dom.editor.innerText = innerText.substring(0, CONFIG.MAX_CHARS);
    notifyStatus('CHARACTER LIMIT REACHED');
    return;
  }

  // Visual Cleanup
  if (innerText.trim() === '' && dom.editor.innerHTML !== '') {
    dom.editor.innerHTML = '';
  }

  notifyStatus('SAVING...', true);
  clearTimeout(state.saveTimeout);
  state.saveTimeout = setTimeout(saveNote, CONFIG.DEBOUNCE_DELAY);

  syncScrollWithCursor();
}

function handleEditorInteraction(e) {
  if (e.target.classList.contains('inkwell-checkbox')) {
    e.target.innerHTML = e.target.innerHTML === '☐ ' ? '☑ ' : '☐ ';
    saveNote(true);
  }
}

async function saveNote(isImmediate = false) {
  if (!state.currentNoteId) return;

  try {
    const rawContent = dom.editor.innerHTML;
    const formattedDate = new Date().toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric'
    });

    const noteRecord = {
      id: state.currentNoteId,
      content: rawContent, // In production, consider a lightweight DOM sanitizer here
      date: formattedDate,
      preview: dom.editor.innerText.substring(0, 100).replace(/\n/g, ' ') || 'New entry...',
      timestamp: Date.now()
    };

    // Parallel Update: Active & Archive
    const { [CONFIG.KEYS.ALL_NOTES]: allNotes = [] } = await chrome.storage.local.get([CONFIG.KEYS.ALL_NOTES]);
    const updatedNotes = [noteRecord, ...allNotes.filter(n => n.id !== state.currentNoteId)].slice(0, 100);

    await chrome.storage.local.set({
      [CONFIG.KEYS.CURRENT_NOTE]: noteRecord,
      [CONFIG.KEYS.ALL_NOTES]: updatedNotes
    });

    if (!isImmediate) notifyStatus('ALL CHANGES SAVED');
  } catch (err) {
    notifyStatus('STORAGE ERROR - RETRYING');
    console.error('Storage error:', err);
  }
}

async function loadNote() {
  const { [CONFIG.KEYS.CURRENT_NOTE]: note } = await chrome.storage.local.get([CONFIG.KEYS.CURRENT_NOTE]);
  if (note) {
    state.currentNoteId = note.id;
    dom.editor.innerHTML = note.content;
  } else {
    resetToNewNote();
  }
}

function startNewNote() {
  if (dom.editor.innerText.trim() !== '' && !confirm('Discard current note?')) return;
  resetToNewNote();
}

function resetToNewNote() {
  closeAllOverlays();
  state.currentNoteId = crypto.randomUUID();
  dom.editor.innerHTML = '';
  saveNote(true);
  updateActiveNavItem(dom.newNoteBtn);
  dom.editor.focus();
}

async function deleteCurrentNote() {
  if (!confirm('Permanently delete this note?')) return;
  try {
    const { [CONFIG.KEYS.ALL_NOTES]: allNotes = [] } = await chrome.storage.local.get([CONFIG.KEYS.ALL_NOTES]);
    const filtered = allNotes.filter(n => n.id !== state.currentNoteId);
    await chrome.storage.local.set({ [CONFIG.KEYS.ALL_NOTES]: filtered });
    await chrome.storage.local.remove(CONFIG.KEYS.CURRENT_NOTE);
    resetToNewNote();
    renderNotes();
  } catch (err) {
    notifyStatus('DELETE FAILED');
  }
}

// --- Archive & UI Sync ---

async function renderNotes(filterStr = '') {
  const { [CONFIG.KEYS.ALL_NOTES]: notes = [] } = await chrome.storage.local.get([CONFIG.KEYS.ALL_NOTES]);
  let filtered = notes;

  if (filterStr) {
    const query = filterStr.toLowerCase();
    filtered = notes.filter(n => 
      n.content.toLowerCase().includes(query) || 
      n.preview.toLowerCase().includes(query)
    );
  }

  if (filtered.length === 0) {
    dom.notesList.innerHTML = `<div class="empty-placeholder">${filterStr ? 'No matches found.' : 'Your archive is empty.'}</div>`;
    return;
  }

  dom.notesList.innerHTML = filtered.map(n => `
    <div class="note-item ${n.id === state.currentNoteId ? 'active' : ''}" data-id="${n.id}">
      <div class="note-preview">${n.preview}</div>
      <div class="note-date">${n.date}</div>
    </div>
  `).join('');

  // Performance-friendly delegation
  dom.notesList.onclick = (e) => {
    const item = e.target.closest('.note-item');
    if (item) switchNote(item.dataset.id, filtered);
  };
}

async function switchNote(id, source) {
  const selected = source.find(n => n.id === id);
  if (selected) {
    state.currentNoteId = selected.id;
    dom.editor.innerHTML = selected.content;
    await chrome.storage.local.set({ [CONFIG.KEYS.CURRENT_NOTE]: selected });
    closeAllOverlays();
    updateActiveNavItem(dom.newNoteBtn);
    dom.editor.focus();
  }
}

async function handleClearArchive() {
  if (!confirm('DELETE ENTIRE ARCHIVE? This is permanent.')) return;
  await chrome.storage.local.set({ [CONFIG.KEYS.ALL_NOTES]: [] });
  renderNotes();
  notifyStatus('ARCHIVE WIPED');
}

// --- UX Helpers ---

function notifyStatus(msg, isSaving = false) {
  dom.saveStatus.textContent = msg;
  const icon = document.querySelector('.check-icon');
  if (icon) icon.style.opacity = isSaving ? '0.3' : '1';
  dom.saveStatus.style.opacity = isSaving ? '0.5' : '1';
}

function execFormat(cmd) {
  document.execCommand(cmd, false, null);
  dom.editor.focus();
}

function insertChecklistItem() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const box = document.createElement('span');
  box.className = 'inkwell-checkbox';
  box.innerHTML = '☐ ';
  box.contentEditable = 'false';
  range.insertNode(box);
  range.setStartAfter(box);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  saveNote(true);
}

function syncScrollWithCursor() {
  const sel = window.getSelection();
  if (sel.rangeCount > 0) {
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const container = document.querySelector('.main-content');
    const threshold = window.innerHeight - 150;
    if (rect.bottom > threshold) {
      container.scrollBy({ top: rect.bottom - threshold + 60, behavior: 'smooth' });
    }
  }
}

// --- Navigation & States ---

function toggleSidebarState() {
  dom.sidebar.classList.toggle('collapsed');
  state.isSidebarCollapsed = dom.sidebar.classList.contains('collapsed');
  chrome.storage.local.set({ [CONFIG.KEYS.SIDEBAR_STATE]: state.isSidebarCollapsed });
}

async function loadSidebarState() {
  const { [CONFIG.KEYS.SIDEBAR_STATE]: isCollapsed } = await chrome.storage.local.get([CONFIG.KEYS.SIDEBAR_STATE]);
  if (isCollapsed) dom.sidebar.classList.add('collapsed');
  state.isSidebarCollapsed = !!isCollapsed;
}

function toggleArchiveOverlay() {
  const isHidden = dom.archiveOverlay.classList.contains('hidden');
  closeAllOverlays();
  if (isHidden) {
    renderNotes();
    dom.archiveOverlay.classList.remove('hidden');
    updateActiveNavItem(dom.listBtn);
  }
}

function toggleSettingsOverlay() {
  const isHidden = dom.settingsOverlay.classList.contains('hidden');
  closeAllOverlays();
  if (isHidden) {
    dom.settingsOverlay.classList.remove('hidden');
    updateActiveNavItem(dom.settingsBtn);
  }
}

function closeAllOverlays() {
  dom.archiveOverlay.classList.add('hidden');
  dom.settingsOverlay.classList.add('hidden');
  updateActiveNavItem(dom.newNoteBtn);
}

function updateActiveNavItem(el) {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
}

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) {
      if (e.key === 'Escape') closeAllOverlays();
      return;
    }
    const key = e.key.toLowerCase();
    if (key === 'n') { e.preventDefault(); startNewNote(); }
    if (key === 'l') { e.preventDefault(); toggleArchiveOverlay(); }
    if (key === 'p') { e.preventDefault(); toggleSettingsOverlay(); }
    if (key === 's') { e.preventDefault(); saveNote(true); }
  });
}

// --- Preferences Implementation ---

function bindSettingGroup(container, onUpdate) {
  container.addEventListener('click', (e) => {
    const tile = e.target.closest('.option-tile');
    if (!tile) return;
    container.querySelectorAll('.option-tile').forEach(t => t.classList.remove('active'));
    tile.classList.add('active');
    onUpdate(tile.dataset.value);
  });
}

function saveSettings() {
  const s = {
    paperStyle: dom.paperStyleOptions.querySelector('.active').dataset.value,
    font: dom.fontOptions.querySelector('.active').dataset.value,
    fontSize: dom.fontSizeOptions.querySelector('.active').dataset.value,
    inkColor: dom.inkColorOptions.querySelector('.active').dataset.value
  };
  chrome.storage.local.set({ [CONFIG.KEYS.SETTINGS]: s });
}

async function loadSettings() {
  const { [CONFIG.KEYS.SETTINGS]: s = CONFIG.DEFAULTS } = await chrome.storage.local.get([CONFIG.KEYS.SETTINGS]);
  updatePaperVisuals(s.paperStyle);
  updateTypography(s.font);
  updateFontSize(s.fontSize);
  updateInkColor(s.inkColor);
  
  // Sync UI Tiles
  syncTiles(dom.paperStyleOptions, s.paperStyle);
  syncTiles(dom.fontOptions, s.font);
  syncTiles(dom.fontSizeOptions, s.fontSize);
  syncTiles(dom.inkColorOptions, s.inkColor);
}

function syncTiles(container, val) {
  container.querySelectorAll('.option-tile').forEach(t => t.classList.toggle('active', t.dataset.value === val));
}

function updatePaperVisuals(style) {
  dom.paperSheet.style.backgroundImage = 'none';
  if (style === 'ruled') {
    dom.paperSheet.style.backgroundImage = 'linear-gradient(rgba(197, 163, 104, 0.18) 1px, transparent 1px)';
    dom.paperSheet.style.backgroundSize = '100% 36px';
  } else if (style === 'grid') {
    dom.paperSheet.style.backgroundImage = 'linear-gradient(rgba(197, 163, 104, 0.18) 1px, transparent 1px), linear-gradient(90deg, rgba(197, 163, 104, 0.18) 1px, transparent 1px)';
    dom.paperSheet.style.backgroundSize = '36px 36px, 36px 36px';
  }
}

function updateTypography(font) {
  dom.editor.style.fontFamily = font === 'caveat' ? "'Caveat', cursive" : 'var(--font-serif)';
  dom.editor.style.fontStyle = font === 'caveat' ? 'normal' : 'italic';
}

function updateFontSize(size) {
  dom.editor.style.fontSize = size;
  dom.editor.style.lineHeight = '36px';
  dom.editor.style.paddingTop = '8px';
}

function updateInkColor(color) {
  dom.editor.style.color = color;
}
