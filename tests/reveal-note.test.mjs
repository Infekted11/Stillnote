import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

const main = await fs.readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8');
const renderer = await fs.readFile(new URL('../src/main.js', import.meta.url), 'utf8');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'Stillnote reveal '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const handlers = new Map(), revealed = [];
  const context = vm.createContext({
    fs, path, vaultPath: root,
    isSupportedFile: target => target.endsWith('.md'),
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    fromMainWindow: (event, action) => { assert.equal(event, 'trusted'); return action(); },
    shell: { showItemInFolder: target => revealed.push(target) },
    fetch: () => { throw new Error('Offline'); },
  });
  let start = main.indexOf('function resolveInVault(');
  vm.runInContext(main.slice(start, main.indexOf('function resolveVaultPath(', start)), context);
  start = main.indexOf("  ipcMain.handle('note:reveal'");
  vm.runInContext(main.slice(start, main.indexOf("  ipcMain.handle('note:read'", start)), context);
  return { root, revealed, reveal: id => handlers.get('note:reveal')('trusted', id) };
}

test('offline reveal passes the exact nested saved path, including spaces, to the OS', async t => {
  const f = await fixture(t), id = 'Project notes/November drafts/My note.md';
  await fs.mkdir(path.dirname(path.join(f.root, id)), { recursive: true });
  await fs.writeFile(path.join(f.root, id), '# My note');
  assert.equal((await f.reveal(id)).revealed, true);
  assert.deepEqual(f.revealed, [path.join(f.root, id)]);
});

test('moving or deleting an open note reports the missing file without revealing its folder', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, 'Open.md'), '# Open');
  await fs.rename(path.join(f.root, 'Open.md'), path.join(f.root, 'Moved.md'));
  const moved = await f.reveal('Open.md');
  assert.equal(moved.revealed, false);
  assert.match(moved.message, /can no longer find.*moved or deleted/);
  await fs.rm(path.join(f.root, 'Moved.md'));
  assert.equal((await f.reveal('Moved.md')).revealed, false);
  await fs.mkdir(path.join(f.root, 'Directory.md'));
  assert.equal((await f.reveal('Directory.md')).revealed, false);
  assert.deepEqual(f.revealed, []);
});

test('unsaved IDs and paths outside the vault are rejected', async t => {
  const f = await fixture(t);
  for (const id of [null, undefined, '', ' ']) await assert.rejects(f.reveal(id), /Save this note/);
  await assert.rejects(f.reveal('../Outside.md'), /outside the current vault/);
  assert.deepEqual(f.revealed, []);
});

test('preload forwards the note ID through the existing bridge', async () => {
  const source = await fs.readFile(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  let bridge;
  const calls = [];
  vm.runInNewContext(source, { process: { platform: 'darwin' }, require: () => ({
    contextBridge: { exposeInMainWorld: (_name, api) => { bridge = api; } },
    ipcRenderer: { on() {}, invoke: (...args) => calls.push(args) },
  }) });
  bridge.revealNote('Folder with spaces/Note.md');
  assert.deepEqual(calls, [['note:reveal', 'Folder with spaces/Note.md']]);
});

function menuFixture(id = 'Saved.md') {
  const element = () => ({
    hidden: true, children: [], attributes: {}, style: {}, offsetWidth: 190, offsetHeight: 41,
    setAttribute(name, value) { this.attributes[name] = value; },
    getAttribute(name) { return this.attributes[name]; },
    addEventListener(name, fn) { this[name] = fn; },
    append(child) { this.children.push(child); }, replaceChildren() { this.children = []; }, focus() {},
    getBoundingClientRect: () => ({ right: 500, bottom: 100 }),
  });
  const menu = element(), anchor = element(), messages = [], calls = [];
  const context = vm.createContext({
    state: { active: id, vault: { path: '/vault' }, dirty: true },
    $: selector => selector === '#note-menu-button' ? anchor : menu,
    document: { createElement: element }, showToast: message => messages.push(message),
    window: { innerWidth: 1000, innerHeight: 800, stillnote: { revealNote: async id => { calls.push(id); return { revealed: true }; } } },
  });
  let start = renderer.indexOf('async function revealNote(');
  vm.runInContext(renderer.slice(start, renderer.indexOf('function showExplorerContextMenu(', start)), context);
  start = renderer.indexOf('function closeExplorerContextMenu()');
  vm.runInContext(renderer.slice(start, renderer.indexOf('\n}', start) + 2), context);
  return { context, menu, messages, calls, open: () => context.showActiveNoteMenu({ preventDefault() {}, stopPropagation() {} }) };
}

test('note menu disables unsaved notes but allows saved notes with unsaved edits', () => {
  for (const id of [null, '', ' ']) {
    const f = menuFixture(id); f.open();
    assert.equal(f.menu.children[0].disabled, true);
  }
  const f = menuFixture(); f.open();
  assert.equal(f.menu.children[0].textContent, 'Reveal in File Manager');
  assert.equal(f.menu.children[0].disabled, false);
  f.menu.children[0].click();
  assert.deepEqual(f.calls, ['Saved.md']);
  assert.equal(f.menu.hidden, true);
});

test('renderer displays the missing-file explanation even after the catalog loses the file', async () => {
  const f = menuFixture('Moved.md');
  f.context.state.files = [];
  f.context.window.stillnote.revealNote = async () => ({ revealed: false, message: 'Stillnote can no longer find this file. It may have been moved or deleted outside Stillnote.' });
  f.open(); assert.equal(f.menu.children[0].disabled, false);
  await f.context.revealNote();
  assert.match(f.messages[0], /can no longer find.*moved or deleted/);
});
