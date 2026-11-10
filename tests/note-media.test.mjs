import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const mediaSource = await readFile(new URL('../src/media-player.js', import.meta.url), 'utf8');
class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; this.dataset = {}; this.style = {}; this.listeners = {}; this.isConnected = true; this.classList = { add() {} }; if (['AUDIO','VIDEO'].includes(this.tagName)) { this.paused = true; this.currentTime = 0; this.volume = 1; this.muted = false; this.playbackRate = 1; this.duration = NaN; } }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  removeAttribute(key) { delete this.attributes[key]; if (key === 'src') this.src = ''; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  querySelector(selector) {
    if (selector === '.canvas-text-edit') return this.editor ||= new Element('div');
    return this.children.find(child => `.${child.className}` === selector);
  }
  querySelectorAll() { return this.children.flatMap(child => [...(['AUDIO','VIDEO'].includes(child.tagName) ? [child] : []), ...child.querySelectorAll()]); }
  async play() { this.paused = false; this.listeners.play?.(); }
  pause() { this.paused = true; }
  load() { this.reloaded = true; }
}
function harness({ canvas = false, fail = false } = {}) {
  const data = { width: 1200, height: 760, elements: [
    { type: 'stroke', points: [{ x: 5, y: 8 }, { x: 10, y: 20 }] },
    { type: 'shape', shape: 'triangle', x: 10, y: 20, w: 60, h: 40, rotation: 45 },
    { type: 'line', x1: 0, y1: 0, x2: 50, y2: 70, endMarker: 'arrow' },
    { type: 'text', x: 5, y: 6, text: 'Hello' },
  ] };
  const context = vm.createContext({
    structuredClone,
    document: { createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag) },
    WidgetType: class {}, fileExtension: file => file.split('.').pop(), prettyName: file => file,
    findExplorerNode: () => ({ format: canvas ? 'canvas' : 'asset' }), state: { theme: 'light' },
    sheetCellHtml: text => text, setStructuredDirty() { throw new Error('Preview changed the active note'); },
    window: { stillnote: {
      readNote: async () => { if (fail) throw new Error('Missing'); return `<!-- stillnote:type=canvas -->\n\`\`\`stillnote-canvas\n${JSON.stringify(data)}\n\`\`\``; },
      readAsset: async () => { if (fail) throw new Error('Missing'); return { mime: 'video/mp4', data: 'data:video/mp4;base64,AAAA' }; },
    } },
  });
  vm.runInContext(mediaSource.replace(/export /g, '') + '\n' + source.slice(source.indexOf('const playableMediaExtensions'), source.indexOf('const taskPreviewCache')) +
    source.slice(source.indexOf('function decodeStructured'), source.indexOf('function canvasDefaults')) +
    source.slice(source.indexOf('function spreadsheetCellValue('), source.indexOf('function sheetCellHtml(')) +
    source.slice(source.indexOf('function isCanvasImageFile'), source.indexOf('function renderCanvas(')) +
    '\nglobalThis.Widget = WikiMediaWidget; globalThis.dispose = disposeMediaPlayers;', context);
  return context;
}
const flush = () => new Promise(resolve => setImmediate(resolve));
test('linked canvas renders its shapes, strokes, arrows and rotated text without editing controls', async () => {
  const context = harness({ canvas: true }); let measures = 0;
  const preview = new context.Widget('Canvas.md', 0, 13).toDOM({ requestMeasure() { measures++; } });
  await flush();
  const drawing = preview.children[1];
  assert.equal(drawing.tagName, 'SVG');
  assert.equal(drawing.attributes.viewBox, '0 0 1200 760');
  assert.equal(drawing.children.length, 4);
  assert.match(drawing.children[1].attributes.transform, /rotate\(45/);
  assert.equal(drawing.children[2].children.length, 2);
  const text = drawing.children[3].editor;
  assert.equal(text.contentEditable, 'false');
  assert.deepEqual(Object.keys(text.listeners), []);
  assert.equal(measures, 1);
});
test('linked video has controls and releases playback when the widget is destroyed', async () => {
  const context = harness(); const widget = new context.Widget('Clip.mp4', 0, 12);
  const preview = widget.toDOM({ requestMeasure() {} }); await flush();
  const shell = preview.children[1], player = shell.media;
  assert.equal(player.tagName, 'VIDEO'); assert.equal(player.controls, false);
  assert.equal(player.preload, 'metadata'); assert.equal(player.playsInline, true);
  player.listeners.error();
  assert.match(shell.children.at(-1).textContent, /codec/);
  widget.destroy(preview);
  assert.equal(player.paused, true); assert.equal(player.src, ''); assert.equal(player.reloaded, true);
});
test('missing canvas shows a useful error and preserves the edit link button', async () => {
  const context = harness({ canvas: true, fail: true });
  const preview = new context.Widget('Missing.md', 0, 14).toDOM({ requestMeasure() {} }); await flush();
  assert.equal(preview.children[0].textContent, 'Edit link');
  assert.match(preview.children[1].textContent, /Preview unavailable/);
});
test('audio player uses custom controls without autoplay', () => {
  const context = harness(); const host = new Element('span');
  const player = context.createMediaPlayer({ mime: 'audio/mpeg', data: 'data:audio/mpeg;base64,AAAA' }, 'Song.mp3', host);
  assert.equal(player.media.tagName, 'AUDIO'); assert.equal(player.media.controls, false); assert.equal(player.media.autoplay, undefined);
});

test('canvas images start at the bottom, fit the canvas, and survive save/reload', () => {
  const context = harness();
  const stroke = { type: 'stroke', points: [{ x: 1, y: 2 }] };
  const data = { width: 1200, height: 760, elements: [stroke] };
  const image = context.insertCanvasImage(data, 'data:image/png;base64,AAAA', 2400, 1200, 'Photo.png');
  assert.equal(data.elements[0], image); assert.equal(data.elements[1], stroke);
  assert.equal(image.w / image.h, 2);
  assert(image.w <= 1200 && image.h <= 760);
  const reloaded = JSON.parse(JSON.stringify(data));
  const drawing = new Element('svg');
  context.drawCanvasElements(drawing, reloaded, color => color, new Set(), true);
  assert.equal(drawing.children[0].tagName, 'IMAGE');
  assert.equal(drawing.children[0].attributes.href, image.src);
  assert.equal(drawing.children[0].attributes.preserveAspectRatio, 'xMidYMid meet');
  assert.equal(drawing.children[1].tagName, 'POLYLINE');
  const newer = context.insertCanvasImage(data, 'data:image/jpeg;base64,BBBB', 200, 100, 'Second.jpg');
  assert.equal(data.elements[0], newer); assert.equal(data.elements[1], image);
});
test('canvas image transforms render and external image sources are not loaded', () => {
  const context = harness(); const drawing = new Element('svg');
  const data = { elements: [{ type: 'image', src: 'https://example.com/image.png', x: 5, y: 10, w: 100, h: 50, rotation: 90 }] };
  context.drawCanvasElements(drawing, data, color => color, new Set(), true);
  assert.equal(drawing.children[0].attributes.href, undefined);
  assert.equal(drawing.children[0].attributes.transform, 'rotate(90 55 35)');
});

test('vault image references follow file and folder moves in saved canvas data', async () => {
  const { createRequire } = await import('node:module');
  const { rewriteLinks } = createRequire(import.meta.url)('../electron/file-links.cjs');
  const canvas = { elements: [{ type: 'image', link: '<[Photos/Summer day.png]>', src: 'data:image/png;base64,AAAA', x: 0, y: 0, w: 50, h: 50 }] };
  let saved = `<!-- stillnote:type=canvas -->\n\`\`\`stillnote-canvas\n${JSON.stringify(canvas, null, 2)}\n\`\`\``;
  saved = rewriteLinks(saved, [['Photos/Summer day.png', 'Pictures/Summer day.png']]);
  saved = rewriteLinks(saved, [['Pictures/Summer day.png', 'Pictures/Garden.png']]);
  const context = harness(); const decoded = context.decodeStructured(saved);
  assert.equal(decoded.data.elements[0].link, '<[Pictures/Garden.png]>');
  assert.equal(decoded.data.elements[0].src, canvas.elements[0].src);
});
test('linked canvas images retain their saved copy if the original is deleted', async () => {
  const context = harness({ fail: true }); const drawing = new Element('svg');
  const src = 'data:image/png;base64,AAAA';
  context.drawCanvasElements(drawing, { elements: [{ type: 'image', link: '<[Deleted.png]>', src, x: 0, y: 0, w: 100, h: 50 }] }, color => color, new Set(), true);
  await flush();
  assert.equal(drawing.children[0].attributes.href, src);
});
test('linked canvas images resolve their latest vault source', async () => {
  const context = harness();
  context.window.stillnote.readAsset = async file => ({ mime: 'image/png', data: `data:image/png;base64,${file}` });
  const drawing = new Element('svg');
  context.drawCanvasElements(drawing, { elements: [{ type: 'image', link: '<[Current.png]>', src: 'data:image/png;base64,OLD', x: 0, y: 0, w: 100, h: 50 }] }, color => color, new Set(), true);
  await flush();
  assert.equal(drawing.children[0].attributes.href, 'data:image/png;base64,Current.png');
});
test('renaming linked images to filenames containing quotes preserves canvas JSON', async () => {
  const { createRequire } = await import('node:module');
  const { rewriteLinks } = createRequire(import.meta.url)('../electron/file-links.cjs');
  const data = { elements: [{ type: 'image', link: '<[Photos/Original.png]>', src: 'data:image/png;base64,AAAA' }] };
  const source = '```stillnote-canvas\n' + JSON.stringify(data) + '\n```';
  const updated = rewriteLinks(source, [['Photos/Original.png', 'Photos/My "garden".png']]);
  const parsed = JSON.parse(updated.split('\n').slice(1, -1).join('\n'));
  assert.equal(parsed.elements[0].link, '<[Photos/My "garden".png]>');
});

test('canvas text focus and input keep the editor node and multiline content intact', () => {
  const context = harness(); let edits = 0, focused;
  context.setStructuredDirty = () => edits++;
  const data = { elements: [{ type: 'text', x: 0, y: 0, text: 'First line\nSecond line' }] };
  const drawing = new Element('svg');
  context.drawCanvasElements(drawing, data, color => color, new Set(), false, index => { focused = index; });
  const editor = drawing.children[0].editor;
  editor.innerText = data.elements[0].text;
  assert.equal(editor.contentEditable, 'false');
  editor.listeners.focus();
  assert.equal(editor.contentEditable, 'true');
  assert.equal(focused, 0);
  editor.innerText = 'Edited first line\n\nThird line';
  editor.listeners.input();
  editor.listeners.blur();
  assert.equal(editor.contentEditable, 'false');
  assert.equal(data.elements[0].text, 'Edited first line\n\nThird line');
  assert.equal(drawing.children[0].editor, editor);
  assert.equal(edits, 1);
  assert.match(editor.innerHTML, /\n\n/);
});
test('canvas text paste inserts plain text through the browser editing history', () => {
  const context = harness(); const calls = [];
  context.document.execCommand = (...args) => calls.push(args);
  const drawing = new Element('svg');
  context.drawCanvasElements(drawing, { elements: [{ type: 'text', x: 0, y: 0, text: '' }] }, color => color);
  let prevented = false;
  drawing.children[0].editor.listeners.paste({ preventDefault() { prevented = true; }, stopPropagation() {}, clipboardData: { getData: type => type === 'text/plain' ? 'Pasted\ntext' : '<b>Pasted</b>' } });
  assert.equal(prevented, true);
  assert.deepEqual(calls, [['insertText', false, 'Pasted\ntext']]);
});

test('single rotated selection frame stays aligned with the object', () => {
  const context = harness();
  for (const rotation of [0, 15, 45, 90, 180, -30, 370]) {
    const frame = context.canvasSelectionFrame([{ type: 'image', x: 100, y: 200, w: 120, h: 60, rotation }], rotation);
    assert(Math.abs(frame.x - 100) < 1e-9);
    assert(Math.abs(frame.y - 200) < 1e-9);
    assert(Math.abs(frame.w - 120) < 1e-9);
    assert(Math.abs(frame.h - 60) < 1e-9);
    assert.equal(frame.rotation, rotation);
  }
});
test('rotating multiple objects keeps the selection frame dimensions and center', () => {
  const context = harness();
  const elements = [{ type: 'shape', x: 10, y: 20, w: 100, h: 50 }, { type: 'text', x: 180, y: 80, w: 80, h: 40 }];
  const original = context.canvasSelectionFrame(elements);
  const angle = Math.PI / 3, { x: cx, y: cy } = original.center;
  const rotated = elements.map(el => {
    const dx = el.x+el.w/2-cx, dy = el.y+el.h/2-cy;
    return { ...el, x: cx+dx*Math.cos(angle)-dy*Math.sin(angle)-el.w/2, y: cy+dx*Math.sin(angle)+dy*Math.cos(angle)-el.h/2, rotation: 60 };
  });
  const frame = context.canvasSelectionFrame(rotated, 60);
  for (const key of ['x','y','w','h']) assert(Math.abs(frame[key]-original[key]) < 1e-9);
});
test('freehand strokes and lines participate in a rotated selection frame', () => {
  const context = harness();
  const frame = context.canvasSelectionFrame([{ type: 'stroke', points: [{ x: 10, y: 10 }, { x: 10, y: 110 }] }, { type: 'line', x1: 50, y1: 10, x2: 50, y2: 110 }], 90);
  assert(Math.abs(frame.w-100) < 1e-9);
  assert(Math.abs(frame.h-40) < 1e-9);
});

test('duplicate selection offsets independent copies and preserves stacking, rotation, and image links', () => {
  const context = harness();
  const data = { elements: [
    { type: 'image', x: 10, y: 20, w: 100, h: 60, rotation: 45, link: '<[Photo.png]>', src: 'data:image/png;base64,AAAA' },
    { type: 'stroke', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] },
    { type: 'line', x1: 10, y1: 20, x2: 30, y2: 40 },
    { type: 'text', x: 5, y: 6, text: 'Hello' },
  ] };
  const selected = context.duplicateCanvasElements(data, new Set([3, 2, 1, 0]));
  assert.deepEqual([...selected], [4, 5, 6, 7]);
  assert.equal(data.elements[4].x, 34); assert.equal(data.elements[4].rotation, 45);
  assert.equal(data.elements[4].link, '<[Photo.png]>');
  assert.equal(data.elements[5].points[0].x, 25);
  assert.equal(data.elements[6].x2, 54);
  assert.equal(data.elements[7].text, 'Hello');
  data.elements[5].points[0].x = 999;
  assert.equal(data.elements[1].points[0].x, 1);
  assert.equal(data.elements[0].x, 10);
});

