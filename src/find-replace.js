import { keymap, runScopeHandlers } from '@codemirror/view';
import { SearchQuery, search, getSearchQuery, setSearchQuery, openSearchPanel, closeSearchPanel, findNext, findPrevious, replaceNext, replaceAll } from '@codemirror/search';

export function searchMatchSummary(state, query = getSearchQuery(state)) {
  if (!query.search) return { count: 0, current: 0, label: 'Type to find', valid: false };
  if (!query.valid) return { count: 0, current: 0, label: 'Invalid expression', valid: false };
  const selection = state.selection.main, cursor = query.getCursor(state);
  let count = 0, current = 0;
  for (let match = cursor.next(); !match.done; match = cursor.next()) {
    if (++count > 10000) return { count, current, label: current ? `${current} of 10,000+` : '10,000+ matches', valid: true };
    if (match.value.from === selection.from && match.value.to === selection.to) current = count;
  }
  return { count, current, label: current ? `${current} of ${count}` : count ? `${count} ${count === 1 ? 'match' : 'matches'}` : 'No matches', valid: true };
}

export function replaceCurrentMatch(view) {
  const query = getSearchQuery(view.state);
  if (!query.valid || view.state.readOnly) return false;
  const { from, to } = view.state.selection.main;
  const cursor = query.getCursor(view.state, from), match = cursor.next();
  if (match.done || match.value.from !== from || match.value.to !== to) {
    if (!findNext(view)) return false;
  }
  return replaceNext(view);
}

