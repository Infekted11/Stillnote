import { noteTitleLine } from '../electron/note-title.mjs';
import { Compartment, EditorState, StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';

export const markdownMode = new Compartment();
export const isReading = view => view.state.readOnly;

export function markdownModeExtensions(mode, livePreview) {
  return [
    mode === 'source' ? [] : [livePreview, markdownBlocks],
    markdownTitle,
    EditorState.readOnly.of(mode === 'reading'),
    EditorView.editable.of(mode !== 'reading'),
    EditorView.editorAttributes.of({ 'data-markdown-mode': mode }),
    EditorView.contentAttributes.of(mode === 'reading' ? { 'aria-label': 'Note reading view', tabindex: '0' } : { 'aria-label': 'Markdown editor' }),
  ];
}

class MarkdownTable extends WidgetType {
  constructor(rows) { super(); this.rows = rows; }
  eq(other) { return JSON.stringify(this.rows) === JSON.stringify(other.rows); }
  toDOM(view) {
    const container = document.createElement('div');
    container.className = 'cm-markdown-table';
    const table = document.createElement('table');
    for (const [index, values] of this.rows.entries()) {
      const row = document.createElement('tr');
      for (const value of values) {
        const cell = document.createElement(index ? 'td' : 'th');
        cell.textContent = value;
        row.append(cell);
      }
      table.append(row);
    }
    container.append(table);
    if (!view.state.readOnly) container.addEventListener('mousedown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      view.dispatch({ selection: { anchor: view.posAtDOM(container) }, scrollIntoView: true });
      view.focus();
    });
    return container;
  }
}

class MarkdownProperties extends WidgetType {
  constructor(text) { super(); this.text = text; }
  eq(other) { return this.text === other.text; }
  toDOM() {
    const properties = document.createElement('details');
    properties.className = 'cm-markdown-properties';
    const summary = document.createElement('summary');
    summary.textContent = 'Properties';
    const source = document.createElement('pre');
    source.textContent = this.text;
    properties.append(summary, source);
    return properties;
  }
}

function frontmatterEndLine(doc) {
  if (!/^\uFEFF?---[ \t]*$/.test(doc.line(1).text)) return 0;
  for (let number = 2; number <= doc.lines; number++) {
    if (/^---[ \t]*$/.test(doc.line(number).text)) return number;
  }
  return 0;
}

function titleDecoration(state) {
  const { doc } = state;
  const number = noteTitleLine(doc);
  if (number > doc.lines) return Decoration.none;
  return Decoration.set([Decoration.line({
    class: 'cm-note-title', attributes: { role: 'heading', 'aria-level': '1' },
  }).range(doc.line(number).from)]);
}

const markdownTitle = StateField.define({
  create: titleDecoration,
  update: (decorations, transaction) => transaction.docChanged ? titleDecoration(transaction.state) : decorations,
  provide: field => EditorView.decorations.from(field),
});

function blockDecorations(state) {
  const ranges = [];
  const touched = (from, to) => !state.readOnly && state.selection.ranges.some(range => range.from <= to && range.to >= from);
  const end = frontmatterEndLine(state.doc);
  const frontmatterEnd = end ? state.doc.line(end).to : 0;
  if (end && !touched(0, frontmatterEnd)) {
    const source = state.sliceDoc(state.doc.line(2).from, state.doc.line(end).from).trimEnd();
    ranges.push(Decoration.replace({ widget: new MarkdownProperties(source), block: true, inclusive: false }).range(0, frontmatterEnd));
  }
  syntaxTree(state).iterate({ enter(ref) {
    if (ref.name !== 'Table' || ref.node.parent?.name !== 'Document') return;
    const from = state.doc.lineAt(ref.from).from, to = state.doc.lineAt(ref.to).to;
    if (from < frontmatterEnd || touched(from, to)) return false;
    const table = ref.node;
    const rows = [table.getChild('TableHeader'), ...table.getChildren('TableRow')].map(row => {
      const values = [];
      let start = row.from;
      for (const delimiter of row.getChildren('TableDelimiter')) {
        if (delimiter.from !== row.from) values.push(state.sliceDoc(start, delimiter.from).trim());
        start = delimiter.to;
      }
      if (start < row.to) values.push(state.sliceDoc(start, row.to).trim());
      return values.map(value => value.replace(/\\\|/g, '|'));
    });
    ranges.push(Decoration.replace({ widget: new MarkdownTable(rows), block: true, inclusive: false }).range(from, to));
    return false;
  } });
  return Decoration.set(ranges);
}
const markdownBlocks = StateField.define({
  create: blockDecorations,
  update(decorations, transaction) {
    return transaction.docChanged || transaction.selection || transaction.startState.readOnly !== transaction.state.readOnly || syntaxTree(transaction.startState) !== syntaxTree(transaction.state)
      ? blockDecorations(transaction.state) : decorations;
  },
  provide: field => EditorView.decorations.from(field),
});

export function markdownCodeAt(state, position) {
  for (let node = syntaxTree(state).resolveInner(position, -1); node; node = node.parent) {
    if (['InlineCode', 'FencedCode', 'CodeBlock'].includes(node.name)) return true;
  }
  return false;
}

export function wikiCompletions(getFiles) {
  return context => {
    const line = context.state.doc.lineAt(context.pos);
    const match = /(?:^|[^\\])\[\[([^\[\]\n|#]*)$/.exec(line.text.slice(0, context.pos - line.from));
    if (!match || markdownCodeAt(context.state, context.pos)) return null;
    return {
      from: context.pos - match[1].length,
      options: getFiles().filter(path => !/[\[\]|#\n]/.test(path)).map(path => ({
        label: path.replace(/\.md$/i, ''),
        type: 'text',
        apply(view, option, from, to) {
          const closing = /^\]{1,2}/.exec(view.state.sliceDoc(to, to + 2))?.[0].length ?? 0;
          const insert = option.label + ']]';
          view.dispatch({ changes: { from, to: to + closing, insert }, selection: { anchor: from + insert.length } });
        },
      })),
      validFor: /^[^\[\]\n|#]*$/,
    };
  };
}