test('spreadsheet preview trims trailing empty rows and columns, counting zeros and formulas', () => {
  const context = harness();
  const size = context.spreadsheetPreviewSize({ rows: 20, columns: 8, cells: { A1: 'Name', B2: '0', D7: '=A2+1', H20: '   ', A2: '2' } });
  assert.equal(size.rows, 7); assert.equal(size.columns, 4);
  const empty = context.spreadsheetPreviewSize({ cells: { Z99: '', A1: ' ' } });
  assert.equal(empty.rows, 0); assert.equal(empty.columns, 0);
});
test('spreadsheet cell endpoint renders exactly A1 through the requested address', () => {
  const context = harness();
  const data = { cells: { A1: 'Title', B2: '=C9*2', C9: '3', D20: 'Outside' } };
  const scroll = context.renderSpreadsheetPreview(data, 'b3', 'Budget.md');
  const table = scroll.children[0], rows = table.children[0].children;
  assert.equal(rows.length, 3); assert.equal(rows[0].children.length, 2);
  assert.equal(rows[1].children[1].textContent, '6');
  assert.equal(rows[0].children[0].tagName, 'TH');
  assert.equal(rows[1].children[0].attributes.scope, 'row');
  assert.equal(rows[1].children[1].tagName, 'TD');
  assert.equal(rows[2].children[1].dataset.cell, 'B3');
  assert.equal(rows[2].children[1].textContent, '');
});
test('spreadsheet previews support multi-letter endpoints and report invalid or excessive ranges', () => {
  const context = harness();
  assert.equal(context.spreadsheetPreviewSize({ cells: {} }, 'AA10').columns, 27);
  assert.throws(() => context.spreadsheetPreviewSize({ cells: {} }, 'A0'), /cell address/);
  assert.throws(() => context.spreadsheetPreviewSize({ cells: {} }, 'A1:C3'), /cell address/);
  assert.throws(() => context.spreadsheetPreviewSize({ cells: {} }, 'ZZ9999999'), /too large/);
  assert.equal(context.renderSpreadsheetPreview({ cells: {} }, '', 'Empty.md').textContent, 'Empty spreadsheet');
});
test('spreadsheet widget reads structured text and distinguishes cell extents', async () => {
  const context = harness();
  context.findExplorerNode = () => ({ format: 'spreadsheet' });
  context.window.stillnote.readNote = async () => '<!-- stillnote:type=spreadsheet -->\n```stillnote-spreadsheet\n' + JSON.stringify({ cells: { A1: 'Item', B2: '10' } }) + '\n```';
  const widget = new context.Widget('Budget.md', 0, 20, 'B2');
  const preview = widget.toDOM({ requestMeasure() {} }); await flush();
  assert.match(preview.className, /is-spreadsheet/);
  assert.equal(preview.children[1].children[0].tagName, 'TABLE');
  assert.equal(widget.eq(new context.Widget('Budget.md', 0, 20, 'C4')), false);
  assert.equal(widget.eq(new context.Widget('Budget.md', 0, 20, 'B2')), true);
});

