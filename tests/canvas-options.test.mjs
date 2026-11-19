import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
function harness() {
  const listeners = new Map(), windowListeners = new Map();
  const node = (field = false, inside = true) => ({ inside, closest: () => field ? {} : null });
  const body = node(false, false);
  const document = { body, activeElement: body, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const window = { addEventListener: (name, fn) => windowListeners.set(name, fn), removeEventListener: name => windowListeners.delete(name) };
  const context = vm.createContext({ document, window });
  vm.runInContext(source.slice(source.indexOf('function attachCanvasOptionsShortcut('), source.indexOf('function renderCanvas(')), context);
  const root = { isConnected: true, contains: el => el.inside };
  let toggles = 0;
  const cleanup = context.attachCanvasOptionsShortcut(root, () => toggles++);
  const send = (name, props = {}) => listeners.get(name)?.({ key: 'Shift', target: body, ...props });
  const tap = props => { send('keydown', props); send('keyup', props); };
  return { node, document, root, send, tap, cleanup, listeners, windowListeners, toggles: () => toggles };
}

test('tapping Shift toggles once on release and holding it does not repeat', () => {
  const h = harness();
  h.send('keydown'); h.send('keydown', { repeat: true });
  assert.equal(h.toggles(), 0);
  h.send('keyup'); assert.equal(h.toggles(), 1);
  h.tap(); assert.equal(h.toggles(), 2);
});
test('typing targets and focused text fields leave options unchanged', () => {
  const h = harness();
  h.tap({ target: h.node(true) });
  h.document.activeElement = h.node(true);
  h.tap(); assert.equal(h.toggles(), 0);
  h.document.activeElement = h.document.body;
  h.send('keydown'); h.document.activeElement = h.node(true); h.send('keyup');
  assert.equal(h.toggles(), 0);
});
test('Shift-click, Shift shortcuts, modifiers and composition do not toggle', () => {
  const h = harness();
  h.send('keydown'); h.send('pointerdown'); h.send('keyup');
  h.send('keydown'); h.send('keydown', { key: 'A' }); h.send('keyup');
  for (const props of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { defaultPrevented: true }]) h.tap(props);
  assert.equal(h.toggles(), 0);
});
test('shortcuts stay inside the active canvas and listeners are removed on exit', () => {
  const h = harness();
  h.document.activeElement = h.node(false, false); h.tap();
  h.document.activeElement = h.document.body;
  h.send('keydown'); h.windowListeners.get('blur')(); h.send('keyup');
  h.root.isConnected = false; h.tap();
  assert.equal(h.toggles(), 0);
  h.cleanup(); assert.equal(h.listeners.size, 0); assert.equal(h.windowListeners.size, 0);
});
