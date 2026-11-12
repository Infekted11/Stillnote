import stillnoteLogo from '../Stillnote-site/logo.svg';
import noteSyntaxGuide from '../electron/note-syntax.html?raw';
import { parseVaultLink, setVaultLinkPreviewSize, shouldRenderFileLink } from './vault-links.js';
import { createGraphPreview } from './graph-preview.js';
import { findReplaceExtension } from './find-replace.js';
import { fileDisplayName, fileDisplayParts } from './file-labels.js';
import { runHomeAgent } from './home-agent.js';
import { preparePdfContent } from './pdf-content.js';
import { createMediaPlayer, disposeMediaPlayers } from './media-player.js';
import { attachMediaResize } from './media-resize.js';
import { reorderSpreadsheet } from './spreadsheet.js';
import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor, rectangularSelection, crosshairCursor } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownKeymap } from '@codemirror/lang-markdown';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { Strikethrough, TaskList } from '@lezer/markdown';
import { searchKeymap, highlightSelectionMatches, openSearchPanel, closeSearchPanel, searchPanelOpen } from '@codemirror/search';
import { syntaxHighlighting, defaultHighlightStyle, syntaxTree, bracketMatching, foldGutter, indentOnInput, indentUnit } from '@codemirror/language';
import { animate } from 'animejs';
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './style.css';
import './window-controls.css';

const motionDuration = (milliseconds) => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 1 : milliseconds;

const refreshFileLinksEffect = StateEffect.define();
let vaultRenderRevision = 0, vaultCatalogSignature = null;
const spellingDecorationsEffect = StateEffect.define();
const spellingDecorationsField = StateField.define({
  create: () => Decoration.none,
  update(decorations, transaction) {
    decorations = decorations.map(transaction.changes);
    for (const effect of transaction.effects) if (effect.is(spellingDecorationsEffect)) decorations = effect.value;
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});
let dictionaryPromise = null;
let dictionary = null;
let customDictionary = new Set();
let customDictionarySavePromise = Promise.resolve();
let spellingTimer = null;
let spellingRequest = 0;
async function getSpellDictionary() {
  if (!dictionaryPromise) dictionaryPromise = window.stillnote.loadSpellcheckDictionary().then((text) => {
    dictionary = new Set(text.split(/\r?\n/).map((word) => word.trim().toLocaleLowerCase()).filter(Boolean));
    for (const word of dictionary) {
      if (!dictionaryByFirst.has(word[0])) dictionaryByFirst.set(word[0], []);
      if (!dictionaryByLast.has(word.at(-1))) dictionaryByLast.set(word.at(-1), []);
      dictionaryByFirst.get(word[0]).push(word); dictionaryByLast.get(word.at(-1)).push(word);
    }
    return dictionary;
  });
  return dictionaryPromise;
}
function scheduleSpellcheck(view) {
  const request = ++spellingRequest;
  clearTimeout(spellingTimer);
  spellingTimer = setTimeout(async () => {
    try {
      const words = await getSpellDictionary();
      if (request !== spellingRequest || view !== state.view) return;
      const text = view.state.doc.toString();
      const ignored = [];
      syntaxTree(view.state).iterate({ enter(node) { if (['FencedCode', 'InlineCode', 'LinkDestination'].includes(node.type.name)) ignored.push([node.from, node.to]); } });
      const marks = [];
      const matcher = /[\p{L}]+(?:['’][\p{L}]+)?/gu;
      let match;
      while ((match = matcher.exec(text))) {
        const word = match[0].toLocaleLowerCase();
        if (word.length < 3 || ignored.some(([from, to]) => match.index >= from && match.index < to)) continue;
        if (!isKnownWord(word)) {
          marks.push(Decoration.mark({ class: 'spellcheck-misspelled', attributes: { title: 'Possible spelling mistake' } }).range(match.index, match.index + match[0].length));
        }
      }
      if (request === spellingRequest && view === state.view) view.dispatch({ effects: spellingDecorationsEffect.of(Decoration.set(marks, true)) });
    } catch (error) { console.error('Spellcheck dictionary could not be loaded:', error); }
  }, 180);
}
function spellingSuggestions(word) {
  if (!dictionary || word.length < 3) return [];
  const normalized = word.toLocaleLowerCase();
  const candidates = new Set([...(dictionaryByFirst.get(normalized[0]) || []), ...(dictionaryByLast.get(normalized.at(-1)) || [])]);
  const ranked = [];
  for (const candidate of candidates) {
    if (Math.abs(candidate.length - normalized.length) > 2) continue;
    const distance = editDistanceAtMostTwo(normalized, candidate);
    if (distance <= 2) ranked.push({ candidate, distance });
  }
  return ranked.sort((a, b) => a.distance - b.distance || a.candidate.localeCompare(b.candidate)).slice(0, 5).map(({ candidate }) => candidate);
}
function normalizeCustomDictionary(words) {
  return new Set((Array.isArray(words) ? words : []).filter((word) => typeof word === 'string').map((word) => word.trim().toLocaleLowerCase()).filter((word) => /^[\p{L}][\p{L}'’\-]{0,63}$/u.test(word)));
}
async function loadCustomDictionaryForVault() {
  const saved = await window.stillnote.loadCustomDictionary();
  let words = saved.words;
  if (!saved.exists) {
    try {
      const legacyWords = normalizeCustomDictionary(JSON.parse(localStorage.getItem('stillnote-custom-dictionary') || '[]'));
      if (legacyWords.size) {
        words = [...legacyWords];
        await window.stillnote.saveCustomDictionary(words);
      }
      localStorage.removeItem('stillnote-custom-dictionary');
    } catch (error) {
      console.warn('Could not migrate the personal dictionary into this vault:', error.message);
    }
  } else {
    localStorage.removeItem('stillnote-custom-dictionary');
  }
  customDictionary = normalizeCustomDictionary(words);
  renderCustomDictionary();
  if (state.view) scheduleSpellcheck(state.view);
}
function persistCustomDictionary() {
  if (!state.vault) return Promise.reject(new Error('Open a vault before saving personal words.'));
  const words = [...customDictionary].sort((a, b) => a.localeCompare(b));
  customDictionarySavePromise = customDictionarySavePromise.catch(() => {}).then(() => window.stillnote.saveCustomDictionary(words));
  return customDictionarySavePromise.catch((error) => {
    showToast(error.message || 'Could not save the personal dictionary.');
    throw error;
  });
}
function addCustomWord(value) {
  if (!state.vault) { showToast('Open a vault before adding personal words.'); return false; }
  const word = String(value || '').trim().toLocaleLowerCase();
  if (!/^[\p{L}][\p{L}'’\-]{0,63}$/u.test(word)) { showToast('Enter a single word using letters, apostrophes, or hyphens.'); return false; }
  if (isKnownWord(word)) { showToast(`“${word}” is already in the dictionary.`); return false; }
  customDictionary.add(word); void persistCustomDictionary().catch(() => {}); renderCustomDictionary();
  if (state.view) scheduleSpellcheck(state.view);
  return true;
}
function renderCustomDictionary() {
  const list = $('#custom-dictionary-list');
  if (!list) return;
  list.replaceChildren();
  const words = [...customDictionary].sort((a, b) => a.localeCompare(b));
  if (!words.length) { const empty = document.createElement('p'); empty.className = 'dictionary-empty'; empty.textContent = 'No personal words yet.'; list.append(empty); return; }
  for (const word of words) {
    const row = document.createElement('div'); row.className = 'dictionary-word-row';
    const label = document.createElement('span'); label.textContent = word;
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'icon-button dictionary-remove'; remove.setAttribute('aria-label', `Remove ${word} from dictionary`); remove.title = 'Remove word'; remove.innerHTML = icons.close;
    remove.addEventListener('click', () => { customDictionary.delete(word); void persistCustomDictionary().catch(() => {}); renderCustomDictionary(); if (state.view) scheduleSpellcheck(state.view); });
    row.append(label, remove); list.append(row);
  }
}
function editDistanceAtMostTwo(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index), beforePrevious = null;
  for (let i = 1; i <= a.length; i++) {
    const current = [i]; let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      let value = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (beforePrevious && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, beforePrevious[j - 2] + 1);
      current[j] = value; rowMin = Math.min(rowMin, value);
    }
    if (rowMin > 2) return 3;
    beforePrevious = previous; previous = current;
  }
  return previous[b.length];
}
const dictionaryByFirst = new Map();
const dictionaryByLast = new Map();

const svgIcon = (paths, className = '') => `<svg class="app-icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
const icons = {
  panel: svgIcon('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M9 4.5v15"/>'),
  home: svgIcon('<path d="m3.5 10 8.5-7 8.5 7v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M9 21v-8h6v8"/>'),
  search: svgIcon('<circle cx="10.8" cy="10.8" r="6.3"/><path d="m15.5 15.5 4.2 4.2"/>'),
  file: svgIcon('<path d="M6 3.8h8l4 4v12.4H6z"/><path d="M14 3.8v4h4M9 12h6M9 15.5h6"/>'),
  filePlus: svgIcon('<path d="M6 3.8h8l4 4v12.4H6z"/><path d="M14 3.8v4h4M12 11v6M9 14h6"/>'),
  formatBold: svgIcon('<path d="M7 5h6a4 4 0 0 1 0 8H7zM7 13h7a3 3 0 0 1 0 6H7z"/>'),
  formatItalic: svgIcon('<path d="M10 5h9M5 19h9M14 5 10 19"/>'),
  formatCode: svgIcon('<path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>'),
  formatStrike: svgIcon('<path d="M5 8a4 4 0 0 1 4-3h6a4 4 0 0 1 3 1.4M4 12h16M19 16a4 4 0 0 1-4 3H9a4 4 0 0 1-3-1.4"/>'),
  formatH1: svgIcon('<path d="M4 5v14M4 12h8M12 5v14M17 8l2-2v12M16 18h6"/>'),
  formatH2: svgIcon('<path d="M3 5v14M3 12h8M11 5v14M15 9a3 3 0 0 1 6 0c0 3-6 4-6 9h7"/>'),
  formatBullet: svgIcon('<circle cx="5" cy="6" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="5" cy="18" r="1"/><path d="M10 6h10M10 12h10M10 18h10"/>'),
  formatOrdered: svgIcon('<path d="M9 6h11M9 12h11M9 18h11M4 5h1v3M4 11h2l-2 2h2M4 17h2l-2 2h2"/>'),
  formatCheck: svgIcon('<rect x="3.5" y="4" width="6" height="6" rx="1"/><path d="m5 7 1.4 1.4L8.5 6M13 7h7M3.5 14h6v6h-6zM13 17h7"/>'),
  tasks: svgIcon('<path d="m4 7 1.5 1.5L8 5.8M11 7h9M4 16l1.5 1.5L8 14.8M11 16h9"/>'),
  formatHighlight: svgIcon('<path d="m8 14 7-7 4 4-7 7H8zM6 20h13M13 9l4 4M5 5h3M6.5 3.5v3M18 17l2 2M19 18l2-2"/>'),
  duplicate: svgIcon('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>'),
  image: svgIcon('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m21 15-5-5L5 21"/>'),
  canvas: svgIcon('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="m7 16 3-4 2 2 3-5 2 7"/>'),
  cursor: svgIcon('<path d="m5 3 14 10-7 1-3 7z"/>'),
  draw: svgIcon('<path d="m4 16 9-9 4 4-9 9H4zM12 8l4 4M14 6l2-2 4 4-2 2"/>'),
  rectangle: svgIcon('<rect x="4" y="5" width="16" height="14" rx="1"/>'),
  shape: svgIcon('<rect x="3.5" y="4" width="7" height="7" rx="1"/><circle cx="17" cy="7.5" r="3.5"/><path d="m5 20 4-6 4 6z"/>'),
  triangle: svgIcon('<path d="m12 3 9 17H3z"/>'),
  speech: svgIcon('<path d="M4 4h16v12H10l-5 4z"/>'),
  markerArrow: svgIcon('<path d="M3 8h11V4l7 8-7 8v-4H3z"/>'),
  markerCircle: svgIcon('<circle cx="12" cy="12" r="7"/>'),
  markerSquare: svgIcon('<rect x="5" y="5" width="14" height="14" rx="1"/>'),
  markerDiamond: svgIcon('<path d="m12 3 9 9-9 9-9-9z"/>'),
  markerNone: svgIcon('<path d="M5 5l14 14M19 5 5 19"/>'),
  ellipse: svgIcon('<ellipse cx="12" cy="12" rx="8" ry="6"/>'),
  rotate: svgIcon('<rect x="8" y="8" width="9" height="9" rx="1"/><path d="M5 8a8 8 0 0 1 12-4M17 1v4h-4"/>'),
  text: svgIcon('<path d="M4 6V4h16v2M12 4v16M9 20h6"/>'),
  line: svgIcon('<path d="M4 18 20 6"/>'),
  eraser: svgIcon('<path d="m7 16-3-3a2 2 0 0 1 0-3l6-6a2 2 0 0 1 3 0l6 6-8 8H7zM13 18h7"/>'),
  trash: svgIcon('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  star: svgIcon('<path d="m12 3 2.75 5.57 6.15.89-4.45 4.33 1.05 6.12L12 17.02l-5.5 2.89 1.05-6.12L3.1 9.46l6.15-.89L12 3z"/>'),
  undo: svgIcon('<path d="M9 14 4 9l5-5"/><path d="M4 9h9a6 6 0 0 1 0 12h-2"/>'),
  redo: svgIcon('<path d="m15 14 5-5-5-5"/><path d="M20 9h-9a6 6 0 0 0 0 12h2"/>'),
  code: svgIcon('<path d="m8 6-6 6 6 6M16 6l6 6-6 6M14 4l-4 16"/>'),
  geometry: svgIcon('<path d="m4 19 8-15 8 15H4zM8 19a4 4 0 0 0-2-4"/>'),
  calculator3d: svgIcon('<path d="m12 3 9 5v9l-9 5-9-5V8zM3 8l9 5 9-5M12 13v9M12 3v10"/>'),
  spreadsheet: svgIcon('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16M4 14h16M10 9v11M15 9v11"/>'),
  graph: svgIcon('<path d="M4 20V4M4 20h16"/><path d="M7 16c2-1 2-7 5-7s3 5 6 1"/>'),
  folder: svgIcon('<path d="M3.5 7.5a2 2 0 0 1 2-2H10l2 2h6.5a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>'),
  folderOpen: svgIcon('<path d="M3.5 7.5a2 2 0 0 1 2-2H10l2 2h6.5a2 2 0 0 1 2 2v1"/><path d="m3.5 12 1.2-1.5h15.8l-2.2 7a2 2 0 0 1-1.9 1.5H5.2a2 2 0 0 1-1.9-2.5z"/>'),
  folderPlus: svgIcon('<path d="M3 8a2 2 0 0 1 2-2h4.5l2 2H18a2 2 0 0 1 2 2v2"/><path d="M3 12h11M8.5 9.5v5M3 12l1.7 6.3A2 2 0 0 0 6.6 20h7"/>'),
  expandAll: svgIcon('<path d="M8 4H5a1 1 0 0 0-1 1v3M16 4h3a1 1 0 0 1 1 1v3M8 20H5a1 1 0 0 1-1-1v-3M16 20h3a1 1 0 0 0 1-1v-3"/><path d="M12 7v10M7 12h10"/>'),
  collapseAll: svgIcon('<path d="M8 4H5a1 1 0 0 0-1 1v3M16 4h3a1 1 0 0 1 1 1v3M8 20H5a1 1 0 0 1-1-1v-3M16 20h3a1 1 0 0 0 1-1v-3"/><path d="M7 12h10"/>'),
  menu: svgIcon('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  chevron: svgIcon('<path d="m9 18 6-6-6-6"/>'),
  down: svgIcon('<path d="m6 9 6 6 6-6"/>'),
  refresh: svgIcon('<path d="M17.7 5.3A8 8 0 1 0 20 11"/><path d="M20 3v5h-5"/>'),
  external: svgIcon('<path d="M14 5h5v5M19 5l-8 8"/><path d="M17 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h5"/>'),
  gear: svgIcon('<path d="M4 6h7m4 0h5M4 12h3m4 0h9M4 18h9m4 0h3"/><circle cx="13" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="15" cy="18" r="2"/>'),
  assistant: svgIcon('<path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>'),
  send: svgIcon('<path d="m21 3-7.2 18-3.2-7.6L3 10.2z"/><path d="M10.6 13.4 21 3"/>'),
  mic: svgIcon('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5m-4 0h8"/>'),
  shift: svgIcon('<path d="m5 12 7-7 7 7h-4v7H9v-7z"/>', 'shortcut-shift-icon'),
  close: svgIcon('<path d="m6 6 12 12M18 6 6 18"/>'),
  statusCheck: svgIcon('<path d="m5 12.5 4.5 4.5L19 7"/>'),
  statusX: svgIcon('<path d="m6 6 12 12M18 6 6 18"/>'),
  book: svgIcon('<path d="M5 4.5h11a3 3 0 0 1 3 3v12H8a3 3 0 0 1-3-3z"/><path d="M5 16.5a3 3 0 0 1 3-3h11M9 8h6"/>', 'brand-mark-icon'),
  command: svgIcon('<path d="M9 9h6v6H9z"/><path d="M9 9V6a2 2 0 1 0-2 2h10a2 2 0 1 0-2-2v12a2 2 0 1 0-2-2H7a2 2 0 1 0 2 2z"/>'),
};

const app = document.querySelector('#app');
const isWindows = window.stillnote.platform === 'win32';
app.innerHTML = `
  <div class="app-shell">
    <header class="topbar${isWindows ? ' topbar-windows' : ''}">
      <div class="traffic-space"></div>
      <button class="icon-button sidebar-toggle" aria-label="Toggle sidebar">${icons.panel}</button>
      <div class="topbar-brand"><img src="${stillnoteLogo}" width="26" height="26" alt=""><span>Stillnote</span></div>
      <div class="topbar-actions"><button class="icon-button home-trigger" id="home-button" title="Home" aria-label="Home">${icons.home}</button><div class="topbar-search" id="topbar-search"><button class="icon-button search-trigger" title="Search notes (⌘⇧F / Ctrl+Shift+F)" aria-label="Search notes" aria-expanded="false">${icons.search}</button><input class="topbar-search-input" id="search-input" placeholder="Search notes…" autocomplete="off" aria-label="Search notes"><div class="topbar-search-results" id="search-results"></div></div><button class="icon-button assistant-trigger" id="assistant-toggle" title="Open assistant">${icons.assistant}</button></div>
    </header>
    <div class="workspace">
      <aside class="sidebar">
        <div class="explorer-toolbar"><button class="explorer-action" id="new-folder" title="New folder">${icons.folderPlus}<span>Folder</span></button><button class="explorer-action" id="new-file" title="Create a file">${icons.filePlus}<span>File ▾</span></button><button class="explorer-tree-action" id="expand-folders" title="Expand all folders" aria-label="Expand all folders">${icons.expandAll}</button><button class="explorer-tree-action" id="collapse-folders" title="Collapse all folders" aria-label="Collapse all folders">${icons.collapseAll}</button><button class="explorer-refresh" id="refresh-notes" title="Refresh explorer">${icons.refresh}</button></div>
        <div class="note-list" id="note-list"></div>
        <section class="sidebar-linked-files" hidden aria-label="Linked files"></section>
        <div class="explorer-root-drop">Move to vault root</div>
        <div class="sidebar-bottom"><div class="explorer-heading"><button class="vault-switcher"><span class="vault-mark">S</span><span class="vault-name">Choose a folder</span></button></div><button class="icon-button small settings" id="settings-button" title="Settings" aria-label="Settings" aria-haspopup="true" aria-expanded="false">${icons.gear}</button></div>
      </aside>
      <div class="panel-resizer" id="sidebar-resizer" role="separator" aria-orientation="vertical" aria-label="Resize file explorer" aria-valuemin="190" aria-valuemax="440" tabindex="0"></div>
      <main class="main-area">
        <div class="editor-wrap" id="editor-wrap">
          <div class="welcome" id="welcome">
            <div class="welcome-mark">${icons.book}</div>
            <div class="eyebrow">A SPACE TO THINK</div>
            <h1>Your thoughts,<br><em>in good order.</em></h1>
            <p>A quiet place for notes, ideas, and everything in between.<br>Everything stays in a folder on your computer.</p>
            <button class="primary-button" id="open-vault">Open a folder ${icons.external}</button>
            <div class="welcome-foot"><span>MARKDOWN, ALWAYS</span><span>·</span><span>YOUR FILES, YOURS</span></div>
          </div>
          <div class="note-editor" id="note-editor" hidden>
            <div class="note-meta"><div class="breadcrumbs" id="breadcrumbs"></div><span class="save-state" id="save-state">Saved</span></div>
            <nav class="note-indexes" id="note-indexes" aria-label="Note indexes" hidden></nav>
            <div class="editor-content" id="editor-content"></div>
            <nav class="note-format-toolbar" id="note-format-toolbar" aria-label="Note formatting" hidden>
              <button type="button" data-format="bold" title="Bold" aria-label="Bold">${icons.formatBold}</button>
              <button type="button" data-format="italic" title="Italic" aria-label="Italic">${icons.formatItalic}</button>
              <button type="button" data-format="code" title="Inline code" aria-label="Inline code">${icons.formatCode}</button>
              <button type="button" data-format="strike" title="Strikethrough" aria-label="Strikethrough">${icons.formatStrike}</button>
              <span class="format-toolbar-divider"></span>
              <button type="button" data-format="heading1" title="Heading 1" aria-label="Heading 1">${icons.formatH1}</button>
              <button type="button" data-format="heading2" title="Heading 2" aria-label="Heading 2">${icons.formatH2}</button>
              <button type="button" data-format="bullet" title="Bullet list" aria-label="Bullet list">${icons.formatBullet}</button>
              <button type="button" data-format="ordered" title="Ordered list" aria-label="Ordered list">${icons.formatOrdered}</button>
              <button type="button" data-format="checklist" title="Checklist" aria-label="Checklist">${icons.formatCheck}</button>
              <button type="button" data-format="highlight" title="Highlight selection" aria-label="Highlight selection">${icons.formatHighlight}</button>
            </nav>
            <div class="editor-footer" id="editor-footer"><span>MARKDOWN</span><span id="word-count">0 words</span><span>LOCAL FILE</span></div>
            <button type="button" class="meeting-notes-trigger" id="meeting-notes-trigger" title="Click to start recording" aria-label="Start meeting recording" aria-pressed="false">${icons.mic}<span class="meeting-duration" hidden>00:00</span></button>
          </div>
        </div>
        <footer class="statusbar"><div class="status-left"><span class="status-dot"></span><span id="status-vault">No vault open</span></div><div class="status-right"><button id="backlink-count" type="button" disabled>0 backlinks</button><span>Markdown</span><span class="status-divider"></span><span>UTF-8</span><span class="status-divider"></span><span>⌘ K Search</span></div></footer>
      </main>
      <div class="panel-resizer assistant-resizer" id="assistant-resizer" role="separator" aria-orientation="vertical" aria-label="Resize assistant panel" aria-valuemin="280" aria-valuemax="560" tabindex="0"></div>
      <aside class="assistant-drawer" id="assistant-drawer" aria-label="AI assistant">
        <div class="assistant-panel">
          <div class="assistant-messages" id="assistant-messages"><div class="assistant-welcome"><div class="assistant-welcome-icon">${icons.assistant}</div><strong>What would you like to do?</strong><p>Ask a question about this note, or ask me to edit it.</p></div></div>
          <form class="assistant-composer" id="assistant-form"><div class="assistant-modes"><button type="button" class="assistant-mode active" data-mode="ask">Ask</button><button type="button" class="assistant-mode" data-mode="edit">Edit note</button></div><div class="assistant-input-wrap"><textarea id="assistant-input" rows="3" placeholder="Ask about this note…"></textarea><button type="submit" class="send-button" id="assistant-send" aria-label="Send question">${icons.send}</button></div><div class="assistant-footnote">The open file and directly linked files are sent to your selected AI provider.</div></form>
        </div>
      </aside>
    </div>
    <div class="settings-overlay" id="settings-overlay" hidden>
      <section class="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header class="settings-modal-header"><div><div class="eyebrow">PREFERENCES</div><h2 id="settings-title">Settings</h2></div><button class="icon-button" id="settings-close" aria-label="Close settings">${icons.close}</button></header>
        <div class="settings-modal-body">
          <nav class="settings-tabs" aria-label="Settings sections"><button class="settings-tab active" data-tab="theme">${icons.gear}<span>Theme</span></button><button class="settings-tab" data-tab="directory" aria-label="Directory"><span class="app-icon">${icons.folder}</span><span>Directory</span><span class="settings-health-indicator is-off" data-health="directory" aria-hidden="true">${icons.statusX}</span></button><button class="settings-tab" data-tab="ai" aria-label="AI settings"><span class="app-icon">${icons.assistant}</span><span>AI settings</span><span class="settings-health-indicator is-off" data-health="ai" aria-hidden="true">${icons.statusX}</span></button><button class="settings-tab" data-tab="tasks" aria-label="Google Tasks"><span class="app-icon">${icons.formatCheck}</span><span>Google Tasks</span><span class="settings-health-indicator is-off" data-health="tasks" aria-hidden="true">${icons.statusX}</span></button><button class="settings-tab" data-tab="desmos" aria-label="Graphing"><span class="app-icon">${icons.graph}</span><span>Graphing</span><span class="settings-health-indicator is-off" data-health="desmos" aria-hidden="true">${icons.statusX}</span></button><button class="settings-tab" data-tab="dictionary">${icons.book}<span>Dictionary</span></button><button class="settings-tab" data-tab="toolbar">${icons.formatBullet}<span>Toolbar</span></button><button class="settings-tab" data-tab="equations"><span class="equation-tab-icon">∑</span><span>Note syntax</span></button><button class="settings-tab" data-tab="shortcuts"><span class="shortcut-tab-icon">⌘</span><span>Shortcuts</span></button></nav>
          <div class="settings-content">
            <section class="settings-section active" data-section="theme"><div class="settings-section-heading"><span class="eyebrow">APPEARANCE</span><h3>Choose a theme</h3><p>Set the tone for your writing space.</p></div><div class="theme-cards"><button class="theme-card" data-theme="light" aria-pressed="false"><span class="theme-preview preview-light"><i></i><i></i><i></i></span><span>Light</span><span class="theme-card-check">✓</span></button><button class="theme-card" data-theme="sepia" aria-pressed="false"><span class="theme-preview preview-sepia"><i></i><i></i><i></i></span><span>Sepia</span><span class="theme-card-check">✓</span></button><button class="theme-card" data-theme="dark" aria-pressed="false"><span class="theme-preview preview-dark"><i></i><i></i><i></i></span><span>Dark</span><span class="theme-card-check">✓</span></button></div></section>
            <section class="settings-section" data-section="directory" hidden><div class="settings-section-heading"><span class="eyebrow">YOUR FILES</span><h3>Vault directory</h3><p>Your notes and files stay in this folder on your computer.</p></div><div class="directory-card"><span class="directory-icon">${icons.folder}</span><div><strong id="directory-name">No folder open</strong><span id="directory-path">Choose a folder to see its location.</span></div></div><button class="secondary-button" id="change-directory">Choose a folder</button><div class="supported-file-types"><h4>Supported file types</h4><div class="supported-file-row"><strong>Edit as text</strong><code>Markdown and code files: JS · TS · Python · HTML · CSS · JSON · Java · C/C++ · Rust · Go · SQL · Shell · XML · YAML · TOML · Swift · Kotlin · Ruby · PHP</code></div><div class="supported-file-row"><strong>Interactive documents</strong><code>Canvas · Geometry · 3D Calculator · Spreadsheet · Graph · Google Tasks</code></div><div class="supported-file-row"><strong>Preview images</strong><code>.png · .jpg · .jpeg · .webp · .heic · .icns · .svg</code></div><div class="supported-file-row"><strong>Play audio and video</strong><code>MP4 · WebM · OGV · MOV · M4V · MP3 · WAV · OGG · M4A · AAC · FLAC · Opus (codec support varies)</code></div><div class="supported-file-row"><strong>Preview documents</strong><code>.pdf</code></div><div class="supported-file-row"><strong>Interactive 3D preview</strong><code>.obj · .stl · .step · .stp</code></div><p>Ask the AI about open code files, PDFs, Geometry, and 3D Calculator files. Scanned PDFs need selectable text; OCR isn’t built in.</p></div></section>
            <section class="settings-section" data-section="ai" hidden>
              <div class="settings-section-heading"><span class="eyebrow">CLOUD AI</span><h3>AI assistant</h3><p>Ask questions about your current note or request an edit. On Home, Ask compares files and their connections; Work handles multi-step requests across files and tasks.</p></div>
              <label class="field-label" for="ai-provider">Provider</label><select class="settings-input" id="ai-provider" aria-describedby="ai-provider-info"><option value="groq">Groq — free daily limits</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic (Claude)</option></select><p class="settings-note" id="ai-provider-info"></p>
              <label class="field-label" for="ai-model">Cloud model</label><select class="settings-input" id="ai-model" aria-describedby="ai-model-status"></select><p class="settings-note" id="ai-model-status">Save a Groq API key to load available models.</p>
              <label class="field-label" for="ai-key" id="ai-key-label">Groq API key</label><input class="settings-input" id="ai-key" type="password" placeholder="Paste your Groq API key" autocomplete="new-password"><div class="key-actions"><button class="primary-button" id="save-ai-key">Save key</button><button class="secondary-button" id="remove-ai-key">Remove key</button><span class="key-status" id="ai-key-status">Checking secure storage…</span></div>
              <p class="settings-note" id="ai-key-help"></p><p class="settings-note">Keys are encrypted in this vault and can only be opened on this device. Each provider has its own key and model preference.</p>
              <button class="secondary-button" id="reset-unreadable-credentials" type="button">Reset unreadable credentials</button><p class="settings-note">Use this only when Stillnote cannot decrypt credentials. It archives the unreadable credentials file so you can enter new AI, Desmos, and Google Tasks credentials.</p>
            </section>
            <section class="settings-section" data-section="tasks" hidden><div class="settings-section-heading"><span class="eyebrow">GOOGLE TASKS</span><h3>Sync task sheets</h3><p>Task sheets read from and write to Google Tasks lists. Your OAuth credentials and account token are encrypted in this vault.</p></div><label class="field-label" for="google-tasks-client-id">OAuth Desktop app client ID</label><input class="settings-input" id="google-tasks-client-id" type="text" autocomplete="off" placeholder="123456789.apps.googleusercontent.com"><label class="field-label" for="google-tasks-client-secret">OAuth client secret</label><input class="settings-input" id="google-tasks-client-secret" type="password" autocomplete="new-password" placeholder="Paste the secret from the same Desktop app client"><div class="key-actions"><button class="primary-button" id="save-google-tasks-client">Save credentials</button><button class="secondary-button" id="connect-google-tasks">Connect Google account</button><button class="secondary-button" id="disconnect-google-tasks">Disconnect</button><span class="key-status" id="google-tasks-status">Checking connection…</span></div><p class="settings-note">Go to Google Cloud Console (console.cloud.google.com/). Create a Project and go to that project's dashboard. Click "Library" in the left sidebar, search for "Google Tasks api", and enable it. Back in the dashboard, click on credentials, then create credentials, then OAUTH Client ID. Set the application type to: “Desktop app”. Copy the Client ID and Client Secret, you will need these and won't be able to view them again. Under OAuth 2.0 Client IDs, find the one you created an click on it. Go to "Audience" and scroll down until you find "test users". Add the Gmail you intend to use as a test user. Paste the Client ID and Client Secret into StillNote. Click save, then click "Connect Google Accout". Click on the Gmail that you added as a test user and click confirm. The app requests access only to your Google Tasks.</p></section>

            <section class="settings-section" data-section="desmos" hidden><div class="settings-section-heading"><span class="eyebrow">DESMOS TOOLS</span><h3>Connect Desmos</h3><p>Graph, Geometry, and 3D Calculator files save their Desmos state inside the Markdown file.</p></div><label class="field-label" for="desmos-api-key">Desmos API key</label><input class="settings-input" id="desmos-api-key" type="password" autocomplete="off" placeholder="Enter your Desmos API key"><div class="key-actions"><button class="primary-button" id="save-desmos-key">Save key</button><button class="secondary-button" id="remove-desmos-key">Remove key</button></div><p class="settings-note">Get an API key at desmos.com/my-api. Geometry Tool and 3D Calculator access must be enabled for your key. Desmos loads from the internet.</p></section>

            <section class="settings-section" data-section="dictionary" hidden><div class="settings-section-heading"><span class="eyebrow">SPELL CHECK</span><h3>Personal dictionary</h3><p>Words here are treated as correctly spelled in your notes. This dictionary is encrypted in a separate file in the selected vault.</p></div><form class="dictionary-add-form" id="custom-dictionary-form"><input class="settings-input" id="custom-dictionary-input" type="text" maxlength="64" autocomplete="off" spellcheck="false" placeholder="Add a word"><button class="secondary-button" type="submit">Add word</button></form><div class="custom-dictionary-list" id="custom-dictionary-list" aria-live="polite"></div></section>

            <section class="settings-section" data-section="toolbar" hidden><div class="settings-section-heading"><span class="eyebrow">EDITOR LAYOUT</span><h3>Toolbar position</h3><p>Choose where formatting and canvas tools appear.</p></div><label class="field-label" for="notes-toolbar-position">Notes toolbar</label><select class="settings-input toolbar-position-select" id="notes-toolbar-position"><option value="left">Left</option><option value="right">Right</option><option value="bottom">Bottom</option><option value="hidden">Hidden</option></select><label class="field-label" for="canvas-toolbar-position">Canvas toolbar</label><select class="settings-input toolbar-position-select" id="canvas-toolbar-position"><option value="left">Left</option><option value="right">Right</option><option value="bottom">Bottom</option></select><p class="settings-note">Hidden applies only to the notes toolbar.</p></section>

            <section class="settings-section" data-section="equations" hidden>${noteSyntaxGuide}</section>
            <section class="settings-section" data-section="shortcuts" hidden><div class="settings-section-heading"><span class="eyebrow">KEYBOARD</span><h3>Keyboard shortcuts</h3><p>Use these shortcuts to move around and format notes quickly.</p></div><div class="shortcut-groups"><div class="shortcut-group"><h4>Workspace</h4><div class="shortcut-row"><span>Search notes</span><kbd>⌘ / Ctrl K</kbd></div><div class="shortcut-row"><span>New note</span><kbd>⌘ / Ctrl N</kbd></div><div class="shortcut-row"><span>New folder</span><kbd>⌘ / Ctrl ${icons.shift} N</kbd></div><div class="shortcut-row"><span>Save note</span><kbd>⌘ / Ctrl S</kbd></div><div class="shortcut-row"><span>Export note as PDF</span><kbd>⌘ / Ctrl P</kbd></div><div class="shortcut-row"><span>Choose vault folder</span><kbd>⌘ / Ctrl O</kbd></div><div class="shortcut-row"><span>Open settings</span><kbd>⌘ / Ctrl ,</kbd></div><div class="shortcut-row"><span>Toggle AI assistant</span><kbd>⌘ / Ctrl ${icons.shift} A</kbd></div><div class="shortcut-row"><span>Close popup or assistant; otherwise go Home from a file</span><kbd>Esc</kbd></div></div><div class="shortcut-group"><h4>Explorer</h4><div class="shortcut-row"><span>Add or remove an item from selection</span><kbd>${icons.shift} Click</kbd></div><div class="shortcut-row"><span>Delete from the context menu without confirmation</span><kbd>Hold Enter + Delete</kbd></div></div><div class="shortcut-group"><h4>Editor</h4><div class="shortcut-row"><span>Find and replace in file</span><kbd>⌘ / Ctrl F</kbd></div><div class="shortcut-row"><span>Next / previous match</span><kbd>Enter / ${icons.shift} Enter</kbd></div><div class="shortcut-row"><span>Bold selection</span><kbd>⌘ / Ctrl B</kbd></div><div class="shortcut-row"><span>Italic selection</span><kbd>⌘ / Ctrl I</kbd></div><div class="shortcut-row"><span>Inline code</span><kbd>⌘ / Ctrl ${icons.shift} C</kbd></div><div class="shortcut-row"><span>Strikethrough</span><kbd>⌘ / Ctrl ${icons.shift} X</kbd></div><div class="shortcut-row"><span>Undo / redo</span><kbd>⌘ / Ctrl Z / ${icons.shift} Z</kbd></div></div><div class="shortcut-group"><h4>AI prompt</h4><div class="shortcut-row"><span>Send prompt</span><kbd>Enter</kbd></div><div class="shortcut-row"><span>New line</span><kbd>${icons.shift} Enter</kbd></div></div></div></section>
          </div>
        </div>
      </section>
    </div>
    <div class="explorer-context-menu" id="explorer-context-menu" role="menu" hidden></div>
    <div class="explorer-context-menu editor-context-menu" id="editor-context-menu" role="menu" aria-label="Editor options" hidden></div>
    <div class="explorer-context-menu new-file-menu" id="new-file-menu" role="menu" hidden></div>
    <div class="rename-overlay" id="rename-overlay" hidden>
      <form class="rename-dialog" id="rename-form" role="dialog" aria-modal="true" aria-labelledby="rename-title">
        <label id="rename-title" for="rename-input">Rename item</label>
        <input id="rename-input" autocomplete="off" spellcheck="false">
        <div class="rename-actions"><button type="button" class="secondary-button" id="rename-cancel">Cancel</button><button type="submit" class="primary-button">Rename</button></div>
      </form>
    </div>
    <div class="rename-overlay delete-overlay" id="delete-overlay" hidden><section class="rename-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title"><h2 id="delete-title">Delete item?</h2><p id="delete-description"></p><div class="rename-actions"><button type="button" class="secondary-button" id="delete-cancel">Cancel</button><button type="button" class="primary-button delete-confirm" id="delete-confirm">Delete</button></div></section></div>
    <div class="link-picker-overlay" id="link-picker-overlay" hidden><section class="link-picker" role="dialog" aria-modal="true" aria-labelledby="link-picker-title"><header><div><span class="eyebrow">INSERT LINK</span><h2 id="link-picker-title">Choose a file or task</h2></div><button class="icon-button" id="link-picker-close" type="button" aria-label="Close link picker">${icons.close}</button></header><div class="link-picker-tabs" id="link-picker-tabs" role="tablist" aria-label="Link sources"></div><label class="link-picker-search">${icons.search}<input id="link-picker-query" type="search" autocomplete="off" placeholder="Filter files…" aria-label="Filter links"></label><div class="link-picker-results" id="link-picker-results" role="listbox"></div><footer><span>Click an item to insert it at the cursor</span><kbd>Esc</kbd></footer></section></div>
    <div class="toast" id="toast" hidden></div>
  </div>`;

const AI_PROVIDERS = {
  groq: { name: 'Groq', defaultModel: 'openai/gpt-oss-120b' },
  openai: { name: 'OpenAI', defaultModel: 'gpt-6.1-sol' },
  anthropic: { name: 'Anthropic', defaultModel: 'claude-sonnet-5-5' },
};
function resolveAiProvider(value) { return Object.hasOwn(AI_PROVIDERS, value) ? value : 'groq'; }
const state = { aiProvider: resolveAiProvider(localStorage.getItem('stillnote-ai-provider')), vault: null, files: [], tree: [], collapsed: new Set(), active: null, home: false, homeChats: loadHomeChats(), homeSession: null, homeMode: localStorage.getItem('stillnote-home-mode') === 'work' ? 'work' : 'ask', homeRun: null, view: null, structured: null, assetViewer: null, assetPath: null, assetBytes: null, pdfText: null, pdfTextPromise: null, toolbarPositions: loadToolbarPositions(), saveTimer: null, savePromise: null, dirty: false, lastTitleValidationMessage: null, sidebarOpen: true, sidebarWidth: Number(localStorage.getItem('stillnote-sidebar-width')) || 258, assistantWidth: Number(localStorage.getItem('stillnote-assistant-width')) || 360, theme: 'light', assistantOpen: false, assistantMode: 'ask', chatHistory: [], draggedItem: null, explorerSelection: new Set(), contextDeleteBypass: false, taskLinkStates: new Map(), workspaceRestored: false, pendingDeepLinks: [] };
{
  const workspaceShortcuts = [...document.querySelectorAll('.shortcut-group')].find((group) => group.querySelector('h4')?.textContent === 'Workspace');
  const firstRow = workspaceShortcuts?.querySelector('.shortcut-row');
  if (firstRow) {
    firstRow.querySelector('span').textContent = 'Insert a file or task link'; firstRow.querySelector('kbd').textContent = '⌘ / Ctrl K';
    const searchRow = document.createElement('div'); searchRow.className = 'shortcut-row'; searchRow.innerHTML = `<span>Search notes</span><kbd>⌘ / Ctrl ${icons.shift} F</kbd>`; firstRow.after(searchRow);
  }
}
function loadToolbarPositions() {
  const notePosition = localStorage.getItem('stillnote-notes-toolbar-position');
  const canvasPosition = localStorage.getItem('stillnote-canvas-toolbar-position');
  return { notes: ['left', 'right', 'bottom', 'hidden'].includes(notePosition) ? notePosition : 'right', canvas: ['left', 'right', 'bottom'].includes(canvasPosition) ? canvasPosition : 'right' };
}
function loadHomeChats() { try { const saved = JSON.parse(localStorage.getItem('stillnote-home-chats') || '[]'); return Array.isArray(saved) ? saved.slice(0, 3) : []; } catch { return []; } }
function persistHomeChat() { if (!state.homeSession) return; state.homeSession.updatedAt = Date.now(); state.homeChats = [state.homeSession, ...state.homeChats.filter((chat) => chat.id !== state.homeSession.id)].slice(0, 3); try { localStorage.setItem('stillnote-home-chats', JSON.stringify(state.homeChats)); } catch { try { localStorage.setItem('stillnote-home-chats', JSON.stringify(state.homeChats.map(({aiContext,...chat})=>chat))); } catch {} } }
let resolveRenameDialog = null;
let resolveDeleteDialog = null;
const $ = (selector) => document.querySelector(selector);
const list = $('#note-list');
setupPanelResizers();

const markdownMarkers = new Set(['HeaderMark', 'EmphasisMark', 'CodeMark', 'LinkMark', 'LinkDestination', 'LinkTitle', 'StrikethroughMark', 'ListMark', 'QuoteMark', 'TaskMarker']);
class TextWidget extends WidgetType {
  constructor(text, className) { super(); this.text = text; this.className = className; }
  toDOM() {
    const element = document.createElement('span');
    element.className = this.className;
    element.textContent = this.text;
    return element;
  }
  eq(other) { return other.text === this.text && other.className === this.className; }
}
class HorizontalRuleWidget extends WidgetType {
  toDOM() { const element = document.createElement('hr'); element.className = 'cm-md-horizontal-rule-widget'; return element; }
}
class TaskCheckboxWidget extends WidgetType {
  constructor(checked, from, to) { super(); this.checked = checked; this.from = from; this.to = to; }
  toDOM(view) {
    const input = document.createElement('input'); input.type = 'checkbox'; input.className = 'cm-md-task-checkbox'; input.checked = this.checked; input.setAttribute('aria-label', this.checked ? 'Mark task incomplete' : 'Mark task complete');
    input.addEventListener('mousedown', (event) => event.preventDefault());
    input.addEventListener('change', () => view.dispatch({ changes: { from: this.from, to: this.to, insert: input.checked ? '[x]' : '[ ]' } }));
    return input;
  }
  eq(other) { return this.checked === other.checked && this.from === other.from && this.to === other.to; }
}
const mathNS = 'http://www.w3.org/1998/Math/MathML';
const greekLetters = { alpha:'α', beta:'β', gamma:'γ', delta:'δ', epsilon:'ε', theta:'θ', lambda:'λ', mu:'μ', pi:'π', rho:'ρ', sigma:'σ', tau:'τ', phi:'φ', chi:'χ', psi:'ψ', omega:'ω', Gamma:'Γ', Delta:'Δ', Theta:'Θ', Lambda:'Λ', Pi:'Π', Sigma:'Σ', Phi:'Φ', Psi:'Ψ', Omega:'Ω' };
function mathNode(tag, text) { const node = document.createElementNS(mathNS, tag); if (text != null) node.textContent = text; return node; }
function parseMath(source) {
  let index = 0;
  function sequence(stop = '') {
    const row = mathNode('mrow');
    while (index < source.length && source[index] !== stop) {
      let atom;
      const char = source[index++];
      if (/\s/.test(char)) continue;
      if (char === '{') { atom = sequence('}'); index++; }
      else if (char === '\\' || char === '/') {
        const command = (source.slice(index).match(/^[A-Za-z]+/) || [''])[0]; index += command.length;
        if (char === '/' && !greekLetters[command] && !['int','infty','sum','prod','frac','sqrt','cdot','times','le','ge','neq','pm'].includes(command)) { index -= command.length; atom = mathNode('mo', '/'); row.append(atom); continue; }
        if (command === 'frac' || command === 'dfrac' || command === 'tfrac') { const numerator = group(), denominator = group(); atom = mathNode('mfrac'); atom.append(numerator, denominator); }
        else if (command === 'sqrt') { atom = mathNode('msqrt'); atom.append(group()); }
        else if (command === 'int' || command === 'infty' || command === 'sum' || command === 'prod') atom = mathNode('mo', ({ int:'∫', infty:'∞', sum:'∑', prod:'∏' })[command]);
        else if (greekLetters[command]) atom = mathNode('mi', greekLetters[command]);
        else if (command === 'cdot' || command === 'times' || command === 'le' || command === 'ge' || command === 'neq' || command === 'pm') atom = mathNode('mo', ({ cdot:'·', times:'×', le:'≤', ge:'≥', neq:'≠', pm:'±' })[command]);
        else if (command === 'left' || command === 'right') { const delim = source[index++]; atom = mathNode('mo', delim || ''); }
        else atom = mathNode('mi', command || source[index - 1]);
      } else if (char === '^' || char === '_') {
        const script = group();
        if (!row.lastChild) row.append(mathNode('mi', ' '));
        const base = row.lastChild; row.removeChild(base);
        const combined = mathNode(char === '^' ? 'msup' : 'msub'); combined.append(base, script); row.append(combined); continue;
      } else if ('+-=<>(),[]|'.includes(char)) atom = mathNode('mo', char);
      else if (/\d/.test(char)) atom = mathNode('mn', char);
      else atom = mathNode('mi', char);
      if (atom) row.append(atom);
    }
    return row;
  }
  function group() { while (source[index] === ' ') index++; if (source[index] === '{') { index++; const result = sequence('}'); index++; return result; } return sequenceAtom(); }
  function sequenceAtom() {
    while (source[index] === ' ') index++;
    if (index >= source.length) return mathNode('mrow');
    let token = source[index++];
    if (token === '\\' || token === '/') { const command = (source.slice(index).match(/^[A-Za-z]+/) || [''])[0]; index += command.length; token = greekLetters[command] || ({ int:'∫', infty:'∞', sum:'∑', prod:'∏', cdot:'·', times:'×', le:'≤', ge:'≥', neq:'≠', pm:'±' })[command] || command || token; }
    const result = mathNode(/^\d/.test(token) ? 'mn' : 'mi', token); return result;
  }
  return sequence();
}
class EquationWidget extends WidgetType {
  constructor(source, from, to) { super(); this.source = source; this.from = from; this.to = to; }
  toDOM(view) {
    const math = mathNode('math'); math.setAttribute('display', 'inline'); math.classList.add('cm-md-equation'); math.append(parseMath(this.source)); math.dataset.equation = this.source; math.title = 'Click to edit · right-click for Desmos preview';
    math.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const bounds = math.getBoundingClientRect(), fraction = bounds.width ? Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) : 0;
      const offset = Math.round(fraction * this.source.length);
      view.dispatch({ selection: { anchor: this.from + 1 + offset }, scrollIntoView: true });
      view.focus();
    });
    return math;
  }
  eq(other) { return other.source === this.source && other.from === this.from && other.to === this.to; }
}
const playableMediaExtensions = ['.mp4', '.webm', '.ogv', '.mov', '.m4v', '.mp3', '.wav', '.ogg', '.oga', '.m4a', '.aac', '.flac', '.opus'];
function spreadsheetPreviewSize(data, endCell = '') {
  const address = key => {
    const match = String(key).trim().match(/^([A-Z]+)([1-9]\d*)$/i);
    if (!match) return null;
    let columns = 0;
    for (const letter of match[1].toUpperCase()) columns = columns*26 + letter.charCodeAt(0)-64;
    return { columns, rows: Number(match[2]) };
  };
  let rows = 0, columns = 0, startRow = 0, startColumn = 0;
  if (endCell) {
    const parts = endCell.split(',');
    const start = parts.length === 2 ? address(parts[0]) : address('A1');
    const end = address(parts[parts.length-1]);
    if (parts.length > 2 || !start || !end) throw new Error('Use a cell address such as #D8, or two cells such as #A5,D8.');
    if (![start.rows, start.columns, end.rows, end.columns].every(Number.isSafeInteger)) throw new Error('This table range is too large.');
    if (end.rows < start.rows || end.columns < start.columns) throw new Error('The second cell must be at or below and to the right of the first cell.');
    startRow = start.rows-1; startColumn = start.columns-1;
    rows = end.rows-startRow; columns = end.columns-startColumn;
  } else {
    for (const [key, value] of Object.entries(data.cells || {})) {
      if (!String(value ?? '').trim()) continue;
      const cell = address(key); if (!cell) continue;
      rows = Math.max(rows, cell.rows); columns = Math.max(columns, cell.columns);
    }
  }
  if (!Number.isSafeInteger(rows*columns) || rows*columns > 50000) throw new Error('This table is too large to embed. Add a smaller endpoint such as #D8.');
  return { rows, columns, startRow, startColumn };
}
function renderSpreadsheetPreview(data, endCell, file) {
  const { rows, columns, startRow, startColumn } = spreadsheetPreviewSize(data, endCell);
  const scroll = document.createElement('span'); scroll.className = 'cm-wiki-sheet-scroll';
  if (!rows || !columns) { scroll.textContent = 'Empty spreadsheet'; return scroll; }
  const table = document.createElement('table'); table.className = 'cm-wiki-sheet-table'; table.setAttribute('aria-label', file);
  const body = document.createElement('tbody');
  for (let row = 0; row < rows; row++) {
    const tr = document.createElement('tr');
    for (let col = 0; col < columns; col++) {
      const key = `${columnLabel(col+startColumn)}${row+startRow+1}`, raw = String(data.cells?.[key] ?? '');
      const cell = document.createElement(row === 0 || col === 0 ? 'th' : 'td');
      if (row === 0) cell.setAttribute('scope', 'col'); else if (col === 0) cell.setAttribute('scope', 'row');
      cell.textContent = raw.startsWith('=') ? spreadsheetCellValue(data, key) : raw;
      cell.dataset.cell = key; tr.append(cell);
    }
    body.append(tr);
  }
  table.append(body); scroll.append(table); return scroll;
}
class WikiMediaWidget extends WidgetType {
  constructor(file, from, to, rawLink, endCell, previewSize, revision) { super(); this.file = file; this.from = from; this.to = to; this.rawLink = rawLink; this.endCell = endCell; this.previewSize = previewSize; this.revision = revision; }
  toDOM(view) {
    const extension = `.${fileExtension(this.file)}`;
    const is3d = ['.obj', '.stl', '.step', '.stp'].includes(extension);
    const format = findExplorerNode(this.file)?.format;
    const isGraph = ['graph','geometry','calculator3d'].includes(format);
    const isCanvas = format === 'canvas';
    const isSpreadsheet = findExplorerNode(this.file)?.format === 'spreadsheet';
    const isPlayable = playableMediaExtensions.includes(extension);
    const preview = document.createElement('span'); preview.className = `cm-wiki-media-preview${isGraph ? ' is-graph' : isSpreadsheet ? ' is-spreadsheet' : isCanvas ? ' is-canvas' : isPlayable ? ' is-playable' : is3d ? ' is-3d' : ' is-image'}`; preview.dataset.target = this.file; preview.title = `${this.file} · right-click to open · place the caret in the link to edit it`;
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'cm-wiki-media-edit'; edit.textContent = 'Edit link'; edit.title = 'Show and edit the link';
    edit.addEventListener('mousedown', (event) => { event.preventDefault(); event.stopPropagation(); });
    edit.addEventListener('click', (event) => {
      event.preventDefault(); event.stopPropagation();
      view.dispatch({ selection: { anchor: this.from + 2 }, scrollIntoView: true }); view.focus();
    });
    preview.append(edit);
    const saveSize = (size) => {
      if (state.view !== view || preview.__disposed || view.state.sliceDoc(this.from, this.to) !== this.rawLink) return;
      const value = setVaultLinkPreviewSize(this.rawLink.slice(2, -2), size);
      const insert = this.rawLink.slice(0, 2) + value + this.rawLink.slice(-2);
      if (insert !== this.rawLink) view.dispatch({ changes: { from: this.from, to: this.to, insert }, userEvent: 'input' });
    };
    const loading = document.createElement('span'); loading.className = 'cm-wiki-media-loading'; loading.textContent = 'Loading preview…'; preview.append(loading);
    const source = isCanvas || isSpreadsheet || isGraph ? window.stillnote.readNote(this.file) : window.stillnote.readAsset(this.file);
    source.then(async (asset) => {
      if (!preview.isConnected || preview.__disposed) return;
      preview.replaceChildren(edit);
      if (isGraph) {
        const graph = decodeStructured(asset);
        if (graph?.type !== format) throw new Error('Invalid graph document');
        const host = document.createElement('span'); host.className = 'cm-wiki-graph-preview'; host.setAttribute('role','img'); host.setAttribute('aria-label',this.file);preview.append(host);
        const instance = createGraphPreview(host,format,graph.data,{getKey:()=>window.stillnote.getDesmosKey(),loadApi:loadDesmosApi,isCurrent:()=>preview.isConnected&&!preview.__disposed,onResize:()=>view.requestMeasure()});
        preview.__disposePreview = instance.destroy;
        await instance.ready;
        if(!preview.isConnected||preview.__disposed)return;
      } else if (isSpreadsheet) {
        const sheet = decodeStructured(asset);
        if (sheet?.type !== 'spreadsheet' || !sheet.data?.cells || typeof sheet.data.cells !== 'object') throw new Error('Invalid spreadsheet');
        preview.append(renderSpreadsheetPreview(sheet.data, this.endCell, this.file));
      } else if (isCanvas) {
        const canvas = decodeStructured(asset);
        if (canvas?.type !== 'canvas' || !Array.isArray(canvas.data?.elements)) throw new Error('Invalid canvas');
        const drawing = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        drawing.setAttribute('viewBox', `0 0 ${canvas.data.width || 1200} ${canvas.data.height || 760}`);
        drawing.setAttribute('role', 'img'); drawing.setAttribute('aria-label', this.file);
        drawing.classList.add('cm-wiki-canvas-preview');
        drawCanvasElements(drawing, canvas.data, color => state.theme === 'dark' && ['#20211e', '#353630', '#373832', '#000', '#000000'].includes(color || '#20211e') ? '#ffffff' : color || '#20211e', new Set(), true);
        preview.append(drawing);
      } else if (isPlayable) {
        const player = createMediaPlayer(asset, this.file, { embedded: true, settingsKey: `${state.vault?.path}/${this.file}` });
        player.media.addEventListener('loadedmetadata', () => { if (preview.isConnected) view.requestMeasure(); });
        preview.append(player);
      } else if (asset.mime.startsWith('image/')) {
        const image = document.createElement('img'); image.className = 'cm-wiki-image-preview'; image.alt = this.file; image.loading = 'lazy';
        image.addEventListener('load', () => { if (preview.isConnected) view.requestMeasure(); });
        image.src = asset.data; preview.append(image);
        attachMediaResize(preview, view, this.previewSize, saveSize, image);
      } else if (['.obj', '.stl', '.step', '.stp'].includes(extension)) {
        const viewport = document.createElement('span'); viewport.className = 'cm-wiki-3d-preview'; preview.append(viewport);
        attachMediaResize(preview, view, this.previewSize, saveSize);
        void mountInlineModelPreview(viewport, this.file, asset, preview);
      }
      view.requestMeasure();
    }).catch((problem) => {
      if (!preview.isConnected || preview.__disposed) return;
      preview.classList.add('is-error');
      const error = document.createElement('span'); error.textContent = `Preview unavailable · ${this.file}${isSpreadsheet || isGraph ? ` · ${problem.message}` : ''}`; preview.replaceChildren(edit, error);
      void refreshExplorer().catch(() => {});
    });
    preview.addEventListener('pointerdown', (event) => event.stopPropagation());
    preview.addEventListener('mousedown', (event) => event.stopPropagation());
    return preview;
  }
  destroy(dom) { dom.__disposed = true; disposeMediaPlayers(dom); dom.__disposePreview?.(); }
  eq(other) { return other.file === this.file && other.from === this.from && other.to === this.to && other.rawLink === this.rawLink && other.revision === this.revision; }
}
const taskPreviewCache = new Map();
function decodeTaskReferencePart(value) { try { return decodeURIComponent(value); } catch { return value; } }
function taskReferenceSyntax(listName, taskName) { return `;;${encodeURIComponent(listName)}/${encodeURIComponent(taskName)};;`; }
async function resolveTaskReference(listName, taskName, fresh = false) {
  const key = `${listName.toLocaleLowerCase()}\u0000${taskName.toLocaleLowerCase()}`;
  const cached = taskPreviewCache.get(key);
  if (!fresh && cached && Date.now() - cached.time < 15000) return cached.promise;
  const promise = (async () => {
    const lists = await window.stillnote.listGoogleTaskLists();
    const matchingLists = lists.filter((list) => String(list.title || '').trim().toLocaleLowerCase() === listName.toLocaleLowerCase());
    if (matchingLists.length !== 1) throw new Error(matchingLists.length ? `More than one task list is named “${listName}”.` : `Task list “${listName}” was not found.`);
    const tasks = await window.stillnote.listGoogleTasks(matchingLists[0].id);
    const matchingTasks = tasks.filter((task) => String(task.title || '').trim().toLocaleLowerCase() === taskName.toLocaleLowerCase());
    if (matchingTasks.length !== 1) throw new Error(matchingTasks.length ? `More than one task is named “${taskName}”.` : `Task “${taskName}” was not found.`);
    return { list: matchingLists[0], task: matchingTasks[0] };
  })();
  taskPreviewCache.set(key, { time: Date.now(), promise });
  try { return await promise; } catch (error) { if (taskPreviewCache.get(key)?.promise === promise) taskPreviewCache.delete(key); throw error; }
}
function replaceTaskReferenceInEditor(view, source, approximateFrom, approximateTo, replacement) {
  if (view !== state.view) return false;
  const document = view.state.doc.toString();
  let from = approximateFrom, to = approximateTo;
  if (document.slice(from, to) !== source) {
    from = document.indexOf(source, Math.max(0, approximateFrom - 200));
    if (from < 0) return false;
    to = from + source.length;
  }
  view.dispatch({ changes: { from, to, insert: replacement }, selection: { anchor: from + replacement.length }, scrollIntoView: true });
  return true;
}
class TaskReferenceWidget extends WidgetType {
  constructor(listName, taskName, source, from, to) { super(); this.listName = listName; this.taskName = taskName; this.source = source; this.from = from; this.to = to; }
  toDOM(view) {
    const preview = document.createElement('span'); preview.className = 'cm-task-preview is-loading';
    preview.addEventListener('contextmenu', (event) => showTaskContextMenu(event, this.listName, this.taskName));
    preview.innerHTML = `<span class="cm-task-preview-status"></span><span class="cm-task-preview-copy"><strong>${escapeHtml(this.taskName)}</strong><small>${escapeHtml(this.listName)} · Loading task…</small></span>`;
    const stop = (event) => event.stopPropagation(); preview.addEventListener('pointerdown', stop); preview.addEventListener('mousedown', stop); preview.addEventListener('click', stop);
    resolveTaskReference(this.listName, this.taskName).then(({ list, task }) => {
      if (!preview.isConnected || preview.__disposed) return;
      if (task.status === 'completed') { replaceTaskReferenceInEditor(view, this.source, this.from, this.to, ''); return; }
      preview.className = 'cm-task-preview'; preview.replaceChildren();
      const complete = document.createElement('input'); complete.type = 'checkbox'; complete.className = 'cm-task-preview-complete'; complete.setAttribute('aria-label', `Complete ${task.title}`);
      const fields = document.createElement('span'); fields.className = 'cm-task-preview-fields';
      const title = document.createElement('input'); title.className = 'cm-task-preview-title'; title.value = task.title || this.taskName; title.maxLength = 1024; title.setAttribute('aria-label', 'Task title');
      const backlinkLines = String(task.notes || '').split(/\r?\n/).filter((line) => /^Stillnote note:\s+stillnote:\/\/open\?/i.test(line.trim()));
      let editableNotes = String(task.notes || '').split(/\r?\n/).filter((line) => !/^Stillnote note:\s+stillnote:\/\/open\?/i.test(line.trim())).join('\n').trim();
      const details = document.createElement('textarea'); details.className = 'cm-task-preview-details'; details.value = editableNotes; details.rows = 2; details.maxLength = 8192; details.placeholder = 'Add task details…'; details.setAttribute('aria-label', 'Task details');
      const meta = document.createElement('small'); meta.textContent = list.title || this.listName;
      fields.append(title, details, meta); preview.append(complete, fields);
      const setBusy = (busy) => { complete.disabled = busy; title.disabled = busy; details.disabled = busy; preview.classList.toggle('is-busy', busy); };
      complete.addEventListener('change', async () => {
        if (!complete.checked) return;
        setBusy(true);
        try { await window.stillnote.updateGoogleTask(list.id, task.id, { status: 'completed' }); taskPreviewCache.clear(); replaceTaskReferenceInEditor(view, this.source, this.from, this.to, ''); view.focus(); }
        catch (error) { complete.checked = false; setBusy(false); showToast(error.message || 'Could not complete task.'); }
      });
      title.addEventListener('change', async () => {
        const nextTitle = title.value.trim(); if (!nextTitle || nextTitle === task.title) { title.value = task.title; return; }
        setBusy(true);
        try {
          const updated = await window.stillnote.updateGoogleTask(list.id, task.id, { title: nextTitle });
          const finalTitle = updated.title || nextTitle; taskPreviewCache.clear();
          replaceTaskReferenceInEditor(view, this.source, this.from, this.to, taskReferenceSyntax(list.title || this.listName, finalTitle));
        } catch (error) { title.value = task.title; setBusy(false); showToast(error.message || 'Could not rename task.'); }
      });
      details.addEventListener('change', async () => {
        if (details.value.trim() === editableNotes) return;
        setBusy(true);
        try { const notes = `${details.value.trim()}${details.value.trim() && backlinkLines.length ? '\n\n' : ''}${backlinkLines.join('\n')}`; const updated = await window.stillnote.updateGoogleTask(list.id, task.id, { notes }); task.notes = updated.notes || notes; editableNotes = details.value.trim(); details.value = editableNotes; taskPreviewCache.clear(); }
        catch (error) { details.value = editableNotes; showToast(error.message || 'Could not update task details.'); }
        finally { if (preview.isConnected) setBusy(false); }
      });
    }).catch((error) => { if (preview.isConnected) { preview.className = 'cm-task-preview is-error'; preview.querySelector('small').textContent = error.message || 'Task unavailable'; } });
    return preview;
  }
  eq(other) { return other.source === this.source && other.from === this.from && other.to === this.to; }
}
function showDesmosPreview(source, x, y) {
  document.querySelector('.equation-preview')?._dismiss?.();
  const popup = document.createElement('section'); popup.className = 'equation-preview'; popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-label', 'Desmos equation preview');
  popup.style.left = `${Math.min(x, innerWidth - 440)}px`; popup.style.top = `${Math.min(y, innerHeight - 330)}px`;
  popup.innerHTML = '<div class="equation-preview-graph"></div>';
  const dismiss = (event) => { if (event && popup.contains(event.target)) return; document.removeEventListener('pointerdown', dismiss); popup._calculator?.destroy?.(); popup.remove(); };
  popup._dismiss = () => dismiss();
  document.body.append(popup); document.addEventListener('pointerdown', dismiss);
  const mount = () => { if (!popup.isConnected) return; if (!window.Desmos) { popup.querySelector('.equation-preview-graph').textContent = 'Desmos could not be loaded. Check your internet connection.'; return; } const calculator = window.Desmos.GraphingCalculator(popup.querySelector('.equation-preview-graph'), { expressions: false, settingsMenu: false, zoomButtons: true }); const latex = source.replace(/\/(alpha|beta|gamma|delta|epsilon|theta|lambda|mu|pi|rho|sigma|tau|phi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Pi|Sigma|Phi|Psi|Omega|int|infty|sum|prod|frac|sqrt|cdot|times|le|ge|neq|pm)\b/g, (_match, command) => `\\${command}`); calculator.setExpression({ id: 'equation', latex }); popup._calculator = calculator; };
  if (window.Desmos) mount(); else { let script = document.querySelector('#desmos-api'); if (!script) { script = document.createElement('script'); script.id = 'desmos-api'; script.src = 'https://www.desmos.com/api/v1.11/calculator.js?apiKey=dcb31709b452b1cf9dc26972add0fda6'; script.onload = mount; script.onerror = () => { if (popup.isConnected) popup.querySelector('.equation-preview-graph').textContent = 'Desmos could not be loaded. Check your internet connection.'; }; document.head.append(script); } else script.addEventListener('load', mount, { once: true }); }
}
function makeLiveMarkdownDecorations(view) {
  const decorations = [];
  const activeLines = new Set(view.state.selection.ranges.map((range) => view.state.doc.lineAt(range.head).number));
  const listLines = new Set();
  const fencedCodeRanges = [];
  syntaxTree(view.state).iterate({ enter(node) { if (node.type.name === 'FencedCode') fencedCodeRanges.push([node.from, node.to]); } });
  const equationRanges = [];
  for (let number = 1; number <= view.state.doc.lines; number++) {
    const line = view.state.doc.line(number);
    if (fencedCodeRanges.some(([from, to]) => line.from >= from && line.to <= to)) continue;
    const matcher = /(?<!\$)\$([^\s$](?:[^$\n]*?[^\s$])?)\$(?!\$)/g; let match;
    while ((match = matcher.exec(line.text))) {
      const from = line.from + match.index, to = from + match[0].length;
      if (!syntaxTree(view.state).resolveInner(from + 1).type.is('InlineCode')) equationRanges.push({ from, to, source: match[1], line: number });
    }
  }
  const emphasisRanges = [];
  syntaxTree(view.state).iterate({
    enter(node) {
      const name = node.type.name;
      const line = view.state.doc.lineAt(node.from);
      if (name !== 'FencedCode' && equationRanges.some(({ from, to }) => node.from < to && node.to > from)) return;
      if ((name === 'Emphasis' || name === 'StrongEmphasis') && node.to > node.from) emphasisRanges.push([node.from, node.to]);
      if (name === 'TaskMarker' && node.to > node.from) {
        const marker = view.state.doc.sliceString(node.from, node.to);
        decorations.push(Decoration.replace({ widget: new TaskCheckboxWidget(/\[[xX]\]/.test(marker), node.from, node.to) }).range(node.from, node.to));
        return;
      }
      if (name === 'ListMark' && node.to > node.from) {
        const marker = view.state.doc.sliceString(node.from, node.to);
        if (/^[*+-]$/.test(marker.trim())) {
          const isTaskListLine = /^\s*[-*+]\s+\[[ xX]\](?:\s|$)/.test(line.text);
          decorations.push(isTaskListLine ? Decoration.replace({}).range(node.from, node.to) : Decoration.replace({ widget: new TextWidget('•', 'cm-md-bullet') }).range(node.from, node.to));
          if (!listLines.has(line.from)) {
            decorations.push(Decoration.line({ class: 'cm-md-list-line' }).range(line.from));
            listLines.add(line.from);
          }
        } else {
          decorations.push(Decoration.replace({ widget: new TextWidget(marker.trim(), 'cm-md-ordered-marker') }).range(node.from, node.to));
        }
        return;
      }
      const heading = name.match(/^(?:ATX|Setext)Heading([1-6])$/);
      if (heading && node.to > node.from) decorations.push(Decoration.mark({ class: `cm-md-heading cm-md-h${heading[1]}` }).range(node.from, node.to));
      const marks = {
        Emphasis: 'cm-md-emphasis', StrongEmphasis: 'cm-md-strong', Strikethrough: 'cm-md-strikethrough',
        InlineCode: 'cm-md-inline-code', Link: 'cm-md-link', Image: 'cm-md-image', FencedCode: 'cm-md-code-block',
      };
      if (marks[name] && node.to > node.from) decorations.push(Decoration.mark({ class: marks[name] }).range(node.from, node.to));
      if (markdownMarkers.has(name) && node.to > node.from) {
        const caretInEmphasis = name === 'EmphasisMark' && emphasisRanges.some(([from, to]) =>
          node.from >= from && node.to <= to && view.state.selection.ranges.some((range) => range.head >= from && range.head <= to));
        if (name === 'EmphasisMark' ? !caretInEmphasis : !activeLines.has(line.number)) decorations.push(Decoration.replace({}).range(node.from, node.to));
      }
    },
  });
  for (let number = 1; number <= view.state.doc.lines; number++) {
    const line = view.state.doc.line(number);
    const isInsideCode = fencedCodeRanges.some(([from, to]) => line.from >= from && line.to <= to);
    if (!isInsideCode) {
      const taskMatcher = /;;([^;\n/]+)\/([^;\n]+?);;/g; let taskMatch;
      while ((taskMatch = taskMatcher.exec(line.text))) {
        const from = line.from + taskMatch.index, to = from + taskMatch[0].length;
        if (syntaxTree(view.state).resolveInner(from + 2).type.is('InlineCode')) continue;
        const caretTouches = view.state.selection.ranges.some(({ head }) => head >= from && head <= to);
        if (!caretTouches) decorations.push(Decoration.replace({ widget: new TaskReferenceWidget(decodeTaskReferencePart(taskMatch[1].trim()), decodeTaskReferencePart(taskMatch[2].trim()), taskMatch[0], from, to) }).range(from, to));
        else decorations.push(Decoration.mark({ class: 'cm-md-task-link' }).range(from, to));
      }
      const wikiMatcher = /(?:<\[([^\]]+)\]>|\[\[([^\]]+)\]\])/g; let wikiMatch;
      while ((wikiMatch = wikiMatcher.exec(line.text))) {
        const from = line.from + wikiMatch.index, to = from + wikiMatch[0].length;
        if (syntaxTree(view.state).resolveInner(from + 2).type.is('InlineCode')) continue;
        const reference = (wikiMatch[1] || wikiMatch[2]).split('|')[0];
        const { path: target, fragment: endCell, previewSize } = parseVaultLink(reference);
        const linkedFile = resolveVaultFileTarget(target);
        const extension = linkedFile ? `.${fileExtension(linkedFile)}` : '';
        const media = shouldRenderFileLink(reference,findExplorerNode(linkedFile)?.format,extension);
        const caretTouches = view.state.selection.ranges.some(({ head }) => head >= from && head <= to);
        if (media && !caretTouches) decorations.push(Decoration.replace({ widget: new WikiMediaWidget(linkedFile, from, to, wikiMatch[0], endCell, previewSize, vaultRenderRevision) }).range(from, to));
        else decorations.push(Decoration.mark({ class: `cm-md-wiki-link${isBrokenVaultLink(reference) ? ' is-broken' : ''}`, attributes: { title: isBrokenVaultLink(reference) ? 'Linked file not found' : target } }).range(from, to));
      }
      for (const equation of equationRanges.filter((entry) => entry.line === number)) if (!activeLines.has(number)) decorations.push(Decoration.replace({ widget: new EquationWidget(equation.source, equation.from, equation.to) }).range(equation.from, equation.to));
      const highlightMatcher = /(^|[\s([{])=([^=\n]+)=(?=$|[\s.,!?;:)\]}])/g;
      let highlight;
      while ((highlight = highlightMatcher.exec(line.text))) {
        const start = line.from + highlight.index + highlight[1].length;
        const contentStart = start + 1, contentEnd = start + highlight[0].length - highlight[1].length - 1;
        if (contentEnd <= contentStart) continue;
        decorations.push(Decoration.mark({ class: 'cm-md-highlight' }).range(contentStart, contentEnd));
        if (!activeLines.has(number)) {
          decorations.push(Decoration.replace({}).range(start, start + 1));
          decorations.push(Decoration.replace({}).range(contentEnd, contentEnd + 1));
        }
      }
    }
    if (line.text.trim() === '---' && !isInsideCode) {
      decorations.push(Decoration.line({ class: 'cm-md-horizontal-rule-line' }).range(line.from));
      decorations.push(Decoration.replace({ widget: new HorizontalRuleWidget() }).range(line.from, line.to));
    }
  }
  return Decoration.set(decorations, true);
}
function getNoteIndexTargets(view) {
  const headings = [], highlights = [];
  const doc = view.state.doc, codeLines = new Set();
  let activeFence = null;
  const cleanHeadingPrefix = (text) => text.replace(/^\s{0,3}(?:>\s?)+/, '');
  for (let number = 1; number <= doc.lines; number++) {
    const line = doc.line(number), text = cleanHeadingPrefix(line.text);
    const fence = text.match(/^ {0,3}(`{3,}|~{3,})/);
    if (activeFence) {
      codeLines.add(number);
      if (fence && fence[1][0] === activeFence.char && fence[1].length >= activeFence.length && !text.slice(fence[0].length).trim()) activeFence = null;
      continue;
    }
    if (fence) { activeFence = { char: fence[1][0], length: fence[1].length }; codeLines.add(number); continue; }
    const atx = text.match(/^ {0,3}(#{1,2})(?:[ \t]+|$)(.*?)\s*#*\s*$/);
    if (atx) { headings.push({ from: line.from, label: atx[2].trim() || 'Heading' }); continue; }
    if (number < doc.lines && text.trim()) {
      const next = cleanHeadingPrefix(doc.line(number + 1).text);
      const setext = next.match(/^ {0,3}(=+|-+)\s*$/);
      if (setext && !codeLines.has(number + 1)) headings.push({ from: line.from, label: text.trim() || 'Heading' });
    }
  }
  // For setext headings, retain only H1/H2 underlines; the pattern above
  // intentionally maps both underline styles to the two supported levels.
  const text = view.state.doc.toString(), code = [];
  syntaxTree(view.state).iterate({ enter(node) { if (node.type.name === 'FencedCode') code.push([node.from, node.to]); } });
  const matcher = /(^|[\s([{])=([^=\n]+)=(?=$|[\s.,!?;:)\]}])/g;
  let match;
  while ((match = matcher.exec(text))) {
    const from = match.index + match[1].length;
    if (code.some(([start, end]) => from >= start && from < end)) continue;
    highlights.push({ from, label: match[2].trim() || 'Highlight' });
  }
  return { headings, highlights };
}
function renderNoteIndexes(view) {
  const nav = $('#note-indexes');
  if (!nav || view !== state.view) return;
  const groups = getNoteIndexTargets(view);
  const entries = [...groups.headings.map((entry) => ({ ...entry, kind: 'heading' })), ...groups.highlights.map((entry) => ({ ...entry, kind: 'highlight' }))].sort((a, b) => a.from - b.from);
  nav.replaceChildren();
  entries.forEach((entry) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = `note-index-entry note-index-${entry.kind}`;
    const label = Array.from(entry.label); button.textContent = label.length > 10 ? `${label.slice(0, 10).join('')}...` : entry.label;
    button.title = entry.label; button.setAttribute('aria-label', `${entry.kind === 'heading' ? 'Heading' : 'Highlight'}: ${entry.label}`);
    button.addEventListener('click', () => jumpToNoteIndex(view, entry.from)); nav.append(button);
  });
  nav.hidden = !nav.childElementCount;
  positionNoteIndexes();
  updateNoteIndexCurrent(view);
}
function positionNoteIndexes() {
  const nav = $('#note-indexes'), editor = $('#note-editor');
  if (!nav || !editor || nav.hidden) return;
  const rect = editor.getBoundingClientRect();
  nav.style.setProperty('--note-index-top', `${rect.top + rect.height / 2}px`);
  nav.style.setProperty('--note-index-left', `${rect.left + ($('#note-editor').dataset.toolbarPosition === 'left' ? 58 : 12)}px`);
}
window.addEventListener('resize', positionNoteIndexes);
new ResizeObserver(positionNoteIndexes).observe($('#note-editor'));
window.addEventListener('mousemove', (event) => {
  const nav = $('#note-indexes'), editor = $('#note-editor');
  if (!nav || nav.hidden || editor.hidden) return;
  const left = Number.parseFloat(nav.style.getPropertyValue('--note-index-left')) || 0;
  const centerY = Number.parseFloat(nav.style.getPropertyValue('--note-index-top')) || window.innerHeight / 2;
  const halfHeight = nav.offsetHeight / 2;
  const visible = nav.classList.contains('is-visible');
  const near = event.clientX >= left - (visible ? 96 : 80)
    && event.clientX <= left + (visible ? Math.max(nav.offsetWidth + 36, 170) : 145)
    && event.clientY >= centerY - halfHeight - 36 && event.clientY <= centerY + halfHeight + 36;
  nav.classList.toggle('is-visible', near);
});
window.addEventListener('blur', () => $('#note-indexes')?.classList.remove('is-visible'));
function updateNoteIndexCurrent(view) {
  const nav = $('#note-indexes');
  if (!nav || view !== state.view) return;
  const groups = getNoteIndexTargets(view), scroller = view.scrollDOM;
  const entries = [...groups.headings.map((entry) => ({ ...entry, kind: 'heading' })), ...groups.highlights.map((entry) => ({ ...entry, kind: 'highlight' }))].sort((a, b) => a.from - b.from);
  const scrollTop = scroller.getBoundingClientRect().top + 64;
  let nearest = -1, nearestDistance = Infinity;
  entries.forEach((entry, index) => { const coords = view.coordsAtPos(entry.from); if (!coords) return; const distance = Math.abs(coords.top - scrollTop); if (distance < nearestDistance) { nearest = index; nearestDistance = distance; } });
  nav.querySelectorAll('.note-index-entry').forEach((button, index) => { const active = index === nearest; button.classList.toggle('is-current', active); button.setAttribute('aria-current', active ? 'location' : 'false'); });
}
function jumpToNoteIndex(view, position) {
  view.dispatch({ selection: { anchor: position } });
  view.focus();
  const scroller = view.scrollDOM;
  const block = view.lineBlockAt(position);
  const targetCenter = view.documentTop + block.top + block.height / 2;
  const scrollerRect = scroller.getBoundingClientRect();
  const visibleCenter = scrollerRect.top + scroller.clientTop + scroller.clientHeight / 2;
  const previousBehavior = scroller.style.scrollBehavior;
  scroller.style.scrollBehavior = 'auto';
  scroller.scrollTop += targetCenter - visibleCenter;
  scroller.style.scrollBehavior = previousBehavior;
}
const liveMarkdown = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = makeLiveMarkdownDecorations(view); }
  update(update) {
    if (update.docChanged || update.selectionSet || update.viewportChanged || update.transactions.some(transaction => transaction.effects.some(effect => effect.is(refreshFileLinksEffect)))) this.decorations = makeLiveMarkdownDecorations(update.view);
  }
}, { decorations: (plugin) => plugin.decorations });

function wrapEditorSelection(view, marker) {
  const selection = view.state.selection.main;
  const selected = view.state.sliceDoc(selection.from, selection.to);
  const insert = `${marker}${selected}${marker}`;
  const anchor = selection.empty ? selection.from + marker.length : selection.from + marker.length;
  const head = selection.empty ? anchor : anchor + selected.length;
  view.dispatch({ changes: { from: selection.from, to: selection.to, insert }, selection: { anchor, head }, scrollIntoView: true });
  return true;
}
function setEditorLinePrefix(view, prefix, kind) {
  const selection = view.state.selection.main;
  const first = view.state.doc.lineAt(selection.from);
  const last = view.state.doc.lineAt(selection.to);
  const lines = [];
  for (let number = first.number; number <= last.number; number++) lines.push(view.state.doc.line(number));
  if (kind === 'heading') {
    const markers = lines.map((line) => ({
      from: line.from,
      to: line.from + (line.text.match(/^#{1,6}\s+/)?.[0].length ?? 0),
      insert: prefix ? `${prefix} ` : '',
    }));
    const changes = view.state.changes(markers);
    const mapPosition = (position) => {
      const marker = markers[view.state.doc.lineAt(position).number - first.number];
      return marker && position <= marker.to
        ? changes.mapPos(marker.from, -1) + marker.insert.length
        : changes.mapPos(position);
    };
    view.dispatch({
      changes,
      selection: { anchor: mapPosition(selection.anchor), head: mapPosition(selection.head) },
      scrollIntoView: true,
    });
    view.focus();
    return;
  }
  const original = lines.map((line) => line.text);
  const next = original.map((text) => {
    if (kind === 'task') {
      if (/^(\s*)[-*+]\s+\[[ xX]\]\s+/.test(text)) return text.replace(/^(\s*)[-*+]\s+\[[ xX]\]\s+/, '$1');
      if (/^(\s*)[-*+]\s+/.test(text)) return text.replace(/^(\s*)[-*+]\s+/, `$1${prefix}`);
      return `${prefix}${text}`;
    }
    if (kind === 'ordered' && /^\s*\d+\.\s+/.test(text)) return text.replace(/^\s*\d+\.\s+/, '');
    if (kind === 'bullet' && /^\s*[-*+]\s+/.test(text)) return text.replace(/^\s*[-*+]\s+/, '');
    return `${prefix}${text}`;
  });
  view.dispatch({ changes: { from: first.from, to: last.to, insert: next.join('\n') }, scrollIntoView: true });
  view.focus();
}
function openWikiLinkAt(view, event) {
  const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (position == null) return false;
  const line = view.state.doc.lineAt(position);
  const offset = position - line.from;
  const matcher = /(?:<\[([^\]]+)\]>|\[\[([^\]]+)\]\])/g;
  let match;
  while ((match = matcher.exec(line.text))) {
    if (offset < match.index || offset > match.index + match[0].length) continue;
    if (syntaxTree(view.state).resolveInner(line.from + match.index + 2).type.is('InlineCode')) return false;
    const target = (match[1] || match[2]).split('|')[0].trim();
    event.preventDefault();
    void navigateWikiTarget(target);
    return true;
  }
  return false;
}
function wordRangeAt(view, position) {
  const line = view.state.doc.lineAt(position), matcher = /[\p{L}]+(?:['’][\p{L}]+)?/gu;
  let match;
  while ((match = matcher.exec(line.text))) {
    const from = line.from + match.index, to = from + match[0].length;
    if (position >= from && position <= to) return { from, to, word: match[0] };
  }
  return null;
}
function closeEditorContextMenu() { $('#editor-context-menu').hidden = true; }
function showEditorContextMenu(view, event, position, wordRange) {
  const menu = $('#editor-context-menu'); menu.replaceChildren();
  const addAction = (label, action, disabled = false) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'context-action'; button.textContent = label; button.disabled = disabled;
    button.addEventListener('click', () => { closeEditorContextMenu(); action(); view.focus(); }); menu.append(button);
  };
  if (wordRange && dictionary && !isKnownWord(wordRange.word)) {
    const suggestions = spellingSuggestions(wordRange.word);
    if (suggestions.length) {
      for (const suggestion of suggestions) {
        const replacement = wordRange.word === wordRange.word.toLocaleUpperCase() ? suggestion.toLocaleUpperCase() : /^[A-Z]/.test(wordRange.word) ? suggestion[0].toLocaleUpperCase() + suggestion.slice(1) : suggestion;
        addAction(`Correct to “${replacement}”`, () => view.dispatch({ changes: { from: wordRange.from, to: wordRange.to, insert: replacement }, selection: { anchor: wordRange.from + replacement.length }, scrollIntoView: true }));
      }
    } else addAction(`No suggestions for “${wordRange.word}”`, () => {}, true);
    const normalized = wordRange.word.toLocaleLowerCase();
    addAction(`Add “${wordRange.word}” to dictionary`, () => { addCustomWord(normalized); });
  }
  menu.hidden = false;
  menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - 230))}px`;
  menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - menu.offsetHeight - 8))}px`;
}
async function handleEditorContextMenu(view, event) {
  if (state.active?.toLocaleLowerCase().endsWith('.md') && openWikiLinkAt(view, event)) return;
  const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (position == null) return;
  const wordRange = wordRangeAt(view, position);
  if (!wordRange) return;
  event.preventDefault();
  try { await getSpellDictionary(); } catch {}
  if (view !== state.view) return;
  if (isKnownWord(wordRange.word)) return;
  view.dispatch({ selection: { anchor: wordRange.from, head: wordRange.to } });
  closeEditorContextMenu();
  showEditorContextMenu(view, event, position, wordRange);
}
function isKnownWord(word) {
  const normalized = word.toLocaleLowerCase().replace(/’/g, "'");
  return customDictionary.has(normalized) || Boolean(dictionary?.has(normalized));
}

function showToast(message) {
  const toast = $('#toast'); toast.textContent = message; toast.hidden = false;
  clearTimeout(showToast.timer); showToast.timer = setTimeout(() => { toast.hidden = true; }, 2400);
}
function prettyName(path) { return path.split('/').at(-1).replace(/\.md$/i, ''); }
function fileLabel(path, format = findExplorerNode(path)?.format) { return fileDisplayName(path, format); }
function fileLabelPath(path) {
  const parts = path.split('/'); parts[parts.length - 1] = fileLabel(path);
  return parts.join(' / ');
}
function fileLabelHtml(path, format = findExplorerNode(path)?.format) {
  const filename = path.split('/').at(-1);
  const display = fileDisplayParts(path, format);
  const dot = filename.lastIndexOf('.');
  const extension = display.extension || (dot > 0 ? filename.slice(dot) : '');
  const name = display.extension ? display.name : dot > 0 ? filename.slice(0, dot) : filename;
  const characters = Array.from(name);
  const tailLength = Math.min(4, Math.floor(characters.length / 2));
  const split = characters.length - tailLength;
  const head = characters.slice(0, split).join('');
  const tail = characters.slice(split).join('');
  return `<span class="file-name" title="${escapeHtml(name + extension)}"><span class="file-name-base">${escapeHtml(head)}</span><span class="file-name-tail">${escapeHtml(tail)}<span class="file-type-extension">${escapeHtml(extension)}</span></span></span>`;
}

const codeFileTypes = [
  ['Plain text', '.txt'], ['CSV data', '.csv'], ['TSV data', '.tsv'], ['JavaScript', '.js'], ['CommonJS JavaScript', '.cjs'], ['ES module JavaScript', '.mjs'], ['TypeScript', '.ts'], ['React JSX', '.jsx'], ['React TypeScript', '.tsx'],
  ['Python', '.py'], ['HTML', '.html'], ['CSS', '.css'], ['JSON', '.json'], ['Java', '.java'], ['C', '.c'], ['C header', '.h'], ['C++', '.cpp'], ['C++ header', '.hpp'],
  ['Rust', '.rs'], ['Go', '.go'], ['SQL', '.sql'], ['Shell script', '.sh'], ['XML', '.xml'], ['YAML', '.yaml'], ['YAML', '.yml'], ['TOML', '.toml'], ['Swift', '.swift'], ['Kotlin', '.kt'], ['Ruby', '.rb'], ['PHP', '.php'],
];
const editableAssetExtensions = new Set(codeFileTypes.map(([, extension]) => extension).concat('.jar'));
function fileExtension(file) { return file.split('/').at(-1).split('.').at(-1).toLowerCase(); }
function isEditableAsset(file) { return editableAssetExtensions.has(`.${fileExtension(file)}`); }
function codeLanguage(file) {
  const extension = `.${fileExtension(file)}`;
  if (['.js', '.cjs', '.mjs', '.jsx', '.ts', '.tsx'].includes(extension)) return javascript({ typescript: ['.ts', '.tsx'].includes(extension), jsx: ['.jsx', '.tsx'].includes(extension) });
  if (extension === '.py') return python();
  if (['.html', '.xml'].includes(extension)) return html();
  if (extension === '.css') return css();
  if (extension === '.json') return json();
  return [];
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
function inlineMarkdownForPdf(value) {
  let text = escapeHtml(value);
  const code = [];
  text = text.replace(/`([^`]+)`/g, (_match, content) => { const token = `@@CODE${code.length}@@`; code.push(`<code>${content}</code>`); return token; });
  text = text.replace(/\[([^\]]+)\]\((https?:[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/(?:&lt;\[([^\]|]+)(?:\|([^\]]+))?\]&gt;|\[\[([^\]|]+)(?:\|([^\]]+))?\]\])/g, (_all, newTarget, newLabel, oldTarget, oldLabel) => `<span class="wiki-link">${newLabel || newTarget || oldLabel || oldTarget}</span>`)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/_(.+?)_/g, '<em>$1</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>');
  return text.replace(/@@CODE(\d+)@@/g, (_match, index) => code[Number(index)]);
}
function renderMarkdownForPdf(markdownText, title, replacements = new Map()) {
  const source = String(markdownText).split(/\r?\n/);
  if (source.length && source[0].trim().replace(/^#{1,6}\s+/, '').toLocaleLowerCase() === title.toLocaleLowerCase()) source.shift();
  const blocks = []; let listType = null; let inCode = false; let codeLines = [];
  const closeList = () => { if (listType) { blocks.push(`</${listType}>`); listType = null; } };
  const isBlockStart = (line) => /^\s*(```|#{1,6}\s|>|-{3,}\s*$|(?:[-*+]\s+|\d+\.\s+))/.test(line);
  for (let index = 0; index < source.length; index++) {
    const line = source[index];
    if (/^\s*```/.test(line)) {
      closeList();
      if (inCode) { blocks.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`); codeLines = []; inCode = false; }
      else inCode = true;
      continue;
    }
    if (inCode) { codeLines.push(line); continue; }
    if (!line.trim()) { closeList(); continue; }
    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (heading) { closeList(); const level = heading[1].length; blocks.push(`<h${level}>${inlineMarkdownForPdf(heading[2])}</h${level}>`); continue; }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { closeList(); blocks.push('<hr>'); continue; }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) { closeList(); blocks.push(`<blockquote>${inlineMarkdownForPdf(quote[1])}</blockquote>`); continue; }
    const item = line.match(/^\s*(?:([-*+])|(\d+)\.)\s+(.*)$/);
    if (item) {
      const task = item[1] && item[3].match(/^\[([ xX])\]\s+(.*)$/);
      const type = item[2] ? 'ol' : 'ul';
      if (listType !== type) { closeList(); blocks.push(`<${type}>`); listType = type; }
      if (task) blocks.push(`<li class="task ${task[1].trim() ? 'checked' : ''}">${task[1].trim() ? '☑' : '☐'} ${inlineMarkdownForPdf(task[2])}</li>`);
      else blocks.push(`<li>${inlineMarkdownForPdf(item[3])}</li>`);
      continue;
    }
    closeList();
    const paragraph = [line];
    while (index + 1 < source.length && source[index + 1].trim() && !isBlockStart(source[index + 1])) paragraph.push(source[++index]);
    blocks.push(`<div class="pdf-paragraph">${paragraph.map(inlineMarkdownForPdf).join('<br>')}</div>`);
  }
  if (inCode) blocks.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  closeList();
  let html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    *{box-sizing:border-box}body{margin:0;color:#292a27;font:12pt/1.65 Georgia,'Times New Roman',serif}h1{margin:0 0 28pt;font:26pt/1.15 Georgia,'Times New Roman',serif;letter-spacing:-.03em}h2{margin:24pt 0 9pt;font-size:18pt}h3{margin:20pt 0 8pt;font-size:14pt}h4,h5,h6{margin:16pt 0 6pt}p{margin:0 0 12pt}ul,ol{margin:0 0 14pt;padding-left:24pt}li{padding-left:3pt;margin:3pt 0}li.task{list-style:none;margin-left:-17pt}blockquote{margin:12pt 0;padding:2pt 0 2pt 12pt;border-left:2px solid #b8a18b;color:#5d5b54}hr{margin:20pt 0;border:0;border-top:1px solid #c9c5bb}pre{margin:12pt 0;padding:10pt;background:#f2f1ed;border-radius:4pt;white-space:pre-wrap;overflow-wrap:anywhere;font:9pt/1.5 Menlo,monospace}code{padding:1pt 3pt;background:#f0eee9;border-radius:2pt;font:9pt Menlo,monospace}a,.wiki-link{color:#725b49;text-decoration:underline}strong{font-weight:bold}em{font-style:italic}
    .pdf-paragraph{margin:0 0 12pt}.pdf-embed{display:block;margin:10pt 0;max-width:100%;break-inside:avoid}.pdf-embed img,.pdf-embed svg{display:block;max-width:100%;height:auto;max-height:8in;object-fit:contain}.pdf-embed svg{width:100%}.pdf-embed .canvas-text-edit{font:20px/1.4 Georgia,serif;white-space:pre-wrap;overflow-wrap:anywhere}.pdf-embed .canvas-image{clip-path:inset(0 round 8px) fill-box}.cm-wiki-sheet-table{border-collapse:separate;border-spacing:0;table-layout:fixed;width:100%;font:10pt/1.4 Georgia,serif}.cm-wiki-sheet-table tr{break-inside:avoid}.cm-wiki-sheet-table th,.cm-wiki-sheet-table td{padding:5pt 7pt;border:0;text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}.cm-wiki-sheet-table tr+tr>*{border-top:0.5pt solid #b9b6ad}.cm-wiki-sheet-table tr>*+*{border-left:0.5pt solid #b9b6ad}.cm-wiki-sheet-table tr:nth-child(2)>*{border-top-width:1.2pt}.cm-wiki-sheet-table tr>*:nth-child(2){border-left-width:1.2pt}.pdf-task{border:0.5pt solid #d5d0c6;border-radius:5pt;padding:8pt 10pt}.pdf-task small{display:block;color:#777}.pdf-task-details{white-space:pre-wrap}mark{background:#f3e7a9;color:inherit}math{font-size:1.1em}audio,video{display:none!important}
    </style></head><body><main><h1>${escapeHtml(title)}</h1>${blocks.join('\n')}</main></body></html>`;
  for (const [token, rendered] of replacements) html = html.split(token).join(rendered);
  return html;
}
async function prepareNotePdf(markdownText) {
  const cache = new Map();
  const unavailable = (file, error) => `<span class="pdf-embed">Preview unavailable: ${escapeHtml(file)} · ${escapeHtml(error.message || 'Could not render')}</span>`;
  const imageHtml = (src, alt) => `<span class="pdf-embed"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"></span>`;
  const renderLink = async target => {
    const [path, extent = ''] = target.split('#'), file = resolveVaultFileTarget(path);
    if (!file) return undefined;
    const extension = `.${fileExtension(file)}`, format = findExplorerNode(file)?.format;
    if (playableMediaExtensions.includes(extension)) return '';
    if (['graph','geometry','calculator3d'].includes(format)) {
      const parsed=decodeStructured(await window.stillnote.readNote(file));
      return imageHtml(await graphSnapshotForPdf(parsed),file);
    }
    if (format === 'canvas' || format === 'spreadsheet') {
      const parsed = decodeStructured(await window.stillnote.readNote(file));
      if (!parsed?.data) throw new Error('Invalid structured document');
      if (format === 'spreadsheet') return `<span class="pdf-embed">${renderSpreadsheetPreview(parsed.data, extent, file).outerHTML}</span>`;
      const data = structuredClone(parsed.data);
      await Promise.all(data.elements.filter(el => el.type === 'image' && el.link).map(async el => {
        const path = el.link.match(/^<\[([^\]]+)\]>$/)?.[1];
        if (path) { try { el.src = (await window.stillnote.readAsset(path)).data; } catch { el.src = ''; el.missing = true; } }
        if (!el.missing) delete el.link;
      }));
      const drawing = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      drawing.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); drawing.setAttribute('viewBox', `0 0 ${data.width || 1200} ${data.height || 760}`);
      drawCanvasElements(drawing, data, color => color || '#20211e', new Set(), true);
      return `<span class="pdf-embed">${drawing.outerHTML}</span>`;
    }
    if (['.png','.jpg','.jpeg','.webp','.gif','.bmp','.heic','.icns','.svg'].includes(extension)) return imageHtml((await window.stillnote.readAsset(file)).data, file);
    if (['.obj','.stl','.step','.stp'].includes(extension)) return imageHtml(await modelSnapshotForPdf(file, await window.stillnote.readAsset(file)), file);
    return undefined;
  };
  return preparePdfContent(markdownText, {
    escape: escapeHtml,
    link: target => {
      if (!cache.has(target)) cache.set(target, renderLink(target).catch(error => unavailable(target,error)));
      return cache.get(target);
    },
    image: async (target, label) => {
      try {
        if (/^https?:\/\//i.test(target)) return imageHtml(target, label);
        const file = resolveVaultFileTarget(target);
        if (!file) throw new Error('Image not found');
        const asset = await window.stillnote.readAsset(file);
        if (!asset.mime.startsWith('image/')) throw new Error('Not an image');
        return imageHtml(asset.data, label || file);
      } catch(error) { return unavailable(target,error); }
    },
    equation: source => { const math = mathNode('math'); math.setAttribute('display','inline'); math.append(parseMath(source)); return math.outerHTML; },
    task: async (listName, taskName) => {
      try {
        const { list, task } = await resolveTaskReference(decodeTaskReferencePart(listName),decodeTaskReferencePart(taskName));
        if (task.status === 'completed') return '';
        const notes = String(task.notes || '').split(/\r?\n/).filter(line => !/^Stillnote note:\s+stillnote:\/\/open\?/i.test(line.trim())).join('\n').trim();
        return `<span class="pdf-embed pdf-task"><strong>☐ ${escapeHtml(task.title || taskName)}</strong><small>${escapeHtml(list.title || listName)}</small>${notes ? `<span class="pdf-task-details">${escapeHtml(notes)}</span>` : ''}</span>`;
      } catch(error) { return unavailable(taskName,error); }
    },
  });
}
async function graphSnapshotForPdf(parsed) {
  if(!parsed)throw new Error('Invalid graph file');
  const host=document.createElement('div');host.style.cssText='position:fixed;left:-2000px;top:0;width:1000px;height:650px';document.body.append(host);
  const instance=createGraphPreview(host,parsed.type,parsed.data,{getKey:()=>window.stillnote.getDesmosKey(),loadApi:loadDesmosApi});
  try { return await instance.screenshot(); } finally { instance.destroy();host.remove(); }
}
async function modelSnapshotForPdf(file, asset) {
  let renderer, group;
  try {
    ({ group } = await createThreeModel(file, asset));
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#f4f4f1'); scene.add(group);
    scene.add(new THREE.HemisphereLight(0xffffff,0x77736a,2.2));
    const light = new THREE.DirectionalLight(0xffffff,2.7); light.position.set(4,7,8); scene.add(light);
    const fill = new THREE.DirectionalLight(0xffffff,1.1); fill.position.set(-6,2,-5); scene.add(fill);
    const bounds = new THREE.Box3().setFromObject(group), center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
    const dimension = Math.max(size.x,size.y,size.z,.001), radius = dimension*.5;
    const camera = new THREE.PerspectiveCamera(42,1000/650,Math.max(dimension/10000,.00001),dimension*1000);
    camera.position.set(radius*3.2,radius*2.5,radius*3.2); camera.lookAt(center);
    renderer = new THREE.WebGLRenderer({ antialias:true, preserveDrawingBuffer:true }); renderer.setSize(1000,650); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.render(scene,camera); return renderer.domElement.toDataURL('image/png');
  } finally {
    group?.traverse(part => { part.geometry?.dispose(); if (part.material) for (const material of Array.isArray(part.material) ? part.material : [part.material]) material.dispose(); });
    renderer?.dispose();
  }
}
async function exportPdf(notePath = state.active) {
  if (!state.vault || !notePath) { showToast('Open a note before exporting a PDF.'); return; }
  try {
    let markdownText;
    if (notePath === state.active && state.view) { await saveActive(); markdownText = state.view.state.doc.toString(); }
    else markdownText = await window.stillnote.readNote(notePath);
    const title = prettyName(notePath);
    const prepared = await prepareNotePdf(markdownText);
    const result = await window.stillnote.exportPdf(notePath, renderMarkdownForPdf(prepared.markdown, title, prepared.replacements));
    if (result) showToast('PDF exported');
  } catch (error) { showToast(error.message || 'Could not export PDF.'); }
}
function isBrokenVaultLink(target) {
  const reference = parseVaultLink(target).target, file = parseVaultLink(target).path;
  return file ? !resolveVaultFileTarget(file) : !reference.startsWith('#') || !state.active;
}
function invalidateVaultLinkRendering() {
  vaultRenderRevision++;
  canvasImageAssets.clear();
  state.view?.dispatch({ effects: refreshFileLinksEffect.of(null) });
  const canvasEditor = document.activeElement?.closest?.('.canvas-text-edit');
  if(canvasEditor)canvasEditor.addEventListener('blur',()=>state.structured?.refreshCanvas?.(),{once:true});
  else state.structured?.refreshCanvas?.();
  document.querySelectorAll('.canvas-image[data-file-target]').forEach(image=>{if(!resolveVaultFileTarget(image.dataset.fileTarget))image.removeAttribute('href');});
  document.querySelectorAll('.sheet-wiki-link').forEach(link => {
    const broken = isBrokenVaultLink(link.dataset.target);
    link.classList.toggle('is-broken', broken); link.setAttribute('aria-invalid', String(broken));
    link.title = broken ? 'Linked file not found' : link.dataset.target;
  });
  if (state.home && state.homeSession) renderHomeTranscript();
}
function refreshVaultLinksIfChanged() {
  const entries=[];const visit=nodes=>{for(const node of nodes)if(node.type==='folder')visit(node.children||[]);else entries.push([node.path,node.format]);};visit(state.tree);
  const signature=JSON.stringify([state.vault?.path,entries]);
  if(signature!==vaultCatalogSignature){vaultCatalogSignature=signature;invalidateVaultLinkRendering();}
}
const linkedFilesPanel = $('.sidebar-linked-files');
let linkedFilesKey = '';

function renderSidebarLinks() {
  if (linkedFilesPanel.hidden) return;
  const targets = new Set();
  const collect = (value) => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(/<\[([^\]\r\n]+)\]>|\[\[([^\]\r\n]+)\]\]/g)) {
        const file = resolveVaultFileTarget(match[1] ?? match[2]);
        if (file) targets.add(file);
      }
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(collect);
    }
  };
  if (state.active) collect(state.structured?.data ?? state.view?.state.doc.toString());
  const key = JSON.stringify([state.vault?.path, state.active, [...targets]]);
  if (key === linkedFilesKey) return;
  linkedFilesKey = key;
  const heading = document.createElement('h2');
  heading.textContent = 'Linked files';
  linkedFilesPanel.replaceChildren(heading);
  if (!targets.size) {
    const empty = document.createElement('p');
    empty.textContent = state.active ? 'No linked files' : 'Open a file to see its links';
    linkedFilesPanel.append(empty);
  }
  for (const file of targets) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'sidebar-linked-file';
    const name = document.createElement('strong');
    name.innerHTML = fileLabelHtml(file);
    const location = document.createElement('span');
    location.textContent = file;
    row.append(name, location);
    row.addEventListener('click', () => void openNote(file));
    linkedFilesPanel.append(row);
    void renderSidebarLinkPreview(row, file).catch(() => {});
  }
}

async function renderSidebarLinkPreview(row, file) {
  const extension = fileExtension(file);
  const video = /^(mp4|webm|ogv|mov|m4v)$/.test(extension);
  const image = /^(png|jpe?g|gif|bmp|webp|heic|icns|svg)$/.test(extension);
  if (video || image) {
    const asset = await window.stillnote.readAsset(file);
    if (!row.isConnected) return;
    if (image) {
      const thumbnail = document.createElement('img');
      thumbnail.alt = '';
      thumbnail.loading = 'lazy';
      thumbnail.src = asset.data;
      row.append(thumbnail);
      return;
    }
    const media = document.createElement('video');
    media.muted = true;
    media.preload = 'auto';
    media.addEventListener('loadeddata', () => {
      if (row.isConnected && media.videoWidth) {
        const thumbnail = document.createElement('canvas');
        thumbnail.width = Math.min(240, media.videoWidth);
        thumbnail.height = Math.round(thumbnail.width * media.videoHeight / media.videoWidth);
        thumbnail.getContext('2d').drawImage(media, 0, 0, thumbnail.width, thumbnail.height);
        row.append(thumbnail);
      }
      media.removeAttribute('src');
      media.load();
    }, { once: true });
    media.src = asset.data;
  } else if (extension === 'md' || isEditableAsset(file)) {
    const text = await window.stillnote.readNote(file);
    if (!row.isConnected) return;
    const structured = extension === 'md' ? decodeStructured(text) : null;
    const excerpt = document.createElement('span');
    excerpt.textContent = structured ? `${fileLabel(file)} · ${structured.type}` : text.trim().slice(0, 220);
    row.append(excerpt);
  }
}

function setSidebarLinksVisible(visible) {
  if (linkedFilesPanel.hidden === !visible) return;
  linkedFilesPanel.hidden = !visible;
  linkedFilesPanel.closest('.sidebar').classList.toggle('show-linked-files', visible);
  if (visible) renderSidebarLinks();
  else {
    linkedFilesPanel.replaceChildren();
    linkedFilesKey = '';
  }
}
document.addEventListener('keydown', (event) => {
  if (event.key === 'Alt' && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    setSidebarLinksVisible(true);
  }
});
document.addEventListener('keyup', (event) => {
  if (!event.altKey) setSidebarLinksVisible(false);
});
window.addEventListener('blur', () => setSidebarLinksVisible(false));

function renderFiles() {
  renderSidebarLinks();
  refreshVaultLinksIfChanged();
  scheduleBacklinks();
  list.innerHTML = '';
  if (!state.files.length) {
    if (!state.tree.length) list.innerHTML = `<div class="empty-files"><span class="empty-file-icon">${icons.folder}</span><span>Folder is empty</span></div>`;
  }
  const addNodes = (nodes, parent, depth = 0) => {
    for (const node of nodes) {
      if (node.type === 'folder') {
        const isCollapsed = state.collapsed.has(node.path);
        const row = document.createElement('button');
        row.className = `folder-row${state.explorerSelection.has(node.path) ? ' selected' : ''}`; row.style.setProperty('--depth', depth);
        row.setAttribute('aria-expanded', String(!isCollapsed));
        row.innerHTML = `<span class="folder-chevron${isCollapsed ? ' is-collapsed' : ''}">${icons.down}</span>${isCollapsed ? icons.folder : icons.folderOpen}<span>${escapeHtml(node.name)}</span>`;
        row.title = node.path; row.addEventListener('click', (event) => { if (selectExplorerNode(node, event.shiftKey)) return; isCollapsed ? state.collapsed.delete(node.path) : state.collapsed.add(node.path); renderFiles(); });
        row.addEventListener('contextmenu', (event) => showExplorerContextMenu(event, node));
        wireExplorerDrag(row, node);
        parent.append(row);
        if (!isCollapsed) addNodes(node.children, parent, depth + 1);
      } else {
        const row = document.createElement('button');
        row.className = `note-row${node.path === state.active || state.explorerSelection.has(node.path) ? ' selected' : ''}`;
        row.style.setProperty('--depth', depth);
        row.innerHTML = `${icons[node.format] || icons.file}${fileLabelHtml(node.name, node.format)}`;
        row.title = node.path; row.addEventListener('click', (event) => { if (selectExplorerNode(node, event.shiftKey)) return; void openNote(node.path); });
        row.addEventListener('contextmenu', (event) => showExplorerContextMenu(event, node)); wireExplorerDrag(row, node); parent.append(row);
      }
    }
  };
  addNodes(state.tree, list);
}
function selectExplorerNode(node, additive = false) {
  if (additive) {
    state.explorerSelection.has(node.path) ? state.explorerSelection.delete(node.path) : state.explorerSelection.add(node.path);
    renderFiles();
    return true;
  }
  state.explorerSelection = new Set([node.path]);
  return false;
}
function findExplorerNode(targetPath, nodes = state.tree) {
  for (const node of nodes) {
    if (node.path === targetPath) return node;
    if (node.type === 'folder') { const found = findExplorerNode(targetPath, node.children || []); if (found) return found; }
  }
  return null;
}
function explorerFilePaths(nodes = state.tree, paths = []) {
  for (const node of nodes) node.type === 'folder' ? explorerFilePaths(node.children || [], paths) : paths.push(node.path);
  return paths;
}
function setExplorerFoldersExpanded(expanded) {
  const visit = (nodes) => {
    for (const node of nodes) if (node.type === 'folder') {
      if (expanded) state.collapsed.delete(node.path); else state.collapsed.add(node.path);
      visit(node.children || []);
    }
  };
  visit(state.tree); renderFiles();
}
async function setVault(vault) {
  if (state.vault?.path !== vault.path) stopHomeRun();
  if (state.vault?.path && state.vault.path !== vault.path) { state.view?.destroy(); state.view = null; state.active = null; $('#editor-content').replaceChildren(); }
  state.vault = vault; state.files = vault.files; state.tree = vault.tree; state.collapsed.clear();
  $('.vault-name').textContent = vault.name; $('.vault-mark').textContent = vault.name.charAt(0).toUpperCase();
  $('#status-vault').textContent = vault.name;
  setSettingsHealth('directory', true, 'Folder open');
  renderFiles();
  await loadCustomDictionaryForVault().catch((error) => {
    customDictionary = new Set(); renderCustomDictionary();
    console.warn('Could not load the personal dictionary for this vault:', error.message);
  });
  const legacyDesmosKey = localStorage.getItem('stillnote-desmos-api-key');
  if (legacyDesmosKey) {
    try {
      const status = await window.stillnote.desmosKeyStatus();
      if (!status.configured) await window.stillnote.saveDesmosKey(legacyDesmosKey);
      localStorage.removeItem('stillnote-desmos-api-key');
    }
    catch (error) { console.warn('Could not migrate the saved Desmos key into the vault:', error.message); }
  }
  await updateDesmosKeyStatus();
}
function showEmptyVault() {
  $('#welcome').hidden = false;
  $('#welcome .eyebrow').textContent = 'VAULT READY';
  $('#welcome h1').innerHTML = 'A fresh page<br><em>is waiting.</em>';
  $('#welcome p').innerHTML = 'Create a note and start collecting your thoughts.';
  $('#open-vault').innerHTML = `Create your first note ${icons.external}`;
  $('#note-editor').hidden = true;
}
async function chooseVault() {
  try {
    await saveActive();
    const vault = await window.stillnote.chooseVault(); if (!vault) return;
    await setVault(vault);
    if (explorerFilePaths().length) await openNote(explorerFilePaths()[0]);
    else showEmptyVault();
    await openPendingDeepLinks();
  } catch (error) { showToast(error.message || 'Could not open that folder.'); }
}
function renderHomeTranscript() {
  const transcript = $('#home-transcript'); if (!transcript || !state.homeSession) return;
  transcript.replaceChildren();
  if (!state.homeSession.messages.length) {
    const empty = document.createElement('section'); empty.className = 'home-empty-state';
    empty.innerHTML = `<div class="home-empty-mark">${icons.assistant}</div><div class="eyebrow">A THOUGHTFUL START</div><h2>${state.homeMode === 'work' ? 'What would you like to get done?' : 'What connects your notes?'}</h2><p>${state.homeMode === 'work' ? 'Plan a project, connect files, analyze data, or create linked tasks. I’ll ask when I need more detail.' : 'Summarize files, compare ideas, and explore their relationships.'}</p><div class="home-prompt-suggestions">${state.homeMode === 'work' ? '<button type="button" data-home-prompt="Help me plan a project using my notes. Ask me what you need before creating files or tasks.">Plan a project</button><button type="button" data-home-prompt="Analyze my data files and identify their relationships. Ask which files and questions to focus on.">Analyze my data</button>' : ''}<button type="button" data-home-prompt="Summarize the ideas I’ve been collecting lately">Summarize my recent ideas</button><button type="button" data-home-prompt="Help me find a note about ">Find a note about…</button><button type="button" data-home-prompt="Explain this concept in a simple way: ">Explain a concept</button></div>`;
    transcript.append(empty);
  }
  for (const message of state.homeSession.messages) {
    const bubble = document.createElement('div'); bubble.className = `home-bubble ${message.role}`;
    const text = String(message.content || '');
    const parts = text.split(/((?:<\[[^\]]+\]>|\[\[[^\]]+\]\]))/g);
    for (const part of parts) {
      const match = part.match(/^(?:<\[([^\]]+)\]>|\[\[([^\]]+)\]\])$/);
      if (!match) { bubble.append(document.createTextNode(part)); continue; }
      const ref = (match[1] || match[2]).trim();
      const found = resolveVaultFileTarget(ref.split('|')[0].split('#')[0]);
      if (!found) { const broken = document.createElement('span'); broken.className = 'home-file-link is-broken'; broken.textContent = ref; broken.title = 'Linked file not found'; bubble.append(broken); continue; }
      const link = document.createElement('button'); link.type = 'button'; link.className = 'home-file-link'; link.textContent = fileLabel(found); link.title = `Right-click to open ${found}`;
      link.addEventListener('click', (event) => event.preventDefault());
      link.addEventListener('contextmenu', async (event) => {
        event.preventDefault();
        const followupHistory = state.homeSession.messages.slice(-8).map(({ role, content }) => ({ role, content }));
        await navigateWikiTarget(ref); setAssistantOpen(true);
        $('#assistant-messages').replaceChildren();
        state.chatHistory = followupHistory;
        followupHistory.forEach(({ role, content }) => appendChatBubble(role, content));
      });
      bubble.append(link);
    }
    if (message.kind === 'question') { const label = document.createElement('strong'); label.className = 'home-question-label'; label.textContent = 'A question before continuing'; bubble.prepend(label); }
    if (message.events?.length) {
      const details = document.createElement('details'); details.className = 'home-action-log';
      const summary = document.createElement('summary'); summary.textContent = `${message.events.filter(event=>event.status === 'done').length} completed steps`; details.append(summary);
      const list = document.createElement('ul');
      for (const event of message.events) { const item = document.createElement('li'); item.textContent = `${event.status === 'done' ? '✓' : event.status === 'error' ? '!' : '…'} ${event.label}${event.summary ? ' — '+event.summary : ''}`; list.append(item); }
      details.append(list); bubble.append(details);
    }
    transcript.append(bubble);
  }
  transcript.scrollTop = transcript.scrollHeight;
}
function startHomeSession(session = null) {
  if (state.homeRun) { showToast('Stop the current request before switching chats.'); return; }
  if (session?.vaultPath && session.vaultPath !== state.vault?.path) return;
  state.homeSession = session ? JSON.parse(JSON.stringify(session)) : { id: crypto.randomUUID(), title: 'New conversation', updatedAt: Date.now(), messages: [], mode:state.homeMode, vaultPath:state.vault?.path };
  state.homeMode = state.homeSession.mode === 'work' ? 'work' : 'ask';
  renderHomeTranscript(); renderHomeHistory(); updateHomeMode();
}
function renderHomeHistory() {
  const history = $('#home-history'); if (!history) return;
  history.replaceChildren();
  if (!state.homeChats.length) { const empty = document.createElement('p'); empty.className = 'home-history-empty'; empty.textContent = 'Your conversations will appear here.'; history.append(empty); return; }
  for (const chat of state.homeChats.filter(chat => !chat.vaultPath || chat.vaultPath === state.vault?.path)) {
    const button = document.createElement('button'); button.type = 'button'; button.className = `home-history-item${state.homeSession?.id === chat.id ? ' active' : ''}`;
    button.textContent = chat.title || chat.messages?.find((item) => item.role === 'user')?.content?.slice(0, 48) || 'Conversation';
    button.addEventListener('click', () => startHomeSession(chat)); history.append(button);
  }
}
async function openHome() {
  if (state.home && state.homeRun) return;
  if (meetingRecording || meetingStopPromise) await stopMeetingRecording();
  cancelMeetingRecording(); $('#meeting-notes-trigger').hidden = true;
  $('#note-format-toolbar').hidden = true; $('#note-editor').classList.remove('has-markdown-editor');
  try { await saveActive(); } catch (error) { showToast(error.message || 'Could not save the open file.'); return; }
  state.assetViewer?.destroy?.(); state.assetViewer = null; state.assetPath = null; state.assetBytes = null; state.pdfText = null; state.pdfTextPromise = null;
  if (state.view) { state.view.destroy(); state.view = null; }
  state.structured?.cleanup?.(); state.structured?.desmos?.destroy?.();
  state.structured = null; updateAssistantModeCopy(); state.active = null; state.home = true; state.dirty = false;
  state.assistantOpen = false; $('.workspace').classList.remove('assistant-open');
  $('#editor-content').innerHTML = `<section class="home-view"><div class="home-topline"><button type="button" class="home-history-toggle" id="home-history-toggle" aria-label="Show recent chats" aria-expanded="false" title="Recent chats">${icons.menu}</button></div><div class="home-chat-layout"><aside class="home-history"><div class="home-history-top"><div class="home-history-label">RECENT CHATS</div><button type="button" id="home-new-chat" aria-label="New conversation" title="New conversation">${icons.filePlus}</button></div><div id="home-history"></div></aside><div class="home-chat-main"><div class="home-transcript" id="home-transcript"></div><div class="home-mode-toggle" role="group" aria-label="Home assistant mode"><button type="button" data-home-mode="ask" aria-pressed="true">Ask</button><button type="button" data-home-mode="work" aria-pressed="false">Work</button></div><form class="home-composer" id="home-form"><textarea id="home-input" rows="3" placeholder="Ask anything about your notes…"></textarea><button type="submit" class="send-button" id="home-send" aria-label="Send question">${icons.send}</button></form><button type="button" class="home-stop" id="home-stop" hidden>Stop</button><div class="home-footnote" id="home-mode-note"></div></div></div></section>`;
  $('#note-editor').hidden = false; $('#welcome').hidden = true;
  $('#breadcrumbs').innerHTML = `<span>${escapeHtml(state.vault?.name || 'Workspace')}</span><span class="crumb-slash">/</span><strong>Home</strong>`;
  $('#save-state').textContent = '';
  $('#word-count').textContent = ''; $('#assistant-toggle').disabled = true; $('#assistant-toggle').setAttribute('aria-disabled', 'true'); $('#assistant-toggle').setAttribute('aria-pressed', 'false');
  await window.stillnote.rememberNote(null).catch(() => {}); renderFiles();
  if (state.homeRun) { renderHomeTranscript(); renderHomeHistory(); updateHomeMode(); } else startHomeSession();
  $('#home-form').addEventListener('submit', submitHomeMessage);
  $('#home-input').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      if (!state.homeRun) $('#home-form').requestSubmit();
    }
  });
  document.querySelectorAll('[data-home-mode]').forEach(button => button.addEventListener('click', () => {
    if (state.homeRun) return;
    state.homeMode = button.dataset.homeMode; state.homeSession.mode = state.homeMode;
    localStorage.setItem('stillnote-home-mode',state.homeMode); updateHomeMode(); renderHomeTranscript(); persistHomeChat();
  }));
  $('#home-stop').addEventListener('click',stopHomeRun);
  $('#home-new-chat').addEventListener('click', () => { startHomeSession(); $('#home-input').focus(); });
  $('#home-history-toggle').addEventListener('click', (event) => {
    const button = event.currentTarget, view = $('.home-view'), history = $('.home-history');
    const expanded = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(expanded)); button.setAttribute('aria-label', expanded ? 'Hide recent chats' : 'Show recent chats');
    if (expanded) {
      view.classList.add('has-home-history');
      animate(history, { opacity: [0, 1], translateX: [-7, 0], duration: motionDuration(130), ease: 'outQuad' });
    } else {
      animate(history, { opacity: [1, 0], translateX: [0, -5], duration: motionDuration(100), ease: 'inQuad', onComplete: () => {
        if (button.getAttribute('aria-expanded') !== 'true') view.classList.remove('has-home-history');
        history.style.opacity = ''; history.style.transform = '';
      } });
    }
  });
  $('#home-transcript').addEventListener('click', (event) => { const suggestion = event.target.closest('[data-home-prompt]'); if (!suggestion) return; const input = $('#home-input'); input.value = suggestion.dataset.homePrompt; input.focus(); input.setSelectionRange(input.value.length, input.value.length); });
}
function updateHomeMode() {
  const busy = !!state.homeRun;
  document.querySelectorAll('[data-home-mode]').forEach(button => { button.setAttribute('aria-pressed',String(button.dataset.homeMode === state.homeMode)); button.disabled = busy; });
  if ($('#home-input')) { $('#home-input').disabled = busy; $('#home-input').placeholder = state.homeMode === 'work' ? 'Describe what you want to accomplish…' : 'Ask about your notes, files, and their connections…'; }
  if ($('#home-send')) { $('#home-send').disabled = busy; $('#home-send').setAttribute('aria-label',state.homeMode === 'work' ? 'Start work' : 'Ask question'); }
  if ($('#home-new-chat')) $('#home-new-chat').disabled = busy;
  if ($('#home-stop')) $('#home-stop').hidden = !busy;
  if ($('#home-mode-note')) $('#home-mode-note').textContent = state.homeMode === 'work' ? 'Work can create and update files and Google Tasks. It asks for details when needed.' : 'Ask reads relevant files and relationships. It does not change your workspace.';
}
function stopHomeRun() {
  const run = state.homeRun; if (!run) return;
  run.stopped = true; void window.stillnote.cancelHome(run.id).catch(() => {});
  if ($('#home-stop')) { $('#home-stop').disabled = true; $('#home-stop').textContent = 'Stopping…'; }
}
async function homeReadTool(name,args,mode,vault) {
  const result = await window.stillnote.homeTool({ tool:name,args,mode,vault });
  if (name !== 'read_file' || result.kind !== 'pdf') return result;
  if (state.vault?.path !== vault) throw new Error('The active vault changed.');
  if (result.bytes > 20*1024*1024) throw new Error('This PDF exceeds the 20 MB Home reading limit.');
  const asset = await window.stillnote.readAsset(args.path), { getDocument } = await getPdfJs();
  const pdf = await getDocument({data:bytesFromDataUrl(asset.data),isEvalSupported:false,useSystemFonts:true}).promise;
  try {
    const pages=[];let total=0;
    for(let number=1;number<=pdf.numPages&&total<130000;number++) { const content=await (await pdf.getPage(number)).getTextContent();const line=`Page ${number}\n${content.items.map(item=>item.str||'').join(' ')}`;pages.push(line);total+=line.length; }
    const text=pages.join('\n\n');
    if (!text.replace(/Page \d+/g,'').trim()) throw new Error('This PDF has no selectable text. OCR is not available.');
    const offset=Math.max(0,Number(args.offset)||0),length=Math.min(50000,Math.max(1,Number(args.length)||30000));
    return {path:args.path,text:text.slice(offset,offset+length),totalCharacters:text.length,truncated:offset+length<text.length||total>=130000,note:'Selectable PDF text only; images and layout are not analyzed.'};
  } finally { await pdf.destroy(); }
}
async function submitHomeMessage(event) {
  event.preventDefault();
  const input = $('#home-input'), prompt = input?.value.trim(); if (!prompt || state.homeRun) return;
  const session = state.homeSession, mode = state.homeMode, vault = state.vault?.path, provider = state.aiProvider, model = selectedAiModel(provider);
  const run = {id:crypto.randomUUID(),stopped:false}; state.homeRun = run; updateHomeMode();
  let progress;
  try {
    const keyStatus = await window.stillnote.aiKeyStatus(provider);
    if (!keyStatus.configured) { openSettings('ai'); return; }
    if(run.stopped)return;
    const history=session.messages.slice(-12);
    session.messages.push({role:'user',content:prompt});
    if(session.messages.filter(item=>item.role==='user').length===1)session.title=prompt.slice(0,58);
    input.value='';renderHomeTranscript();persistHomeChat();
    progress=document.createElement('section');progress.className='home-run-progress';progress.setAttribute('role','status');progress.setAttribute('aria-live','polite');$('#home-transcript').append(progress);
    const result=await runHomeAgent({mode,prompt,history,context:session.aiContext?.[mode]||[],
      stopped:()=>run.stopped||state.vault?.path!==vault,
      modelStep:request=>window.stillnote.homeStep({...request,provider,model,vault,requestId:run.id}),
      tool:(name,args)=>homeReadTool(name,args,mode,vault),
      onProgress:({label,plan,events})=>{
        if(!progress.isConnected)return; progress.replaceChildren();
        const status=document.createElement('strong');status.textContent=label;progress.append(status);
        if(plan.length){const list=document.createElement('ol');for(const step of plan){const item=document.createElement('li');item.textContent=step;list.append(item);}progress.append(list);}
        const count=document.createElement('small');count.textContent=`${events.filter(event=>event.status==='done').length} steps completed`;progress.append(count);
      },
    });
    session.aiContext ||= {};session.aiContext[mode]=result.context;
    session.messages.push({role:'assistant',content:result.text,kind:result.kind,events:result.events,mode});
    if(state.vault?.path===vault){[state.files,state.tree]=await Promise.all([window.stillnote.listNotes(),window.stillnote.getVaultTree()]);renderFiles();}
    if(state.homeSession===session){persistHomeChat();if(state.home){renderHomeTranscript();renderHomeHistory();}}
  } catch(error) {
    session.messages.push({role:'assistant',content:error.message||'The request could not finish.',kind:'error'});
    if(state.homeSession===session){persistHomeChat();if(state.home)renderHomeTranscript();}
  } finally {
    progress?.remove();if(state.homeRun===run)state.homeRun=null;
    if($('#home-stop')){$('#home-stop').disabled=false;$('#home-stop').textContent='Stop';}
    updateHomeMode();if(state.home)$('#home-input')?.focus();
  }
}
function bytesFromDataUrl(dataUrl) {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
function renderAssetTextEditor(file, contents, navigationId) {
  const theme = EditorView.theme({ '&': { backgroundColor: 'transparent', color: '#393a37', fontSize: '13px', height: '100%' }, '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', lineHeight: '1.65', overflow: 'auto' }, '.cm-content': { maxWidth: 'none', padding: '28px 28px 90px', caretColor: '#a7795d' }, '.cm-gutters': { backgroundColor: '#f5f4f0', borderRight: '1px solid #e6e4dd', color: '#9a9a91' }, '.cm-activeLineGutter': { backgroundColor: '#ebe8e1', color: '#55564f' }, '.cm-activeLine': { backgroundColor: '#f8f7f3' }, '.cm-foldGutter .cm-gutterElement': { cursor: 'pointer' }, '&.cm-focused': { outline: 'none' }, '.cm-selectionBackground, ::selection': { backgroundColor: '#e7ded4 !important' }, '.cm-cursor': { borderLeftColor: '#a7795d' } }, { dark: false });
  state.active = file;
  state.view = new EditorView({ state: EditorState.create({ doc: contents, extensions: [findReplaceExtension(icons), lineNumbers(), highlightActiveLineGutter(), foldGutter(), highlightActiveLine(), drawSelection(), dropCursor(), rectangularSelection(), history(), bracketMatching(), indentOnInput(), indentUnit.of('  '), codeLanguage(file), syntaxHighlighting(defaultHighlightStyle), EditorView.contentAttributes.of({ spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off' }), keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]), theme, EditorView.updateListener.of((update) => { if (update.docChanged && navigationId === state.navigationId) onEdit(); })] }), parent: $('#editor-content') });
}
let occtPromise = null;
let pdfjsPromise = null;
async function getPdfJs() {
  if (!pdfjsPromise) pdfjsPromise = Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')]).then(([pdfjs, worker]) => { pdfjs.GlobalWorkerOptions.workerSrc = worker.default; return pdfjs; }).catch((error) => { pdfjsPromise = null; throw error; });
  return pdfjsPromise;
}
async function extractActivePdfText(file) {
  if (state.assetPath !== file || !state.assetBytes) throw new Error('The PDF is no longer open.');
  if (!state.pdfTextPromise) state.pdfTextPromise = (async () => {
    const bytes = state.assetBytes.slice();
    const { getDocument } = await getPdfJs();
    const pdf = await getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: true }).promise;
    const pages = []; let total = 0; const limit = 135000;
    for (let pageNumber = 1; pageNumber <= pdf.numPages && total < limit; pageNumber++) {
      const page = await pdf.getPage(pageNumber), content = await page.getTextContent();
      const line = content.items.map((item) => item.str || '').filter(Boolean).join(' ');
      if (line) { const chunk = `Page ${pageNumber}\n${line}`; pages.push(chunk.slice(0, limit - total)); total += chunk.length; }
    }
    pdf.destroy();
    if (!pages.length) throw new Error('No selectable text was found in this PDF. Scanned PDFs need OCR before the assistant can read them.');
    return `${pages.join('\n\n')}${total >= limit ? '\n\n[PDF text truncated to fit the assistant context.]' : ''}`;
  })();
  return state.pdfTextPromise.then((text) => { if (state.active !== file || state.assetPath !== file) throw new Error('The PDF changed while its text was being read.'); state.pdfText = text; return text; });
}
function loadOcctImporter() {
  if (!occtPromise) occtPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.id = 'occt-import-js'; script.src = new URL('./vendor/occt-import-js.js', document.baseURI).href;
    script.onload = () => { window.stillnote.loadOcctWasm().then((wasm) => window.occtimportjs({ wasmBinary: new Uint8Array(wasm) })).then(resolve, reject); };
    script.onerror = () => reject(new Error('The STEP geometry engine could not be loaded.'));
    document.head.append(script);
  }).catch((error) => { occtPromise = null; throw error; });
  return occtPromise;
}
async function createThreeModel(file, asset) {
  const extension = `.${fileExtension(file)}`, bytes = bytesFromDataUrl(asset.data), group = new THREE.Group();
  if (extension === '.obj') {
    const object = new OBJLoader().parse(new TextDecoder().decode(bytes));
    const material = new THREE.MeshStandardMaterial({ color: 0xb7aa95, roughness: .68, metalness: .08, side: THREE.DoubleSide });
    object.traverse((part) => { if (part.isMesh) { part.material = material; if (!part.geometry.attributes.normal) part.geometry.computeVertexNormals(); } }); group.add(object);
  } else if (extension === '.stl') {
    const geometry = new STLLoader().parse(bytes.buffer);
    if (!geometry.attributes.position?.count) throw new Error('No triangles were found in this STL file.');
    group.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xb7aa95, roughness: .68, metalness: .08, side: THREE.DoubleSide })));
  } else {
    const occt = await loadOcctImporter(), result = occt.ReadStepFile(bytes, { linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: .001, angularDeflection: .5 });
    if (!result?.success || !result.meshes?.length) throw new Error('No renderable STEP geometry was found.');
    for (const source of result.meshes) {
      const positions = source.attributes?.position?.array || [];
      if (!positions.length) continue;
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      if (source.index?.array?.length) geometry.setIndex(source.index.array);
      if (source.attributes?.normal?.array?.length) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(source.attributes.normal.array, 3)); else geometry.computeVertexNormals();
      const rgb = source.color || [.72, .68, .59], channel = (index, fallback) => Number.isFinite(Number(rgb[index])) ? Number(rgb[index]) : fallback, color = new THREE.Color().setRGB(channel(0, .72), channel(1, .68), channel(2, .59));
      group.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: .68, metalness: .08, side: THREE.DoubleSide })));
    }
    if (!group.children.length) throw new Error('No renderable STEP faces were found.');
  }
  const bounds = new THREE.Box3().setFromObject(group);
  if (bounds.isEmpty()) throw new Error('This model has no visible geometry.');
  const center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
  group.position.sub(center); group.rotation.x = extension === '.obj' ? 0 : -Math.PI / 2;
  return { group, size };
}
async function mountInlineModelPreview(stage, file, asset, owner) {
  let alive = true, frame = 0, renderer = null, controls = null, resize = null, group = null;
  const dispose = () => {
    alive = false; cancelAnimationFrame(frame); resize?.disconnect(); controls?.dispose();
    if (group) group.traverse((part) => { if (part.geometry) part.geometry.dispose(); if (part.material) for (const material of Array.isArray(part.material) ? part.material : [part.material]) material.dispose(); });
    renderer?.dispose(); renderer?.domElement.remove();
  };
  owner.__disposePreview = dispose;
  try {
    ({ group } = await createThreeModel(file, asset));
    if (!alive || !stage.isConnected) { dispose(); return; }
    const scene = new THREE.Scene(); scene.background = new THREE.Color(state.theme === 'dark' ? '#20211e' : state.theme === 'sepia' ? '#f1ecdf' : '#f4f4f1'); scene.add(group);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x77736a, 2.2));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.7); keyLight.position.set(4, 7, 8); scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xffffff, 1.1); fillLight.position.set(-6, 2, -5); scene.add(fillLight);
    const bounds = new THREE.Box3().setFromObject(group), center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z, .001), radius = maxDimension * .5;
    const camera = new THREE.PerspectiveCamera(42, 1, Math.max(maxDimension / 10000, .00001), maxDimension * 1000);
    camera.position.set(radius * 3.2, radius * 2.5, radius * 3.2); camera.lookAt(center);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; stage.append(renderer.domElement);
    controls = new OrbitControls(camera, renderer.domElement); controls.target.copy(center); controls.enableDamping = true; controls.dampingFactor = .075; controls.minDistance = radius * .15; controls.maxDistance = radius * 80;
    const draw = () => { if (!alive) return; frame = requestAnimationFrame(draw); controls.update(); renderer.render(scene, camera); };
    resize = new ResizeObserver(() => { const width = stage.clientWidth, height = stage.clientHeight; if (!width || !height) return; renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); });
    resize.observe(stage);
    if (stage.clientWidth && stage.clientHeight) { renderer.setSize(stage.clientWidth, stage.clientHeight, false); camera.aspect = stage.clientWidth / stage.clientHeight; camera.updateProjectionMatrix(); }
    draw();
  } catch (error) {
    if (!alive || !stage.isConnected) return;
    stage.textContent = error.message || '3D preview unavailable'; stage.classList.add('is-error');
    dispose();
  }
}
async function mountThreeViewer(stage, file, asset, navigationId) {
  const viewport = document.createElement('div'); viewport.className = 'asset-model-viewport'; stage.append(viewport);
  const status = document.createElement('div'); status.className = 'asset-model-hint'; status.textContent = 'Drag to rotate · scroll to zoom'; viewport.append(status);
  try {
    const { group } = await createThreeModel(file, asset);
    if (navigationId !== state.navigationId || !viewport.isConnected) return;
    const scene = new THREE.Scene(); scene.background = new THREE.Color(state.theme === 'dark' ? '#20211e' : state.theme === 'sepia' ? '#f1ecdf' : '#f4f4f1'); scene.add(group);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x77736a, 2.2));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.7); keyLight.position.set(4, 7, 8); scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xffffff, 1.1); fillLight.position.set(-6, 2, -5); scene.add(fillLight);
    const bounds = new THREE.Box3().setFromObject(group), center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z, .001), radius = maxDimension * .5;
    const camera = new THREE.PerspectiveCamera(42, 1, Math.max(maxDimension / 10000, .00001), maxDimension * 1000); camera.position.set(radius * 3.2, radius * 2.5, radius * 3.2); camera.lookAt(center);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; viewport.append(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement); controls.target.copy(center); controls.enableDamping = true; controls.dampingFactor = .075; controls.minDistance = radius * .15; controls.maxDistance = radius * 80;
    let frame = 0, alive = true;
    const render = () => { if (!alive) return; frame = requestAnimationFrame(render); controls.update(); renderer.render(scene, camera); };
    const resize = new ResizeObserver(() => { const width = viewport.clientWidth, height = viewport.clientHeight; if (!width || !height) return; renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); });
    resize.observe(viewport); const width = viewport.clientWidth, height = viewport.clientHeight; renderer.setSize(width, height, false); camera.aspect = width / Math.max(height, 1); camera.updateProjectionMatrix();
    status.remove(); render();
    state.assetViewer = { destroy() { alive = false; cancelAnimationFrame(frame); resize.disconnect(); controls.dispose(); scene.traverse((part) => { if (part.geometry) part.geometry.dispose(); if (part.material) for (const material of Array.isArray(part.material) ? part.material : [part.material]) material.dispose(); }); renderer.dispose(); renderer.domElement.remove(); } };
  } catch (error) {
    if (navigationId !== state.navigationId || !viewport.isConnected) return;
    status.textContent = error.message || 'This model could not be rendered.'; status.classList.add('is-error');
  }
}
async function renderAssetPreview(file, navigationId) {
  const asset = await window.stillnote.readAsset(file);
  if (navigationId !== state.navigationId) return;
  const host = $('#editor-content'), stage = document.createElement('section'); stage.className = 'asset-preview-stage'; host.replaceChildren(stage);
  const ext = `.${fileExtension(file)}`;
  state.assetPath = file; state.assetBytes = ext === '.pdf' ? bytesFromDataUrl(asset.data) : null; state.pdfText = null; state.pdfTextPromise = null;
  if (asset.mime.startsWith('image/')) { const image = document.createElement('img'); image.className = 'asset-preview-image'; image.src = asset.data; image.alt = prettyName(file); image.addEventListener('error', () => { const message = document.createElement('p'); message.className = 'asset-preview-error'; message.textContent = 'This image format cannot be decoded by the built-in preview.'; stage.replaceChildren(message); }); stage.append(image); }
  else if (asset.mime.startsWith('audio/') || asset.mime.startsWith('video/')) { stage.append(createMediaPlayer(asset, file, { settingsKey: `${state.vault?.path}/${file}` })); state.assetViewer = { destroy() { disposeMediaPlayers(stage); } }; }
  else if (asset.mime === 'application/pdf') { const shell = document.createElement('div'); shell.className = 'asset-pdf-shell'; const frame = document.createElement('iframe'); frame.className = 'asset-preview-frame'; frame.title = prettyName(file); frame.src = asset.data; shell.append(frame); stage.append(shell); }
  else if (['.obj', '.stl', '.step', '.stp'].includes(ext)) { void mountThreeViewer(stage, file, asset, navigationId); }
  else {
    const pre = document.createElement('pre'); pre.className = 'asset-preview-text';
    try {
      pre.textContent = new TextDecoder().decode(bytesFromDataUrl(asset.data));
    } catch (error) { pre.textContent = error.message || 'This file could not be previewed.'; }
    if (navigationId !== state.navigationId) return;
    stage.append(pre);
  }
}
async function openNote(file) {
  stopHomeRun();
  if (meetingRecording || meetingStopPromise) await stopMeetingRecording();
  if (meetingStarting) cancelMeetingRecording();
  $('#note-format-toolbar').hidden = true; $('#note-editor').classList.remove('has-markdown-editor');
  state.home = false; $('#assistant-toggle').disabled = false; $('#assistant-toggle').removeAttribute('aria-disabled'); $('#home-button').setAttribute('aria-pressed', 'false');
  const navigationId=state.navigationId=(state.navigationId||0)+1;
  try {
    const requestedActive=state.active;
    if(state.pendingStructuredRename)await state.pendingStructuredRename;
    if(file===requestedActive&&state.active!==requestedActive)file=state.active;
    const activeBeforeSave = state.active;
    await saveActive();
    if(navigationId!==state.navigationId)return;
    if (file === activeBeforeSave && state.active !== activeBeforeSave) file = state.active;
    state.assetViewer?.destroy?.(); state.assetViewer = null;
    state.assetPath = null; state.assetBytes = null; state.pdfText = null; state.pdfTextPromise = null;
    if (!file.toLowerCase().endsWith('.md') && !isEditableAsset(file)) {
      const changedFile = state.active !== file;
      state.view?.destroy(); state.view = null; state.structured?.cleanup?.(); state.structured?.desmos?.destroy?.(); state.structured = null; state.dirty = false; state.active = file;
      if (changedFile) { state.chatHistory = []; state.lastTitleValidationMessage = null; renderAssistantWelcome(); }
      $('#editor-content').replaceChildren(); $('#note-indexes').hidden = true; $('#note-format-toolbar').hidden = true; $('#meeting-notes-trigger').hidden = true; $('#note-editor').classList.remove('has-markdown-editor');
      updateAssistantModeCopy();
      $('#note-editor').hidden = false; $('#welcome').hidden = true; $('#save-state').textContent = 'Preview'; $('#editor-footer').querySelector('span').textContent = 'PREVIEW'; $('#editor-footer').lastElementChild.textContent = 'LOCAL FILE';
      updateFileLocation(file); renderFiles();
      await renderAssetPreview(file, navigationId); if (navigationId !== state.navigationId) return;
      void window.stillnote.rememberNote(file).catch((error) => console.error('Could not save active file:', error));
      return;
    }
    let contents = await window.stillnote.readNote(file);
    if(navigationId!==state.navigationId)return;
    if (!file.toLowerCase().endsWith('.md')) {
      const changedFile = state.active !== file;
      state.view?.destroy(); state.view = null; state.structured?.cleanup?.(); state.structured?.desmos?.destroy?.(); state.structured = null;
      if (changedFile) { state.chatHistory = []; state.lastTitleValidationMessage = null; renderAssistantWelcome(); }
      $('#editor-content').replaceChildren(); $('#note-indexes').hidden = true; $('#note-format-toolbar').hidden = true; $('#meeting-notes-trigger').hidden = true; $('#note-editor').classList.remove('has-markdown-editor');
      renderAssetTextEditor(file, contents, navigationId); state.dirty = false; $('#save-state').textContent = 'Saved'; $('#note-editor').hidden = false; $('#welcome').hidden = true; $('#editor-footer').querySelector('span').textContent = fileExtension(file).toUpperCase();
      updateAssistantModeCopy(); updateWordCount(contents); updateFileLocation(file); renderFiles();
      void window.stillnote.rememberNote(file).catch((error) => console.error('Could not save active file:', error));
      return;
    }
    const lineEnding = contents.includes('\r\n') ? '\r\n' : '\n';
    const lines = contents.split(/\r?\n/);
    const titleLine = prettyName(file);
    const firstLineTitle = lines[0].trim().replace(/^#{1,6}\s+/, '').replace(/\.md$/i, '').trim().toLocaleLowerCase();
    const fileTitle = titleLine.replace(/\.md$/i, '').trim().toLocaleLowerCase();
    if (/^#\s+/.test(lines[0]) || (firstLineTitle && firstLineTitle === fileTitle)) lines[0] = titleLine;
    else lines.unshift(titleLine);
    const normalizedContents = lines.join(lineEnding);
    if (normalizedContents !== contents) {
      await window.stillnote.writeNote(file, normalizedContents);
      contents = normalizedContents;
    }
    const structuredFile = decodeStructured(contents);
    if (state.view) { state.view.destroy(); state.view = null; }
    state.structured?.cleanup?.(); state.structured?.desmos?.destroy?.();
    state.structured = null;
    updateAssistantModeCopy();
    // Structured editors are plain DOM rather than CodeMirror views, so destroy
    // the previous canvas or spreadsheet surface before mounting a Markdown note.
    $('#editor-content').replaceChildren();
    $('#note-indexes').hidden = true;
    if (structuredFile) {
      cancelMeetingRecording(); $('#meeting-notes-trigger').hidden = true;
      const changedNote = state.active !== file;
      state.active = file;
      renderStructured(structuredFile.type, structuredFile.data, file, titleLine);
      updateAssistantModeCopy();
      state.dirty = false; $('#save-state').textContent = 'Saved'; updateWordCount(contents);
      void window.stillnote.rememberNote(file).catch((error) => console.error('Could not save active note:', error));
      if (changedNote) { state.chatHistory = []; state.lastTitleValidationMessage = null; renderAssistantWelcome(); }
      $('#welcome').hidden = true; $('#note-editor').hidden = false; updateFileLocation(file); renderFiles(); return;
    }
    const theme = EditorView.theme({
      '&': { backgroundColor: 'transparent', color: '#393a37', fontSize: '16px', height: '100%' },
      '.cm-scroller': { fontFamily: '"Iowan Old Style", "Palatino Linotype", Georgia, serif', lineHeight: '1.9', overflow: 'auto' },
      '.cm-content': { maxWidth: '720px', margin: '0 auto', padding: '42px 28px 90px', caretColor: '#a7795d' },
      '.cm-line': { padding: '0 0' }, '.cm-gutters': { display: 'none' },
      '&.cm-focused': { outline: 'none' }, '.cm-activeLine': { backgroundColor: 'transparent' },
      '.cm-selectionBackground, ::selection': { backgroundColor: '#e7ded4 !important' },
      '.cm-cursor': { borderLeftColor: '#a7795d' },
      '.cm-line:first-child': { fontSize: '30px', fontWeight: '600', letterSpacing: '-.04em', color: '#292a27' },
    }, { dark: false });
    if (state.view) { state.view.destroy(); state.view = null; }
    state.view = new EditorView({
      state: EditorState.create({ doc: contents, extensions: [findReplaceExtension(icons), spellingDecorationsField, lineNumbers(), highlightActiveLineGutter(), drawSelection(), dropCursor(), rectangularSelection(), crosshairCursor(), history(), markdown({ extensions: [Strikethrough, TaskList] }), syntaxHighlighting(defaultHighlightStyle), highlightSelectionMatches(), highlightActiveLine(), EditorView.lineWrapping, liveMarkdown, EditorView.contentAttributes.of({ spellcheck: 'false', lang: 'en-US' }), keymap.of([{ key: 'Mod-b', run: (view) => wrapEditorSelection(view, '**') }, { key: 'Mod-i', run: (view) => wrapEditorSelection(view, '*') }, { key: 'Mod-Shift-c', run: (view) => wrapEditorSelection(view, '`') }, { key: 'Mod-Shift-x', run: (view) => wrapEditorSelection(view, '~~') }, ...markdownKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap]), theme, EditorView.updateListener.of((update) => { if (update.docChanged) { onEdit(); scheduleSpellcheck(update.view); renderNoteIndexes(update.view); } })] }),
      parent: $('#editor-content'),
    });
    state.view.scrollDOM.addEventListener('scroll', () => updateNoteIndexCurrent(state.view), { passive: true });
    $('#note-editor').dataset.toolbarPosition = state.toolbarPositions.notes;
    $('#meeting-notes-trigger').hidden = false;
    $('#note-format-toolbar').hidden = state.toolbarPositions.notes === 'hidden';
    $('#note-editor').classList.toggle('has-markdown-editor', state.toolbarPositions.notes !== 'hidden');
    scheduleSpellcheck(state.view);
    updateWordCount(contents); $('#save-state').textContent = 'Saved'; state.dirty = false;
    const changedNote = state.active !== file;
    state.active = file; void window.stillnote.rememberNote(file).catch((error) => console.error('Could not save active note:', error));
    updateAssistantModeCopy();
    if (changedNote) { state.chatHistory = []; state.lastTitleValidationMessage = null; renderAssistantWelcome(); }
    $('#welcome').hidden = true; $('#note-editor').hidden = false;
    renderNoteIndexes(state.view);
    updateFileLocation(file); renderFiles();
  } catch (error) { showToast(error.message || 'Could not open note.'); }
}
$('#editor-content').addEventListener('contextmenu', (event) => {
  if (!event.target.closest('.cm-editor') || !state.view) return;
  const mediaLink = event.target.closest('.cm-wiki-media-preview');
  if (mediaLink) { event.preventDefault(); event.stopPropagation(); void navigateWikiTarget(mediaLink.dataset.target); return; }
  if (openWikiLinkAt(state.view, event)) { event.stopPropagation(); return; }
  const equation = event.target.closest('math[data-equation]');
  if (equation) { event.preventDefault(); event.stopPropagation(); showDesmosPreview(equation.dataset.equation, event.clientX, event.clientY); return; }
  const position = state.view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (position != null) {
    const line = state.view.state.doc.lineAt(position), matcher = /\$([^$\n]+)\$/g; let match;
    while ((match = matcher.exec(line.text))) if (position >= line.from + match.index && position <= line.from + match.index + match[0].length) { event.preventDefault(); event.stopPropagation(); showDesmosPreview(match[1], event.clientX, event.clientY); return; }
  }
  void handleEditorContextMenu(state.view, event);
});
$('#note-format-toolbar').addEventListener('mousedown', (event) => event.preventDefault());
$('#note-format-toolbar').addEventListener('click', (event) => {
  const button = event.target.closest('[data-format]');
  if (!button || !state.view) return;
  const view = state.view;
  const actions = {
    bold: () => wrapEditorSelection(view, '**'), italic: () => wrapEditorSelection(view, '*'),
    code: () => wrapEditorSelection(view, '`'), strike: () => wrapEditorSelection(view, '~~'),
    heading1: () => setEditorLinePrefix(view, '#', 'heading'), heading2: () => setEditorLinePrefix(view, '##', 'heading'),
    bullet: () => setEditorLinePrefix(view, '- ', 'bullet'), ordered: () => setEditorLinePrefix(view, '1. ', 'ordered'),
    checklist: () => setEditorLinePrefix(view, '- [ ] ', 'task'), highlight: () => wrapEditorSelection(view, '='),
  };
  actions[button.dataset.format]?.(); view.focus();
});
function onEdit() {
  renderSidebarLinks();
  state.dirty = true; $('#save-state').textContent = 'Unsaved changes';
  const documentText = state.view.state.doc.toString();
  scheduleTaskReferenceLinks(state.view);
  updateWordCount(documentText);
  if (!state.active?.toLowerCase().endsWith('.md')) { clearTimeout(state.saveTimer); state.saveTimer = setTimeout(saveActive, 650); return; }
  const title = state.view.state.doc.line(1).text;
  const invalidCharacter = /[<>:"/\\|?*\u0000-\u001f]/.test(title);
  const titleError = invalidCharacter ? noteTitleError(title.replace(/\.md$/i, '').trim()) : null;
  if (titleError && titleError !== state.lastTitleValidationMessage) showToast(titleError);
  state.lastTitleValidationMessage = titleError;
  clearTimeout(state.saveTimer); state.saveTimer = setTimeout(saveActive, 650);
}
function noteTitleCharacterError(character) {
  if (character === '/' || character === '\\') return 'A note title cannot contain / or \\; those characters separate folders.';
  if (character === ':') return 'A note title cannot contain a colon (:).';
  if (/[<>|?*"]/u.test(character)) return `A note title cannot contain ${character}; that character is reserved in file names.`;
  return 'A note title cannot contain control characters.';
}
function noteTitleError(title) {
  const trimmed = title.trim();
  if (!trimmed) return 'A note title cannot be empty.';
  const invalidCharacter = trimmed.match(/[<>:"/\\|?*\u0000-\u001f]/);
  if (invalidCharacter) return noteTitleCharacterError(invalidCharacter[0]);
  if (trimmed === '.' || trimmed === '..') return 'A note title cannot be “.” or “..”.';
  if (trimmed.endsWith('.')) return 'A note title cannot end with a period.';
  return null;
}
function updateWordCount(text) {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  $('#word-count').textContent = `${words} ${words === 1 ? 'word' : 'words'}`;
}
function encodeStructured(type, title, data) {
  return `${title}\n<!-- stillnote:type=${type} -->\n\n\`\`\`stillnote-${type}\n${JSON.stringify(data, null, 2)}\n\`\`\`\n`;
}
function decodeStructured(contents) {
  const match = contents.match(/<!--\s*stillnote:type=(canvas|spreadsheet|graph|tasks|geometry|calculator3d)\s*-->[\s\S]*?```stillnote-\1\s*\n([\s\S]*?)\n```/);
  if (!match) return null;
  try { return { type: match[1], data: JSON.parse(match[2]) }; } catch { return { type: match[1], data: null }; }
}
function canvasDefaults() { return { version: 1, width: 1200, height: 760, elements: [] }; }
function sheetDefaults() { return { version: 1, columns: 8, rows: 20, cells: {} }; }
function graphDefaults() { return { version: 1, state: null }; }
function taskSheetDefaults(listId) { return { version: 1, listId, tasks: [] }; }
function geometryDefaults() { return { version: 1, state: null }; }
function calculator3dDefaults() { return { version: 1, state: null }; }
function isValidStructuredPayload(type, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (type === 'geometry' || type === 'calculator3d') return data.state == null || (typeof data.state === 'object' && !Array.isArray(data.state));
  return true;
}
let desmosApiLoad = null;
let desmosApiLoadedKey = null;
function loadDesmosApi(apiKey) {
  if (!apiKey) return Promise.reject(new Error('Add a Desmos API key in Settings → Graphing to open this tool.'));
  if (window.Desmos?.GraphingCalculator && desmosApiLoadedKey === apiKey) return Promise.resolve(window.Desmos);
  if (desmosApiLoad?.key === apiKey) return desmosApiLoad.promise;
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://www.desmos.com/api/v1.12/calculator.js?apiKey=${encodeURIComponent(apiKey)}`;
    script.async = true;
    script.onload = () => {
      if (!window.Desmos?.GraphingCalculator) { reject(new Error('Desmos loaded without its Graphing Calculator API.')); return; }
      desmosApiLoadedKey = apiKey; resolve(window.Desmos);
    };
    script.onerror = () => reject(new Error('Could not load Desmos. Check your internet connection and API key.'));
    document.head.append(script);
  });
  desmosApiLoad = { key: apiKey, promise };
  return promise;
}
function structuredLink(target) {
  void navigateWikiTarget(String(target || '').split('|')[0].trim());
}
async function navigateWikiTarget(target) {
  const clean = parseVaultLink(target).target;
  const hashIndex = clean.indexOf('#');
  const fileTarget = hashIndex < 0 ? clean : clean.slice(0, hashIndex).trim();
  const fragment = hashIndex < 0 ? '' : clean.slice(hashIndex + 1).trim();
  const file = fileTarget ? resolveVaultFileTarget(fileTarget) : state.active;
  if (!file) { showToast(`No file found for “${fileTarget || clean}”.`); return; }
  // Keep the existing editor instance for in-note anchors. Reopening the same
  // document destroys and remounts CodeMirror, which can reset its scroll state.
  if (file !== state.active || !state.view) await openNote(file);
  if (fragment && state.view && state.active === file) {
    const position = findNoteAnchor(state.view, fragment);
    if (position == null) showToast(`No heading or tag “${fragment}” found in ${prettyName(file)}.`);
    else jumpToNoteIndex(state.view, position);
  }
}
function slugForHeading(value) {
  return String(value || '').toLocaleLowerCase().replace(/<[^>]*>/g, '').replace(/[`*_~]/g, '').trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-').replace(/-+/g, '-');
}
function findNoteAnchor(view, fragment) {
  let decoded = fragment;
  try { decoded = decodeURIComponent(fragment.replace(/\+/g, ' ')); } catch {}
  const lineTarget = decoded.match(/^L(\d+)$/i);
  if (lineTarget) {
    const number = Number(lineTarget[1]);
    if (Number.isInteger(number) && number >= 1 && number <= view.state.doc.lines) return view.state.doc.line(number).from;
    return null;
  }
  const wanted = slugForHeading(decoded);
  const doc = view.state.doc;
  let inFence = false, fenceChar = '', fenceLength = 0, slugCounts = new Map();
  for (let number = 1; number <= doc.lines; number++) {
    const line = doc.line(number), text = line.text;
    const fence = text.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (!inFence) { inFence = true; fenceChar = fence[1][0]; fenceLength = fence[1].length; }
      else if (fence[1][0] === fenceChar && fence[1].length >= fenceLength) inFence = false;
      continue;
    }
    if (inFence) continue;
    const heading = text.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const base = slugForHeading(heading[1]);
      const count = slugCounts.get(base) || 0; slugCounts.set(base, count + 1);
      const slug = count ? `${base}-${count}` : base;
      if (slug === wanted || base === wanted) return line.from;
    }
    if (/^\s*#/.test(text) && slugForHeading(text.replace(/^\s*#+\s*/, '')) === wanted) return line.from;
    if (number < doc.lines && text.trim() && /^\s*(?:=+|-+)\s*$/.test(doc.line(number + 1).text)) {
      const base = slugForHeading(text.trim()), count = slugCounts.get(base) || 0; slugCounts.set(base, count + 1);
      if (base === wanted || (count && `${base}-${count}` === wanted)) return line.from;
    }
  }
  // A fragment that names a hashtag jumps to its first occurrence.
  const tag = `#${decoded.replace(/^#/, '')}`;
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, 'iu').exec(doc.toString());
  return match ? match.index + match[1].length : null;
}
let taskReferenceTimer = null;
function taskReferenceUrl(file, line) {
  const url = new URL('stillnote://open');
  url.searchParams.set('note', file);
  url.searchParams.set('line', String(line));
  return url.toString();
}
function replaceTaskNoteLink(notes, file, nextUrl) {
  let found = false;
  const updated = String(notes || '').replace(/stillnote:\/\/open\?[^\s]+/g, (candidate) => {
    try {
      if (new URL(candidate).searchParams.get('note') === file) { found = true; return nextUrl; }
    } catch {}
    return candidate;
  });
  return found ? updated : `${updated.replace(/\s*$/, '')}${updated.trim() ? '\n\n' : ''}Stillnote note: ${nextUrl}`;
}
function scheduleTaskReferenceLinks(view) {
  clearTimeout(taskReferenceTimer);
  if (!view || view !== state.view || !state.active?.toLowerCase().endsWith('.md')) return;
  const file = state.active;
  taskReferenceTimer = setTimeout(() => { void linkTaskReferencesInNote(view, file); }, 500);
}
async function linkTaskReferencesInNote(view, file) {
  if (view !== state.view || state.active !== file) return;
  const document = view.state.doc;
  const matcher = /;;([^;\n/]+)\/([^;\n]+?);;/g;
  const references = [];
  let match;
  while ((match = matcher.exec(document.toString()))) {
    const listName = decodeTaskReferencePart(match[1].trim()), taskName = decodeTaskReferencePart(match[2].trim());
    if (listName && taskName) references.push({ listName, taskName, line: document.lineAt(match.index).number });
  }
  for (const reference of references) {
    if (view !== state.view || state.active !== file) return;
    const key = `${file}\u0000${reference.listName.toLocaleLowerCase()}\u0000${reference.taskName.toLocaleLowerCase()}\u0000${reference.line}`;
    if (state.taskLinkStates.has(key)) continue;
    state.taskLinkStates.set(key, 'pending');
    try {
      const lists = await window.stillnote.listGoogleTaskLists();
      const candidates = lists.filter((list) => String(list.title || '').trim().toLocaleLowerCase() === reference.listName.toLocaleLowerCase());
      if (candidates.length !== 1) throw new Error(candidates.length ? `More than one Google Tasks list is named “${reference.listName}”.` : `No Google Tasks list is named “${reference.listName}”.`);
      const tasks = await window.stillnote.listGoogleTasks(candidates[0].id);
      const matchingTasks = tasks.filter((task) => String(task.title || '').trim().toLocaleLowerCase() === reference.taskName.toLocaleLowerCase());
      if (matchingTasks.length !== 1) throw new Error(matchingTasks.length ? `More than one task named “${reference.taskName}” is in “${reference.listName}”.` : `No task named “${reference.taskName}” is in “${reference.listName}”.`);
      const task = matchingTasks[0], url = taskReferenceUrl(file, reference.line);
      const existing = String(task.notes || ''), nextNotes = replaceTaskNoteLink(existing, file, url);
      if (nextNotes !== existing) await window.stillnote.updateGoogleTask(candidates[0].id, task.id, { notes: nextNotes });
      state.taskLinkStates.set(key, 'linked');
      if (view === state.view && state.active === file) showToast(`Linked “${reference.taskName}” to line ${reference.line}.`);
    } catch (error) {
      state.taskLinkStates.set(key, 'error');
      if (view === state.view && state.active === file) showToast(error.message || `Could not link “${reference.taskName}”.`);
    }
  }
}
function queueDeepLink(rawLink) {
  try {
    const url = new URL(String(rawLink));
    if (url.protocol !== 'stillnote:' || url.hostname !== 'open') return;
    const file = url.searchParams.get('note') || '';
    const line = Number(url.searchParams.get('line'));
    if (!file || !Number.isInteger(line) || line < 1) return;
    state.pendingDeepLinks.push({ file, line });
    void openPendingDeepLinks();
  } catch {}
}
async function openPendingDeepLinks() {
  if (!state.workspaceRestored || !state.vault || !state.pendingDeepLinks.length) return;
  const links = state.pendingDeepLinks.splice(0);
  for (const link of links) await navigateWikiTarget(`${link.file}#L${link.line}`);
}
function resolveVaultFileTarget(target) {
  const clean = parseVaultLink(target).path.replace(/\\/g, '/').replace(/^\.\//, '').toLocaleLowerCase();
  if (!clean) return null;
  const files = explorerFilePaths();
  const exact = files.find((file) => file.toLocaleLowerCase() === clean);
  if (exact) return exact;
  // Extensionless note links still refer to an exact path from the vault root.
  if (!/\.[^/]+$/.test(clean)) return files.find((file) => file.toLocaleLowerCase() === `${clean}.md`) || null;
  return null;
}
function setStructuredDirty() {
  renderSidebarLinks();
  const structured=state.structured;
  if(structured && structured.type !== 'tasks'){
    const snapshot=JSON.stringify({title:structured.title||prettyName(state.active),data:structured.data});
    if(snapshot!==structured.historySnapshot){
      if(!structured.historyPending){structured.undoStack.push(structured.historySnapshot);if(structured.undoStack.length>100)structured.undoStack.shift();structured.redoStack=[];structured.historyPending=true;}
      structured.historySnapshot=snapshot;
      clearTimeout(structured.historyTimer);structured.historyTimer=setTimeout(()=>{structured.historyPending=false;},600);
    }
    updateStructuredHistoryButtons();
  }
  state.dirty = true; $('#save-state').textContent = 'Unsaved changes';
  clearTimeout(state.saveTimer); state.saveTimer = setTimeout(saveActive, 450);
}
function updateStructuredHistoryButtons(){
  const structured=state.structured;if(!structured)return;
  document.querySelectorAll('[data-history="undo"]').forEach(button=>button.disabled=!structured.undoStack.length);
  document.querySelectorAll('[data-history="redo"]').forEach(button=>button.disabled=!structured.redoStack.length);
}
async function applyStructuredHistory(direction){
  const structured=state.structured;if(!structured)return;
  const from=direction==='undo'?structured.undoStack:structured.redoStack,to=direction==='undo'?structured.redoStack:structured.undoStack;
  if(!from.length)return;
  clearTimeout(structured.historyTimer);structured.historyPending=false;
  to.push(JSON.stringify({title:structured.title||prettyName(state.active),data:structured.data}));
  const snapshot=from.pop();const restored=JSON.parse(snapshot);const type=structured.type,history={undoStack:structured.undoStack,redoStack:structured.redoStack};
  structured.data=restored.data;structured.title=restored.title;structured.historySnapshot=snapshot;
  let active=state.active;
  if(restored.title&&restored.title!==prettyName(active)){
    try{active=await window.stillnote.renameEntry(active,restored.title);state.active=active;[state.files,state.tree]=await Promise.all([window.stillnote.listNotes(),window.stillnote.getVaultTree()]);renderFiles();updateFileLocation(active);void window.stillnote.rememberNote(active).catch(()=>{});}
    catch(error){showToast(`Could not restore the file name: ${error.message}`);}
  }
  renderStructured(type,restored.data,active,restored.title||prettyName(active));
  Object.assign(state.structured,history,{historySnapshot:snapshot,historyPending:false});
  state.dirty=true;$('#save-state').textContent='Unsaved changes';clearTimeout(state.saveTimer);state.saveTimer=setTimeout(saveActive,250);updateStructuredHistoryButtons();
}
function renderStructured(type, rawData, file, title) {
  cancelMeetingRecording(); $('#meeting-notes-trigger').hidden = true;
  state.structured?.cleanup?.();
  const defaults = { canvas: canvasDefaults, graph: graphDefaults, tasks: () => taskSheetDefaults(''), geometry: geometryDefaults, calculator3d: calculator3dDefaults, spreadsheet: sheetDefaults };
  const data = rawData && typeof rawData === 'object' ? rawData : (defaults[type] || sheetDefaults)();
  state.structured?.desmos?.destroy?.();
  state.structured = { type, data, title, file, undoStack:[], redoStack:[], historySnapshot:JSON.stringify({title,data}), historyPending:false };
  updateAssistantModeCopy();
  const host = $('#editor-content'); host.replaceChildren();
  const root = document.createElement('section'); root.className = `structured-editor ${type}-editor`;
  if (type === 'canvas') root.dataset.toolbarPosition = state.toolbarPositions.canvas;
  root.innerHTML = `<div class="structured-title" contenteditable="true" role="textbox" aria-label="File title" spellcheck="false"></div><div class="structured-toolbar"></div><div class="structured-surface"></div>`;
  const titleEl = root.querySelector('.structured-title'); titleEl.textContent = title;
  titleEl.addEventListener('input', () => { state.structured.title = titleEl.textContent.trim(); setStructuredDirty(); });
  titleEl.addEventListener('blur', () => {
    const next = titleEl.textContent.trim(); const error = noteTitleError(next);
    if (error) { showToast(error); titleEl.textContent = prettyName(state.active); return; }
    const old = state.active, owner=state.structured; if (next && next !== prettyName(old)) {
      const renameTask=(async()=>{
        try {
          if(state.active!==old||state.structured!==owner)return;
          if(owner.type==='tasks') await window.stillnote.renameGoogleTaskList(owner.data.listId,next);
          if(state.active!==old||state.structured!==owner)return;
          const moved = await window.stillnote.renameEntry(old, next);
          if(state.active!==old||state.structured!==owner)return;
          state.active = moved; [state.files, state.tree] = await Promise.all([window.stillnote.listNotes(), window.stillnote.getVaultTree()]);
          if(state.active!==moved||state.structured!==owner)return;
          renderFiles(); updateFileLocation(moved); setStructuredDirty();
        } catch (e) {
          if(state.structured===owner){
            showToast(`Could not rename file: ${e.message}`);
            titleEl.textContent = prettyName(old);
            if(owner.type==='tasks'){
              owner.title=prettyName(old);
              await window.stillnote.renameGoogleTaskList(owner.data.listId,prettyName(old)).catch(()=>{});
              setStructuredDirty();
            }
          }
        }
      })();
      state.pendingStructuredRename=renameTask;
      void renameTask.finally(()=>{if(state.pendingStructuredRename===renameTask)state.pendingStructuredRename=null;});
      return renameTask;
    }
  });
  host.append(root);
  if (type === 'canvas') renderCanvas(root, data);
  else if (type === 'graph') void renderGraph(root, data);
  else if (type === 'tasks') void renderTaskSheet(root, data);
  else if (type === 'geometry') renderGeometry(root, data);
  else if (type === 'calculator3d') renderCalculator3d(root, data);
  else renderSpreadsheet(root, data);
  updateStructuredHistoryButtons();
  return root;
}
function updateFileLocation(file) {
  const breadcrumbs = $('#breadcrumbs');
  breadcrumbs.innerHTML = `<span>${escapeHtml(state.vault.name)}</span><span class="crumb-slash">/</span><strong class="breadcrumb-path"></strong>`;
  const path = breadcrumbs.querySelector('.breadcrumb-path');
  const parts = file.split('/');
  parts.forEach((part, index) => {
    const entryPath = parts.slice(0, index + 1).join('/');
    const isFile = index === parts.length - 1;
    const extension = isFile && part.lastIndexOf('.') > 0 ? part.slice(part.lastIndexOf('.')) : '';
    const name = part.slice(0, part.length - extension.length);
    const displayedExtension = /^\.md$/i.test(extension) ? fileDisplayParts(file, findExplorerNode(file)?.format).extension : extension;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'breadcrumb-name';
    button.textContent = name;
    button.setAttribute('aria-label', `Rename ${button.textContent}`);
    button.addEventListener('click', () => {
      const node = findExplorerNode(entryPath);
      if (!node) return;
      const input = document.createElement('input');
      input.className = 'breadcrumb-name';
      input.value = name;
      input.size = Math.max(8, input.value.length);
      input.setAttribute('aria-label', button.getAttribute('aria-label'));
      button.replaceWith(input);
      input.focus();
      input.select();
      const finish = (commit) => {
        if (!input.isConnected) return;
        const nextName = input.value.trim();
        input.replaceWith(button);
        if (commit && nextName && nextName !== name) {
          void renameExplorerEntryTo(node, nextName + extension, file, nextName);
        }
      };
      input.addEventListener('blur', () => finish(true), { once: true });
      input.addEventListener('keydown', (event) => {
        const saveShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's';
        if (event.isComposing || (!saveShortcut && event.key !== 'Enter' && event.key !== 'Escape')) return;
        event.preventDefault();
        event.stopPropagation();
        finish(event.key !== 'Escape');
        button.focus();
      });
    });
    if (index > 0) path.append(' / ');
    path.append(button, displayedExtension);
  });
}
function renderGeometry(root, data) {
  void renderDesmosTool(root, data, 'geometry');
  return;
  data.elements = Array.isArray(data.elements) ? data.elements.filter((item) => item && (item.type === 'point' && validCoordinate(item) || item.type === 'segment' && Array.isArray(item.points) && item.points.length === 2 && item.points.every(validCoordinate) || item.type === 'circle' && validCoordinate(item.center) && Number.isFinite(Number(item.radius)) && Number(item.radius) > 0 || item.type === 'triangle' && Array.isArray(item.points) && item.points.length === 3 && item.points.every(validCoordinate))).slice(0, 500) : [];
  const toolbar = root.querySelector('.structured-toolbar');
  toolbar.innerHTML = `<span>Geometry · choose a tool, then click or drag on the plane</span><select aria-label="Geometry tool"><option value="point">Point</option><option value="segment">Segment</option><option value="circle">Circle</option><option value="triangle">Triangle</option><option value="select">Select</option></select><button type="button" data-geometry-delete>Delete selected</button><button type="button" data-history="undo" aria-label="Undo">${icons.undo}</button><button type="button" data-history="redo" aria-label="Redo">${icons.redo}</button>`;
  const surface = root.querySelector('.structured-surface');
  surface.innerHTML = `<svg class="geometry-plane" viewBox="0 0 800 520" role="img" aria-label="Interactive geometry plane"></svg><div class="geometry-measurements" aria-live="polite"></div>`;
  const svg = surface.querySelector('svg');
  const measurements = surface.querySelector('.geometry-measurements');
  const tool = toolbar.querySelector('select');
  let selected = -1, start = null;
  const toScreen = (p) => ({ x: 400 + Number(p.x) * 32, y: 260 - Number(p.y) * 32 });
  const fromEvent = (event) => { const p = svg.createSVGPoint(); p.x = event.clientX; p.y = event.clientY; const q = p.matrixTransform(svg.getScreenCTM().inverse()); return { x: Math.round((q.x - 400) / 32 * 100) / 100, y: Math.round((260 - q.y) / 32 * 100) / 100 }; };
  const el = (tag, attrs = {}) => { const node = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value)); return node; };
  const draw = () => {
    svg.replaceChildren();
    const grid = el('path', { d: Array.from({ length: 25 }, (_, i) => `M${i * 32} 0V520`).join('') + Array.from({ length: 17 }, (_, i) => `M0 ${i * 32}H800`).join(''), class: 'geometry-grid' }); svg.append(grid);
    svg.append(el('path', { d: 'M0 260H800M400 0V520', class: 'geometry-axis' }));
    data.elements.forEach((item, index) => {
      const points = (item.points || []).map(toScreen); let shape;
      if (item.type === 'point') { const p = toScreen(item); shape = el('circle', { cx: p.x, cy: p.y, r: 6, class: 'geometry-point' }); if (item.label) { const label = el('text', { x: p.x + 9, y: p.y - 8 }); label.textContent = String(item.label).slice(0, 32); svg.append(label); } }
      else if (item.type === 'segment' && points.length >= 2) shape = el('line', { x1: points[0].x, y1: points[0].y, x2: points[1].x, y2: points[1].y, class: 'geometry-line' });
      else if (item.type === 'circle' && item.center) { const c = toScreen(item.center); shape = el('circle', { cx: c.x, cy: c.y, r: Math.max(1, Number(item.radius) * 32), class: 'geometry-circle' }); }
      else if (item.type === 'triangle' && points.length >= 3) shape = el('polygon', { points: points.map(p => `${p.x},${p.y}`).join(' '), class: 'geometry-triangle' });
      if (shape) { shape.dataset.index = index; if (index === selected) shape.classList.add('selected'); svg.append(shape); }
    });
    const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
    const summaries = data.elements.map((item,i) => {
      if (item.type === 'segment' && item.points?.length >= 2) return `Segment ${i+1}: length ${distance(...item.points).toFixed(2)}`;
      if (item.type === 'circle' && item.center) return `Circle ${i+1}: radius ${Number(item.radius).toFixed(2)}, area ${(Math.PI*Number(item.radius)**2).toFixed(2)}`;
      if (item.type === 'triangle' && item.points?.length >= 3) { const [a,b,c]=item.points; return `Triangle ${i+1}: area ${(Math.abs(a.x*(b.y-c.y)+b.x*(c.y-a.y)+c.x*(a.y-b.y))/2).toFixed(2)}`; }
      return null;
    }).filter(Boolean);
    measurements.textContent = summaries.join('  ·  ') || 'Lengths and areas appear here as you add shapes.';
  };
  toolbar.querySelector('[data-geometry-delete]').addEventListener('click', () => { if (selected >= 0) { data.elements.splice(selected,1); selected=-1; setStructuredDirty(); draw(); } });
  svg.addEventListener('pointerdown', (event) => { const index = event.target.closest('[data-index]')?.dataset.index; if (tool.value === 'select') { selected = index == null ? -1 : Number(index); draw(); return; } start = fromEvent(event); if (tool.value === 'point') { data.elements.push({ type: 'point', ...start, label: `P${data.elements.filter(x=>x.type==='point').length+1}` }); start=null; setStructuredDirty(); draw(); } else { svg.setPointerCapture(event.pointerId); } });
  svg.addEventListener('pointerup', (event) => { if (!start) return; const end=fromEvent(event), a=start; start=null; if (tool.value==='segment') data.elements.push({type:'segment',points:[a,end]}); else if(tool.value==='circle') data.elements.push({type:'circle',center:a,radius:Math.max(.05,Math.hypot(end.x-a.x,end.y-a.y))}); else if(tool.value==='triangle') data.elements.push({type:'triangle',points:[a,{x:end.x,y:a.y},end]}); setStructuredDirty(); draw(); });
  draw();
}
function renderCalculator3d(root, data) {
  void renderDesmosTool(root, data, 'calculator3d');
  return;
  const toolbar=root.querySelector('.structured-toolbar');
  toolbar.innerHTML=`<span>3D Calculator · plot z = f(x, y)</span><label>z = <input class="surface-expression" aria-label="Surface expression" spellcheck="false"></label><label>Range <input class="surface-range" type="number" min="1" max="30" step="1" aria-label="Plot range"></label><button type="button" data-surface-plot>Plot</button><button type="button" data-history="undo" aria-label="Undo">${icons.undo}</button><button type="button" data-history="redo" aria-label="Redo">${icons.redo}</button>`;
  const surface=root.querySelector('.structured-surface');surface.innerHTML=`<div class="surface-plot" role="img" aria-label="Three dimensional function plot"></div><div class="surface-status" aria-live="polite">Drag to rotate · scroll to zoom</div>`;
  const input=toolbar.querySelector('.surface-expression'), rangeInput=toolbar.querySelector('.surface-range'), host=surface.querySelector('.surface-plot'), status=surface.querySelector('.surface-status');
  data.expression=typeof data.expression==='string'?data.expression:'sin(sqrt(x^2 + y^2))'; data.range=Math.max(1,Math.min(30,Number(data.range)||6));
  input.value=data.expression;rangeInput.value=data.range;
  const scene=new THREE.Scene(); scene.background=new THREE.Color(state.theme==='dark'?0x242520:state.theme==='sepia'?0xfaf6ed:0xffffff);
  const camera=new THREE.PerspectiveCamera(45,1,.1,1000);camera.position.set(9,8,10);
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));host.append(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xffffff,0x6b6255,2));const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(4,8,6);scene.add(light);
  const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.target.set(0,0,0);
  const grid=new THREE.GridHelper(12,24,state.theme==='dark'?0x77786e:0x77766e,state.theme==='dark'?0x484a42:0xd8d6cf);scene.add(grid);
  let mesh=null;
  const resize=()=>{const w=Math.max(1,host.clientWidth),h=Math.max(1,host.clientHeight);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();};
  const observer=new ResizeObserver(resize);observer.observe(host);resize();
  const plot=(recordChange=true)=>{try{const fn=compileSurfaceExpression(input.value);const bound=Math.max(1,Math.min(30,Number(rangeInput.value)||6));const resolution=Math.max(20,Math.min(100,Number(data.resolution)||48));const geometry=new THREE.BufferGeometry(),vertices=[],indices=[];for(let j=0;j<=resolution;j++)for(let i=0;i<=resolution;i++){const x=-bound+2*bound*i/resolution,y=-bound+2*bound*j/resolution;let z=fn(x,y);if(!Number.isFinite(z)||Math.abs(z)>1000)z=NaN;vertices.push(x,z,y);}for(let j=0;j<resolution;j++)for(let i=0;i<resolution;i++){const a=j*(resolution+1)+i,b=a+1,c=a+resolution+1,d=c+1;indices.push(a,c,b,b,c,d);}geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setIndex(indices);geometry.computeVertexNormals();const material=new THREE.MeshStandardMaterial({color:0x987353,side:THREE.DoubleSide,roughness:.62,metalness:.05,wireframe:false});const next=new THREE.Mesh(geometry,material);if(mesh){scene.remove(mesh);mesh.geometry.dispose();mesh.material.dispose();}mesh=next;scene.add(mesh);data.expression=input.value.trim();data.range=bound;if(recordChange)setStructuredDirty();status.textContent=`z = ${data.expression} · range ±${bound}`;}catch(error){status.textContent=error.message||'Expression could not be plotted.';}};
  toolbar.querySelector('[data-surface-plot]').addEventListener('click',plot);input.addEventListener('keydown',event=>{if(event.key==='Enter')plot();});
  let frame;const animate=()=>{frame=requestAnimationFrame(animate);controls.update();renderer.render(scene,camera);};animate();plot(false);
  state.structured.refreshCalculator3d=()=>{scene.background.set(state.theme==='dark'?0x242520:state.theme==='sepia'?0xfaf6ed:0xffffff);};
  state.structured.cleanup=()=>{cancelAnimationFrame(frame);observer.disconnect();controls.dispose();if(mesh){mesh.geometry.dispose();mesh.material.dispose();}renderer.dispose();};
}
async function renderDesmosTool(root, data, type) {
  const isGeometry = type === 'geometry';
  const label = isGeometry ? 'Desmos Geometry Tool' : 'Desmos 3D Calculator';
  const toolbar = root.querySelector('.structured-toolbar');
  toolbar.innerHTML = `<span>${label} · state is saved in this file</span><button data-history="undo" title="Undo (⌘Z)" aria-label="Undo">${icons.undo}</button><button data-history="redo" title="Redo (⌘⇧Z)" aria-label="Redo">${icons.redo}</button>`;
  toolbar.querySelectorAll('[data-history]').forEach((button) => button.addEventListener('click', () => applyStructuredHistory(button.dataset.history)));
  const surface = root.querySelector('.structured-surface');
  const owner = state.structured;
  const status = (message, configure = false) => {
    surface.replaceChildren();
    const panel = document.createElement('div'); panel.className = 'graph-setup';
    const text = document.createElement('p'); text.textContent = message; panel.append(text);
    if (configure) { const button = document.createElement('button'); button.className = 'secondary-button'; button.textContent = 'Open Graphing settings'; button.addEventListener('click', () => openSettings('desmos')); panel.append(button); }
    surface.append(panel);
  };
  let key = '';
  try { key = await window.stillnote.getDesmosKey(); }
  catch (error) { status(error.message || 'Open a vault to use the saved Desmos key.'); return; }
  if (!key) { setSettingsHealth('desmos', false, 'Desmos API key missing'); status(`A Desmos API key with ${isGeometry ? 'Geometry Tool' : '3D Calculator'} access is required.`, true); return; }
  try {
    const api = await loadDesmosApi(key);
    if (state.structured !== owner || !root.isConnected) return;
    const constructor = isGeometry ? api.Geometry : api.Calculator3D;
    const feature = isGeometry ? 'GeometryCalculator' : 'Calculator3D';
    if (typeof constructor !== 'function' || api.enabledFeatures?.[feature] === false) throw new Error(`This Desmos API key does not have ${isGeometry ? 'Geometry Tool' : '3D Calculator'} access enabled.`);
    const host = document.createElement('div'); host.className = 'graph-calculator'; surface.replaceChildren(host);
    const tool = constructor(host, { expressions: true, keypad: true, settingsMenu: true, zoomButtons: true, autosize: true, border: false, invertedColors: false });
    owner.desmos = tool;
    setSettingsHealth('desmos', true, 'Desmos API key working');
    if (data.state && typeof data.state === 'object') {
      try { tool.setState(data.state); } catch { data.state = tool.getState(); }
    } else {
      const migratingLegacyFile = Object.keys(data).some((key) => !['version', 'state'].includes(key));
      data.state = tool.getState();
      if (migratingLegacyFile) setStructuredDirty();
    }
    tool.clearHistory();
    tool.observeEvent('change', () => {
      if (state.structured !== owner || !state.active) return;
      data.state = tool.getState(); setStructuredDirty();
    });
  } catch (error) {
    if (state.structured === owner && root.isConnected) { setSettingsHealth('desmos', false, 'Desmos tool unavailable'); status(error.message || `Could not open ${label}.`, true); }
  }
}
function isCanvasImageFile(file) { return /\.(png|jpe?g|webp|gif|svg|bmp|heic|icns)$/i.test(file); }
function openCanvasImagePicker(insert) {
  const previousFocus = document.activeElement;
  const dialog = document.createElement('dialog'); dialog.className = 'canvas-image-dialog';
  dialog.setAttribute('aria-labelledby', 'canvas-image-title');
  dialog.innerHTML = `<form><header><h2 id="canvas-image-title">Add image</h2><button type="button" class="icon-button" data-close aria-label="Close">${icons.close}</button></header><label for="canvas-image-link">Image link</label><input class="settings-input" id="canvas-image-link" placeholder="Vault path, Stillnote link, or https://…" required autocomplete="off"><p class="canvas-image-hint">Vault links follow file and folder renames and moves. A saved copy keeps the image visible if its source is deleted.</p><label for="canvas-image-filter">Images in your vault</label><input class="settings-input" id="canvas-image-filter" type="search" placeholder="Filter images…"><div class="canvas-image-list"></div><p class="canvas-image-error" role="alert"></p><footer><button type="button" class="secondary-button" data-close>Cancel</button><button class="primary-button" type="submit">Add image</button></footer></form>`;
  const input = dialog.querySelector('#canvas-image-link'), filter = dialog.querySelector('#canvas-image-filter'), list = dialog.querySelector('.canvas-image-list');
  const files = explorerFilePaths().filter(isCanvasImageFile);
  const render = () => {
    list.replaceChildren();
    const matches = files.filter(file => file.toLowerCase().includes(filter.value.toLowerCase()));
    for (const file of matches) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'canvas-image-option';
      button.textContent = file; button.title = file;
      button.addEventListener('click', () => { input.value = file; input.focus(); }); list.append(button);
    }
    if (!matches.length) { const empty = document.createElement('p'); empty.textContent = files.length ? 'No matching images.' : 'No images found. Add images to your vault to choose them here.'; list.append(empty); }
  };
  filter.addEventListener('input', render); render();
  dialog.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('keydown', event => { if (event.key === 'Escape') event.stopPropagation(); });
  dialog.addEventListener('close', () => { dialog.remove(); if (previousFocus?.isConnected) previousFocus.focus(); });
  dialog.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault(); const submit = dialog.querySelector('[type="submit"]'), error = dialog.querySelector('.canvas-image-error');
    submit.disabled = true; error.textContent = '';
    try { await insert(input.value.trim(), () => dialog.open); if (dialog.open) dialog.close(); }
    catch (problem) { error.textContent = problem.message || 'Could not add image.'; }
    finally { submit.disabled = false; }
  });
  document.body.append(dialog); dialog.showModal(); input.focus();
}
const canvasImageAssets = new Map();
function canvasImageAsset(file) {
  const key = `${state.vault?.path}/${file}`;
  let cached = canvasImageAssets.get(key);
  if (!cached || Date.now() - cached.time > 5000) {
    cached = { time: Date.now(), promise: window.stillnote.readAsset(file) };
    if (canvasImageAssets.size > 50) canvasImageAssets.clear();
    canvasImageAssets.set(key, cached);
  }
  return cached.promise;
}
function canvasElementBounds(el) {
    if(el.type==='stroke') { const xs=el.points.map(p=>p.x),ys=el.points.map(p=>p.y);const x=Math.min(...xs),y=Math.min(...ys);return {x,y,w:Math.max(1,Math.max(...xs)-x),h:Math.max(1,Math.max(...ys)-y)}; }
    if(el.type==='line') return {x:Math.min(el.x1,el.x2),y:Math.min(el.y1,el.y2),w:Math.max(1,Math.abs(el.x2-el.x1)),h:Math.max(1,Math.abs(el.y2-el.y1))};
    if(el.type==='text') return {x:el.x,y:el.y,w:Math.max(40,el.w||220),h:Math.max(30,el.h||60)};
    return {x:Math.min(el.x,el.x+el.w),y:Math.min(el.y,el.y+el.h),w:Math.max(1,Math.abs(el.w)),h:Math.max(1,Math.abs(el.h))};
}

function canvasSelectionFrame(elements, rotation = 0) {
  if (!elements.length) return null;
  const angle = rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  const points = elements.flatMap(el => {
    if (el.type === 'stroke') return el.points;
    if (el.type === 'line') return [{ x: el.x1, y: el.y1 }, { x: el.x2, y: el.y2 }];
    const b = canvasElementBounds(el), cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const a = (el.rotation || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return [[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]].map(([x,y]) => ({ x: cx + x*b.w*c - y*b.h*s, y: cy + x*b.w*s + y*b.h*c }));
  }).map(p => ({ x: p.x*cos + p.y*sin, y: -p.x*sin + p.y*cos }));
  if (!points.length) return null;
  const left = Math.min(...points.map(p => p.x)), top = Math.min(...points.map(p => p.y));
  const w = Math.max(1, Math.max(...points.map(p => p.x)) - left), h = Math.max(1, Math.max(...points.map(p => p.y)) - top);
  const cx = left+w/2, cy = top+h/2, center = { x: cx*cos-cy*sin, y: cx*sin+cy*cos };
  return { x: center.x-w/2, y: center.y-h/2, w, h, rotation, center };
}
function duplicateCanvasElements(data, indices, offset = 24) {
  const copies = [...indices].sort((a,b) => a-b).filter(i => data.elements[i]).map(i => {
    const copy = structuredClone(data.elements[i]);
    if (copy.type === 'stroke') copy.points = copy.points.map(p => ({ x: p.x+offset, y: p.y+offset }));
    else if (copy.type === 'line') { copy.x1+=offset; copy.y1+=offset; copy.x2+=offset; copy.y2+=offset; }
    else { copy.x+=offset; copy.y+=offset; }
    return copy;
  });
  const start = data.elements.length; data.elements.push(...copies);
  return new Set(copies.map((_,i) => start+i));
}
function insertCanvasImage(data, src, width, height, name) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('This image has invalid dimensions.');
  const canvasWidth = data.width || 1200, canvasHeight = data.height || 760;
  const scale = Math.min(1, canvasWidth * .8 / width, canvasHeight * .8 / height);
  const w = width * scale, h = height * scale;
  const image = { type: 'image', src, name, x: (canvasWidth - w) / 2, y: (canvasHeight - h) / 2, w, h };
  data.elements.unshift(image);
  return image;
}
function drawCanvasElements(svg, data, displayColor, selected = new Set(), readOnly = false, onTextFocus = () => {}) {
    data.elements.forEach((el, i) => {
      let node;
      if (el.type === 'image') {
        const target = el.link?.match(/^<\[([^\]]+)\]>$/)?.[1];
        if (el.link && (!target || !resolveVaultFileTarget(target) || el.missing)) {
          node = document.createElementNS('http://www.w3.org/2000/svg', 'g'); node.classList.add('canvas-image-missing');
          const box = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          for(const [key,value] of Object.entries({x:el.x,y:el.y,width:el.w,height:el.h,rx:8,fill:'none',stroke:'#c24f49','stroke-dasharray':'5 4'}))box.setAttribute(key,value);
          const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');label.setAttribute('x',el.x+8);label.setAttribute('y',el.y+22);label.setAttribute('fill','#c24f49');label.setAttribute('font-size',14);label.textContent=el.link;
          node.append(box,label);node.setAttribute('aria-label',`Missing image: ${target || el.link}`);
        } else {
          node = document.createElementNS('http://www.w3.org/2000/svg', 'image'); node.classList.add('canvas-image');
          node.setAttribute('x', el.x); node.setAttribute('y', el.y); node.setAttribute('width', el.w); node.setAttribute('height', el.h);node.setAttribute('preserveAspectRatio', 'xMidYMid meet');
          if (!el.link && /^data:image\/(?:png|jpeg|webp|gif|svg\+xml|bmp);base64,/i.test(el.src || '')) node.setAttribute('href', el.src);
          if (!el.link && /^https?:\/\//i.test(el.url || '')) node.setAttribute('href', el.url);
          if (target) {
            const imageNode=node; imageNode.dataset.fileTarget=target;
            void canvasImageAsset(target).then(asset => { if(imageNode.isConnected && resolveVaultFileTarget(target) && asset.mime.startsWith('image/'))imageNode.setAttribute('href',asset.data); })
              .catch(() => { if(imageNode.isConnected){imageNode.removeAttribute('href');void refreshExplorer().catch(()=>{});} });
          }
          node.setAttribute('aria-label', el.name || 'Canvas image');
        }
      }
      else if (el.type === 'stroke') { node = document.createElementNS('http://www.w3.org/2000/svg', 'polyline'); node.setAttribute('points', el.points.map(p => `${p.x},${p.y}`).join(' ')); node.setAttribute('fill','none'); node.setAttribute('stroke',displayColor(el.color)); node.setAttribute('stroke-width','3'); node.setAttribute('stroke-linecap','round'); node.setAttribute('stroke-linejoin','round'); }
      else if(el.type==='line'){
        node=document.createElementNS('http://www.w3.org/2000/svg','g');const line=document.createElementNS('http://www.w3.org/2000/svg','line');line.setAttribute('x1',el.x1);line.setAttribute('y1',el.y1);line.setAttribute('x2',el.x2);line.setAttribute('y2',el.y2);line.setAttribute('stroke',displayColor(el.color));line.setAttribute('stroke-width','3');line.setAttribute('stroke-linecap','round');node.append(line);
        const dx=el.x2-el.x1,dy=el.y2-el.y1,length=Math.hypot(dx,dy)||1;
        for(const [which,x,y,style,sign] of [['start',el.x1,el.y1,el.startMarker||'none',-1],['end',el.x2,el.y2,el.endMarker||'arrow',1]]){if(style==='none')continue;const ux=dx/length*sign,uy=dy/length*sign;if(style==='circle'){const mark=document.createElementNS('http://www.w3.org/2000/svg','circle');mark.setAttribute('cx',x);mark.setAttribute('cy',y);mark.setAttribute('r',5);mark.setAttribute('fill',displayColor(el.color));node.append(mark);}else if(style==='square'){const mark=document.createElementNS('http://www.w3.org/2000/svg','rect');mark.setAttribute('x',x-4);mark.setAttribute('y',y-4);mark.setAttribute('width',8);mark.setAttribute('height',8);mark.setAttribute('fill',displayColor(el.color));node.append(mark);}else if(style==='diamond'){const mark=document.createElementNS('http://www.w3.org/2000/svg','polygon');mark.setAttribute('points',`${x},${y-5} ${x+5},${y} ${x},${y+5} ${x-5},${y}`);mark.setAttribute('fill',displayColor(el.color));node.append(mark);}else{const bx=x-ux*12,by=y-uy*12,px=-uy*5,py=ux*5,mark=document.createElementNS('http://www.w3.org/2000/svg','polygon');mark.setAttribute('points',`${x},${y} ${bx+px},${by+py} ${bx-px},${by-py}`);mark.setAttribute('fill',displayColor(el.color));node.append(mark);}}
      }
      else if(el.type==='shape'){
        const x=el.x,y=el.y,w=el.w,h=el.h;node=document.createElementNS('http://www.w3.org/2000/svg',el.shape==='rectangle'?'rect':el.shape==='ellipse'?'ellipse':'polygon');
        if(el.shape==='rectangle'){node.setAttribute('x',x);node.setAttribute('y',y);node.setAttribute('width',w);node.setAttribute('height',h);}
        else if(el.shape==='ellipse'){node.setAttribute('cx',x+w/2);node.setAttribute('cy',y+h/2);node.setAttribute('rx',w/2);node.setAttribute('ry',h/2);}
        else if(el.shape==='triangle'){const vertices=el.vertices||[[.5,0],[1,1],[0,1]];node.setAttribute('points',vertices.map(([vx,vy])=>`${x+vx*w},${y+vy*h}`).join(' '));}
        else if(el.shape==='star'){const count=Math.max(4,Math.min(12,el.points||5)),cx=x+w/2,cy=y+h/2,outer=Math.min(w,h)/2,inner=outer*.46,vertices=[];for(let j=0;j<count*2;j++){const radius=j%2?inner:outer,angle=-Math.PI/2+j*Math.PI/count;vertices.push(`${cx+Math.cos(angle)*radius},${cy+Math.sin(angle)*radius}`);}node.setAttribute('points',vertices.join(' '));}
        else {node=document.createElementNS('http://www.w3.org/2000/svg','path');node.setAttribute('d',`M ${x+w*.12} ${y+h*.12} H ${x+w*.88} V ${y+h*.7} H ${x+w*.4} L ${x+w*.22} ${y+h*.92} V ${y+h*.7} H ${x+w*.12} Z`);}
        node.setAttribute('fill','none');node.setAttribute('stroke',displayColor(el.color));node.setAttribute('stroke-width','3');node.setAttribute('stroke-linejoin','round');
        node.setAttribute('pointer-events','all');
      }
      else if (el.type === 'rect' || el.type === 'ellipse') { node = document.createElementNS('http://www.w3.org/2000/svg', el.type === 'rect' ? 'rect' : 'ellipse'); if (el.type === 'rect') { node.setAttribute('x',el.x); node.setAttribute('y',el.y); node.setAttribute('width',el.w); node.setAttribute('height',el.h); } else { node.setAttribute('cx',el.x+el.w/2); node.setAttribute('cy',el.y+el.h/2); node.setAttribute('rx',Math.abs(el.w/2)); node.setAttribute('ry',Math.abs(el.h/2)); } node.setAttribute('fill','none'); node.setAttribute('stroke',displayColor(el.color)); node.setAttribute('stroke-width','3');node.setAttribute('pointer-events','all'); }
      else {
        node = document.createElementNS('http://www.w3.org/2000/svg','foreignObject');
        node.setAttribute('x',el.x); node.setAttribute('y',el.y); node.setAttribute('width',Math.max(40,el.w||220)); node.setAttribute('height',Math.max(30,el.h||60));
        node.innerHTML=`<div xmlns="http://www.w3.org/1999/xhtml" class="canvas-text-edit" contenteditable="false" spellcheck="false">${sheetCellHtml(el.text||'')}</div>`;
        const editor=node.querySelector('.canvas-text-edit');
        if (!readOnly) {
          const showSource = () => { if (editor.querySelector('.sheet-wiki-link')) editor.textContent = el.text || ''; };
          // Expand rendered links before the browser places the caret.
          editor.addEventListener('pointerdown', () => { if (editor.contentEditable === 'true') showSource(); });
          editor.addEventListener('focus', () => { editor.contentEditable = 'true'; showSource(); onTextFocus(i); });
          editor.addEventListener('input', () => { el.text = editor.innerText; setStructuredDirty(); });
          editor.addEventListener('paste', event => {
            event.preventDefault(); event.stopPropagation();
            document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
          });
          editor.addEventListener('blur', () => {
            const text = editor.innerText;
            if (text !== (el.text || '')) { el.text = text; setStructuredDirty(); }
            editor.contentEditable = 'false';
            editor.innerHTML = sheetCellHtml(el.text || '');
          });
        }
        editor.contentEditable = 'false';
        if (!readOnly) editor.tabIndex = -1;
        editor.style.color=displayColor(el.color);
      }
      const elementBounds=canvasElementBounds(el);
      if(el.type!=='stroke'&&el.rotation) node.setAttribute('transform',`rotate(${el.rotation} ${elementBounds.x+elementBounds.w/2} ${elementBounds.y+elementBounds.h/2})`);
      node.dataset.index = i; if (selected.has(i)) node.classList.add('is-selected'); svg.append(node);
    });
}
function renderCanvas(root, data) {
  const toolbar = root.querySelector('.structured-toolbar');
  const colors=[['red','#d94d48'],['yellow','#d9ae23'],['green','#348562'],['blue','#397dc2'],['black','#20211e']];
  toolbar.innerHTML = `<div class="canvas-tool-group" role="toolbar" aria-label="Canvas tools">${[['select','Select and move',icons.cursor],['draw','Pen tool',icons.draw],['shape','Shape tool',icons.shape],['line','Line tool',icons.line],['text','Insert text',icons.text]].map(([tool,label,icon])=>`<button class="canvas-tool${tool==='select'?' active':''}" data-tool="${tool}" title="${label}" aria-label="${label}" aria-pressed="${tool==='select'}">${icon}</button>`).join('')}<button class="canvas-tool" data-action="image" title="Add image" aria-label="Add image">${icons.image}</button><span class="canvas-tool-divider"></span><button class="canvas-tool" data-action="rotate" title="Rotate selected 15° clockwise" aria-label="Rotate selected 15 degrees clockwise">${icons.rotate}</button><button class="canvas-tool canvas-delete" data-tool="delete" title="Delete selected" aria-label="Delete selected">${icons.trash}</button><span class="canvas-tool-divider"></span><button class="canvas-tool" data-history="undo" title="Undo (⌘Z)" aria-label="Undo">${icons.undo}</button><button class="canvas-tool" data-history="redo" title="Redo (⌘⇧Z)" aria-label="Redo">${icons.redo}</button></div>`;
  const surface = root.querySelector('.structured-surface');
  surface.innerHTML = `<svg class="canvas-svg" viewBox="0 0 ${data.width || 1200} ${data.height || 760}" style="width:${data.width || 1200}px;height:${data.height || 760}px;max-width:none" role="img" aria-label="Drawing canvas" xmlns="http://www.w3.org/2000/svg"></svg>`;
  const svg = surface.querySelector('svg');
  const palette=document.createElement('div');palette.className='canvas-color-palette';palette.setAttribute('role','group');palette.setAttribute('aria-label','Selected item actions');
  palette.innerHTML=colors.map(([name,color])=>`<button class="canvas-color-swatch" data-color="${color}" style="--swatch:${color}" title="${name[0].toUpperCase()+name.slice(1)}" aria-label="${name[0].toUpperCase()+name.slice(1)} color" aria-pressed="false"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3.2 3.2L13 4.8"/></svg></button>`).join('') + `<button type="button" class="canvas-duplicate" aria-label="Duplicate selection" title="Duplicate selection">${icons.duplicate}</button>`;surface.append(palette);
  const shapeMenu=document.createElement('div');shapeMenu.className='canvas-shape-menu';shapeMenu.setAttribute('role','group');shapeMenu.setAttribute('aria-label','Shape options');
  shapeMenu.innerHTML=`<div class="canvas-shape-options">${[['rectangle','Rectangle',icons.rectangle],['ellipse','Ellipse',icons.ellipse],['triangle','Triangle',icons.triangle],['star','Star',icons.star],['speech','Speech bubble',icons.speech]].map(([shape,label,icon])=>`<button type="button" data-shape="${shape}" title="${label}" aria-label="${label}" aria-pressed="false">${icon}</button>`).join('')}</div><label class="canvas-star-points" hidden>Points <select aria-label="Star points">${Array.from({length:9},(_,i)=>`<option value="${i+4}"${i===1?' selected':''}>${i+4}</option>`).join('')}</select></label>`;surface.append(shapeMenu);
  const lineMenu=document.createElement('div');lineMenu.className='canvas-line-menu';lineMenu.setAttribute('role','group');lineMenu.setAttribute('aria-label','Line endpoint styles');
  lineMenu.innerHTML=`${[['start','Start'],['end','End']].map(([endpoint,label])=>`<div class="canvas-endpoint-menu" data-endpoint-menu="${endpoint}" role="group" aria-label="${label} endpoint style">${[['none','None',icons.markerNone],['arrow','Arrow',icons.markerArrow],['circle','Circle',icons.markerCircle],['square','Square',icons.markerSquare],['diamond','Diamond',icons.markerDiamond]].map(([style,title,icon])=>`<button type="button" data-endpoint="${endpoint}" data-style="${style}" title="${label}: ${title}" aria-label="${label}: ${title}" aria-pressed="false">${icon}</button>`).join('')}</div>`).join('')}`;surface.append(lineMenu);
  const toolHelp=document.createElement('div');toolHelp.className='canvas-tool-help';toolHelp.setAttribute('aria-live','polite');root.append(toolHelp);
  let tool = 'select'; let selected = new Set(); let draft = null; let interaction = null; let selectionBox = null; let selectedColor='#20211e';
  const displayColor=color=>{const value=String(color||selectedColor).toLowerCase();return state.theme==='dark'&&['#20211e','#353630','#373832','#000','#000000'].includes(value)?'#ffffff':(color||selectedColor);};
  const bounds = canvasElementBounds;
  let selectionRotation = 0, selectionMembers = [];
  const selectionFrame = () => {
    const members = [...selected].map(i => data.elements[i]);
    if (members.length !== selectionMembers.length || members.some((el, i) => el !== selectionMembers[i])) {
      selectionRotation = members.length === 1 ? members[0].rotation || 0 : 0; selectionMembers = members;
    }
    return canvasSelectionFrame(members, selectionRotation);
  };
  const selectionBounds = indices => canvasSelectionFrame([...indices].map(i => data.elements[i]));
  const rotatedPoint=(x,y,center,angle)=>({x:center.x+(x-center.x)*Math.cos(angle)-(y-center.y)*Math.sin(angle),y:center.y+(x-center.x)*Math.sin(angle)+(y-center.y)*Math.cos(angle)});
  const rotateSelectionBy=(degrees)=>{
    const group=selectionFrame();if(!group)return;const center={x:group.x+group.w/2,y:group.y+group.h/2},angle=degrees*Math.PI/180;
    for(const i of selected){const el=data.elements[i];if(el.type==='stroke')el.points=el.points.map(p=>rotatedPoint(p.x,p.y,center,angle));else if(el.type==='line'){const a=rotatedPoint(el.x1,el.y1,center,angle),b=rotatedPoint(el.x2,el.y2,center,angle);el.x1=a.x;el.y1=a.y;el.x2=b.x;el.y2=b.y;}else{const b=bounds(el),moved=rotatedPoint(b.x+b.w/2,b.y+b.h/2,center,angle);el.x=moved.x-b.w/2;el.y=moved.y-b.h/2;el.rotation=((el.rotation||0)+degrees)%360;}}
    selectionRotation += degrees;
    paint();setStructuredDirty();
  };
  const paintSelection = () => {
    svg.querySelector('.canvas-selection-overlay')?.remove();
    svg.querySelectorAll('[data-index]').forEach(node => node.classList.toggle('is-selected', selected.has(Number(node.dataset.index))));
    const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    overlay.classList.add('canvas-selection-overlay'); svg.append(overlay);
    const linesOnly=selected.size>0&&[...selected].every(i=>data.elements[i].type==='line');
    if(selected.size) {
      const b = selectionFrame();
      if(!linesOnly){
      const frameOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      frameOverlay.setAttribute('transform', `rotate(${b.rotation} ${b.center.x} ${b.center.y})`); overlay.append(frameOverlay);
      const outline=document.createElementNS('http://www.w3.org/2000/svg','rect');outline.setAttribute('x',b.x-4);outline.setAttribute('y',b.y-4);outline.setAttribute('width',b.w+8);outline.setAttribute('height',b.h+8);outline.setAttribute('fill','none');outline.setAttribute('stroke','#9a765a');outline.setAttribute('stroke-dasharray','5 4');outline.setAttribute('pointer-events','none');frameOverlay.append(outline);
      for(const [name,x,y] of [['nw',b.x,b.y],['ne',b.x+b.w,b.y],['sw',b.x,b.y+b.h],['se',b.x+b.w,b.y+b.h]]) {const h=document.createElementNS('http://www.w3.org/2000/svg','rect');h.setAttribute('x',x-5);h.setAttribute('y',y-5);h.setAttribute('width',10);h.setAttribute('height',10);h.setAttribute('rx',2);h.setAttribute('fill','#fff');h.setAttribute('stroke','#9a765a');h.setAttribute('stroke-width',2);h.dataset.handle=name;h.classList.add('canvas-resize-handle');frameOverlay.append(h);}
      const rotateX=b.x+b.w/2,rotateY=b.y-24;
      const stem=document.createElementNS('http://www.w3.org/2000/svg','line');stem.setAttribute('x1',rotateX);stem.setAttribute('x2',rotateX);stem.setAttribute('y1',b.y-4);stem.setAttribute('y2',rotateY+6);stem.setAttribute('stroke','#9a765a');stem.setAttribute('pointer-events','none');frameOverlay.append(stem);
      const rotate=document.createElementNS('http://www.w3.org/2000/svg','circle');rotate.setAttribute('cx',rotateX);rotate.setAttribute('cy',rotateY);rotate.setAttribute('r',6);rotate.setAttribute('fill','#fff');rotate.setAttribute('stroke','#9a765a');rotate.setAttribute('stroke-width',2);rotate.dataset.handle='rotate';rotate.classList.add('canvas-rotate-handle');frameOverlay.append(rotate);
      }
      for(const i of selected){const el=data.elements[i];if(el.type==='shape'&&el.shape==='triangle'){const center={x:el.x+el.w/2,y:el.y+el.h/2};(el.vertices||[[.5,0],[1,1],[0,1]]).forEach(([vx,vy],pointIndex)=>{const p=rotatedPoint(el.x+vx*el.w,el.y+vy*el.h,center,(el.rotation||0)*Math.PI/180),handle=document.createElementNS('http://www.w3.org/2000/svg','circle');handle.setAttribute('cx',p.x);handle.setAttribute('cy',p.y);handle.setAttribute('r',5);handle.setAttribute('fill','#fff');handle.setAttribute('stroke','#9a765a');handle.setAttribute('stroke-width',2);handle.dataset.pointHandle=String(pointIndex);handle.dataset.index=String(i);handle.classList.add('canvas-point-handle');overlay.append(handle);});}else if(el.type==='line'){for(const [which,x,y] of [['start',el.x1,el.y1],['end',el.x2,el.y2]]){const handle=document.createElementNS('http://www.w3.org/2000/svg','circle');handle.setAttribute('cx',x);handle.setAttribute('cy',y);handle.setAttribute('r',8);handle.setAttribute('fill','#fff');handle.setAttribute('stroke','#9a765a');handle.setAttribute('stroke-width',2.5);handle.setAttribute('pointer-events','all');handle.dataset.pointHandle=which;handle.dataset.index=String(i);handle.classList.add('canvas-point-handle');overlay.append(handle);}}}
    }
    if(selectionBox){const box=document.createElementNS('http://www.w3.org/2000/svg','rect');box.setAttribute('x',Math.min(selectionBox.start.x,selectionBox.current.x));box.setAttribute('y',Math.min(selectionBox.start.y,selectionBox.current.y));box.setAttribute('width',Math.abs(selectionBox.current.x-selectionBox.start.x));box.setAttribute('height',Math.abs(selectionBox.current.y-selectionBox.start.y));box.setAttribute('class','canvas-marquee');box.setAttribute('pointer-events','none');overlay.append(box);}
    const box=selected.size?selectionBounds(selected):null;
    palette.hidden=!box;
    const showColors = [...selected].some(i => data.elements[i].type !== 'image');
    palette.querySelectorAll('[data-color]').forEach(button => button.hidden = !showColors);
    const one=selected.size===1?data.elements[[...selected][0]]:null,shapeTarget=one?.type==='shape'||one?.type==='rect'||one?.type==='ellipse'?one:null,lineTarget=one?.type==='line'?one:null;
    shapeMenu.hidden=!shapeTarget;lineMenu.hidden=!lineTarget;
    if(shapeTarget){const shapeName=shapeTarget.shape||(shapeTarget.type==='rect'?'rectangle':shapeTarget.type==='ellipse'?'ellipse':'');shapeMenu.querySelectorAll('[data-shape]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.shape===shapeName)));shapeMenu.querySelector('.canvas-star-points').hidden=shapeName!=='star';shapeMenu.querySelector('select').value=String(shapeTarget.points||5);}
    if(lineTarget){for(const endpoint of ['start','end']){const style=lineTarget[`${endpoint}Marker`]||(endpoint==='end'?'arrow':'none');lineMenu.querySelectorAll(`[data-endpoint="${endpoint}"][data-style]`).forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.style===style)));}}
    if(box){const scale=svg.clientWidth/Math.max(1,data.width||1200);const right=(box.x+box.w)*scale+10;const left=right+palette.offsetWidth<=svg.clientWidth?right:Math.max(4,box.x*scale-palette.offsetWidth-10);palette.style.left=`${left}px`;palette.style.top=`${Math.max(8,box.y*scale)}px`;const menuLeft=Math.min(Math.max(4,left),Math.max(4,svg.clientWidth-190));shapeMenu.style.left=`${menuLeft}px`;const menuTop=Math.max(8,box.y*scale+palette.offsetHeight+8);shapeMenu.style.top=`${menuTop}px`;}
    if(lineTarget){const scale=svg.clientWidth/Math.max(1,data.width||1200);for(const [endpoint,x,y] of [['start',lineTarget.x1,lineTarget.y1],['end',lineTarget.x2,lineTarget.y2]]){const menu=lineMenu.querySelector(`[data-endpoint-menu="${endpoint}"]`),left=x*scale-menu.offsetWidth-9;menu.style.left=`${left>=2?left:x*scale+10}px`;menu.style.top=`${Math.max(2,y*scale-menu.offsetHeight/2)}px`;}}
    palette.querySelectorAll('[data-color]').forEach(swatch=>{const active=swatch.dataset.color.toLowerCase()===selectedColor.toLowerCase();swatch.classList.toggle('active',active);swatch.setAttribute('aria-pressed',String(active));});
  };
  const paint = () => {
    svg.replaceChildren();
    drawCanvasElements(svg, data, displayColor, selected, false, index => {
      selected = new Set([index]); selectedColor = data.elements[index].color || selectedColor;
      paintSelection();
    });
    paintSelection();
  };
  svg.dataset.tool=tool;
  const deleteSelected=()=>{if(!selected.size)return;for(const i of [...selected].sort((a,b)=>b-a))data.elements.splice(i,1);selected.clear();paint();setStructuredDirty();};
  state.structured.deleteCanvasSelection=deleteSelected;
  toolbar.querySelectorAll('[data-tool]').forEach(button => button.addEventListener('click', () => { if (button.dataset.tool === 'delete') { deleteSelected(); return; } tool = button.dataset.tool; svg.dataset.tool=tool; toolbar.querySelectorAll('.canvas-tool[data-tool]').forEach(b => {const active=b===button;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});updateToolHelp(); }));
  toolbar.querySelector('[data-action="image"]').addEventListener('click', () => {
    const owner = state.structured;
    openCanvasImagePicker(async (reference, stillOpen) => {
      const remote = /^https?:\/\//i.test(reference);
      const target = reference.replace(/^<\[|\]>$/g, '').replace(/^\[\[|\]\]$/g, '').split('|')[0].trim();
      const file = remote ? null : resolveVaultFileTarget(target);
      if (!remote && (!file || !isCanvasImageFile(file))) throw new Error('Choose an image from the vault or enter its full vault path.');
      const asset = remote ? { data: reference } : await window.stillnote.readAsset(file);
      const image = new Image();
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('This image could not be loaded. Check its link and format.')); image.src = asset.data; });
      if (!stillOpen()) return;
      if (state.structured !== owner || !root.isConnected) throw new Error('Reopen the canvas before adding an image.');
      const element = insertCanvasImage(data, remote ? '' : asset.data, image.naturalWidth, image.naturalHeight, file || reference);
      if (remote) element.url = reference;
      else element.link = `<[${file}]>`;
      selected = new Set([0]); tool = 'select'; svg.dataset.tool = tool;
      toolbar.querySelectorAll('.canvas-tool[data-tool]').forEach(button => { const active = button.dataset.tool === tool; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
      updateToolHelp(); paint(); setStructuredDirty();
    });
  });
  toolbar.querySelector('[data-action="rotate"]').addEventListener('click',()=>rotateSelectionBy(15));
  palette.querySelector('.canvas-duplicate').addEventListener('click', () => {
    if (!selected.size) return;
    const rotation = selectionFrame()?.rotation || 0;
    selected = duplicateCanvasElements(data, selected);
    selectionMembers = [...selected].map(i => data.elements[i]); selectionRotation = rotation;
    paint(); setStructuredDirty();
  });
  palette.querySelectorAll('[data-color]').forEach(button=>button.addEventListener('click',()=>{selectedColor=button.dataset.color;for(const i of selected)if(data.elements[i].type !== 'image')data.elements[i].color=selectedColor;if(selected.size){paint();setStructuredDirty();}}));
  shapeMenu.querySelectorAll('[data-shape]').forEach(button=>button.addEventListener('click',()=>{const target=selected.size===1?data.elements[[...selected][0]]:null;if(!['shape','rect','ellipse'].includes(target?.type))return;target.type='shape';target.shape=button.dataset.shape;if(target.shape==='triangle')target.vertices||=[[.5,0],[1,1],[0,1]];if(target.shape==='star')target.points||=5;paint();setStructuredDirty();}));
  shapeMenu.querySelector('select').addEventListener('change',event=>{const target=selected.size===1?data.elements[[...selected][0]]:null;if(target?.type==='shape'&&target.shape==='star'){target.points=Number(event.target.value);paint();setStructuredDirty();}});
  lineMenu.querySelectorAll('button[data-endpoint][data-style]').forEach(button=>button.addEventListener('click',()=>{const target=selected.size===1?data.elements[[...selected][0]]:null;if(target?.type==='line'){target[`${button.dataset.endpoint}Marker`]=button.dataset.style;paint();setStructuredDirty();}}));
  toolbar.querySelectorAll('[data-history]').forEach(button=>button.addEventListener('click',()=>applyStructuredHistory(button.dataset.history)));
  const point = e => { const p = svg.createSVGPoint(); p.x=e.clientX;p.y=e.clientY; const q=p.matrixTransform(svg.getScreenCTM().inverse()); return {x:q.x,y:q.y}; };
  const updateToolHelp=()=>{const help={select:'First click selects text for dragging; click it again to edit. Alt + drag moves selected text. Use the corner handles to resize and the top handle to rotate.',draw:'Drag to draw freehand with the pen.',shape:'Drag to create a bounding box, then choose Rectangle, Ellipse, Triangle, Star, or Speech bubble from the shape menu.',line:'Drag to draw a line. Move either endpoint, or choose its start and end markers from the line menu.'};toolHelp.textContent=help[tool]||'';toolHelp.hidden=!help[tool];};
  updateToolHelp();
  svg.addEventListener('pointerdown', e => {const textEditor=e.target.closest('.canvas-text-edit');
    if (textEditor && tool === 'select' && !e.altKey && document.activeElement === textEditor) return;
    const textIndex = Number(textEditor?.closest('[data-index]')?.dataset.index);
    if (textEditor && tool === 'select' && !e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey && selected.size === 1 && selected.has(textIndex)) {
      textEditor.contentEditable = 'true';
      return;
    }
    if (document.activeElement?.closest('.canvas-text-edit')) document.activeElement.blur(); const p=point(e); const ix=Number(e.target.closest('[data-index]')?.dataset.index);
    if(tool==='select') {
      const endpointHandle=e.target.closest('[data-point-handle]');
      if(endpointHandle&&Number.isInteger(ix)){interaction={kind:'point',index:ix,handle:endpointHandle.dataset.pointHandle,original:structuredClone(data.elements[ix])};svg.setPointerCapture(e.pointerId);e.preventDefault();e.stopPropagation();return;}
      if(e.target.dataset.handle==='rotate'&&selected.size){const group=selectionFrame(),center=group.center,angle=Math.atan2(p.y-center.y,p.x-center.x);interaction={kind:'rotate',start:p,center,rotation:group.rotation,lastAngle:angle,angle:0,originals:new Map([...selected].map(i=>[i,structuredClone(data.elements[i])]))};svg.setPointerCapture(e.pointerId);e.preventDefault();return;}
      if(e.target.dataset.handle && selected.size) {interaction={kind:'resize',handle:e.target.dataset.handle,start:p,originals:new Map([...selected].map(i=>[i,structuredClone(data.elements[i])])),group:selectionFrame()};svg.setPointerCapture(e.pointerId);e.preventDefault();return;}
      if(Number.isInteger(ix)) {if(e.shiftKey||e.metaKey||e.ctrlKey){selected.has(ix)?selected.delete(ix):selected.add(ix);}else if(!selected.has(ix))selected=new Set([ix]);if(selected.has(ix)){selectedColor=data.elements[[...selected][0]]?.color||selectedColor;interaction={kind:'move',start:p,originals:new Map([...selected].map(i=>[i,structuredClone(data.elements[i])]))};svg.setPointerCapture(e.pointerId);}paint();e.preventDefault();return;}
      if(!e.shiftKey&&!e.metaKey&&!e.ctrlKey)selected.clear();selectionBox={start:p,current:p,additive:e.shiftKey||e.metaKey||e.ctrlKey};svg.setPointerCapture(e.pointerId);paint();return;
    }
    if(tool==='erase' && Number.isInteger(ix)){data.elements.splice(ix,1);selected.clear();paint();setStructuredDirty();return;}
    if((tool==='draw'||tool==='shape'||tool==='line') && Number.isInteger(ix) && data.elements[ix]?.type !== 'image') return;
    svg.setPointerCapture(e.pointerId); if(tool==='draw')draft={type:'stroke',points:[p],color:selectedColor}; else if(tool==='shape')draft={type:'shape',shape:'rectangle',x:p.x,y:p.y,w:0,h:0,color:selectedColor}; else if(tool==='line')draft={type:'line',x1:p.x,y1:p.y,x2:p.x,y2:p.y,startMarker:'none',endMarker:'arrow',color:selectedColor}; else if(tool==='text')draft={type:'text',x:p.x,y:p.y,w:0,h:0,text:'',color:selectedColor};
    if(draft){data.elements.push(draft);selected=new Set([data.elements.length-1]);setStructuredDirty();}
  });
  svg.addEventListener('pointermove',e=>{
    const p=point(e);
    if(draft||interaction){clearTimeout(state.structured.historyTimer);state.structured.historyTimer=setTimeout(()=>{state.structured.historyPending=false;},600);}
    if(selectionBox){selectionBox.current=p;paint();return;}
    if(interaction){
      const dx=p.x-interaction.start.x,dy=p.y-interaction.start.y;
      if(interaction.kind==='move'){
        for(const [i,original] of interaction.originals){
          const el=data.elements[i];
          if(el.type==='stroke')el.points=original.points.map(point=>({x:point.x+dx,y:point.y+dy}));
          else if(el.type==='line'){el.x1=original.x1+dx;el.y1=original.y1+dy;el.x2=original.x2+dx;el.y2=original.y2+dy;}
          else{el.x=original.x+dx;el.y=original.y+dy;}
        }
      } else if(interaction.kind==='point'){
        const el=data.elements[interaction.index],original=interaction.original;
        if(el.type==='line'){if(interaction.handle==='start'){el.x1=p.x;el.y1=p.y;}else{el.x2=p.x;el.y2=p.y;}}
        else if(el.type==='shape'&&el.shape==='triangle'){const center={x:original.x+original.w/2,y:original.y+original.h/2},local=rotatedPoint(p.x,p.y,center,-(original.rotation||0)*Math.PI/180);el.vertices=(original.vertices||[[.5,0],[1,1],[0,1]]).map(([x,y],index)=>index===Number(interaction.handle)?[Math.max(0,Math.min(1,(local.x-original.x)/original.w)),Math.max(0,Math.min(1,(local.y-original.y)/original.h))]:[x,y]);}
      } else if(interaction.kind==='rotate'){
        const nextAngle=Math.atan2(p.y-interaction.center.y,p.x-interaction.center.x);let step=nextAngle-interaction.lastAngle;while(step>Math.PI)step-=2*Math.PI;while(step<-Math.PI)step+=2*Math.PI;interaction.angle+=step;interaction.lastAngle=nextAngle;
        selectionRotation = interaction.rotation + interaction.angle * 180 / Math.PI;
        for(const [i,original] of interaction.originals){const el=data.elements[i];if(el.type==='stroke')el.points=original.points.map(point=>rotatedPoint(point.x,point.y,interaction.center,interaction.angle));else if(el.type==='line'){const a=rotatedPoint(original.x1,original.y1,interaction.center,interaction.angle),b=rotatedPoint(original.x2,original.y2,interaction.center,interaction.angle);el.x1=a.x;el.y1=a.y;el.x2=b.x;el.y2=b.y;}else{const b=bounds(original),moved=rotatedPoint(b.x+b.w/2,b.y+b.h/2,interaction.center,interaction.angle);el.x=moved.x-b.w/2;el.y=moved.y-b.h/2;el.rotation=((original.rotation||0)+interaction.angle*180/Math.PI)%360;}}
      } else {
        const b=interaction.group,handle=interaction.handle;
        const local = rotatedPoint(p.x, p.y, b.center, -b.rotation*Math.PI/180);
        const right=handle.includes('e'),bottom=handle.includes('s'),left=handle.includes('w'),top=handle.includes('n');
        const nx=left?Math.min(b.x+b.w-4,local.x):b.x,ny=top?Math.min(b.y+b.h-4,local.y):b.y;
        const nr=right?Math.max(b.x+4,local.x):b.x+b.w,nb=bottom?Math.max(b.y+4,local.y):b.y+b.h;
        const sx=(nr-nx)/Math.max(1,b.w),sy=(nb-ny)/Math.max(1,b.h);
        const scalePoint = (x,y) => {
          const local = rotatedPoint(x,y,b.center,-b.rotation*Math.PI/180);
          return rotatedPoint(nx+(local.x-b.x)*sx,ny+(local.y-b.y)*sy,b.center,b.rotation*Math.PI/180);
        };
        for(const [i,original] of interaction.originals){
          const el=data.elements[i];
          if(el.type==='stroke')el.points=original.points.map(point=>scalePoint(point.x,point.y));
          else if(el.type==='line'){const a=scalePoint(original.x1,original.y1),z=scalePoint(original.x2,original.y2);el.x1=a.x;el.y1=a.y;el.x2=z.x;el.y2=z.y;}
          else{const ob=bounds(original),center=scalePoint(ob.x+ob.w/2,ob.y+ob.h/2);el.w=ob.w*sx;el.h=ob.h*sy;el.x=center.x-el.w/2;el.y=center.y-el.h/2;}
        }
      }
      paint();return;
    }
    if(!draft)return;
    if(draft.type==='stroke')draft.points.push(p);else if(draft.type==='line'){draft.x2=p.x;draft.y2=p.y;}else{draft.w=p.x-draft.x;draft.h=p.y-draft.y;}
    paint();
  });
  const finishPointer=()=>{
    if(selectionBox){
      const box={x:Math.min(selectionBox.start.x,selectionBox.current.x),y:Math.min(selectionBox.start.y,selectionBox.current.y),w:Math.abs(selectionBox.current.x-selectionBox.start.x),h:Math.abs(selectionBox.current.y-selectionBox.start.y)};
      if(box.w>3||box.h>3){
        const hits=data.elements.map((el,i)=>({i,b:bounds(el)})).filter(({b})=>b.x<=box.x+box.w&&b.x+b.w>=box.x&&b.y<=box.y+box.h&&b.y+b.h>=box.y).map(({i})=>i);
        selected=selectionBox.additive?new Set([...selected,...hits]):new Set(hits);
      }
      selectionBox=null;paint();return;
    }
    if(interaction){interaction=null;setStructuredDirty();}
    if(draft){
      const draftedType=draft.type;
      const focusText=draft.type==='text'&&Math.max(Math.abs(draft.w),Math.abs(draft.h))>=12;
      if(draft.type==='text'&&!focusText){data.elements.pop();selected.clear();}
      else if(draft.type==='line'&&Math.hypot(draft.x2-draft.x1,draft.y2-draft.y1)<4){data.elements.pop();selected.clear();}
      else if(draft.type==='shape'||draft.type==='text'){
        if(draft.w<0){draft.x+=draft.w;draft.w=Math.abs(draft.w);}
        if(draft.h<0){draft.y+=draft.h;draft.h=Math.abs(draft.h);}
        draft.w=Math.max(draft.type==='text'?180:4,draft.w);
        draft.h=Math.max(draft.type==='text'?60:4,draft.h);
      }
      draft=null;
      if(draftedType==='shape'||draftedType==='line'||draftedType==='text'){tool='select';svg.dataset.tool=tool;toolbar.querySelectorAll('.canvas-tool[data-tool]').forEach(button=>{const active=button.dataset.tool===tool;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});updateToolHelp();}
      setStructuredDirty();paint();
      if(focusText){const textIndex=[...selected][0];const textEditor=svg.querySelector('[data-index=\"'+textIndex+'\"] .canvas-text-edit');requestAnimationFrame(()=>textEditor?.focus());}
    }
  };
  svg.addEventListener('pointerup',finishPointer);
  svg.addEventListener('pointercancel',finishPointer);
  svg.addEventListener('click',e=>{if(e.target.closest('.sheet-wiki-link'))e.preventDefault();});
  svg.addEventListener('contextmenu',e=>{
    const link=e.target.closest('.sheet-wiki-link');
    const text=e.target.closest('[data-link-text]')?.getAttribute('data-link-text')||'';
    const match=text.match(/(?:<\[([^\]]+)\]>|\[\[([^\]]+)\]\])/);
    const target=link?.dataset.target||(match?.[1]||match?.[2]);
    if(target){e.preventDefault();e.stopPropagation();structuredLink(target);}
  });
  paint();
  state.structured.refreshCanvas=paint;
}
async function renderGraph(root, data) {
  const toolbar = root.querySelector('.structured-toolbar');
  toolbar.innerHTML = `<span>Desmos Graphing Calculator · graph state is saved in this file</span><button data-history="undo" title="Undo (⌘Z)" aria-label="Undo">${icons.undo}</button><button data-history="redo" title="Redo (⌘⇧Z)" aria-label="Redo">${icons.redo}</button>`;
  toolbar.querySelectorAll('[data-history]').forEach((button) => button.addEventListener('click', () => applyStructuredHistory(button.dataset.history)));
  const surface = root.querySelector('.structured-surface');
  const owner = state.structured;
  const status = (message, configure = false) => {
    surface.replaceChildren();
    const panel = document.createElement('div'); panel.className = 'graph-setup';
    const text = document.createElement('p'); text.textContent = message; panel.append(text);
    if (configure) { const button = document.createElement('button'); button.className = 'secondary-button'; button.textContent = 'Open Graphing settings'; button.addEventListener('click', () => openSettings('desmos')); panel.append(button); }
    surface.append(panel);
  };
  let key = '';
  try { key = await window.stillnote.getDesmosKey(); }
  catch (error) { status(error.message || 'Open a vault to use the saved Desmos key.'); return; }
  if (!key) { setSettingsHealth('desmos', false, 'Graphing API key missing'); status('A Desmos API key is required to use the graph editor.', true); return; }
  try {
    const api = await loadDesmosApi(key);
    if (state.structured !== owner || !root.isConnected) return;
    const host = document.createElement('div'); host.className = 'graph-calculator'; surface.replaceChildren(host);
    const graphTheme = state.theme === 'dark' ? {
      colors: ['#d1a07e', '#84b7a1', '#83a9d2', '#d88980', '#b19bd2', '#d7c36f']
    } : state.theme === 'sepia' ? {
      colors: ['#9d7151', '#6e927b', '#6f89a8', '#b46d5e', '#92779d', '#b09550']
    } : {};
    const calculator = api.GraphingCalculator(host, {
      expressions: true, keypad: true, settingsMenu: true, zoomButtons: true, autosize: true,
      // Desmos' inversion filter also flips expression colors and custom CSS.
      // Keep its graphpaper in the normal color space; our scoped CSS themes
      // the surrounding calculator controls instead.
      invertedColors: false, fontSize: 15, border: false, ...graphTheme
    });
    owner.desmos = calculator;
    setSettingsHealth('desmos', true, 'Graphing API key working');
    if (data.state && typeof data.state === 'object') calculator.setState(data.state);
    else data.state = calculator.getState();
    calculator.clearHistory();
    calculator.observeEvent('change', () => {
      if (state.structured !== owner || !state.active) return;
      data.state = calculator.getState(); setStructuredDirty();
    });
  } catch (error) {
    if (state.structured === owner && root.isConnected) { setSettingsHealth('desmos', false, 'Graphing API key not working'); status(error.message || 'Could not open Desmos.', true); }
  }
}
function renderSpreadsheet(root, data) {
  const toolbar = root.querySelector('.structured-toolbar'); toolbar.innerHTML = `<span>Drag headers to reorder · Double-click a column or press F2 to rename · Alt + arrows to move</span><button data-history="undo" title="Undo (⌘Z)" aria-label="Undo">${icons.undo}</button><button data-history="redo" title="Redo (⌘⇧Z)" aria-label="Redo">${icons.redo}</button><button class="sheet-add-row">Add row</button><button class="sheet-add-column">Add column</button>`;
  const surface = root.querySelector('.structured-surface');
  let draggedHeader = null;
  const render = () => {
    let html = '<table class="sheet-grid"><thead><tr><th></th>';
    for (let c = 0; c < data.columns; c++) {
      const letter = columnLabel(c), name = data.columnNames?.[c] || '';
      const label = name ? `${letter}: ${name}` : letter;
      html += `<th draggable="true" tabindex="0" scope="col" data-axis="column" data-index="${c}" aria-label="${escapeHtml(`Column ${label}. Double-click or press F2 to rename. Drag to move.`)}" title="Double-click or press F2 to rename · Drag to move">${name ? `<span class="sheet-column-letter">${letter}</span> ${escapeHtml(name)}` : letter} <span aria-hidden="true">⠿</span></th>`;
    }
    html += '</tr></thead><tbody>';
    for(let r=0;r<data.rows;r++){html+=`<tr><th draggable="true" tabindex="0" scope="row" data-axis="row" data-index="${r}" aria-label="Row ${r+1}. Drag or use Alt and up or down arrow to move." title="Drag to move row">${r+1} <span aria-hidden="true">⠿</span></th>`;for(let c=0;c<data.columns;c++){const key=`${columnLabel(c)}${r+1}`;const value=String(data.cells[key] ?? ''); const shown=value.startsWith('=')?spreadsheetCellValue(data,key):value; html+=`<td contenteditable="true" data-cell="${key}" spellcheck="false">${sheetCellHtml(shown)}</td>`;}html+='</tr>';}
    html+='</tbody></table>'; surface.innerHTML=html;
    surface.querySelectorAll('[data-cell]').forEach(cell=>{cell.addEventListener('focus',()=>{cell.textContent=data.cells[cell.dataset.cell]||'';});cell.addEventListener('input',()=>{data.cells[cell.dataset.cell]=cell.innerText;setStructuredDirty();surface.querySelectorAll('[data-cell]').forEach(other=>{if(other===cell||document.activeElement===other)return;const raw=String(data.cells[other.dataset.cell]??'');other.innerHTML=sheetCellHtml(raw.startsWith('=')?spreadsheetCellValue(data,other.dataset.cell):raw);});});cell.addEventListener('blur',()=>{const key=cell.dataset.cell;data.cells[key]=serializeLinkedText(cell);const raw=String(data.cells[key]??'');cell.innerHTML=sheetCellHtml(raw.startsWith('=')?spreadsheetCellValue(data,key):raw);});});
  };
  const renameColumn = async (header) => {
    const index = Number(header.dataset.index), owner = state.structured;
    const name = await requestNameValue(`Rename column ${columnLabel(index)}`, data.columnNames?.[index] || '', 'Rename');
    if (name === null || state.structured !== owner || !root.isConnected) return;
    const next = name.trim();
    if (next === (data.columnNames?.[index] || '')) return;
    if (!Array.isArray(data.columnNames)) data.columnNames = [];
    data.columnNames[index] = next;
    owner.historyPending = false;
    render(); setStructuredDirty();
    surface.querySelector(`[data-axis="column"][data-index="${index}"]`)?.focus();
  };
  surface.addEventListener('dblclick', event => {
    const header = event.target.closest('th[data-axis="column"]');
    if (header) { event.preventDefault(); void renameColumn(header); }
  });
  surface.addEventListener('keydown', event => {
    const header = event.target.closest('th[data-axis="column"]');
    if (header && event.key === 'F2') { event.preventDefault(); void renameColumn(header); }
  });
  const clearDrop = () => surface.querySelectorAll('.sheet-drop-target,.sheet-dragging').forEach(header => header.classList.remove('sheet-drop-target', 'sheet-dragging'));
  const move = (axis, from, to) => {
    // End the previous edit's undo group so a move can be undone independently.
    if (state.structured) state.structured.historyPending = false;
    if (!reorderSpreadsheet(data, axis, from, to)) return;
    render(); setStructuredDirty();
    surface.querySelector(`[data-axis="${axis}"][data-index="${to}"]`)?.focus();
  };
  surface.addEventListener('dragstart', event => {
    const header = event.target.closest('th[data-axis]');
    if (!header) return;
    draggedHeader = { axis: header.dataset.axis, from: Number(header.dataset.index) };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-stillnote-sheet-header', JSON.stringify(draggedHeader));
    header.classList.add('sheet-dragging');
  });
  surface.addEventListener('dragover', event => {
    const header = event.target.closest('th[data-axis]');
    if (!draggedHeader || !header || header.dataset.axis !== draggedHeader.axis) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'move';
    surface.querySelectorAll('.sheet-drop-target').forEach(element => element.classList.remove('sheet-drop-target'));
    header.classList.add('sheet-drop-target');
  });
  surface.addEventListener('drop', event => {
    const header = event.target.closest('th[data-axis]');
    if (!draggedHeader || !header || header.dataset.axis !== draggedHeader.axis) return;
    event.preventDefault(); event.stopPropagation();
    const { axis, from } = draggedHeader; draggedHeader = null; clearDrop();
    move(axis, from, Number(header.dataset.index));
  });
  surface.addEventListener('dragend', () => { draggedHeader = null; clearDrop(); });
  surface.addEventListener('keydown', event => {
    const header = event.target.closest('th[data-axis]');
    if (!header || !event.altKey) return;
    const axis = header.dataset.axis, from = Number(header.dataset.index);
    const delta = axis === 'row' ? { ArrowUp: -1, ArrowDown: 1 }[event.key] : { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (!delta) return;
    event.preventDefault(); move(axis, from, from + delta);
  });
  surface.addEventListener('click',e=>{const link=e.target.closest('.sheet-wiki-link');if(link)e.preventDefault();});
  surface.addEventListener('contextmenu',e=>{const link=e.target.closest('.sheet-wiki-link');if(link){e.preventDefault();e.stopPropagation();structuredLink(link.dataset.target);}});
  toolbar.querySelector('.sheet-add-row').addEventListener('click',()=>{data.rows=Math.min(200,data.rows+1);render();setStructuredDirty();});
  toolbar.querySelector('.sheet-add-column').addEventListener('click',()=>{data.columns=Math.min(26,data.columns+1);render();setStructuredDirty();});render();
  toolbar.querySelectorAll('[data-history]').forEach(button=>button.addEventListener('click',()=>applyStructuredHistory(button.dataset.history)));
}
async function adoptGoogleTaskListTitle(root, owner, remoteTitle) {
  const title = String(remoteTitle || '').trim();
  if (!title || state.structured !== owner || !root.isConnected) return;
  const titleEl = root.querySelector('.structured-title');
  if (title === prettyName(state.active)) { owner.title = title; titleEl.textContent = title; return; }
  const error = noteTitleError(title);
  if (error) { showToast(`Google list title cannot be used as a file name: ${error}`); return; }
  const oldPath = state.active;
  try {
    await saveActive();
    if (state.active !== oldPath || state.structured !== owner) return;
    const moved = await window.stillnote.renameEntry(oldPath, title);
    if (state.active !== oldPath || state.structured !== owner) return;
    state.active = moved; owner.file = moved; owner.title = title; titleEl.textContent = title;
    [state.files, state.tree] = await Promise.all([window.stillnote.listNotes(), window.stillnote.getVaultTree()]);
    renderFiles(); updateFileLocation(moved); void window.stillnote.rememberNote(moved).catch(() => {}); setStructuredDirty();
  } catch (error) { showToast(`Google list title changed, but the task sheet could not be renamed: ${error.message}`); }
}
async function renderTaskSheet(root, data) {
  if (!Array.isArray(data.tasks)) data.tasks = [];
  const owner = state.structured;
  let syncing = false;
  const toolbar = root.querySelector('.structured-toolbar');
  toolbar.innerHTML = `<span class="task-sheet-status">Loading Google Tasks…</span><button class="secondary-button task-sheet-refresh" type="button" aria-label="Sync with Google Tasks" title="Sync with Google Tasks">${icons.refresh}</button>`;
  const surface = root.querySelector('.structured-surface');
  surface.innerHTML = `<form class="task-sheet-add"><input class="settings-input" type="text" maxlength="1024" placeholder="Add a task…" aria-label="New task"><button class="primary-button" type="submit">Add task</button></form><div class="task-sheet-list" aria-live="polite"></div>`;
  const status = toolbar.querySelector('.task-sheet-status');
  const list = surface.querySelector('.task-sheet-list');
  const isCurrent = () => state.structured === owner && root.isConnected;
  const paintTasks = () => {
    if (!data.tasks?.length) { list.innerHTML = '<div class="task-sheet-empty">No tasks in this list yet.</div>'; return; }
    const taskMap = new Map(data.tasks.map((task, index) => [task.id, { task, index }]));
    const renderRows = (tasks) => [...tasks].sort((a, b) => Number(Boolean(a.parent)) - Number(Boolean(b.parent))).map((task) => {
      const index = data.tasks.indexOf(task);
      const depth = task.parent && taskMap.has(task.parent) ? 1 : 0;
      const due = task.due ? String(task.due).slice(0, 10) : '';
      return `<article class="task-sheet-card${task.status === 'completed' ? ' is-complete' : ''}${depth ? ' is-subtask' : ''}${task.starred ? ' is-starred' : ''}" data-index="${index}"><div class="task-sheet-row"><input class="task-sheet-complete" type="checkbox" aria-label="Mark ${escapeHtml(task.title)} complete" ${task.status === 'completed' ? 'checked' : ''}><input class="task-sheet-title" type="text" maxlength="1024" aria-label="Task title" value="${escapeHtml(task.title)}"><button class="task-sheet-star${task.starred ? ' is-starred' : ''}" type="button" aria-label="${task.starred ? 'Unstar' : 'Star'} task" title="${task.starred ? 'Unstar task' : 'Star task'}">${icons.star}</button><button class="icon-button task-sheet-delete" type="button" aria-label="Delete ${escapeHtml(task.title)}" title="Delete task">${icons.trash}</button></div><div class="task-sheet-fields"><label>Due date<input class="task-sheet-due" type="date" value="${escapeHtml(due)}" aria-label="Due date"></label><label class="task-sheet-details-label">Details<textarea class="task-sheet-details" rows="2" maxlength="8192" placeholder="Add details…" aria-label="Task details">${escapeHtml(task.notes || '')}</textarea></label></div>${depth ? '' : `<form class="task-sheet-subtask"><input class="settings-input" type="text" maxlength="1024" placeholder="Add a subtask…" aria-label="New subtask"><button class="secondary-button" type="submit">Add subtask</button></form>`}</article>`;
    }).join('');
    const active = data.tasks.filter((task) => task.status !== 'completed');
    const completed = data.tasks.filter((task) => task.status === 'completed');
    list.innerHTML = `${renderRows(active)}${completed.length ? `<details class="task-sheet-completed"><summary>Completed <span>${completed.length}</span></summary><div class="task-sheet-completed-list">${renderRows(completed)}</div></details>` : ''}`;
    if (!active.length && !completed.length) list.innerHTML = '<div class="task-sheet-empty">No tasks in this list yet.</div>';
  };
  const sync = async () => {
    if (syncing || !isCurrent()) return;
    syncing = true;
    status.textContent = 'Syncing…';
    try {
      const [lists, tasks] = await Promise.all([window.stillnote.listGoogleTaskLists(), window.stillnote.listGoogleTasks(data.listId)]);
      if (!isCurrent()) return;
      const remoteList = lists.find((item) => item.id === data.listId);
      if (!remoteList) throw new Error('This Google Tasks list no longer exists.');
      await adoptGoogleTaskListTitle(root, owner, remoteList.title);
      if (!isCurrent()) return;
      const previousTasks = JSON.stringify(data.tasks);
      const localStars = new Map(data.tasks.map((task) => [task.id, Boolean(task.starred)]));
      data.tasks = tasks.map((task) => ({ id: task.id, title: task.title || '', status: task.status || 'needsAction', due: task.due || null, notes: task.notes || '', parent: task.parent || null, starred: localStars.get(task.id) || false }));
      paintTasks(); status.textContent = `Synced with Google Tasks · ${data.tasks.length} ${data.tasks.length === 1 ? 'task' : 'tasks'}`;
      if (previousTasks !== JSON.stringify(data.tasks)) setStructuredDirty();
    } catch (error) { if (isCurrent()) status.textContent = error.message || 'Could not sync Google Tasks'; }
    finally { syncing = false; }
  };
  const syncTimer = setInterval(() => { if (!isCurrent()) clearInterval(syncTimer); else void sync(); }, 120000);
  owner.cleanup = () => clearInterval(syncTimer);
  toolbar.querySelector('.task-sheet-refresh').addEventListener('click', () => void sync());
  toolbar.querySelectorAll('[data-history]').forEach((button) => button.addEventListener('click', () => applyStructuredHistory(button.dataset.history)));
  surface.querySelector('.task-sheet-add').addEventListener('submit', async (event) => {
    event.preventDefault(); const input = surface.querySelector('.task-sheet-add input'); const title = input.value.trim();
    if (!title) return;
    const submit = surface.querySelector('.task-sheet-add button'); submit.disabled = true;
    try {
      const task = await window.stillnote.createGoogleTask(data.listId, title);
      if (!isCurrent()) return;
      data.tasks.push({ id: task.id, title: task.title || title, status: task.status || 'needsAction', due: task.due || null, notes: task.notes || '', parent: null, starred: false });
      input.value = ''; paintTasks(); setStructuredDirty(); status.textContent = 'Task added to Google Tasks';
    } catch (error) { if (isCurrent()) { status.textContent = error.message || 'Could not add task'; showToast(status.textContent); } }
    finally { submit.disabled = false; }
  });
  list.addEventListener('contextmenu', (event) => {
    const row = event.target.closest('[data-index]');
    const task = row && data.tasks[Number(row.dataset.index)];
    if (task) showTaskContextMenu(event, owner.title || prettyName(state.active), task.title);
  });
  list.addEventListener('change', async (event) => {
    if (event.target.matches('.task-sheet-due, .task-sheet-details')) {
      const row = event.target.closest('[data-index]'); const task = data.tasks[Number(row.dataset.index)];
      const due = event.target.matches('.task-sheet-due') ? event.target.value : String(task.due || '').slice(0, 10);
      const notes = event.target.matches('.task-sheet-details') ? event.target.value : task.notes || '';
      const changes = event.target.matches('.task-sheet-due') ? { due: due ? `${due}T00:00:00.000Z` : null } : { notes };
      event.target.disabled = true;
      try {
        const updated = await window.stillnote.updateGoogleTask(data.listId, task.id, changes);
        if (!isCurrent()) return;
        if ('due' in changes) task.due = updated.due || null; else task.notes = updated.notes || '';
        setStructuredDirty(); status.textContent = 'Task updated in Google Tasks';
      } catch (error) { if (isCurrent()) { if ('due' in changes) event.target.value = String(task.due || '').slice(0, 10); else event.target.value = task.notes || ''; status.textContent = error.message || 'Could not update task'; showToast(status.textContent); } }
      finally { if (event.target.isConnected) event.target.disabled = false; }
      return;
    }
    if (event.target.matches('.task-sheet-title')) {
      const row = event.target.closest('[data-index]'); const task = data.tasks[Number(row.dataset.index)]; const title = event.target.value.trim();
      if (!title) { event.target.value = task.title; return; }
      event.target.disabled = true;
      try {
        const updated = await window.stillnote.updateGoogleTask(data.listId, task.id, { title });
        if (!isCurrent()) return;
        task.title = updated.title || title; event.target.value = task.title; setStructuredDirty(); status.textContent = 'Task updated in Google Tasks';
      } catch (error) { if (isCurrent()) { event.target.value = task.title; status.textContent = error.message || 'Could not update task'; showToast(status.textContent); } }
      finally { if (event.target.isConnected) event.target.disabled = false; }
      return;
    }
    if (!event.target.matches('.task-sheet-complete')) return;
    const row = event.target.closest('[data-index]'); const task = data.tasks[Number(row.dataset.index)];
    const nextStatus = event.target.checked ? 'completed' : 'needsAction'; event.target.disabled = true;
    try {
      const updated = await window.stillnote.updateGoogleTask(data.listId, task.id, { status: nextStatus });
      if (!isCurrent()) return;
      task.status = updated.status || nextStatus; paintTasks(); setStructuredDirty(); status.textContent = 'Task updated in Google Tasks';
    } catch (error) { if (isCurrent()) { event.target.checked = task.status === 'completed'; status.textContent = error.message || 'Could not update task'; showToast(status.textContent); } }
    finally { if (event.target.isConnected) event.target.disabled = false; }
  });
  list.addEventListener('focusin', (event) => {
    const card = event.target.closest('.task-sheet-card');
    if (card) card.classList.add('is-editing');
  });
  list.addEventListener('focusout', (event) => {
    const card = event.target.closest('.task-sheet-card');
    if (!card) return;
    requestAnimationFrame(() => {
      if (card.isConnected && !card.contains(document.activeElement)) card.classList.remove('is-editing');
    });
  });
  list.addEventListener('click', async (event) => {
    const star = event.target.closest('.task-sheet-star');
    if (star) { const row = star.closest('[data-index]'); const task = data.tasks[Number(row.dataset.index)]; task.starred = !task.starred; paintTasks(); setStructuredDirty(); return; }
    const button = event.target.closest('.task-sheet-delete'); if (!button) return;
    const row = button.closest('[data-index]'); const index = Number(row.dataset.index); const task = data.tasks[index]; button.disabled = true;
    try {
      await window.stillnote.deleteGoogleTask(data.listId, task.id);
      if (!isCurrent()) return;
      data.tasks.splice(index, 1); paintTasks(); setStructuredDirty(); status.textContent = 'Task deleted from Google Tasks';
    } catch (error) { if (isCurrent()) { button.disabled = false; status.textContent = error.message || 'Could not delete task'; showToast(status.textContent); } }
  });
  list.addEventListener('submit', async (event) => {
    const form = event.target.closest('.task-sheet-subtask'); if (!form) return;
    event.preventDefault(); const row = form.closest('[data-index]'); const parent = data.tasks[Number(row.dataset.index)]; const input = form.querySelector('input'); const title = input.value.trim();
    if (!title) return;
    const button = form.querySelector('button'); button.disabled = true;
    try {
      const task = await window.stillnote.createGoogleTask(data.listId, title, parent.id);
      if (!isCurrent()) return;
      data.tasks.push({ id: task.id, title: task.title || title, status: task.status || 'needsAction', due: task.due || null, notes: task.notes || '', parent: task.parent || parent.id, starred: false });
      paintTasks(); setStructuredDirty(); status.textContent = 'Subtask added to Google Tasks';
    } catch (error) { if (isCurrent()) { status.textContent = error.message || 'Could not add subtask'; showToast(status.textContent); } }
    finally { if (button.isConnected) button.disabled = false; }
  });
  paintTasks(); await sync();
}
function spreadsheetCellValue(data, key, visiting = new Set()) {
  key=key.toUpperCase();
  const raw=String(data.cells[key]??'').trim();
  if(!raw)return '0';
  if(!raw.startsWith('=')){const value=Number(raw);return Number.isFinite(value)?String(value):'#VALUE!';}
  if(visiting.has(key))return '#CYCLE!';
  const next=new Set(visiting);next.add(key);
  try {
    const expression=raw.slice(1),tokens=expression.match(/[A-Za-z]+[0-9]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|[()+\-*/^]/g)||[];
    if(tokens.join('')!==expression.replace(/\s+/g,''))return '#VALUE!';
    let pos=0;
    const primary=()=>{const token=tokens[pos++];if(token==='+'||token==='-'){const n=primary();return token==='-'?-n:n;}if(token==='('){const n=add();if(tokens[pos++]!==')')throw new Error('#VALUE!');return n;}if(!token)throw new Error('#VALUE!');if(/^[A-Za-z]+\d+$/.test(token)){const result=spreadsheetCellValue(data,token,next);if(result.startsWith('#'))throw new Error(result);return Number(result);}const value=Number(token);if(!Number.isFinite(value))throw new Error('#VALUE!');return value;};
    const power=()=>{let n=primary();if(tokens[pos]==='^'){pos++;n=Math.pow(n,power());}return n;};
    const multiply=()=>{let n=power();while(tokens[pos]==='*'||tokens[pos]==='/'){const op=tokens[pos++],r=power();if(op==='/'&&r===0)throw new Error('#DIV/0!');n=op==='*'?n*r:n/r;}return n;};
    const add=()=>{let n=multiply();while(tokens[pos]==='+'||tokens[pos]==='-'){const op=tokens[pos++],r=multiply();n=op==='+'?n+r:n-r;}return n;};
    const result=add();if(pos!==tokens.length||!Number.isFinite(result))return '#VALUE!';return String(Number(result.toPrecision(12)));
  } catch(error) {return error.message?.startsWith('#')?error.message:'#VALUE!';}
}
function columnLabel(index) { let out=''; for(let n=index+1;n;n=Math.floor((n-1)/26)) out=String.fromCharCode(65+(n-1)%26)+out; return out; }
function sheetCellHtml(value) {
  const source = String(value), matcher = /(?:<\[([^\]|]+)(?:\|([^\]]+))?\]>|\[\[([^\]|]+)(?:\|([^\]]+))?\]\])/g;
  let html = '', offset = 0, match;
  while ((match = matcher.exec(source))) {
    html += escapeHtml(source.slice(offset, match.index));
    const target = (match[1] || match[3]).trim(), label = match[2] || match[4] || parseVaultLink(target).target;
    html += `<a class="sheet-wiki-link${isBrokenVaultLink(target) ? ' is-broken' : ''}" href="#" data-target="${escapeHtml(target)}" aria-invalid="${isBrokenVaultLink(target)}">${escapeHtml(label)}</a>`;
    offset = match.index + match[0].length;
  }
  return html + escapeHtml(source.slice(offset));
}
function serializeLinkedText(element) {
  const read = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    if (node.matches('a.sheet-wiki-link')) {
      const target = node.dataset.target || '', label = node.textContent || target;
      return `<[${target}${label !== parseVaultLink(target).target ? `|${label}` : ''}]>`;
    }
    return [...node.childNodes].map(read).join('');
  };
  return [...element.childNodes].map(read).join('');
}
async function saveActive() {
  if (state.savePromise) {
    await state.savePromise;
    if (state.dirty) return saveActive();
    return;
  }
  if (!state.dirty || !state.active || (!state.view && !state.structured)) return;
  clearTimeout(state.saveTimer);
  if (state.structured) {
    const active = state.active, structured = state.structured, title = (structured.title || prettyName(active)).trim() || prettyName(active);
    const operation = (async()=>{try{await window.stillnote.writeNote(active,encodeStructured(structured.type,title,structured.data));state.dirty=false;$('#save-state').textContent='Saved';scheduleBacklinks();}catch(e){$('#save-state').textContent='Save failed';showToast(e.message||'Could not save file.');}})();
    state.savePromise=operation;try{await operation;}finally{state.savePromise=null;}return;
  }
  const view = state.view;
  const oldPath = state.active;
  let writeSucceeded = false;
  const operation = (async () => {
    try {
      if (!oldPath.toLowerCase().endsWith('.md')) {
        const contents = view.state.doc.toString(); await window.stillnote.writeNote(oldPath, contents); writeSucceeded = true;
        if (state.view === view && state.active === oldPath) { state.dirty = view.state.doc.toString() !== contents; $('#save-state').textContent = state.dirty ? 'Unsaved changes' : 'Saved'; }
        return;
      }
      const firstLine = view.state.doc.line(1);
      const typedTitle = firstLine.text.trim();
      const title = (typedTitle || prettyName(oldPath)).replace(/\.md$/i, '').trim() || prettyName(oldPath);
      if (firstLine.text !== title) view.dispatch({ changes: { from: firstLine.from, to: firstLine.to, insert: title } });
      const contents = view.state.doc.toString();
      await window.stillnote.writeNote(oldPath, contents);
      writeSucceeded = true; scheduleBacklinks();

      const titleError = noteTitleError(typedTitle.replace(/\.md$/i, '').trim());
      if (titleError) {
        state.dirty = view.state.doc.toString() !== contents;
        $('#save-state').textContent = state.dirty ? 'Unsaved changes' : 'Saved';
        if (state.lastTitleValidationMessage !== titleError) showToast(titleError);
        state.lastTitleValidationMessage = titleError;
        return;
      }

      let savedPath = oldPath;
      const currentTitle = prettyName(oldPath);
      if (title !== currentTitle) {
        try { savedPath = await window.stillnote.renameEntry(oldPath, title); }
        catch (error) {
          state.dirty = view.state.doc.toString() !== contents;
          $('#save-state').textContent = state.dirty ? 'Unsaved changes' : 'Saved';
          showToast(`Note saved, but it could not be renamed: ${error.message}`);
          return;
        }
      }
      if (savedPath !== oldPath) {
        state.active = savedPath;
        [state.files, state.tree] = await Promise.all([window.stillnote.listNotes(), window.stillnote.getVaultTree()]);
        renderFiles();
        updateFileLocation(savedPath);
        void window.stillnote.rememberNote(savedPath).catch((error) => console.error('Could not save active note:', error));
      }
      if (state.view === view && state.active === savedPath) {
        state.dirty = view.state.doc.toString() !== contents;
        $('#save-state').textContent = state.dirty ? 'Unsaved changes' : 'Saved';
      }
    } catch (error) {
      $('#save-state').textContent = 'Save failed'; showToast(error.message);
    }
  })();
  state.savePromise = operation;
  try { await operation; }
  finally { state.savePromise = null; }
  if (writeSucceeded && state.dirty) return saveActive();
}
async function createNote(parentPath = '') {
  if (!state.vault) return chooseVault();
  const title = `Untitled ${state.files.filter((file) => prettyName(file).startsWith('Untitled')).length + 1}`;
  try { const file = await window.stillnote.createNote(title, parentPath); [state.files, state.tree] = await Promise.all([window.stillnote.listNotes(), window.stillnote.getVaultTree()]); renderFiles(); await openNote(file); state.view?.focus(); }
  catch (error) { showToast(error.message || 'Could not create note.'); }
}
async function requestCodeFileName() {
  const form = $('#rename-form'), actions = form.querySelector('.rename-actions');
  const pickerLabel = document.createElement('label'); pickerLabel.className = 'code-type-picker'; pickerLabel.textContent = 'File type';
  const picker = document.createElement('select'); picker.className = 'settings-input'; picker.setAttribute('aria-label', 'Code file type');
  picker.replaceChildren(...codeFileTypes.map(([label, extension]) => { const option = document.createElement('option'); option.value = extension; option.textContent = `${label} (${extension})`; return option; }));
  pickerLabel.append(picker); actions.before(pickerLabel);
  const title = await requestNameValue('Create code file', 'Untitled', 'Create file');
  const extension = picker.value; pickerLabel.remove();
  if (!title?.trim()) return null;
  const chosenName = title.trim();
  const typedExtension = codeFileTypes.map(([, candidate]) => candidate).find((candidate) => chosenName.toLocaleLowerCase().endsWith(candidate));
  const stem = typedExtension ? chosenName.slice(0, -typedExtension.length) : chosenName;
  return `${stem}${extension}`;
}
async function createCodeFile(parentPath = '') {
  if (!state.vault) return chooseVault();
  const name = await requestCodeFileName(); if (!name) return;
  try {
    const file = await window.stillnote.createCodeFile(name, parentPath);
    [state.files, state.tree] = await Promise.all([window.stillnote.listNotes(), window.stillnote.getVaultTree()]);
    renderFiles(); await openNote(file); state.view?.focus();
  } catch (error) { showToast(error.message || 'Could not create code file.'); }
}
async function createStructuredFile(type, parentPath = '') {
  if (!state.vault) return chooseVault();
  const labels = { canvas: 'Canvas', graph: 'Graph', geometry: 'Geometry', calculator3d: '3D Calculator', spreadsheet: 'Spreadsheet' };
  const label = labels[type] || 'Spreadsheet';
  const title = `Untitled ${label} ${state.files.filter((file) => prettyName(file).startsWith(`Untitled ${label}`)).length + 1}`;
  try {
    const file = await window.stillnote.createNote(title, parentPath);
    const defaults = { canvas: canvasDefaults, graph: graphDefaults, geometry: geometryDefaults, calculator3d: calculator3dDefaults, spreadsheet: sheetDefaults };
    const data = (defaults[type] || sheetDefaults)();
    await window.stillnote.writeNote(file, encodeStructured(type, title, data));
    [state.files, state.tree] = await Promise.all([window.stillnote.listNotes(), window.stillnote.getVaultTree()]);
    renderFiles(); await openNote(file);
  } catch (error) { showToast(error.message || `Could not create ${label.toLowerCase()}.`); }
}
async function createTaskSheet(parentPath = '') {
  if (!state.vault) return chooseVault();
  const connection = await window.stillnote.googleTasksStatus().catch(() => null);
  if (!connection?.clientIdConfigured || !connection.connected) { showToast('Connect Google Tasks in Settings before creating a task sheet.'); openSettings('tasks'); return; }
  try {
    const lists = await window.stillnote.listGoogleTaskLists();
    const choice = await chooseGoogleTaskList(lists);
    if (!choice) return;
    let list = choice.list; let requestedTitle = '';
    if (choice.create) {
      requestedTitle = (await requestNameValue('New Google Tasks list', '', 'Create list'))?.trim();
      if (!requestedTitle) return;
      const invalid = noteTitleError(requestedTitle);
      if (invalid) { showToast(invalid); return; }
    }
    const title = String(requestedTitle || list.title || '').trim();
    const invalid = noteTitleError(title);
    if (invalid) { showToast(`This Google Tasks list title cannot be used as a file name: ${invalid}`); return; }
    const expectedPath = [parentPath, `${title}.md`].filter(Boolean).join('/');
    if (state.files.some((file) => file.toLocaleLowerCase() === expectedPath.toLocaleLowerCase())) { showToast('A file with this title already exists in that folder.'); return; }
    if (choice.create) list = await window.stillnote.createGoogleTaskList(title);
    const file = await window.stillnote.createNote(title, parentPath);
    const data = taskSheetDefaults(list.id);
    await window.stillnote.writeNote(file, encodeStructured('tasks', title, data));
    [state.files, state.tree] = await Promise.all([window.stillnote.listNotes(), window.stillnote.getVaultTree()]);
    renderFiles(); await openNote(file);
  } catch (error) { showToast(error.message || 'Could not create a Google Tasks sheet.'); }
}
function chooseGoogleTaskList(lists) {
  if (!lists.length) return Promise.resolve({ create: true });
  const overlay = document.createElement('div'); overlay.className = 'rename-overlay task-list-picker';
  const options = lists.map((list) => `<option value="${escapeHtml(list.id)}">${escapeHtml(list.title)}</option>`).join('');
  overlay.innerHTML = `<section class="rename-dialog" role="dialog" aria-modal="true" aria-labelledby="task-list-picker-title"><h2 id="task-list-picker-title">Choose a Google Tasks list</h2><select class="settings-input task-list-picker-select">${options}</select><div class="rename-actions"><button type="button" class="secondary-button" data-choice="cancel">Cancel</button><button type="button" class="secondary-button" data-choice="create">Create new list</button><button type="button" class="primary-button" data-choice="use">Use selected list</button></div></section>`;
  document.body.append(overlay);
  const select = overlay.querySelector('select'); select.focus();
  return new Promise((resolve) => {
    const finish = (choice) => { overlay.remove(); resolve(choice); };
    overlay.querySelector('[data-choice="cancel"]').addEventListener('click', () => finish(null));
    overlay.querySelector('[data-choice="create"]').addEventListener('click', () => finish({ create: true }));
    overlay.querySelector('[data-choice="use"]').addEventListener('click', () => finish({ list: lists.find((list) => list.id === select.value) }));
    overlay.addEventListener('click', (event) => { if (event.target === overlay) finish(null); });
    overlay.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(null); } });
  });
}
function showNewFileMenu(anchor, parentPath = '') {
  const menu = $('#new-file-menu'); menu.replaceChildren();
  const options = [
    ['Note', 'file', () => createNote(parentPath)],
    ['Code file', 'code', () => createCodeFile(parentPath)],
    ['Canvas', 'canvas', () => createStructuredFile('canvas', parentPath)],
    ['Geometry', 'geometry', () => createStructuredFile('geometry', parentPath)],
    ['3D calculator', 'calculator3d', () => createStructuredFile('calculator3d', parentPath)],
    ['Spreadsheet', 'spreadsheet', () => createStructuredFile('spreadsheet', parentPath)],
    ['Graph', 'graph', () => createStructuredFile('graph', parentPath)],
    ['Task sheet', 'tasks', () => createTaskSheet(parentPath)]
  ];
  menu.setAttribute('aria-label', 'Create a file');
  anchor.setAttribute('aria-expanded', 'true');
  anchor.setAttribute('aria-controls', menu.id);
  for (const [label, icon, action] of options) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'new-file-type';
    button.setAttribute('role', 'menuitem'); button.setAttribute('aria-label', label);
    button.title = label; button.dataset.tooltip = label;
    button.innerHTML = icons[icon];
    button.addEventListener('click', () => { menu.hidden = true; anchor.setAttribute('aria-expanded', 'false'); action(); });
    button.addEventListener('keydown', (event) => {
      const index = options.findIndex(([name]) => name === label);
      const offset = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 4, ArrowUp: -4 }[event.key];
      if (offset !== undefined) { event.preventDefault(); menu.children[(index + offset + options.length) % options.length].focus(); }
      if (event.key === 'Escape') { event.preventDefault(); menu.hidden = true; anchor.setAttribute('aria-expanded', 'false'); anchor.focus(); }
    });
    menu.append(button);
  }
  const rect = anchor.getBoundingClientRect(); menu.hidden = false;
  menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - menu.offsetHeight - 8))}px`;

}
async function createFolder(parentPath = '') {
  if (!state.vault) return chooseVault();
  const name = await requestNameValue('Create folder', '', 'Create');
  if (!name?.trim()) return;
  try {
    const created = await window.stillnote.createFolder(parentPath, name);
    if (parentPath) state.collapsed.delete(parentPath);
    if (created) state.collapsed.delete(created);
    [state.files, state.tree] = await Promise.all([window.stillnote.listNotes(), window.stillnote.getVaultTree()]); renderFiles();
  } catch (error) { showToast(error.message || 'Could not create folder.'); }
}
let explorerRefreshRequest = 0;
async function refreshExplorer({ paths = [], forceLinks = false } = {}) {
  if (!state.vault) return;
  const vault = state.vault, request = ++explorerRefreshRequest;
  const [files, tree] = await Promise.all([window.stillnote.listNotes(), window.stillnote.getVaultTree()]);
  if (state.vault !== vault || request !== explorerRefreshRequest) return;
  state.files = files; state.tree = tree;
  const revision = vaultRenderRevision; renderFiles();
  if (revision === vaultRenderRevision && (forceLinks || paths.some(path => !path || path !== state.active))) invalidateVaultLinkRendering();
}
window.stillnote.onVaultChanged?.(change => {
  if (change.vault === state.vault?.path) void refreshExplorer(change).catch(error => console.warn('Could not refresh vault:', error.message));
});
window.addEventListener('focus', () => { void refreshExplorer({forceLinks:true}).catch(() => {}); });
function canDropOnFolder(item, destinationPath) {
  if (item?.items) return item.items.length > 0 && item.items.every((entry) => canDropOnFolder(entry, destinationPath));
  if (!item || item.path === destinationPath) return false;
  if (item.type === 'folder' && destinationPath.startsWith(`${item.path}/`)) return false;
  return true;
}
function clearDragStyles() {
  document.querySelectorAll('.dragging,.drop-target,.root-drop-target').forEach((element) => element.classList.remove('dragging', 'drop-target', 'root-drop-target'));
  $('#note-list')?.classList.remove('asset-upload-target');
  $('.sidebar').classList.remove('explorer-dragging');
}
function hasExternalFiles(event) { return !state.draggedItem && Array.from(event.dataTransfer?.types || []).includes('Files'); }
async function uploadDroppedFiles(event, destination = '') {
  event.preventDefault(); event.stopPropagation(); clearDragStyles();
  const files = Array.from(event.dataTransfer?.files || []);
  if (!files.length) return;
  try {
    if (files.length > 100) throw new Error('Upload up to 100 files at a time.');
    const oversized = files.find((file) => file.size > 250 * 1024 * 1024);
    if (oversized) throw new Error(`${oversized.name} is larger than the 250 MB upload limit.`);
    const uploads = await Promise.all(files.map(async (file) => ({ name: file.name, data: await file.arrayBuffer() })));
    const saved = await window.stillnote.uploadAssets(destination, uploads);
    [state.files, state.tree] = await Promise.all([window.stillnote.listNotes(), window.stillnote.getVaultTree()]);
    if (destination) for (const [index, part] of destination.split('/').entries()) state.collapsed.delete(destination.split('/').slice(0, index + 1).join('/'));
    renderFiles(); showToast(`${saved.length} file${saved.length === 1 ? '' : 's'} added`);
  } catch (error) { showToast(error.message || 'Files could not be uploaded.'); }
}
function wireExplorerDrag(row, node) {
  row.draggable = true;
  row.addEventListener('dragstart', (event) => {
    const selected = state.explorerSelection.has(node.path)
      ? [...state.explorerSelection].map((path) => findExplorerNode(path)).filter(Boolean) : [node];
    const items = selected.filter((entry) => !selected.some((parent) => parent.type === 'folder' && entry.path.startsWith(`${parent.path}/`)))
      .map(({ path, type }) => ({ path, type }));
    state.draggedItem = { items };
    $('.sidebar').classList.add('explorer-dragging');
    state.explorerSelection = new Set(selected.map((entry) => entry.path));
    for (const element of $('#note-list').querySelectorAll('.note-row,.folder-row')) {
      if (selected.some((entry) => entry.path === element.title)) element.classList.add('dragging');
    }
    event.dataTransfer.setData('application/x-stillnote-paths', JSON.stringify(items.map((entry) => entry.path)));
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-stillnote-path', node.path);
    event.dataTransfer.setData('application/x-stillnote-type', node.type);
    row.classList.add('dragging');
  });
  row.addEventListener('dragend', () => { state.draggedItem = null; clearDragStyles(); });
  row.addEventListener('dragover', (event) => { if (!hasExternalFiles(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; row.classList.add('drop-target'); });
  row.addEventListener('drop', (event) => { if (!hasExternalFiles(event)) return; void uploadDroppedFiles(event, node.type === 'folder' ? node.path : ''); });
  if (node.type !== 'folder') return;
  row.addEventListener('dragover', (event) => {
    if (hasExternalFiles(event)) return;
    if (!canDropOnFolder(state.draggedItem, node.path)) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'move'; row.classList.add('drop-target');
  });
  row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
  row.addEventListener('drop', (event) => {
    if (hasExternalFiles(event)) return;
    event.preventDefault(); event.stopPropagation();
    const item = state.draggedItem; state.draggedItem = null; clearDragStyles();
    if (canDropOnFolder(item, node.path)) moveExplorerEntry(item, node.path);
  });
}
$('#note-list').addEventListener('dragover', (event) => { if (!hasExternalFiles(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; $('#note-list').classList.add('asset-upload-target'); });
$('#note-list').addEventListener('dragleave', (event) => { if (!$('#note-list').contains(event.relatedTarget)) $('#note-list').classList.remove('asset-upload-target'); });
$('#note-list').addEventListener('drop', (event) => { if (hasExternalFiles(event)) void uploadDroppedFiles(event, ''); $('#note-list').classList.remove('asset-upload-target'); });
async function moveExplorerEntry(item, destinationPath) {
  if (!item || !canDropOnFolder(item, destinationPath)) return;
  const items = item.items || [item];
  const moved = [];
  let nextActive = state.active;
  let failure = null;
  try {
    const activePathBeforeSave = state.active;
    await saveActive();
    if (state.dirty) throw new Error('Save changes before moving selected items.');
    nextActive = state.active;
    const entries = items.map((entry) => ({ ...entry, path: entry.type === 'note' && activePathBeforeSave === entry.path ? state.active : entry.path }));
    const destination = destinationPath ? findExplorerNode(destinationPath)?.children || [] : state.tree;
    const names = new Set();
    for (const entry of entries) {
      const name = entry.path.split('/').at(-1).toLowerCase();
      if (names.has(name) || destination.some((existing) => existing.name.toLowerCase() === name && existing.path !== entry.path)) {
        throw new Error('Selected items would have duplicate names in the destination folder.');
      }
      names.add(name);
    }
    for (const entry of entries) {
      const oldPath = entry.path;
      const movedPath = await window.stillnote.moveEntry(oldPath, destinationPath);
      moved.push(movedPath);
      if (nextActive === oldPath) nextActive = movedPath;
      else if (entry.type === 'folder' && nextActive?.startsWith(`${oldPath}/`)) nextActive = `${movedPath}${nextActive.slice(oldPath.length)}`;
      state.collapsed = new Set([...state.collapsed].map((folder) => folder === oldPath || folder.startsWith(`${oldPath}/`) ? `${movedPath}${folder.slice(oldPath.length)}` : folder));
    }
  } catch (error) { failure = error; }
  if (moved.length) {
    if (destinationPath) state.collapsed.delete(destinationPath);
    state.explorerSelection = new Set(moved);
    [state.files, state.tree] = await Promise.all([window.stillnote.listNotes(), window.stillnote.getVaultTree()]);
    renderFiles();
    if (nextActive) { state.active = null; await openNote(nextActive); }
  }
  if (failure) showToast(`${moved.length ? `${moved.length} items moved. ` : ''}${failure.message || 'Could not move selected items.'}`);
  else showToast(`${moved.length} item${moved.length === 1 ? '' : 's'} moved`);
}
for (const target of document.querySelectorAll('.explorer-heading, .explorer-root-drop, #note-list')) {
  const isRootDrop = (event) => canDropOnFolder(state.draggedItem, '')
    && (target.id !== 'note-list' || event.target === target);
  const highlight = target.id === 'note-list' ? $('.explorer-root-drop') : target;
  target.addEventListener('dragover', (event) => {
    if (!isRootDrop(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    highlight.classList.add('root-drop-target');
  });
  target.addEventListener('dragleave', () => highlight.classList.remove('root-drop-target'));
  target.addEventListener('drop', (event) => {
    if (!isRootDrop(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const item = state.draggedItem;
    state.draggedItem = null;
    clearDragStyles();
    void moveExplorerEntry(item, '');
  });
}
function showExplorerContextMenu(event, node) {
  event.preventDefault(); event.stopPropagation();
  if (!state.explorerSelection.has(node.path)) state.explorerSelection = new Set([node.path]);
  renderFiles();
  const menu = $('#explorer-context-menu'); menu.replaceChildren();
  const addAction = (label, action, danger = false) => {
    const button = document.createElement('button'); button.className = `context-action${danger ? ' danger' : ''}`; button.textContent = label;
    const run = (skipConfirm = false) => { closeExplorerContextMenu(); action(skipConfirm); };
    button.addEventListener('click', () => run(danger && state.contextDeleteBypass));
    if (danger) button.addEventListener('keydown', (keyEvent) => { if (keyEvent.key === 'Enter') { keyEvent.preventDefault(); run(true); } });
    menu.append(button);
  };
  if (node.type === 'folder') {
    addAction('New note here', () => createNote(node.path));
    addAction('New code file here…', () => createCodeFile(node.path));
    addAction('New canvas here', () => createStructuredFile('canvas', node.path));
    addAction('New geometry here', () => createStructuredFile('geometry', node.path));
    addAction('New 3D calculator here', () => createStructuredFile('calculator3d', node.path));
    addAction('New spreadsheet here', () => createStructuredFile('spreadsheet', node.path));
    addAction('New graph here', () => createStructuredFile('graph', node.path));
    addAction('New task sheet here', () => createTaskSheet(node.path));
    addAction('New folder here', () => createFolder(node.path));
    const separator = document.createElement('div'); separator.className = 'context-separator'; menu.append(separator);
  } else {
    addAction('Copy link', () => { void window.stillnote.copyFileLink(node.path).then(() => showToast('Link copied')).catch((error) => showToast(error.message || 'Could not copy link.')); });
  }
  addAction('Rename…', () => renameExplorerEntry(node));
  const selectedNodes = [...state.explorerSelection].map((path) => findExplorerNode(path)).filter(Boolean);
  const selectedRoots = selectedNodes.filter((candidate, index, all) => !all.some((parent, parentIndex) => parentIndex !== index && parent.type === 'folder' && candidate.path.startsWith(`${parent.path}/`)));
  addAction(selectedRoots.length > 1 ? `Delete ${selectedRoots.length} selected items…` : 'Delete…', (skipConfirm) => deleteExplorerEntries(selectedRoots, skipConfirm), true);
  menu.hidden = false;
  const width = 190; const height = menu.offsetHeight;
  menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8))}px`;
}
// Keep unsaved editor content in sync so a later save cannot restore old links.
window.stillnote.onFileLinksUpdated?.((moves) => {
  const rewrite = (text) => text.replace(/<\[([^\]\r\n]+)\]>|\[\[([^\]\r\n]+)\]\]/g, (source, modern, legacy) => {
    const value = modern ?? legacy, raw = value.split('|')[0].split('#')[0];
    const target = parseVaultLink(raw).path.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
    const move = moves.find(([oldPath]) => target === oldPath.toLowerCase() || (!/\.[^/]+$/.test(target) && `${target}.md` === oldPath.toLowerCase()));
    if (!move) return source;
    const valueUpdated = (parseVaultLink(raw).linkOnly ? '!!!' : '') + move[1] + value.slice(raw.length);
    return modern !== undefined ? `<[${valueUpdated}]>` : `[[${valueUpdated}]]`;
  });
  if (state.view) {
    const text = state.view.state.doc.toString(), updated = rewrite(text);
    if (text !== updated) state.view.dispatch({ changes: { from: 0, to: text.length, insert: updated } });
  }
  const updateData = (data) => {
    if (!data || typeof data !== 'object') return;
    for (const key of Object.keys(data)) {
      if (typeof data[key] === 'string') data[key] = rewrite(data[key]);
      else updateData(data[key]);
    }
  };
  updateData(state.structured?.data);
  if (state.structured) {
    for (const key of ['undoStack', 'redoStack']) state.structured[key] = state.structured[key].map(snapshot => {
      const value = JSON.parse(snapshot); updateData(value); return JSON.stringify(value);
    });
    if (state.structured.historySnapshot) { const value = JSON.parse(state.structured.historySnapshot); updateData(value); state.structured.historySnapshot = JSON.stringify(value); }
    state.structured.refreshCanvas?.();
  }
  scheduleBacklinks();
});
let backlinkTimer;
let backlinkRequest = 0;
let backlinkResults = [];
function scheduleBacklinks() {
  clearTimeout(backlinkTimer);
  backlinkTimer = setTimeout(() => void refreshBacklinks(), 250);
}
async function refreshBacklinks() {
  const request = ++backlinkRequest, file = state.active;
  const button = $('#backlink-count');
  button.disabled = !file || state.home;
  if (button.disabled) { button.textContent = '0 backlinks'; backlinkResults = []; return; }
  try {
    const results = await window.stillnote.getBacklinks(file);
    if (request !== backlinkRequest || state.active !== file) return;
    backlinkResults = results;
    button.textContent = `${results.length} backlink${results.length === 1 ? '' : 's'}`;
  } catch { button.textContent = 'Backlinks unavailable'; }
}
const backlinkPopup = document.createElement('div');
backlinkPopup.className = 'backlink-popup'; backlinkPopup.hidden = true;
backlinkPopup.setAttribute('role', 'dialog'); backlinkPopup.setAttribute('aria-label', 'Backlinks');
document.body.append(backlinkPopup);
$('#backlink-count').addEventListener('click', async () => {
  if (!backlinkPopup.hidden) { backlinkPopup.hidden = true; return; }
  await saveActive(); await refreshBacklinks();
  backlinkPopup.replaceChildren();
  const title = document.createElement('strong'); title.textContent = 'Linked from'; backlinkPopup.append(title);
  if (!backlinkResults.length) { const empty = document.createElement('p'); empty.textContent = 'No links to this file yet.'; backlinkPopup.append(empty); }
  for (const reference of backlinkResults) {
    const button = document.createElement('button'); button.type = 'button';
    const label = document.createElement('span'); label.textContent = `${fileLabelPath(reference.file)} · Line ${reference.line}`;
    const excerpt = document.createElement('small'); excerpt.textContent = reference.text;
    button.append(label, excerpt);
    button.addEventListener('click', () => { backlinkPopup.hidden = true; void navigateWikiTarget(`${reference.file}#L${reference.line}`); });
    backlinkPopup.append(button);
  }
  backlinkPopup.hidden = false;
});
document.addEventListener('pointerdown', (event) => { if (!backlinkPopup.contains(event.target) && !event.target.closest('#backlink-count')) backlinkPopup.hidden = true; });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !backlinkPopup.hidden) { event.preventDefault(); backlinkPopup.hidden = true; } });
function showTaskContextMenu(event, listName, taskName) {
  event.preventDefault(); event.stopPropagation();
  const menu = $('#explorer-context-menu'); menu.replaceChildren();
  const button = document.createElement('button'); button.className = 'context-action'; button.textContent = 'Copy link';
  button.addEventListener('click', () => {
    closeExplorerContextMenu();
    void navigator.clipboard.writeText(taskReferenceSyntax(listName, taskName)).then(() => showToast('Link copied')).catch((error) => showToast(error.message || 'Could not copy link.'));
  });
  menu.append(button); menu.hidden = false;
  menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - 198))}px`;
  menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - menu.offsetHeight - 8))}px`;
}
function closeExplorerContextMenu() { $('#explorer-context-menu').hidden = true; state.contextDeleteBypass = false; }
function requestRenameValue(currentName, type) {
  return requestNameValue(`Rename ${type}`, currentName, 'Rename');
}
function requestNameValue(title, initialValue = '', submitLabel = 'Create') {
  const overlay = $('#rename-overlay');
  const input = $('#rename-input');
  $('#rename-title').textContent = title;
  $('#rename-form').querySelector('[type="submit"]').textContent = submitLabel;
  input.value = initialValue;
  overlay.hidden = false;
  requestAnimationFrame(() => { input.focus(); if (initialValue) input.select(); });
  return new Promise((resolve) => { resolveRenameDialog = resolve; });
}
function finishRenameDialog(value = null) {
  if (!resolveRenameDialog) return;
  const resolve = resolveRenameDialog;
  resolveRenameDialog = null;
  $('#rename-overlay').hidden = true;
  resolve(value);
}
function confirmDelete(displayName, description) {
  $('#delete-title').textContent = `Delete “${displayName}”?`;
  $('#delete-description').textContent = description;
  $('#delete-overlay').hidden = false;
  requestAnimationFrame(() => $('#delete-confirm').focus());
  return new Promise((resolve) => { resolveDeleteDialog = resolve; });
}
function finishDeleteDialog(confirmed = false) {
  if (!resolveDeleteDialog) return;
  const resolve = resolveDeleteDialog; resolveDeleteDialog = null; $('#delete-overlay').hidden = true; resolve(confirmed);
}
function explorerRenameName(node) {
  return node.type === 'note' ? prettyName(node.name) : node.name;
}
async function renameExplorerEntry(node) {
  const activePathBeforeDialog = state.active;
  const nextName = await requestRenameValue(explorerRenameName(node), node.type);
  await renameExplorerEntryTo(node, nextName, activePathBeforeDialog);
}
async function renameExplorerEntryTo(node, nextName, activePathBeforeSave, listName = nextName) {
  if (!nextName?.trim() || nextName.trim() === explorerRenameName(node)) return;
  try {
    const vault = state.vault;
    const activeBeforeSave = state.active;
    await saveActive();
    if (state.vault !== vault) return;
    if (state.dirty) throw new Error('Save changes before renaming this item.');
    const sourcePath = node.type === 'note' && activePathBeforeSave === node.path && activeBeforeSave === node.path && state.active !== node.path && state.active ? state.active : node.path;
    if (node.type === 'note' && node.format === 'tasks') {
      const parsed = decodeStructured(await window.stillnote.readNote(sourcePath));
      if (parsed?.type === 'tasks' && parsed.data?.listId) await window.stillnote.renameGoogleTaskList(parsed.data.listId, listName.trim());
    }
    const renamed = await window.stillnote.renameEntry(sourcePath, nextName.trim());
    const active = state.active;
    let nextActive = active;
    if (state.active === sourcePath) nextActive = renamed;
    else if (node.type === 'folder' && state.active?.startsWith(`${sourcePath}/`)) nextActive = `${renamed}${state.active.slice(sourcePath.length)}`;
    [state.files, state.tree] = await Promise.all([window.stillnote.listNotes(), window.stillnote.getVaultTree()]);
    if (node.type === 'folder') {
      state.collapsed = new Set([...state.collapsed].map((folder) =>
        folder === sourcePath || folder.startsWith(`${sourcePath}/`) ? `${renamed}${folder.slice(sourcePath.length)}` : folder));
    }
    renderFiles();
    if (nextActive && nextActive !== active && state.active === active) { state.active = null; await openNote(nextActive); }
  } catch (error) { showToast(error.message || 'Could not rename item.'); }
}
async function deleteExplorerEntries(rawNodes, skipConfirm = false) {
  const nodes = rawNodes.filter(Boolean).filter((node, index, all) => !all.some((parent, parentIndex) => parentIndex !== index && parent.type === 'folder' && node.path.startsWith(`${parent.path}/`)));
  if (!nodes.length) return;
  const displayName = nodes.length === 1 ? (nodes[0].type === 'note' ? fileLabel(nodes[0].path, nodes[0].format) : nodes[0].name) : `${nodes.length} selected items`;
  const description = nodes.length === 1 ? (nodes[0].type === 'folder' ? 'This also deletes everything inside it.' : 'This deletes this file from the vault.') : 'This permanently deletes the selected files, folders, and any files inside selected folders.';
  if (!skipConfirm && !await confirmDelete(displayName, description)) return;
  try {
    const activePathBeforeSave = state.active;
    await saveActive();
    const existingFiles = explorerFilePaths();
    const sourcePaths = nodes.map((node) => node.type === 'note' && activePathBeforeSave === node.path && state.active !== node.path ? state.active : node.path);
    const deletedNotes = sourcePaths.flatMap((sourcePath, index) => nodes[index].type === 'note' ? [sourcePath] : existingFiles.filter((file) => file.startsWith(`${sourcePath}/`)));
    const activeDeleted = Boolean(state.active && deletedNotes.includes(state.active));
    const nearbyIndex = activeDeleted ? existingFiles.indexOf(state.active) : existingFiles.indexOf(sourcePaths[0]);
    for (const sourcePath of sourcePaths) await window.stillnote.deleteEntry(sourcePath);
    [state.files, state.tree] = await Promise.all([window.stillnote.listNotes(), window.stillnote.getVaultTree()]);
    state.explorerSelection.clear();
    renderFiles();
    if (activeDeleted) {
      state.view?.destroy(); state.view = null; state.structured?.cleanup?.(); state.structured?.desmos?.destroy?.(); state.structured = null; state.assetViewer?.destroy?.(); state.assetViewer = null; state.dirty = false; state.active = null;
      await window.stillnote.rememberNote(null);
      const remainingFiles = explorerFilePaths();
      if (remainingFiles.length) await openNote(remainingFiles[Math.max(0, Math.min(nearbyIndex, remainingFiles.length - 1))]); else showEmptyVault();
    }
    showToast(nodes.length === 1 ? `${nodes[0].type === 'folder' ? 'Folder' : 'File'} deleted` : `${nodes.length} items deleted`);
  } catch (error) { showToast(error.message || 'Could not delete selected items.'); }
}
let linkPickerView = null;
let linkPickerSources = [];
let activeLinkPickerSource = 'files';
function closeLinkPicker({ focusEditor = true } = {}) {
  $('#link-picker-overlay').hidden = true;
  const view = linkPickerView; linkPickerView = null; linkPickerSources = [];
  if (focusEditor && view === state.view) view.focus();
}
function insertPickedLink(value) {
  const view = linkPickerView;
  if (!view || view !== state.view) { closeLinkPicker({ focusEditor: false }); return; }
  const selection = view.state.selection.main;
  view.dispatch({ changes: { from: selection.from, to: selection.to, insert: value }, selection: { anchor: selection.from + value.length }, scrollIntoView: true });
  closeLinkPicker();
}
function renderLinkPickerResults() {
  const results = $('#link-picker-results'); results.replaceChildren();
  const source = linkPickerSources.find((entry) => entry.id === activeLinkPickerSource);
  const query = $('#link-picker-query').value.trim().toLocaleLowerCase();
  const items = (source?.items || []).filter((item) => `${item.title} ${item.detail || ''}`.toLocaleLowerCase().includes(query));
  if (!items.length) { const empty = document.createElement('div'); empty.className = 'link-picker-empty'; empty.textContent = query ? 'No matching items' : source?.empty || 'Nothing to link yet'; results.append(empty); return; }
  for (const item of items) {
    const row = document.createElement('button'); row.type = 'button'; row.className = 'link-picker-result'; row.setAttribute('role', 'option');
    row.innerHTML = `<span class="link-picker-result-icon">${source.id === 'files' ? icons.file : icons.formatCheck}</span><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail || '')}</small></span><span class="link-picker-insert">Insert</span>`;
    row.addEventListener('click', () => insertPickedLink(item.syntax)); results.append(row);
  }
}
function selectLinkPickerSource(id) {
  activeLinkPickerSource = id;
  document.querySelectorAll('.link-picker-tab').forEach((tab) => { const selected = tab.dataset.source === id; tab.classList.toggle('active', selected); tab.setAttribute('aria-selected', String(selected)); });
  const source = linkPickerSources.find((entry) => entry.id === id);
  $('#link-picker-query').placeholder = source?.id === 'files' ? 'Filter files…' : `Filter ${source?.label || 'tasks'}…`;
  $('#link-picker-query').value = ''; renderLinkPickerResults(); $('#link-picker-query').focus();
}
async function openLinkPicker() {
  if (!state.view || !state.active?.toLocaleLowerCase().endsWith('.md')) { showToast('Open a Markdown note to insert a link.'); return; }
  linkPickerView = state.view; activeLinkPickerSource = 'files';
  $('#link-picker-overlay').hidden = false; $('#link-picker-tabs').innerHTML = '<button class="link-picker-tab active" type="button" role="tab" aria-selected="true" data-source="files">Files</button>'; $('#link-picker-results').innerHTML = '<div class="link-picker-empty">Loading task sheets…</div>';
  $('#link-picker-query').value = ''; $('#link-picker-query').placeholder = 'Filter files…'; requestAnimationFrame(() => $('#link-picker-query').focus());
  const files = explorerFilePaths().map((file) => ({ title: fileLabel(file), detail: fileLabelPath(file), syntax: `<[${file}]>` }));
  const taskSheetFiles = explorerFilePaths().filter((file) => file.toLocaleLowerCase().endsWith('.md'));
  const sheets = (await Promise.all(taskSheetFiles.map(async (file) => {
    try {
      const raw = await window.stillnote.readNote(file), parsed = decodeStructured(raw);
      if (parsed?.type !== 'tasks' || !Array.isArray(parsed.data?.tasks)) return null;
      const label = raw.split(/\r?\n/, 1)[0].trim() || prettyName(file);
      const tasks = parsed.data.tasks.filter((task) => task.status !== 'completed').map((task) => ({ title: task.title || 'Untitled task', detail: task.due ? `Due ${String(task.due).slice(0, 10)}` : label, syntax: taskReferenceSyntax(label, task.title || 'Untitled task') }));
      return { id: `tasks:${file}`, label, items: tasks, empty: 'No active tasks in this sheet' };
    } catch { return null; }
  }))).filter(Boolean);
  if (linkPickerView !== state.view || $('#link-picker-overlay').hidden) return;
  linkPickerSources = [{ id: 'files', label: 'Files', items: files, empty: 'No files in this vault' }, ...sheets];
  const tabs = $('#link-picker-tabs'); tabs.replaceChildren();
  for (const source of linkPickerSources) {
    const tab = document.createElement('button'); tab.type = 'button'; tab.className = `link-picker-tab${source.id === 'files' ? ' active' : ''}`; tab.dataset.source = source.id; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(source.id === 'files')); tab.textContent = source.label; tab.addEventListener('click', () => selectLinkPickerSource(source.id)); tabs.append(tab);
  }
  renderLinkPickerResults();
}
function openSearch() {
  const search = $('#topbar-search');
  if (search.classList.contains('is-open')) { $('#search-input').focus(); return; }
  search.classList.add('is-open');
  $('.search-trigger').setAttribute('aria-expanded', 'true');
  $('#search-input').value = '';
  renderSearch('');
  $('#search-input').focus();
}
function closeSearch() {
  $('#topbar-search').classList.remove('is-open');
  $('.search-trigger').setAttribute('aria-expanded', 'false');
}
function applyTheme(theme) {
  state.theme = ['light', 'sepia', 'dark'].includes(theme) ? theme : 'light';
  $('.app-shell').dataset.theme = state.theme;
  localStorage.setItem('stillnote-theme', state.theme);
  state.structured?.refreshCanvas?.(); state.structured?.refreshCalculator3d?.();
  state.structured?.desmos?.updateSettings?.({ invertedColors: false });
  document.querySelectorAll('.theme-card').forEach((option) => option.setAttribute('aria-pressed', String(option.dataset.theme === state.theme)));
}
async function restoreWorkspace() {
  syncAiProviderSettings();
  applyTheme(localStorage.getItem('stillnote-theme') || 'light');
  try {
    const vault = await window.stillnote.restoreSession();
    if (!vault) return;
    await setVault(vault);
    if (vault.lastNote && explorerFilePaths().includes(vault.lastNote)) await openNote(vault.lastNote);
    else if (explorerFilePaths().length) await openNote(explorerFilePaths()[0]);
    else showEmptyVault();
  } catch (error) { console.error('Could not restore workspace:', error); }
  finally { state.workspaceRestored = true; await openPendingDeepLinks(); }
}
function selectSettingsTab(tab) {
  document.querySelectorAll('.settings-tab').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
  document.querySelectorAll('.settings-section').forEach((section) => {
    const active = section.dataset.section === tab;
    section.classList.toggle('active', active); section.hidden = !active;
  });
  if (tab === 'dictionary') renderCustomDictionary();
  if (tab === 'tasks') void updateGoogleTasksStatus(true);
}
function setToolbarPosition(type, position) {
  if (type === 'notes') {
    if (!['left', 'right', 'bottom', 'hidden'].includes(position)) return;
    state.toolbarPositions.notes = position;
    localStorage.setItem('stillnote-notes-toolbar-position', position);
    const editor = $('#note-editor'); editor.dataset.toolbarPosition = position;
    const visible = Boolean(state.view && !state.structured && position !== 'hidden');
    $('#note-format-toolbar').hidden = !visible;
    editor.classList.toggle('has-markdown-editor', visible);
  } else {
    if (!['left', 'right', 'bottom'].includes(position)) return;
    state.toolbarPositions.canvas = position;
    localStorage.setItem('stillnote-canvas-toolbar-position', position);
    if (state.structured?.type === 'canvas') document.querySelector('.canvas-editor').dataset.toolbarPosition = position;
  }
}
function aiModelStorageKey(provider = state.aiProvider) { return `stillnote-${provider}-model`; }
function selectedAiModel(provider = state.aiProvider) {
  const select = $('#ai-model');
  return (select.dataset.provider === provider && select.value.trim()) || localStorage.getItem(aiModelStorageKey(provider)) || AI_PROVIDERS[provider].defaultModel;
}
function syncAiProviderSettings() {
  const provider = state.aiProvider, config = AI_PROVIDERS[provider];
  $('#ai-provider').value = provider;
  $('#ai-key').value = '';
  $('#ai-key').placeholder = `Paste your ${config.name} API key`;
  $('#ai-key-label').textContent = `${config.name} API key`;
  $('#ai-provider-info').textContent = provider === 'groq'
    ? 'Groq has a free API tier with daily and per-minute limits. Exact limits depend on your model and account. Stay on the Free plan for free usage; Stillnote does not upgrade your plan or switch providers automatically.'
    : provider === 'anthropic' ? 'Anthropic API usage is billed separately from Claude subscriptions.'
    : 'OpenAI API usage is billed separately from ChatGPT subscriptions.';
  $('#ai-key-help').textContent = provider === 'groq'
    ? 'Create a key at console.groq.com/keys, save it here, then choose a model. Your prompts and relevant file content are sent directly to Groq when you use the assistant. Existing FreeModel keys cannot be used with Groq.'
    : provider === 'anthropic' ? 'Create a key at platform.claude.com/settings/keys, save it here, then choose a Claude model. Your prompts and relevant file content are sent directly to Anthropic when you use the assistant.'
    : 'Create a key at platform.openai.com/api-keys. Your prompts and relevant file content are sent to OpenAI when you use the assistant.';
  $('.assistant-footnote').textContent = `The open file and directly linked files are sent to ${config.name}.`;
}
let aiKeyStatusRequest = 0;
async function updateKeyStatus() {
  const label = $('#ai-key-status'), provider = state.aiProvider, vault = state.vault?.path, request = ++aiKeyStatusRequest;
  const current = () => request === aiKeyStatusRequest && provider === state.aiProvider && vault === state.vault?.path;
  try {
    const status = await window.stillnote.aiKeyStatus(provider);
    if (!current()) return;
    label.textContent = !status.vaultOpen ? 'Open a vault to save keys' : status.configured ? 'Key saved in this vault' : 'No key saved';
    label.className = `key-status${status.configured ? ' configured' : ''}`;
    setSettingsHealth('ai', status.configured, status.configured ? 'API key saved' : 'API key missing');
    $('#save-ai-key').disabled = !status.secureStorageAvailable || !status.vaultOpen;
    $('#remove-ai-key').disabled = !status.vaultOpen;
    if (!status.secureStorageAvailable) label.textContent = 'Secure key storage is unavailable';
  } catch (error) { if (current()) { label.textContent = error.message || 'Could not check key status'; label.className = 'key-status error'; setSettingsHealth('ai', false, 'Could not check API key'); } }
}
async function updateDesmosKeyStatus() {
  const status = await window.stillnote.desmosKeyStatus().catch(() => ({ configured: false, vaultOpen: false, secureStorageAvailable: false }));
  const detail = !status.vaultOpen ? 'Open a vault to save keys' : status.configured ? 'API key saved in this vault' : 'API key missing';
  setSettingsHealth('desmos', status.configured, detail);
  $('#save-desmos-key').disabled = !status.vaultOpen || !status.secureStorageAvailable;
  $('#remove-desmos-key').disabled = !status.vaultOpen;
}
function setSettingsHealth(name, working, detail) {
  const indicator = document.querySelector(`[data-health="${name}"]`);
  if (!indicator) return;
  indicator.innerHTML = working ? icons.statusCheck : icons.statusX;
  indicator.classList.toggle('is-ok', Boolean(working));
  indicator.classList.toggle('is-off', !working);
  indicator.title = detail;
  const tab = indicator.closest('.settings-tab');
  const label = tab && [...tab.querySelectorAll('span:not(.settings-health-indicator)')].map((span) => span.textContent.trim()).filter(Boolean).at(-1);
  if (tab) tab.setAttribute('aria-label', `${label || name}: ${detail}`);
}
let settingsAnimation = 0;
async function openSettings(tab = 'theme') {
  const overlay = $('#settings-overlay'), modal = $('.settings-modal');
  settingsAnimation++;
  overlay.hidden = false;
  animate(overlay, { opacity: [0, 1], duration: motionDuration(120), ease: 'outQuad' });
  animate(modal, { opacity: [0, 1], scale: [.985, 1], duration: motionDuration(150), ease: 'outQuad' });
  selectSettingsTab(tab);
  $('#directory-name').textContent = state.vault?.name || 'No folder open';
  $('#directory-path').textContent = state.vault?.path || 'Choose a folder to see its location.';
  setSettingsHealth('directory', Boolean(state.vault), state.vault ? 'Folder open' : 'No folder open');
  syncAiProviderSettings();
  $('#desmos-api-key').value = state.vault ? await window.stillnote.getDesmosKey().catch(() => '') : '';
  await updateDesmosKeyStatus();
  $('#notes-toolbar-position').value = state.toolbarPositions.notes;
  $('#canvas-toolbar-position').value = state.toolbarPositions.canvas;
  syncProofreadingSettings();
  updateKeyStatus();
  loadAiModels();
  void updateGoogleTasksStatus(true);
}
async function updateGoogleTasksStatus(loadClientId = false) {
  const label = $('#google-tasks-status');
  try {
    const status = await window.stillnote.googleTasksStatus();
    if (loadClientId) $('#google-tasks-client-id').value = status.clientId || '';
    $('#save-google-tasks-client').disabled = !status.secureStorageAvailable || !status.vaultOpen;
    $('#connect-google-tasks').disabled = !status.vaultOpen || !status.clientIdConfigured || !status.clientSecretConfigured || !status.secureStorageAvailable;
    $('#disconnect-google-tasks').disabled = !status.connected;
    if (status.connected) {
      await window.stillnote.listGoogleTaskLists();
      label.textContent = 'Connected and responding'; label.className = 'key-status configured';
      setSettingsHealth('tasks', true, 'Google Tasks connection working');
    } else {
      label.textContent = !status.vaultOpen ? 'Open a vault to save credentials' : !status.clientIdConfigured ? 'Client ID needed' : !status.clientSecretConfigured ? 'Client secret needed' : 'Not connected'; label.className = 'key-status';
      setSettingsHealth('tasks', false, !status.vaultOpen ? 'Open a vault first' : !status.clientIdConfigured ? 'Client ID missing' : !status.clientSecretConfigured ? 'Client secret missing' : 'Google account not connected');
    }
    if (!status.secureStorageAvailable) label.textContent = 'Secure storage is unavailable';
  } catch (error) {
    label.textContent = error.message || 'Could not check Google Tasks'; label.className = 'key-status error';
    $('#disconnect-google-tasks').disabled = false;
    setSettingsHealth('tasks', false, 'Google Tasks connection not working');
  }
}
let aiModelsRequest = 0;
async function loadAiModels() {
  const select = $('#ai-model'), status = $('#ai-model-status'), provider = state.aiProvider, config = AI_PROVIDERS[provider], vault = state.vault?.path, request = ++aiModelsRequest;
  const selected = localStorage.getItem(aiModelStorageKey(provider)) || config.defaultModel;
  const current = () => request === aiModelsRequest && provider === state.aiProvider && vault === state.vault?.path;
  const fallback = document.createElement('option'); fallback.value = selected; fallback.textContent = selected;
  select.replaceChildren(fallback); select.value = selected; select.dataset.provider = provider;
  select.disabled = true; status.textContent = 'Loading available models…';
  try {
    const models = await window.stillnote.listAiModels(provider);
    if (!current()) return;
    const choices = [...new Set(models)];
    if (!choices.length) throw new Error('No compatible chat models were returned for this account.');
    setSettingsHealth('ai', true, 'AI API key working');
    select.replaceChildren(...choices.map((model) => { const option = document.createElement('option'); option.value = model; option.textContent = model; return option; }));
    select.value = choices.includes(selected) ? selected : (choices.includes(config.defaultModel) ? config.defaultModel : choices[0]);
    localStorage.setItem(aiModelStorageKey(provider), select.value);
    status.textContent = `${choices.length} models available from ${config.name}.`;
  } catch (error) {
    if (!current()) return;
    setSettingsHealth('ai', false, 'AI API key not working');
    status.textContent = error.message || 'Save a valid API key to load available models.';
  } finally { if (current()) select.disabled = false; }
}
function closeSettings() {
  const overlay = $('#settings-overlay'), modal = $('.settings-modal'), animation = ++settingsAnimation;
  animate(modal, { opacity: [1, 0], scale: [1, .99], duration: motionDuration(90), ease: 'inQuad' });
  animate(overlay, { opacity: [1, 0], duration: motionDuration(100), ease: 'inQuad', onComplete: () => {
    if (animation === settingsAnimation) { overlay.hidden = true; overlay.style.opacity = ''; modal.style.opacity = ''; modal.style.transform = ''; }
  } });
}
function renderAssistantWelcome() {
  $('#assistant-messages').innerHTML = '<div class="assistant-welcome"><div class="assistant-welcome-icon">' + icons.assistant + '</div><strong>What would you like to do?</strong><p>Ask a question about this note, or ask me to edit it.</p></div>';
}
function setAssistantOpen(open) {
  if (open && state.home) return;
  state.assistantOpen = open;
  $('.workspace').classList.toggle('assistant-open', open);
  $('#assistant-toggle').setAttribute('aria-pressed', String(open));
  if (open) $('#assistant-input').focus();
}
function setupPanelResizers() {
  const workspace = $('.workspace');
  const explorerHandle = $('#sidebar-resizer');
  const assistantHandle = $('#assistant-resizer');
  const setWidths = () => {
    workspace.style.setProperty('--sidebar-width', `${state.sidebarWidth}px`);
    workspace.style.setProperty('--assistant-width', `${state.assistantWidth}px`);
    explorerHandle.setAttribute('aria-valuenow', String(state.sidebarWidth));
    assistantHandle.setAttribute('aria-valuenow', String(state.assistantWidth));
  };
  const resizeAt = (panel, clientX) => {
    const bounds = workspace.getBoundingClientRect();
    if (panel === 'explorer') {
      const max = Math.max(190, Math.min(440, bounds.width - (state.assistantOpen ? state.assistantWidth : 0) - 340));
      state.sidebarWidth = Math.max(190, Math.min(max, clientX - bounds.left));
    } else {
      const visibleExplorerWidth = state.sidebarOpen ? state.sidebarWidth : 0;
      const max = Math.max(280, Math.min(560, bounds.width - visibleExplorerWidth - 340));
      state.assistantWidth = Math.max(280, Math.min(max, bounds.right - clientX));
    }
    setWidths();
  };
  let resizing = null;
  for (const [handle, panel] of [[explorerHandle, 'explorer'], [assistantHandle, 'assistant']]) {
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      resizing = panel;
      handle.classList.add('is-active');
      document.body.classList.add('resizing-panels');
      handle.setPointerCapture?.(event.pointerId);
    });
    handle.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const step = event.shiftKey ? 40 : 16;
      const amount = event.key === 'ArrowRight' ? step : -step;
      const bounds = workspace.getBoundingClientRect();
      const position = panel === 'explorer'
        ? bounds.left + state.sidebarWidth + amount
        : bounds.right - state.assistantWidth - amount;
      resizeAt(panel, position);
    });
  }
  window.addEventListener('pointermove', (event) => { if (resizing) resizeAt(resizing, event.clientX); });
  window.addEventListener('pointerup', () => {
    if (!resizing) return;
    resizing = null;
    document.body.classList.remove('resizing-panels');
    explorerHandle.classList.remove('is-active');
    assistantHandle.classList.remove('is-active');
    localStorage.setItem('stillnote-sidebar-width', String(state.sidebarWidth));
    localStorage.setItem('stillnote-assistant-width', String(state.assistantWidth));
  });
  setWidths();
}
function appendChatBubble(role, text) {
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${role}`;
  bubble.textContent = text;
  $('#assistant-messages').append(bubble);
  $('#assistant-messages').scrollTop = $('#assistant-messages').scrollHeight;
  return bubble;
}
function activeDocumentText(){return state.structured?encodeStructured(state.structured.type,state.structured.title||prettyName(state.active),state.structured.data):state.view?.state.doc.toString()||'';}
function updateAssistantModeCopy() {
  const editButton = document.querySelector('.assistant-mode[data-mode="edit"]');
  const taskSheet = state.structured?.type === 'tasks';
  const structuredLabel = ({ geometry: 'geometry', calculator3d: '3D calculator', canvas: 'canvas', graph: 'graph', spreadsheet: 'spreadsheet' })[state.structured?.type] || '';
  const pdf = state.active?.toLowerCase().endsWith('.pdf');
  if (editButton) { editButton.disabled = Boolean(pdf); editButton.title = pdf ? 'PDF files are read-only' : ''; }
  if (pdf && state.assistantMode === 'edit') { state.assistantMode = 'ask'; document.querySelectorAll('.assistant-mode').forEach((mode) => mode.classList.toggle('active', mode.dataset.mode === 'ask')); }
  if (editButton) editButton.textContent = taskSheet ? 'Add tasks' : structuredLabel ? `Edit ${structuredLabel}` : 'Edit note';
  const documentLabel = taskSheet ? 'task sheet' : structuredLabel || (isEditableAsset(state.active || '') ? 'code file' : 'note');
  $('#assistant-input').placeholder = pdf ? 'Ask about this PDF…' : state.assistantMode === 'edit' ? (taskSheet ? 'Describe tasks to add…' : `Describe a change to this ${documentLabel}…`) : `Ask about this ${documentLabel}…`;
}
async function addAiTasksToSheet(specs, notePath, originalDocument) {
  const owner = state.structured;
  if (!owner || owner.type !== 'tasks' || state.active !== notePath || activeDocumentText() !== originalDocument) throw new Error('The task sheet changed while the assistant was working. Please try again.');
  if (!Array.isArray(specs) || !specs.length) return 0;
  if (specs.length > 30) throw new Error('The assistant returned too many tasks to add at once.');
  const additions = specs.map((item) => {
    const title = String(item?.title || '').trim();
    const notes = String(item?.notes || '').trim();
    const due = String(item?.due || '').trim();
    const parentTitle = String(item?.parentTitle || '').trim();
    if (!title || title.length > 1024) throw new Error('The assistant returned a task with an invalid title.');
    if (notes.length > 8192) throw new Error(`Details for “${title}” are too long.`);
    if (due && (!/^\d{4}-\d{2}-\d{2}$/.test(due) || Number.isNaN(Date.parse(`${due}T00:00:00Z`)))) throw new Error(`The assistant returned an invalid due date for “${title}”.`);
    return { title, notes, due, parentTitle };
  });
  const taskByTitle = new Map(owner.data.tasks.map((task) => [task.title.toLocaleLowerCase(), task]));
  let added = 0;
  try {
    for (const item of additions) {
      if (state.structured !== owner || state.active !== notePath) throw new Error('The task sheet was closed before all tasks were added.');
      const parent = item.parentTitle ? taskByTitle.get(item.parentTitle.toLocaleLowerCase()) : null;
      if (item.parentTitle && !parent) throw new Error(`Could not find parent task “${item.parentTitle}”. Add parent tasks before their subtasks.`);
      const remote = await window.stillnote.createGoogleTask(owner.data.listId, item.title, parent?.id);
      if (state.structured !== owner || state.active !== notePath) throw new Error(`Added “${remote.title || item.title}” to Google Tasks, but the task sheet was closed before Stillnote could refresh.`);
      const task = { id: remote.id, title: remote.title || item.title, status: remote.status || 'needsAction', due: remote.due || null, notes: remote.notes || '', parent: remote.parent || parent?.id || null, starred: false };
      owner.data.tasks.push(task); taskByTitle.set(task.title.toLocaleLowerCase(), task); added++;
      if (item.notes || item.due) {
        const changes = {};
        if (item.notes) changes.notes = item.notes;
        if (item.due) changes.due = `${item.due}T00:00:00.000Z`;
        try {
          const updated = await window.stillnote.updateGoogleTask(owner.data.listId, task.id, changes);
          if (state.structured !== owner || state.active !== notePath) throw new Error('The task sheet was closed before the task details could be updated.');
          task.notes = updated.notes || item.notes;
          task.due = updated.due || (item.due ? `${item.due}T00:00:00.000Z` : null);
        } catch (error) { throw new Error(`Added “${task.title}”, but its details could not be saved: ${error.message}`); }
      }
      setStructuredDirty();
    }
  } catch (error) {
    if (added && state.structured === owner && state.active === notePath) { setStructuredDirty(); renderStructured('tasks', owner.data, notePath, owner.title || prettyName(notePath)); }
    throw error;
  }
  renderStructured('tasks', owner.data, notePath, owner.title || prettyName(notePath));
  return added;
}
function appendAppliedEdit(container, text, notePath, originalDocument) {
  if (state.active !== notePath || activeDocumentText() !== originalDocument) {appendChatBubble('assistant error', 'The document changed while I was working, so I did not apply the edit. Please send the request again.');return false;}
  let updatedDocument=text;
  const structuredType=state.structured?.type||null;
  if(structuredType){
    const parsed=decodeStructured(text);
    if(!parsed||parsed.type!==structuredType||!isValidStructuredPayload(structuredType,parsed.data)){appendChatBubble('assistant error',`The assistant returned invalid ${structuredType} data, so I did not apply the edit.`);return false;}
    const current=state.structured;current.data=parsed.data;setStructuredDirty();
    const history={undoStack:current.undoStack,redoStack:current.redoStack,historySnapshot:current.historySnapshot,historyPending:current.historyPending,historyTimer:current.historyTimer};
    renderStructured(structuredType,current.data,notePath,current.title||prettyName(notePath));Object.assign(state.structured,history);updateStructuredHistoryButtons();
    updatedDocument=activeDocumentText();
  } else {
    if(!state.view){appendChatBubble('assistant error','The note is no longer open, so I did not apply the edit.');return false;}
    state.view.dispatch({ changes: { from: 0, to: state.view.state.doc.length, insert: updatedDocument } });
    state.view.focus();
  }
  const message = document.createElement('p'); message.textContent = 'I updated the document.'; container.append(message);
  const toggle = document.createElement('button'); toggle.className = 'undo-ai-edit-button'; toggle.type = 'button'; toggle.textContent = 'Undo changes';
  let showingUpdated = true;
  toggle.addEventListener('click', () => {
    if(state.active!==notePath){showToast('Open the edited document to undo or redo this change.');return;}
    const expected=showingUpdated?updatedDocument:originalDocument;
    if(activeDocumentText()!==expected){showToast('The document has changed since the AI edit; undo was not applied.');return;}
    if(structuredType)void applyStructuredHistory(showingUpdated?'undo':'redo');
    else {if(!state.view){showToast('Open the edited document to undo or redo this change.');return;}state.view.dispatch({changes:{from:0,to:state.view.state.doc.length,insert:showingUpdated?originalDocument:updatedDocument}});state.view.focus();}
    showingUpdated = !showingUpdated;
    toggle.textContent = showingUpdated ? 'Undo changes' : 'Redo changes';
  });
  container.append(toggle);
  $('#assistant-messages').scrollTop = $('#assistant-messages').scrollHeight;
  return true;
}
async function readLinkedPdfContext(file, limit, current) {
  if(!current())throw new Error('The active file or vault changed.');
  const asset=await window.stillnote.readAsset(file);
  if(!current())throw new Error('The active file or vault changed.');
  if(asset.data.length>28*1024*1024)throw new Error('PDF exceeds the 20 MB reading limit.');
  const {getDocument}=await getPdfJs();
  const pdf=await getDocument({data:bytesFromDataUrl(asset.data),isEvalSupported:false,useSystemFonts:true}).promise;
  try{
    const pages=[];let length=0,page=1;
    for(;page<=pdf.numPages&&page<=50&&length<limit;page++){
      if(!current())throw new Error('The active file or vault changed.');
      const content=await (await pdf.getPage(page)).getTextContent();
      const text=content.items.map(item=>item.str||'').filter(Boolean).join(' ');
      if(text){const chunk=`Page ${page}\n${text}`;pages.push(chunk.slice(0,limit-length));length+=chunk.length+2;}
    }
    if(!pages.length)throw new Error('No selectable PDF text was found; OCR is not available.');
    return {text:pages.join('\n\n'),truncated:page<=pdf.numPages||length>limit};
  }finally{await pdf.destroy();}
}
async function loadLinkedAssistantContext(request, current) {
  const context=await window.stillnote.linkedAiContext(request);
  for(const file of context.files){
    if(!current())throw new Error('The active file or vault changed.');
    if(file.kind!=='pdf'||file.error||!file.textBudget)continue;
    try{Object.assign(file,await readLinkedPdfContext(file.path,file.textBudget,current));delete file.note;}
    catch(error){file.error=error.message;delete file.text;}
    delete file.textBudget;
  }
  if(!current())throw new Error('The active file or vault changed.');
  return context;
}
async function submitAssistantMessage(event) {
  event.preventDefault();
  const prompt = $('#assistant-input').value.trim();
  if (!prompt) return;
  const notePath = state.active, vault = state.vault?.path, navigation = state.navigationId, isPdf = Boolean(notePath?.toLowerCase().endsWith('.pdf'));
  if (!notePath || (!state.view && !state.structured && !isPdf)) { showToast('Open a note, code file, PDF, canvas, geometry, 3D calculator, spreadsheet, graph, or task sheet before using the assistant.'); return; }
  const provider = state.aiProvider, model = selectedAiModel(provider);
  let keyStatus;
  try { keyStatus = await window.stillnote.aiKeyStatus(provider); }
  catch (error) { showToast(error.message || 'Could not check AI key status.'); return; }
  if (!keyStatus.configured) { openSettings('ai'); return; }
  const mode = isPdf ? 'ask' : state.assistantMode;
  const documentType = isPdf ? 'pdf' : state.structured?.type || (isEditableAsset(notePath) ? 'code' : 'markdown');
  localStorage.setItem(aiModelStorageKey(provider), model);
  const welcome = $('.assistant-welcome'); if (welcome) welcome.remove();
  appendChatBubble('user', prompt);
  const loading = appendChatBubble('assistant loading', 'Thinking…');
  $('#assistant-input').value = ''; $('#assistant-send').disabled = true;
  try {
    const documentText = isPdf ? await extractActivePdfText(notePath) : activeDocumentText();
    const current = () => state.active === notePath && state.vault?.path === vault && state.navigationId === navigation;
    if (!current()) throw new Error('The active file or vault changed. Please send the request again.');
    loading.textContent = 'Reading linked files…';
    const linkedContext = await loadLinkedAssistantContext({ provider, vault, notePath, document: documentText }, current);
    loading.textContent = 'Thinking…';
    const result = await window.stillnote.askAi({ provider, vault, notePath, mode, model, noteName: prettyName(notePath), documentType, document: documentText, linkedContext, prompt, history: state.chatHistory });
    loading.remove();
    if (documentType === 'tasks' && result.kind === 'tasks') {
      const added = await addAiTasksToSheet(result.tasks, notePath, documentText);
      const responseText = added ? `Added ${added} ${added === 1 ? 'task' : 'tasks'} to Google Tasks.` : 'No tasks were added.';
      appendChatBubble('assistant', responseText);
      state.chatHistory.push({ role: 'user', content: prompt }, { role: 'assistant', content: responseText });
    } else if (mode === 'edit' && result.kind === 'edit') {
      const bubble = document.createElement('div'); bubble.className = 'chat-bubble assistant'; $('#assistant-messages').append(bubble);
      const applied = appendAppliedEdit(bubble, result.text, notePath, documentText);
      if (!applied) bubble.remove();
      else state.chatHistory.push({ role: 'user', content: prompt }, { role: 'assistant', content: 'Applied the requested changes to the document.' });
    } else {
      appendChatBubble('assistant', result.text);
      state.chatHistory.push({ role: 'user', content: prompt }, { role: 'assistant', content: result.text });
    }
    state.chatHistory = state.chatHistory.slice(-8);
  } catch (error) {
    loading.remove(); appendChatBubble('assistant error', error.message || 'The assistant could not respond.');
  } finally { $('#assistant-send').disabled = false; }
}
let meetingRecording = false;
let meetingStarting = false;
let meetingRecordingStartedAt = 0;
let meetingDurationTimer = null;
let meetingStopPromise = null;
let meetingTargetView = null;
let meetingWhisperWorker = null;
let meetingWhisperRequest = 0;
const meetingWhisperPending = new Map();
let meetingMediaStream = null;
let meetingAudioContext = null;
let meetingAudioSource = null;
let meetingAudioProcessor = null;
let meetingAudioChunks = [];
let meetingAudioSampleCount = 0;
let meetingCaptureGeneration = 0;
let meetingTranscriptionQueue = Promise.resolve();
function meetingButtonStatus(message, recording = meetingRecording) {
  const button = $('#meeting-notes-trigger');
  button.title = message; button.setAttribute('aria-label', message);
  button.classList.toggle('is-recording', recording);
  button.classList.remove('has-transcript');
  button.setAttribute('aria-pressed', String(recording));
}
function updateMeetingDuration() {
  const elapsed = Math.max(0, Math.floor((Date.now() - meetingRecordingStartedAt) / 1000));
  $('#meeting-notes-trigger .meeting-duration').textContent = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
}
function stopMeetingDuration() {
  clearInterval(meetingDurationTimer); meetingDurationTimer = null;
  $('#meeting-notes-trigger .meeting-duration').hidden = true;
}
function cancelMeetingRecording() {
  if (meetingRecording || meetingStopPromise) void stopMeetingRecording();
  if (meetingStarting) meetingCaptureGeneration++;
}
function appendMeetingText(text) {
  if (!text.trim() || !meetingTargetView || state.view !== meetingTargetView) return;
  const view = meetingTargetView, end = view.state.doc.length;
  const suffix = view.state.doc.toString().endsWith('\n') ? '' : '\n';
  view.dispatch({ changes: { from: end, insert: `${suffix}${text.trim()}\n` } });
}
function ensureMeetingWhisperWorker() {
  if (meetingWhisperWorker) return meetingWhisperWorker;
  meetingWhisperWorker = new Worker(new URL('./whisper-worker.js', import.meta.url), { type: 'module' });
  meetingWhisperWorker.addEventListener('message', ({ data }) => {
    const pending = meetingWhisperPending.get(data.id);
    if (data.type === 'progress') {
      if (meetingRecording || meetingStarting) {
        const percent = Number.isFinite(data.progress?.progress) ? ` ${Math.round(data.progress.progress)}%` : '';
        meetingButtonStatus(`Downloading local Whisper model${percent}…`);
      }
      return;
    }
    if (!pending) return;
    meetingWhisperPending.delete(data.id);
    if (data.type === 'result' || data.type === 'ready') pending.resolve(data.text);
    else pending.reject(new Error(data.message || 'Local Whisper could not transcribe this audio.'));
  });
  meetingWhisperWorker.addEventListener('error', (event) => {
    const error = new Error(event.message || 'The local Whisper worker stopped unexpectedly.');
    for (const pending of meetingWhisperPending.values()) pending.reject(error);
    meetingWhisperPending.clear(); meetingWhisperWorker?.terminate(); meetingWhisperWorker = null;
  });
  return meetingWhisperWorker;
}
function transcribeMeetingAudio(samples = null) {
  const worker = ensureMeetingWhisperWorker(), id = ++meetingWhisperRequest;
  const audio = samples?.slice();
  return new Promise((resolve, reject) => {
    meetingWhisperPending.set(id, { resolve, reject });
    if (audio) worker.postMessage({ type: 'transcribe', id, audio: audio.buffer }, [audio.buffer]);
    else worker.postMessage({ type: 'load', id });
  });
}
function resampleMeetingAudio(samples, sourceRate) {
  const targetRate = 16000, ratio = sourceRate / targetRate;
  const output = new Float32Array(Math.floor(samples.length / ratio));
  for (let index = 0; index < output.length; index++) {
    const sourceIndex = index * ratio, left = Math.floor(sourceIndex), fraction = sourceIndex - left;
    output[index] = samples[left] * (1 - fraction) + (samples[Math.min(left + 1, samples.length - 1)] || 0) * fraction;
  }
  return output;
}
function queueMeetingAudio(samples, generation) {
  const audio = resampleMeetingAudio(samples, meetingAudioContext?.sampleRate || 48000);
  let energy = 0;
  for (let index = 0; index < audio.length; index += 16) energy += audio[index] * audio[index];
  if (!audio.length || Math.sqrt(energy / Math.ceil(audio.length / 16)) < 0.001) return;
  meetingTranscriptionQueue = meetingTranscriptionQueue.then(async () => {
    if (generation !== meetingCaptureGeneration || !meetingTargetView) return;
    if (meetingRecording) meetingButtonStatus('Transcribing locally…');
    const text = await transcribeMeetingAudio(audio);
    if (generation !== meetingCaptureGeneration || !meetingTargetView || !text) return;
    appendMeetingText(text);
    if (meetingRecording) meetingButtonStatus('Transcribing live locally · Click to stop');
  }).catch((error) => {
    if (generation !== meetingCaptureGeneration) return;
    meetingRecording = false;
    meetingCaptureGeneration++;
    stopMeetingDuration();
    void releaseMeetingAudioCapture(false);
    const message = `Local Whisper stopped: ${error.message}`;
    meetingButtonStatus(message, false); showToast(message);
  });
}
function drainMeetingAudio(force = false) {
  if (!meetingAudioChunks.length || !meetingAudioContext) return;
  const sampleRate = meetingAudioContext.sampleRate;
  if (!force && meetingAudioSampleCount < sampleRate * 15) return;
  const merged = new Float32Array(meetingAudioSampleCount);
  let offset = 0;
  for (const chunk of meetingAudioChunks) { merged.set(chunk, offset); offset += chunk.length; }
  meetingAudioChunks = []; meetingAudioSampleCount = 0;
  queueMeetingAudio(merged, meetingCaptureGeneration);
}
async function releaseMeetingAudioCapture(flush) {
  if (flush) drainMeetingAudio(true);
  if (meetingAudioProcessor) { meetingAudioProcessor.onaudioprocess = null; try { meetingAudioProcessor.disconnect(); } catch {} }
  if (meetingAudioSource) { try { meetingAudioSource.disconnect(); } catch {} }
  meetingMediaStream?.getTracks().forEach((track) => track.stop());
  const context = meetingAudioContext;
  meetingAudioProcessor = null; meetingAudioSource = null; meetingMediaStream = null; meetingAudioContext = null;
  if (context && context.state !== 'closed') await context.close().catch(() => {});
}
async function startMeetingAudioCapture() {
  meetingMediaStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
  meetingAudioContext = new AudioContext();
  await meetingAudioContext.resume();
  meetingAudioSource = meetingAudioContext.createMediaStreamSource(meetingMediaStream);
  meetingAudioProcessor = meetingAudioContext.createScriptProcessor(4096, 1, 1);
  meetingAudioProcessor.onaudioprocess = (event) => {
    event.outputBuffer.getChannelData(0).fill(0);
    if (!meetingRecording) return;
    const input = event.inputBuffer.getChannelData(0).slice();
    meetingAudioChunks.push(input); meetingAudioSampleCount += input.length;
    drainMeetingAudio();
  };
  meetingAudioSource.connect(meetingAudioProcessor); meetingAudioProcessor.connect(meetingAudioContext.destination);
}
async function startMeetingRecording() {
  if (meetingStarting || meetingRecording || meetingStopPromise) return;
  if (!state.view || !state.active?.toLowerCase().endsWith('.md') || state.home || state.structured) {
    showToast('Open a Markdown note to transcribe into.'); return;
  }
  meetingStarting = true;
  const target = state.view, generation = ++meetingCaptureGeneration;
  const button = $('#meeting-notes-trigger'); button.disabled = true;
  try {
    meetingButtonStatus('Loading local Whisper Medium model (downloads on first use)…', false);
    await transcribeMeetingAudio();
    if (generation !== meetingCaptureGeneration || state.view !== target || state.home) return;
    meetingTargetView = target;
    meetingAudioChunks = []; meetingAudioSampleCount = 0;
    meetingTranscriptionQueue = Promise.resolve();
    await startMeetingAudioCapture();
    if (generation !== meetingCaptureGeneration || state.view !== target || state.home) { await releaseMeetingAudioCapture(false); return; }
    meetingRecording = true;
    meetingRecordingStartedAt = Date.now(); updateMeetingDuration();
    $('#meeting-notes-trigger .meeting-duration').hidden = false;
    meetingDurationTimer = setInterval(updateMeetingDuration, 250);
    meetingButtonStatus('Transcribing live locally · Click to stop');
    showToast('Live transcription started at the bottom of this note');
  } catch (error) {
    meetingRecording = false; stopMeetingDuration(); await releaseMeetingAudioCapture(false);
    meetingButtonStatus(error.message || 'Could not start transcription', false);
    showToast(error.message || 'Could not start transcription.');
  } finally { meetingStarting = false; button.disabled = false; }
}
function stopMeetingRecording() {
  if (meetingStopPromise) return meetingStopPromise;
  if (!meetingRecording) return Promise.resolve();
  meetingRecording = false; stopMeetingDuration();
  const button = $('#meeting-notes-trigger'); button.disabled = true;
  meetingButtonStatus('Finishing local transcription…', false);
  meetingStopPromise = (async () => {
    try {
      await releaseMeetingAudioCapture(true);
      await meetingTranscriptionQueue;
      if (state.view === meetingTargetView) await saveActive();
      meetingButtonStatus('Start live local transcription', false);
    } catch (error) { showToast(error.message || 'Could not finish transcription.'); }
    finally { meetingTargetView = null; meetingStopPromise = null; button.disabled = false; }
  })();
  return meetingStopPromise;
}
$('#meeting-notes-trigger').addEventListener('click', () => {
  if (meetingRecording) void stopMeetingRecording();
  else void startMeetingRecording();
});
function renderSearch(query) {
  const results = $('#search-results'); results.innerHTML = '';
  if (!query.trim()) { results.innerHTML = '<div class="search-hint">Type to find a note by title</div>'; return; }
  const matches = state.files.filter((file) => fileLabel(file).toLowerCase().includes(query.toLowerCase()));
  if (!matches.length) { results.innerHTML = '<div class="search-hint">No matching notes</div>'; return; }
  for (const file of matches.slice(0, 8)) {
    const row = document.createElement('button'); row.className = 'search-result'; row.innerHTML = `${icons[findExplorerNode(file)?.format] || icons.file}${fileLabelHtml(file)}<small>${escapeHtml(file.includes('/') ? file.split('/').slice(0, -1).join('/') : 'Notes')}</small>`;
    row.addEventListener('click', () => { closeSearch(); openNote(file); }); results.append(row);
  }
}

$('.vault-switcher').addEventListener('click', chooseVault);
$('#open-vault').addEventListener('click', () => state.vault && !state.files.length ? createNote() : chooseVault());
$('#new-file').addEventListener('click', (event) => { event.stopPropagation(); showNewFileMenu(event.currentTarget); });
document.addEventListener('click', (event) => { if (!event.target.closest('#new-file-menu') && !event.target.closest('#new-file')) $('#new-file-menu').hidden = true; });
$('.search-trigger').addEventListener('click', openSearch);
$('#search-input').addEventListener('input', (event) => renderSearch(event.target.value));
document.addEventListener('click', (event) => { if ($('#topbar-search').classList.contains('is-open') && !$('#topbar-search').contains(event.target)) closeSearch(); });
$('#refresh-notes').addEventListener('click', async () => { await refreshExplorer({forceLinks:true}); });
$('#expand-folders').addEventListener('click', () => setExplorerFoldersExpanded(true));
$('#collapse-folders').addEventListener('click', () => setExplorerFoldersExpanded(false));
$('#new-folder').addEventListener('click', () => createFolder());
document.addEventListener('click', (event) => { if (!$('#explorer-context-menu').hidden && !$('#explorer-context-menu').contains(event.target)) closeExplorerContextMenu(); });
document.addEventListener('click', (event) => { if (!$('#editor-context-menu').hidden && !$('#editor-context-menu').contains(event.target)) closeEditorContextMenu(); });
$('.sidebar-toggle').addEventListener('click', () => { state.sidebarOpen = !state.sidebarOpen; $('.workspace').classList.toggle('sidebar-collapsed', !state.sidebarOpen); });
$('#settings-button').addEventListener('click', () => openSettings());
$('#settings-close').addEventListener('click', closeSettings);
$('#settings-overlay').addEventListener('click', (event) => { if (event.target === $('#settings-overlay')) closeSettings(); });
$('#rename-form').addEventListener('submit', (event) => { event.preventDefault(); finishRenameDialog($('#rename-input').value.trim()); });
$('#rename-cancel').addEventListener('click', () => finishRenameDialog());
$('#rename-overlay').addEventListener('click', (event) => { if (event.target === $('#rename-overlay')) finishRenameDialog(); });
$('#delete-cancel').addEventListener('click', () => finishDeleteDialog(false));
$('#delete-confirm').addEventListener('click', () => finishDeleteDialog(true));
$('#delete-overlay').addEventListener('click', (event) => { if (event.target === $('#delete-overlay')) finishDeleteDialog(false); });
$('#link-picker-close').addEventListener('click', () => closeLinkPicker());
$('#link-picker-overlay').addEventListener('click', (event) => { if (event.target === $('#link-picker-overlay')) closeLinkPicker(); });
$('#link-picker-query').addEventListener('input', renderLinkPickerResults);
document.querySelectorAll('.settings-tab').forEach((button) => button.addEventListener('click', () => selectSettingsTab(button.dataset.tab)));
$('#custom-dictionary-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (addCustomWord($('#custom-dictionary-input').value)) $('#custom-dictionary-input').value = '';
});
$('#notes-toolbar-position').addEventListener('change', (event) => setToolbarPosition('notes', event.target.value));
$('#canvas-toolbar-position').addEventListener('change', (event) => setToolbarPosition('canvas', event.target.value));
document.querySelectorAll('.theme-card').forEach((button) => button.addEventListener('click', () => applyTheme(button.dataset.theme)));
$('#change-directory').addEventListener('click', async () => { await chooseVault(); $('#directory-name').textContent = state.vault?.name || 'No folder open'; $('#directory-path').textContent = state.vault?.path || 'Choose a folder to see its location.'; });
$('#ai-provider').addEventListener('change', () => {
  state.aiProvider = resolveAiProvider($('#ai-provider').value);
  localStorage.setItem('stillnote-ai-provider', state.aiProvider);
  syncAiProviderSettings(); void updateKeyStatus(); void loadAiModels();
});
$('#save-ai-key').addEventListener('click', async () => {
  const provider = state.aiProvider;
  try {
    await window.stillnote.saveAiKey($('#ai-key').value, provider);
    if (state.aiProvider === provider) $('#ai-key').value = '';
    await updateKeyStatus(); await loadAiModels(); showToast(`${AI_PROVIDERS[provider].name} key saved securely`);
  } catch (error) { if (state.aiProvider === provider) { $('#ai-key-status').textContent = error.message; $('#ai-key-status').className = 'key-status error'; } }
});
$('#remove-ai-key').addEventListener('click', async () => {
  const provider = state.aiProvider;
  try {
    await window.stillnote.clearAiKey(provider);
    if (state.aiProvider === provider) $('#ai-key').value = '';
    await updateKeyStatus(); await loadAiModels();
  } catch (error) { showToast(error.message || 'Could not remove the API key'); }
});
$('#reset-unreadable-credentials').addEventListener('click', async () => {
  const button = $('#reset-unreadable-credentials'); button.disabled = true;
  try {
    await window.stillnote.resetUnreadableCredentials();
    $('#ai-key').value = ''; $('#google-tasks-client-id').value = ''; $('#google-tasks-client-secret').value = ''; $('#desmos-api-key').value = '';
    await Promise.all([updateKeyStatus(), updateDesmosKeyStatus(), updateGoogleTasksStatus()]);
    await loadAiModels();
    showToast('Unreadable credentials were archived. Enter your keys again.');
  } catch (error) { showToast(error.message || 'Could not reset unreadable credentials.'); }
  finally { button.disabled = false; }
});
$('#save-google-tasks-client').addEventListener('click', async () => {
  try { await window.stillnote.saveGoogleTasksCredentials($('#google-tasks-client-id').value, $('#google-tasks-client-secret').value); $('#google-tasks-client-secret').value = ''; await updateGoogleTasksStatus(); showToast('Google OAuth credentials saved securely'); }
  catch (error) { $('#google-tasks-status').textContent = error.message || 'Could not save client ID'; $('#google-tasks-status').className = 'key-status error'; }
});
$('#connect-google-tasks').addEventListener('click', async () => {
  const button = $('#connect-google-tasks'); button.disabled = true; $('#google-tasks-status').textContent = 'Waiting for Google sign-in…';
  try { await window.stillnote.connectGoogleTasks(); state.taskLinkStates.clear(); scheduleTaskReferenceLinks(state.view); await updateGoogleTasksStatus(); showToast('Google Tasks connected'); }
  catch (error) {
    await updateGoogleTasksStatus();
    $('#google-tasks-status').textContent = `Connection failed: ${error.message || 'Could not connect Google Tasks'}`;
    $('#google-tasks-status').className = 'key-status error';
    setSettingsHealth('tasks', false, 'Google Tasks connection failed');
  }
});
$('#disconnect-google-tasks').addEventListener('click', async () => {
  try { await window.stillnote.disconnectGoogleTasks(); await updateGoogleTasksStatus(); showToast('Google Tasks disconnected'); }
  catch (error) { showToast(error.message || 'Could not disconnect Google Tasks'); }
});
function refreshOpenGraph() {
  if (state.structured?.type !== 'graph') return;
  const root = document.querySelector('.graph-editor');
  state.structured.desmos?.destroy?.(); state.structured.desmos = null;
  if (root) void renderGraph(root, state.structured.data);
}
$('#save-desmos-key').addEventListener('click', async () => {
  const key = $('#desmos-api-key').value.trim();
  if (!key) { showToast('Enter a Desmos API key first.'); return; }
  try {
    await window.stillnote.saveDesmosKey(key);
    setSettingsHealth('desmos', true, 'API key saved in this vault');
    showToast('Desmos key saved securely in this vault'); refreshOpenGraph(); invalidateVaultLinkRendering();
  } catch (error) { showToast(error.message || 'Could not save the Desmos key.'); }
});
$('#remove-desmos-key').addEventListener('click', async () => {
  try { await window.stillnote.clearDesmosKey(); }
  catch (error) { showToast(error.message || 'Could not remove the Desmos key.'); return; }
  $('#desmos-api-key').value = '';
  setSettingsHealth('desmos', false, 'API key missing');
  state.structured?.desmos?.destroy?.(); if (state.structured) state.structured.desmos = null;
  refreshOpenGraph(); showToast('Desmos API key removed');
});
$('#ai-model').addEventListener('change', () => localStorage.setItem(aiModelStorageKey(), selectedAiModel()));
$('#assistant-toggle').addEventListener('click', () => setAssistantOpen(!state.assistantOpen));
$('#home-button').addEventListener('click', () => { if (!state.home) void openHome(); else $('#home-input')?.focus(); });
document.querySelectorAll('.assistant-mode').forEach((button) => button.addEventListener('click', () => {
  state.assistantMode = button.dataset.mode;
  document.querySelectorAll('.assistant-mode').forEach((mode) => mode.classList.toggle('active', mode === button));
  updateAssistantModeCopy();
}));
$('#assistant-form').addEventListener('submit', submitAssistantMessage);
$('#assistant-input').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault(); $('#assistant-form').requestSubmit();
  }
});
function handleAppEscape(event) {
  if (event.defaultPrevented || event.isComposing || event.repeat) return;
  // Let Chromium handle exiting video fullscreen and cancelling native dialogs.
  if (document.fullscreenElement || document.querySelector('dialog[open]')) return;
  const close = action => { event.preventDefault(); action(); };
  if (!$('#rename-overlay').hidden) return close(() => finishRenameDialog());
  if (!$('#delete-overlay').hidden) return close(() => finishDeleteDialog(false));
  if (!$('#link-picker-overlay').hidden) return close(() => closeLinkPicker());
  const equation = document.querySelector('.equation-preview');
  if (equation) return close(() => equation._dismiss?.());
  if (!$('#new-file-menu').hidden) return close(() => { $('#new-file-menu').hidden = true; $('#new-file').setAttribute('aria-expanded','false'); });
  if ($('#topbar-search').classList.contains('is-open')) return close(closeSearch);
  if (!$('#settings-overlay').hidden) return close(closeSettings);
  if (!$('#explorer-context-menu').hidden) return close(closeExplorerContextMenu);
  if (!$('#editor-context-menu').hidden) return close(closeEditorContextMenu);
  if (state.view && searchPanelOpen(state.view.state)) return close(() => closeSearchPanel(state.view));
  if (state.assistantOpen) return close(() => setAssistantOpen(false));
  if ([...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].some(dialog => dialog.getClientRects().length)) return;
  const nativePicker = event.target.closest?.('select,input[type="date"],input[type="color"],input[type="file"]');
  if (nativePicker) return close(() => nativePicker.blur());
  if (state.active && !state.home && !event.metaKey && !event.ctrlKey && !event.altKey) close(() => { void openHome(); });
}
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { handleAppEscape(event); return; }
  if (event.defaultPrevented || event.isComposing) return;
  if (event.key === 'Enter' && !$('#explorer-context-menu').hidden) state.contextDeleteBypass = true;
  const mod = event.metaKey || event.ctrlKey;
  if(state.structured?.type==='canvas'&&event.key==='Backspace'&&state.structured.deleteCanvasSelection&&!event.target.closest('input,textarea,[contenteditable="true"]')&&state.structured.data.elements.length){const hasSelection=document.querySelector('.canvas-svg .is-selected');if(hasSelection){event.preventDefault();state.structured.deleteCanvasSelection();return;}}
  if(state.structured&&mod&&event.key.toLowerCase()==='z'&&!event.target.closest('.canvas-text-edit')){event.preventDefault();void applyStructuredHistory(event.shiftKey?'redo':'undo');return;}
  if(state.structured&&mod&&event.key.toLowerCase()==='y'){event.preventDefault();void applyStructuredHistory('redo');return;}
  if (mod && !event.shiftKey && (event.key.toLowerCase() === 'f' || (!event.metaKey && event.key.toLowerCase() === 'h'))) {
    event.preventDefault();
    if (state.view && !state.home) openSearchPanel(state.view);
    else openSearch();
    return;
  }
  if (mod && event.key.toLowerCase() === 'k') { event.preventDefault(); void openLinkPicker(); return; }
  if (mod && event.shiftKey && event.key.toLowerCase() === 'f') { event.preventDefault(); openSearch(); return; }
  if (mod && event.key.toLowerCase() === 'n' && event.shiftKey) { event.preventDefault(); createFolder(); }
  else if (mod && event.key.toLowerCase() === 'n') { event.preventDefault(); createNote(); }
  if (mod && event.key.toLowerCase() === 's') { event.preventDefault(); saveActive(); }
  if (mod && event.key.toLowerCase() === 'p') { event.preventDefault(); exportPdf(); }
  if (mod && event.key.toLowerCase() === 'o') { event.preventDefault(); chooseVault(); }
  if (mod && event.key === ',') { event.preventDefault(); openSettings(); }
  if (mod && event.shiftKey && event.key.toLowerCase() === 'a') { event.preventDefault(); setAssistantOpen(!state.assistantOpen); }
});
document.addEventListener('keyup', (event) => { if (event.key === 'Enter') state.contextDeleteBypass = false; });
window.addEventListener('beforeunload', () => { state.assetViewer?.destroy?.(); if (state.dirty && state.active && state.view) window.stillnote.writeNote(state.active, state.view.state.doc.toString()); else if(state.dirty&&state.active&&state.structured)window.stillnote.writeNote(state.active,encodeStructured(state.structured.type,state.structured.title||prettyName(state.active),state.structured.data)); });
window.stillnote.onStorageRecovered((kind) => {
  showToast(kind === 'credentials' ? 'Unreadable credentials backed up. Re-enter your API keys and reconnect Google Tasks in Settings.' : 'Unreadable personal dictionary backed up. You can add words again in Settings.');
});
window.stillnote.onDeepLink(queueDeepLink);
void restoreWorkspace();