test('two-cell spreadsheet links show only the requested inclusive rectangle', () => {
  const context = harness();
  const data = { cells: { A1: 'Outside', A5: 'Start', D8: '=D9*2', D9: '6' } };
  const preview = context.renderSpreadsheetPreview(data, 'a5,d8', 'Budget.md');
  const rows = preview.children[0].children[0].children;
  assert.equal(rows.length, 4); assert.equal(rows[0].children.length, 4);
  assert.equal(rows[0].children[0].dataset.cell, 'A5');
  assert.equal(rows[0].children[0].textContent, 'Start');
  assert.equal(rows[3].children[3].dataset.cell, 'D8');
  assert.equal(rows[3].children[3].textContent, '12');
  assert.equal(rows[0].children[1].attributes.scope, 'col');
  assert.equal(rows[1].children[0].attributes.scope, 'row');
});
test('two-cell spreadsheet ranges support a single cell, offset columns, and whitespace', () => {
  const context = harness();
  const size = context.spreadsheetPreviewSize({ cells: {} }, ' B5 , D8 ');
  assert.equal(size.startRow, 4); assert.equal(size.startColumn, 1);
  assert.equal(size.rows, 4); assert.equal(size.columns, 3);
  const single = context.spreadsheetPreviewSize({ cells: {} }, 'C7,C7');
  assert.equal(single.rows, 1); assert.equal(single.columns, 1);
  for (const range of ['D8,A5','A8,D5','A5,','A5,D8,E9']) assert.throws(() => context.spreadsheetPreviewSize({ cells: {} }, range));
});

