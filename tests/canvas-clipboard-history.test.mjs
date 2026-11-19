import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
function harness(extras = {}) {
  const listeners = new Map();
  const document = { body: {}, activeElement: null, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  document.activeElement = document.body;
  const context = vm.createContext({ structuredClone, document, ...extras });
  vm.runInContext(source.slice(source.indexOf('function canvasElementBounds('), source.indexOf('function insertCanvasImage(')) +
    source.slice(source.indexOf('function canvasViewport('), source.indexOf('function attachCanvasOptionsShortcut(')), context);
  return { context, document, listeners };
}
const objects = [
  { type:'stroke', points:[{x:10,y:20},{x:30,y:40}], color:'#397dc2' },
  { type:'line', x1:5, y1:10, x2:70, y2:80, endMarker:'diamond' },
  { type:'text', x:20, y:40, w:220, h:60, text:'Hello', rotation:30 },
  { type:'image', x:0, y:0, w:50, h:50, src:'data:image/png;base64,AAAA', link:'<[Photo.png]>' },
];
test('clipboard objects preserve styles, image data and relative placement without mutating the originals', () => {
  const {context:c} = harness();
  const original = JSON.stringify(objects);
  const decoded = c.readCanvasClipboard(JSON.stringify({type:'stillnote-canvas', version:1, elements:objects}));
  const data = {elements:[]};
  assert.equal(c.placeCanvasElements(data, decoded, {x:200,y:300}).size, 4);
  const dx = data.elements[0].points[0].x-10, dy = data.elements[0].points[0].y-20;
  assert.equal(data.elements[1].x1, 5+dx); assert.equal(data.elements[1].y2, 80+dy);
  assert.equal(data.elements[2].rotation, 30); assert.equal(data.elements[2].x, 20+dx);
  assert.equal(data.elements[3].link, '<[Photo.png]>'); assert.equal(data.elements[3].src, objects[3].src);
  assert.equal(JSON.stringify(objects), original);
  for (const text of ['Hello', '{}', '{broken', JSON.stringify({type:'stillnote-canvas',version:1,elements:[{type:'stroke',points:[]}]})]) assert.equal(c.readCanvasClipboard(text), null);
});
test('copy, cut and paste use the system clipboard and leave text fields and other panes alone', async () => {
  const {context:c, document, listeners} = harness();
  const root = {isConnected:true, contains:node => node?.inside};
  let cuts = 0; const pastes = [];
  const cleanup = c.attachCanvasClipboard(root, {copy:()=>objects, cut:()=>cuts++, paste:payload=>pastes.push(payload)});
  let text = '', prevented = 0;
  const clipboardData = {setData:(_,value)=>text=value, getData:()=>text, files:[]};
  const event = type => ({type, target:document.body, clipboardData, preventDefault:()=>prevented++});
  listeners.get('copy')(event('copy')); listeners.get('paste')(event('paste'));
  assert.equal(pastes[0].elements.length, 4);
  listeners.get('cut')(event('cut')); assert.equal(cuts, 1);
  text = 'Pasted plain text'; listeners.get('paste')(event('paste'));
  assert.equal(pastes[1].text, text); assert.equal(pastes[1].elements, null);
  text = ''; clipboardData.files = [{type:'image/png'}]; listeners.get('paste')(event('paste'));
  assert.equal(pastes[2].image.type, 'image/png');
  const before = prevented;
  document.activeElement = {inside:true, closest:()=>({})}; listeners.get('copy')(event('copy')); listeners.get('paste')(event('paste'));
  document.activeElement = {inside:false}; listeners.get('paste')(event('paste'));
  document.activeElement = document.body; root.isConnected = false; listeners.get('cut')(event('cut'));
  assert.equal(prevented, before); assert.equal(cuts, 1);
  cleanup(); assert.equal(listeners.size, 0);
});
test('viewport restoration keeps world coordinates when undo shrinks bounds or changes the origin', () => {
  const {context:c} = harness();
  for (const [x,y] of [[950,700],[-450,-350]]) {
    const old = {originX:-600,originY:-500};
    const surface = {scrollLeft:x+600,scrollTop:y+500,clientWidth:800,clientHeight:600};
    const view = c.canvasViewport(surface,old);
    const data = {originX:0,originY:0,width:1200,height:760,elements:[]};
    c.restoreCanvasViewport(surface,data,view,box=>c.expandCanvasBounds(data,box));
    assert.equal(surface.scrollLeft+data.originX,x); assert.equal(surface.scrollTop+data.originY,y);
    assert(data.width-surface.clientWidth >= surface.scrollLeft);
    assert(data.height-surface.clientHeight >= surface.scrollTop);
  }
});
test('undo and redo both carry the viewport through editor replacement', async () => {
  const {context:c} = harness({clearTimeout, setTimeout:()=>0});
  const view = {x:-400,y:900,w:800,h:600};
  let restores = 0;
  const data = {elements:objects};
  c.state = {active:'Drawing.md', structured:{type:'canvas',title:'Drawing',data,undoStack:[JSON.stringify({title:'Drawing',data:{elements:[]}})],redoStack:[],getCanvasViewport:()=>view}};
  c.prettyName = ()=>'Drawing'; c.$ = ()=>({textContent:''}); c.saveActive = ()=>{}; c.updateStructuredHistoryButtons = ()=>{};
  c.renderStructured = (type,data,file,title)=>{c.state.structured = {type,data,title,getCanvasViewport:()=>view,restoreCanvasViewport:restored=>{assert.equal(restored,view);restores++;}};};
  vm.runInContext(source.slice(source.indexOf('async function applyStructuredHistory('),source.indexOf('function renderStructured(')),c);
  await c.applyStructuredHistory('undo'); assert.equal(c.state.structured.data.elements.length,0);
  await c.applyStructuredHistory('redo'); assert.equal(c.state.structured.data.elements.length,4);
  assert.equal(restores,2);
  assert.equal(c.state.structured.historySnapshot,JSON.stringify({title:'Drawing',data}));
});
