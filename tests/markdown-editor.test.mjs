import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { Table } from '@lezer/markdown';
import { markdownMode, markdownModeExtensions, wikiCompletions } from '../src/markdown-editor.js';
import { syncNoteTitle } from '../electron/note-title.mjs';
import crypto from 'node:crypto';

test('switching Markdown view modes preserves the document and selection', () => {
  const doc = '---\ntags: [example]\n---\n\n# Separate heading\n\n| A | B |\n|-|-|\n| 1 | 2 |';
  let state = EditorState.create({
    doc, selection: { anchor: 7, head: 16 },
    extensions: [markdown({ extensions: Table }), markdownMode.of(markdownModeExtensions('live', []))],
  });
  for (const mode of ['source', 'reading', 'live']) {
    state = state.update({ effects: markdownMode.reconfigure(markdownModeExtensions(mode, [])) }).state;
    assert.equal(state.doc.toString(), doc);
    assert.equal(state.selection.main.anchor, 7);
    assert.equal(state.selection.main.head, 16);
    assert.equal(state.readOnly, mode === 'reading');
    assert.equal(state.facet(EditorView.editable), mode !== 'reading');
  }
});

test('the first line is an accessible H1 in every mode without changing the Markdown', () => {
  for (const mode of ['source', 'reading', 'live']) {
    for (const prefix of ['', '---\ntags: [sample]\n---\n\n']) {
      const doc = prefix + 'Plain title\n\nBody';
      const state = EditorState.create({ doc, extensions: markdownModeExtensions(mode, []) });
      const headings = [];
      for (const decorations of state.facet(EditorView.decorations)) {
        if (typeof decorations === 'function') continue;
        decorations.between(0, state.doc.length, (from, to, decoration) => {
          if (decoration.spec.class === 'cm-note-title') headings.push([from, to, decoration.spec.attributes]);
        });
      }
      assert.deepEqual(headings, [[prefix.length, prefix.length, { role: 'heading', 'aria-level': '1' }]]);
      assert.equal(state.doc.toString(), doc);
    }
  }
});

test('wiki completion inserts the full vault path once and ignores escaped or fenced links', () => {
  const complete = wikiCompletions(() => ['Projects/Plan.md', 'Photo.png', 'Bad[Name].md']);
  const stateFor = doc => EditorState.create({ doc, extensions: markdown() });
  const state = stateFor('[[Pla]]');
  const result = complete({ state, pos: 5 });
  assert.deepEqual(result.options.map(({ label }) => label), ['Projects/Plan', 'Photo.png']);
  const view = { state, dispatch(spec) { this.state = this.state.update(spec).state; } };
  result.options[0].apply(view, result.options[0], result.from, 5);
  assert.equal(view.state.doc.toString(), '[[Projects/Plan]]');
  for (const [doc, pos] of [['\\[[Pla', 6], ['`\x60\x60\n[[Pla\n`\x60\x60', 9]]) {
    assert.equal(complete({ state: stateFor(doc), pos }), null);
  }
});

test('renaming a note updates its title and preserves YAML and body content', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stillnote-markdown-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = await fs.readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  const handlers = new Map();
  const context = vm.createContext({
    fs, path, process, crypto, syncNoteTitle, vaultPath: root,
    ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
    resolveVaultPath: file => path.join(root, file),
    isMarkdown: file => /\.md$/i.test(file),
    safeEntryName: name => name, noteTitleError: () => null,
    assertUniqueEntryName: async () => {}, updateMovedFileLinks: async () => {},
  });
  vm.runInContext(source.slice(source.indexOf("  ipcMain.handle('vault:rename'"), source.indexOf("  ipcMain.handle('vault:delete'")), context);
  const yaml = '---\r\ntags: [sample]\r\n---\r\n\r\n';
  const body = '\r\n\r\n# A body heading\r\n';
  const content = yaml + 'Before' + body;
  await fs.writeFile(path.join(root, 'Before.md'), content);
  assert.equal(await handlers.get('vault:rename')(null, 'Before.md', 'After'), 'After.md');
  assert.equal(await fs.readFile(path.join(root, 'After.md'), 'utf8'), yaml + 'After' + body);
  const edited = yaml + 'Edited' + body + 'New paragraph\r\n';
  assert.equal(await handlers.get('vault:rename')(null, 'After.md', 'Edited.md', edited), 'Edited.md');
  assert.equal(await fs.readFile(path.join(root, 'Edited.md'), 'utf8'), edited);
  await fs.writeFile(path.join(root, 'Taken.md'), 'Taken');
  await assert.rejects(handlers.get('vault:rename')(null, 'Edited.md', 'Taken.md', edited.replace('Edited', 'Taken')), /already exists/);
  assert.equal(await fs.readFile(path.join(root, 'Edited.md'), 'utf8'), edited);
  assert.equal(syncNoteTitle(yaml + 'Legacy paragraph', 'Existing'), yaml + 'Existing\r\n\r\nLegacy paragraph');
});