test('custom player plays, pauses, seeks, adjusts volume, and changes speed', async () => {
  const context = harness(), shell = context.createMediaPlayer({ mime: 'video/mp4', data: 'data:video/mp4;base64,AAAA' }, 'Clip.mp4');
  const media = shell.media, controls = shell.children[2];
  const [play,time,seek,mute,volume] = controls.children;
  const speed = shell.children[3].children[1].children[0];
  assert.equal(seek.disabled, true);
  media.duration = 125; media.listeners.loadedmetadata();
  assert.equal(seek.disabled, false); assert.equal(time.textContent, '0:00 / 2:05');
  await play.listeners.click(); assert.equal(media.paused, false); assert.equal(play.attributes['aria-label'], 'Pause');
  play.listeners.click(); assert.equal(media.paused, true);
  seek.value = 60; seek.listeners.input(); assert.equal(media.currentTime, 60);
  assert.equal(time.textContent, '1:00 / 2:05');
  mute.listeners.click(); assert.equal(media.muted, true); assert.equal(mute.attributes['aria-pressed'], 'true');
  volume.value = .5; volume.listeners.input(); assert.equal(media.volume, .5); assert.equal(media.muted, false);
  speed.value = '1.5'; speed.listeners.change(); assert.equal(media.playbackRate, 1.5);
});
test('custom player reports failed playback and unsupported media without native controls', async () => {
  const context = harness(), shell = context.createMediaPlayer({ mime: 'audio/mpeg', data: 'bad' }, 'Track.mp3');
  shell.media.play = async () => { throw new Error('Unsupported'); };
  await shell.children[2].children[0].listeners.click();
  assert.equal(shell.children.at(-1).hidden, false);
  assert.match(shell.children.at(-1).textContent, /Playback could not start/);
  assert.equal(shell.media.controls, false);
});
test('custom media time supports hours and unknown durations', () => {
  const context = harness();
  assert.equal(context.mediaTime(3665), '1:01:05'); assert.equal(context.mediaTime(NaN), '0:00');
});