export class FindReplacePanel {
  constructor(view, icons = {}) {
    this.view = view;
    this.query = getSearchQuery(view.state);
    const doc = view.dom.ownerDocument;
    const element = (tag, className) => { const node = doc.createElement(tag); node.className = className; return node; };
    const button = (label, content, action, className = '') => {
      const node = element('button', `find-button ${className}`); node.type = 'button'; node.title = label; node.setAttribute('aria-label', label);
      if (content.startsWith('<svg')) node.innerHTML = content; else node.textContent = content;
      node.addEventListener('click', action); return node;
    };
    this.dom = element('form', 'find-replace-panel'); this.dom.setAttribute('role', 'search'); this.dom.setAttribute('aria-label', 'Find and replace in file');
    this.dom.addEventListener('submit', event => event.preventDefault());
    const row = element('div', 'find-row'), field = element('label', 'find-field');
    const icon = element('span', 'find-icon'); icon.innerHTML = icons.search || '';
    this.find = element('input', 'find-input'); this.find.type = 'text'; this.find.placeholder = 'Find in file…'; this.find.setAttribute('aria-label', 'Find in file'); this.find.setAttribute('main-field', 'true'); this.find.autocomplete = 'off'; this.find.spellcheck = false;
    field.append(icon, this.find);
    this.status = element('span', 'find-status'); this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    const options = element('div', 'find-options'); options.setAttribute('role', 'group'); options.setAttribute('aria-label', 'Search options');
    this.options = {};
    for (const [name, label, text] of [['caseSensitive', 'Match case', 'Aa'], ['wholeWord', 'Whole words', 'ab'], ['regexp', 'Regular expression', '.*']]) {
      const control = button(label, text, () => { control.setAttribute('aria-pressed', control.getAttribute('aria-pressed') !== 'true' ? 'true' : 'false'); this.commit(true); }, `find-option find-${name}`);
      this.options[name] = control; options.append(control);
    }
    const navigation = element('div', 'find-navigation');
    this.previous = button('Previous match (Shift+Enter)', icons.down || '↑', () => findPrevious(view), 'find-previous');
    this.next = button('Next match (Enter)', icons.down || '↓', () => findNext(view));
    const close = button('Close find and replace (Esc)', icons.close || '×', () => { closeSearchPanel(view); view.focus(); }, 'find-close');
    navigation.append(this.previous, this.next, close); row.append(field, this.status, options, navigation);
    this.replaceRow = element('div', 'find-replace-row');
    this.replacement = element('input', 'find-replacement'); this.replacement.type = 'text'; this.replacement.placeholder = 'Replace with…'; this.replacement.setAttribute('aria-label', 'Replace with'); this.replacement.autocomplete = 'off'; this.replacement.spellcheck = false;
    this.replace = button('Replace current match (Enter)', 'Replace', () => replaceCurrentMatch(view), 'find-replace-one');
    this.replaceAll = button('Replace all matches', 'Replace all', () => replaceAll(view), 'find-replace-all');
    this.replaceRow.append(this.replacement, this.replace, this.replaceAll); this.dom.append(row, this.replaceRow);
    this.find.addEventListener('input', event => { if (!event.isComposing) this.commit(true); });
    this.find.addEventListener('compositionend', () => this.commit(true));
    this.replacement.addEventListener('input', event => { if (!event.isComposing) this.commit(false); });
    this.replacement.addEventListener('compositionend', () => this.commit(false));
    this.dom.addEventListener('keydown', event => {
      if (event.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeSearchPanel(view); view.focus(); }
      else if (runScopeHandlers(view, event, 'search-panel')) event.preventDefault();
      else if (event.key === 'Enter' && (event.target === this.find || event.target === this.replacement)) {
        event.preventDefault();
        if (event.target === this.find) (event.shiftKey ? findPrevious : findNext)(view);
        else replaceCurrentMatch(view);
      }
    });
    this.setQuery(this.query); this.refresh();
  }
  commit(navigate) {
    const query = new SearchQuery({ search: this.find.value, replace: this.replacement.value, literal: true, ...Object.fromEntries(Object.entries(this.options).map(([key, button]) => [key, button.getAttribute('aria-pressed') === 'true'])) });
    if (query.eq(this.query)) return;
    this.query = query;
    this.view.dispatch({ effects: setSearchQuery.of(query) });
    if (navigate && query.valid) {
      const caret = this.find.ownerDocument.activeElement === this.find ? [this.find.selectionStart, this.find.selectionEnd, this.find.selectionDirection] : null;
      // Start at the current match's beginning so typing a longer query keeps it selected.
      this.view.dispatch({ selection: { anchor: this.view.state.selection.main.from } });
      findNext(this.view);
      // CodeMirror selects the query field after navigation; preserve normal typing here.
      if (caret) this.find.setSelectionRange(...caret);
    }
    this.refresh();
  }
  setQuery(query) {
    this.query = query; this.find.value = query.search; this.replacement.value = query.replace;
    for (const [key, button] of Object.entries(this.options)) button.setAttribute('aria-pressed', String(query[key]));
  }
  refresh() {
    const summary = searchMatchSummary(this.view.state);
    this.status.textContent = summary.label;
    this.find.setAttribute('aria-invalid', String(Boolean(this.query.search) && !this.query.valid));
    this.status.classList.toggle('is-error', Boolean(this.query.search) && !this.query.valid);
    const disabled = !summary.valid || !summary.count;
    this.previous.disabled = this.next.disabled = disabled;
    this.replace.disabled = this.replaceAll.disabled = disabled || this.view.state.readOnly;
    this.replaceRow.hidden = this.view.state.readOnly;
  }
  update(update) {
    const query = getSearchQuery(update.state);
    if (!query.eq(this.query)) this.setQuery(query);
    if (update.docChanged || update.selectionSet || update.transactions.some(transaction => transaction.effects.some(effect => effect.is(setSearchQuery)))) this.refresh();
  }
  mount() { this.find.focus(); this.find.select(); }
  get top() { return true; }
}

export function findReplaceExtension(icons) {
  return [search({ top: true, literal: true, createPanel: view => new FindReplacePanel(view, icons) }), keymap.of([
    { key: 'Mod-Alt-f', run: openSearchPanel, scope: 'editor search-panel' },
    { key: 'Ctrl-h', run: openSearchPanel, scope: 'editor search-panel' },
  ])];
}
