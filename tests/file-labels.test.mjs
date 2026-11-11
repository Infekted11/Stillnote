import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const labelSource=await readFile(new URL('../src/file-labels.js',import.meta.url),'utf8');
const {fileDisplayName,fileDisplayParts}=await import(`data:text/javascript;base64,${Buffer.from(labelSource).toString('base64')}`);
const source=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
class Element {
  constructor(){this.children=[];this.listeners={};this.dataset={};this.style={setProperty(){}};this.value='';this.hidden=false;}
  set innerHTML(value){this.html=value;this.children=[];}
  get innerHTML(){return this.html||'';}
  setAttribute(){}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;}
  addEventListener(name,fn){this.listeners[name]=fn;}
  focus(){}
}
function harness(){
  const formats=['graph','calculator3d','canvas','geometry','tasks','spreadsheet'];
  const entries=formats.map(format=>({name:`${format}.md`,path:`Plans.md/${format}.md`,type:'note',format}));
  entries.push({name:'Notes.md',path:'Plans.md/Notes.md',type:'note',format:'note'},{name:'data.csv',path:'Plans.md/data.csv',type:'note',format:'asset'});
  const tree=[{type:'folder',name:'Plans.md',path:'Plans.md',children:entries}],elements=new Map(),opened=[],inserted=[],renamed=[];
  const $=selector=>{if(!elements.has(selector))elements.set(selector,new Element());return elements.get(selector);};
  const list=new Element();
  const context=vm.createContext({fileDisplayName,fileDisplayParts,$,list,document:{createElement:()=>new Element()},state:{tree,files:entries.map(entry=>entry.path),collapsed:new Set(),explorerSelection:new Set(),active:'Plans.md/Notes.md',view:{},vault:{name:'Vault'}},icons:{file:'FILE',down:'DOWN',folder:'FOLDER',folderOpen:'OPEN'},refreshVaultLinksIfChanged(){},scheduleBacklinks(){},selectExplorerNode:()=>false,showExplorerContextMenu(){},wireExplorerDrag(){},openNote:path=>opened.push(path),showToast:error=>assert.fail(error),requestAnimationFrame:fn=>fn(),linkPickerView:null,activeLinkPickerSource:'files',linkPickerSources:[],decodeStructured:()=>null,insertPickedLink:syntax=>inserted.push(syntax),saveActive:async()=>{},window:{stillnote:{readNote:async()=>'',renameEntry:async(path,title)=>{renamed.push({path,title});return `Plans.md/${title}.md`;},listNotes:async()=>entries.map(entry=>entry.path),getVaultTree:async()=>tree}}});
  const slices=[['function prettyName(', 'const codeFileTypes'],['function escapeHtml(', 'function inlineMarkdownForPdf('],['function findExplorerNode(', 'function setExplorerFoldersExpanded('],['function renderFiles()', 'function selectExplorerNode('],['function renderSearch(', "$('.vault-switcher').addEventListener"],['function renderLinkPickerResults()', 'function selectLinkPickerSource('],['async function openLinkPicker()', 'function openSearch()'],['async function renameExplorerEntry(', 'async function deleteExplorerEntries(']];
  for(const [start,end] of slices)vm.runInContext(source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start))),context);
  return {context,$,list,entries,opened,inserted,renamed};
}
test('cosmetic types appear in explorer and search while navigation uses real paths',()=>{
  const {context,$,list,entries,opened}=harness();context.renderFiles();
  const suffixes=['.grph','.3d','.cnvs','.geom','.task','.sht'];
  for(let index=0;index<suffixes.length;index++){
    const row=list.children[index+1];assert(row.innerHTML.includes(`class="file-type-extension">${suffixes[index]}</span>`));assert.match(suffixes[index],/^\.[a-z0-9]{1,4}$/);
    assert.equal(row.title,entries[index].path);row.listeners.click({shiftKey:false});assert.equal(opened.at(-1),entries[index].path);
  }
  assert(!list.children[7].innerHTML.includes('file-type-extension'));assert(list.children[8].innerHTML.includes('data.csv'));
  assert.equal(context.fileLabelPath('Plans.md/geometry.md'),'Plans.md / geometry.geom');
  context.closeSearch=()=>{};context.renderSearch('.geom');assert.equal($('#search-results').children.length,1);const result=$('#search-results').children[0];assert(result.innerHTML.includes('.geom'));result.listeners.click();assert.equal(opened.at(-1),'Plans.md/geometry.md');
  assert.equal(fileDisplayName('Plans.md','folder'),'Plans.md');assert.equal(fileDisplayName('Budget.final.MD','spreadsheet'),'Budget.final.sht');assert.equal(fileDisplayName('image.png','canvas'),'image.png');
});
test('file picker shows cosmetic types but inserts Markdown links; rename edits the real basename',async()=>{
  const {context,$,entries,inserted,renamed}=harness();await context.openLinkPicker();
  const rows=$('#link-picker-results').children;assert.equal(rows.length,entries.length);
  for(let index=0;index<entries.length;index++){
    rows[index].listeners.click();assert.equal(inserted.at(-1),`<[${entries[index].path}]>`);
  }
  assert(rows[3].innerHTML.includes('geometry.geom'));assert.equal(context.linkPickerSources[0].items[3].syntax,'<[Plans.md/geometry.md]>');
  context.requestRenameValue=async current=>{assert.equal(current,'geometry');return 'Triangle';};
  await context.renameExplorerEntry(entries[3]);assert.deepEqual(renamed,[{path:'Plans.md/geometry.md',title:'Triangle'}]);
  assert.equal(entries[3].name,'geometry.md');assert.equal(entries[3].path,'Plans.md/geometry.md');
});