test('custom player keyboard seeking clamps to the media duration and ignores form controls', () => {
  const context = harness(), shell = context.createMediaPlayer({ mime: 'audio/mpeg', data: 'data:audio/mpeg;base64,AAAA' }, 'Song.mp3');
  shell.media.duration = 10; shell.media.currentTime = 8;
  const event = { key: 'ArrowRight', target: { closest: () => null }, preventDefault() {}, stopPropagation() {} };
  shell.listeners.keydown(event); assert.equal(shell.media.currentTime, 10);
  event.key = 'ArrowLeft'; shell.listeners.keydown(event); assert.equal(shell.media.currentTime, 5);
  event.target.closest = () => ({}); shell.listeners.keydown(event); assert.equal(shell.media.currentTime, 5);
});
test('video fullscreen control toggles the complete custom player', async () => {
  const context = harness(), shell = context.createMediaPlayer({ mime: 'video/mp4', data: 'data:video/mp4;base64,AAAA' }, 'Clip.mp4');
  let entered = 0, exited = 0;
  shell.requestFullscreen = async () => { entered++; context.document.fullscreenElement = shell; };
  context.document.exitFullscreen = async () => { exited++; context.document.fullscreenElement = null; };
  const button = shell.children[2].children.at(-1);
  await button.listeners.click(); await button.listeners.click();
  assert.equal(entered, 1); assert.equal(exited, 1);
});

