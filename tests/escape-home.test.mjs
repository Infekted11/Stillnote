import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
const start=source.indexOf('function handleAppEscape(event) {');
const code=source.slice(start,source.indexOf("document.addEventListener('keydown'",start));
function fixture(){
  const elements=new Map(),queries=new Map(),calls=[];
  const $=id=>{if(!elements.has(id))elements.set(id,{hidden:true,setAttribute(){},classList:{contains:()=>false}});return elements.get(id);};
  const state={active:'Note.md',home:false,assistantOpen:false},document={fullscreenElement:null,querySelector:selector=>queries.get(selector)||null,querySelectorAll:selector=>queries.get(selector)||[]};
  const context=vm.createContext({$,state,document,searchPanelOpen:()=>false,...Object.fromEntries(['finishRenameDialog','finishDeleteDialog','closeLinkPicker','closeSearch','closeSettings','closeExplorerContextMenu','closeEditorContextMenu','setAssistantOpen','openHome'].map(name=>[name,()=>calls.push(name)]))});
  vm.runInContext(code,context);
  const event={defaultPrevented:false,isComposing:false,repeat:false,target:{closest:()=>null},preventDefault(){this.defaultPrevented=true;}};
  return {elements,queries,calls,$,state,document,event,context,run:()=>context.handleAppEscape(event)};
}
test('unhandled Escape returns home from note, code, structured, and media files',()=>{
  for(const file of ['Note.md','File.js','Canvas.md','Budget.md','Clip.mp4','Song.mp3','Paper.pdf','Model.stl']){
    const f=fixture();f.state.active=file;f.run();assert.deepEqual(f.calls,['openHome']);assert.equal(f.event.defaultPrevented,true);
  }
});
test('closing each existing overlay takes priority over returning Home',()=>{
  for(const [id,handler] of [['#rename-overlay','finishRenameDialog'],['#delete-overlay','finishDeleteDialog'],['#link-picker-overlay','closeLinkPicker'],['#settings-overlay','closeSettings'],['#explorer-context-menu','closeExplorerContextMenu'],['#editor-context-menu','closeEditorContextMenu']]){
    const f=fixture();f.$(id).hidden=false;f.run();assert.deepEqual(f.calls,[handler]);assert.equal(f.event.defaultPrevented,true);
  }
  const f=fixture();f.state.assistantOpen=true;f.run();assert.deepEqual(f.calls,['setAssistantOpen']);
});
test('search, new-file menu, and equation popup consume Escape without navigation',()=>{
  const search=fixture();search.$('#topbar-search').classList.contains=()=>true;search.run();assert.deepEqual(search.calls,['closeSearch']);
  const menu=fixture();menu.$('#new-file-menu').hidden=false;menu.run();assert.equal(menu.$('#new-file-menu').hidden,true);assert.deepEqual(menu.calls,[]);assert.equal(menu.event.defaultPrevented,true);
  const equation=fixture();equation.queries.set('.equation-preview',{_dismiss:()=>equation.calls.push('dismiss')});equation.run();assert.deepEqual(equation.calls,['dismiss']);
});
test('editor-consumed, composing, repeated, fullscreen, and native dialog Escape do not navigate',()=>{
  for(const property of ['defaultPrevented','isComposing','repeat']){const f=fixture();f.event[property]=true;f.run();assert.deepEqual(f.calls,[]);}
  const full=fixture();full.document.fullscreenElement={};full.run();assert.deepEqual(full.calls,[]);assert.equal(full.event.defaultPrevented,false);
  const dialog=fixture();dialog.queries.set('dialog[open]',{});dialog.run();assert.deepEqual(dialog.calls,[]);
});
test('native picker closes first, and a second Escape can navigate Home',()=>{
  const f=fixture();f.event.target.closest=()=>({blur:()=>f.calls.push('blur')});f.run();assert.deepEqual(f.calls,['blur']);
  f.event.target.closest=()=>null;f.event.defaultPrevented=false;f.run();assert.deepEqual(f.calls,['blur','openHome']);
});
test('Escape does not reopen Home when no file is active or Home is already open',()=>{
  const f=fixture();f.state.active=null;f.run();assert.deepEqual(f.calls,[]);
  const home=fixture();home.state.home=true;home.run();assert.deepEqual(home.calls,[]);
});
test('hidden modal markup does not block Escape, but visible modals retain priority',()=>{
  const hidden=fixture();hidden.queries.set('[role="dialog"][aria-modal="true"]',[{getClientRects:()=>[]}]);hidden.run();assert.deepEqual(hidden.calls,['openHome']);
  const visible=fixture();visible.queries.set('[role="dialog"][aria-modal="true"]',[{getClientRects:()=>[{}]}]);visible.run();assert.deepEqual(visible.calls,[]);
});

test('Escape closes find and replace before the assistant or Home navigation',()=>{
  const f=fixture();f.state.view={state:{}};f.state.assistantOpen=true;let open=true;
  f.context.searchPanelOpen=()=>open;f.context.closeSearchPanel=()=>{open=false;f.calls.push('closeFind');};
  f.run();assert.deepEqual(f.calls,['closeFind']);assert.equal(f.event.defaultPrevented,true);
  f.event.defaultPrevented=false;f.run();assert.deepEqual(f.calls,['closeFind','setAssistantOpen']);
});
