import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {EditorState} from '@codemirror/state';
import {showPanel} from '@codemirror/view';
import {history,undo} from '@codemirror/commands';
import {SearchQuery,search,setSearchQuery,openSearchPanel,findNext,findPrevious,replaceAll} from '@codemirror/search';
const source=await readFile(new URL('../src/find-replace.js',import.meta.url),'utf8');
const resolved=source.replace(/from '(@codemirror\/[^']+)'/g,(_all,name)=>`from '${import.meta.resolve(name)}'`);
const {searchMatchSummary,replaceCurrentMatch,FindReplacePanel}=await import(`data:text/javascript;base64,${Buffer.from(resolved).toString('base64')}`);
function viewFor(doc,query,readOnly=false){
  const view={plugin:()=>null,state:EditorState.create({doc,extensions:[search({literal:true}),history(),EditorState.readOnly.of(readOnly)]})};
  view.dispatch=spec=>{view.state=spec.state||view.state.update(spec).state;};
  openSearchPanel(view);view.dispatch({effects:setSearchQuery.of(new SearchQuery({literal:true,...query}))});return view;
}
test('find navigation wraps in both directions and reports the current match',()=>{
  const view=viewFor('Cat cat CAT',{search:'cat'});
  assert.equal(searchMatchSummary(view.state).count,3);
  findNext(view);assert.equal(searchMatchSummary(view.state).label,'1 of 3');
  findPrevious(view);assert.equal(searchMatchSummary(view.state).label,'3 of 3');
  findNext(view);assert.equal(searchMatchSummary(view.state).label,'1 of 3');
  findNext(view);assert.equal(view.state.selection.main.from,4);
});
test('case, whole-word and literal backslash searches match the source accurately',()=>{
  assert.equal(searchMatchSummary(viewFor('Cat cat catalog CAT',{search:'cat',wholeWord:true}).state).count,3);
  assert.equal(searchMatchSummary(viewFor('Cat cat catalog CAT',{search:'cat',caseSensitive:true,wholeWord:true}).state).count,1);
  assert.equal(searchMatchSummary(viewFor('literal \\n and\nnew line',{search:'\\n'}).state).count,1);
});
test('Replace replaces the first match immediately and Replace all is one undoable edit',()=>{
  const view=viewFor('cat cat cat',{search:'cat',replace:'dog'});
  assert(replaceCurrentMatch(view));assert.equal(view.state.doc.toString(),'dog cat cat');
  assert(replaceAll(view));assert.equal(view.state.doc.toString(),'dog dog dog');
  assert(undo(view));assert.equal(view.state.doc.toString(),'dog cat cat');
});
test('regular expressions expand captures, reject invalid patterns and handle zero-length matches',()=>{
  const view=viewFor('item1 item2',{search:'item(\\d)',regexp:true,replace:'thing$1'});
  replaceAll(view);assert.equal(view.state.doc.toString(),'thing1 thing2');
  const invalid=viewFor('anything',{search:'[',regexp:true,replace:'bad'});assert.equal(searchMatchSummary(invalid.state).label,'Invalid expression');assert.equal(replaceCurrentMatch(invalid),false);assert.equal(invalid.state.doc.toString(),'anything');
  const zero=viewFor('a a',{search:'(?=a)',regexp:true,replace:'X'});assert.equal(searchMatchSummary(zero.state).count,2);replaceAll(zero);assert.equal(zero.state.doc.toString(),'Xa Xa');
});
test('no matches and read-only documents cannot be replaced',()=>{
  const absent=viewFor('cat',{search:'missing',replace:'dog'});assert.equal(searchMatchSummary(absent.state).label,'No matches');assert.equal(replaceCurrentMatch(absent),false);assert.equal(absent.state.doc.toString(),'cat');
  const locked=viewFor('cat',{search:'cat',replace:'dog'},true);assert.equal(replaceCurrentMatch(locked),false);assert.equal(replaceAll(locked),false);assert.equal(locked.state.doc.toString(),'cat');
});

test('typing a longer query preserves the input caret and the current match',()=>{
  const view=viewFor('cat cat',{search:''}),doc={activeElement:null};
  const element=()=>({ownerDocument:doc,value:'',attributes:{},listeners:{},classList:{toggle(){}},setAttribute(key,value){this.attributes[key]=value;},getAttribute(key){return this.attributes[key];},addEventListener(name,fn){this.listeners[name]=fn;},append(){},querySelector(){return panel.find;},focus(){doc.activeElement=this;},select(){this.selectionStart=0;this.selectionEnd=this.value.length;},setSelectionRange(from,to,direction){this.selectionStart=from;this.selectionEnd=to;this.selectionDirection=direction;}});
  doc.createElement=element;view.dom={ownerDocument:doc};view.root=doc;
  const panel=new FindReplacePanel(view);view.plugin=()=>({specs:view.state.facet(showPanel).filter(Boolean),panels:[panel]});panel.find.focus();
  for(const value of ['c','ca','cat']){panel.find.value=value;panel.find.setSelectionRange(value.length,value.length,'none');panel.commit(true);assert.equal(panel.find.selectionStart,value.length);assert.equal(panel.find.selectionEnd,value.length);assert.equal(view.state.selection.main.from,0);}
  assert.equal(panel.find.value,'cat');assert.equal(panel.status.textContent,'1 of 2');
});