test('embedded audio and video omit speed settings and load the per-file playback speed', () => {
  const context = harness();
  context.localStorage = { getItem: key => key === 'stillnote-media-speed:Vault/Song.mp3' ? '1.5' : '2' };
  for (const mime of ['audio/mpeg','video/mp4']) {
    const shell = context.createMediaPlayer({ mime, data: 'data:media;base64,AAAA' }, 'Song.mp3', { embedded: true, settingsKey: 'Vault/Song.mp3' });
    assert.match(shell.className, /is-embedded/);
    assert.equal(shell.children.some(child => child.className === 'media-player-settings'), false);
    assert.equal(shell.children[2].children.some(child => child.tagName === 'SELECT'), false);
    assert.equal(shell.media.playbackRate, 1.5);
  }
});
test('file playback settings persist speed for subsequent note embeds', () => {
  const context = harness(), saved = new Map();
  context.localStorage = { getItem: key => saved.get(key), setItem: (key,value) => saved.set(key,value) };
  const asset = { mime: 'audio/mpeg', data: 'data:audio/mpeg;base64,AAAA' };
  const shell = context.createMediaPlayer(asset, 'Song.mp3', { settingsKey: 'Vault/Song.mp3' });
  const settings = shell.children[3], speed = settings.children[1].children[0];
  assert.equal(settings.tagName, 'DETAILS');
  speed.value = '1.25'; speed.listeners.change();
  assert.equal(saved.get('stillnote-media-speed:Vault/Song.mp3'), '1.25');
  const embed = context.createMediaPlayer(asset, 'Song.mp3', { embedded: true, settingsKey: 'Vault/Song.mp3' });
  assert.equal(embed.media.playbackRate, 1.25);
  const other = context.createMediaPlayer(asset, 'Song.mp3', { embedded: true, settingsKey: 'Other/Song.mp3' });
  assert.equal(other.media.playbackRate, 1);
});
