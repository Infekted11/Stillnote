import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const linkSource=await readFile(new URL('../src/vault-links.js',import.meta.url),'utf8');
const {parseVaultLink,shouldRenderFileLink}=await import(`data:text/javascript;base64,${Buffer.from(linkSource).toString('base64')}`);
const {linksIn,matchesPath,rewriteLinks}=require('../electron/file-links.cjs');
const main=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
test('!!! suppresses each preview type without changing the target, fragment, or alias',()=>{
  for(const [file,format,extension] of [['image.png','asset','.png'],['Canvas.md','canvas','.md'],['Sheet.md','spreadsheet','.md'],['Graph.md','graph','.md'],['Geometry.md','geometry','.md'],['3D.md','calculator3d','.md'],['Song.mp3','asset','.mp3']]){
    assert.equal(shouldRenderFileLink(file,format,extension),true);assert.equal(shouldRenderFileLink('!!!'+file,format,extension),false);assert.equal(parseVaultLink('!!!'+file).path,file);
  }
  assert.deepEqual(parseVaultLink('!!!Folder/Sheet.md#A5,D8|Budget'),{linkOnly:true,target:'Folder/Sheet.md#A5,D8',path:'Folder/Sheet.md',fragment:'A5,D8',label:'Budget'});
});
test('renames preserve suppression and link fragments in ordinary and structured documents',()=>{
  const text='<[!!!Folder/Sheet#A5,D8|Budget]> [[!!!Folder/Sheet.md]] <[Folder/Sheet.md]>';
  const updated=rewriteLinks(text,[['Folder/Sheet.md','New/Budget.md']]);
  assert.equal(updated,'<[!!!New/Budget.md#A5,D8|Budget]> [[!!!New/Budget.md]] <[New/Budget.md]>');
  assert(linksIn(text).every(link=>matchesPath(link.target,'Folder/Sheet.md')));
  const doc='Canvas\n<!-- stillnote:type=canvas -->\n```stillnote-canvas\n'+JSON.stringify({elements:[{text:'<[!!!Folder/Sheet.md]>'}]})+'\n```';
  const result=rewriteLinks(doc,[['Folder/Sheet.md','New/Quoted "name".md']]);assert.match(JSON.parse(result.match(/```stillnote-canvas\n([\s\S]*?)\n```/)[1]).elements[0].text,/!!!New\/Quoted "name".md/);
});
test('suppressed links resolve for navigation and share broken-link styling rules',()=>{
  const tree=[{path:'Folder/Image.png',format:'asset'},{path:'Sheet.md',format:'spreadsheet'}];
  const context=vm.createContext({parseVaultLink,state:{active:'Note.md'},explorerFilePaths:()=>tree.map(node=>node.path)});
  let start=main.indexOf('function resolveVaultFileTarget(');vm.runInContext(main.slice(start,main.indexOf('function setStructuredDirty(',start)),context);
  start=main.indexOf('function isBrokenVaultLink(');vm.runInContext(main.slice(start,main.indexOf('function invalidateVaultLinkRendering(',start)),context);
  assert.equal(context.resolveVaultFileTarget('!!!folder/image.png'),'Folder/Image.png');assert.equal(context.resolveVaultFileTarget('!!!Sheet#A5,D8'),'Sheet.md');
  assert.equal(context.isBrokenVaultLink('!!!Sheet.md'),false);assert.equal(context.isBrokenVaultLink('!!!Missing.md'),true);assert.equal(context.isBrokenVaultLink('!!!#Heading'),false);
  tree.pop();assert.equal(context.isBrokenVaultLink('!!!Sheet.md'),true);
});
test('the note renderer suppresses only marked links and replaces deleted previews with red links',async()=>{
  const {EditorState}=await import('@codemirror/state');
  const {Decoration,WidgetType}=await import('@codemirror/view');
  const {markdown}=await import('@codemirror/lang-markdown');
  const {syntaxTree}=await import('@codemirror/language');
  class Preview extends WidgetType{constructor(file){super();this.file=file;}}
  const files=new Map([['Image.png','asset'],['Graph.md','graph'],['Budget.md','spreadsheet']]);
  const context=vm.createContext({parseVaultLink,shouldRenderFileLink,Decoration,syntaxTree,markdownMarkers:new Set(),WikiMediaWidget:Preview,TextWidget:Preview,vaultRenderRevision:1,state:{active:'Note.md'},fileExtension:file=>file.split('.').at(-1),findExplorerNode:file=>files.has(file)?{format:files.get(file)}:null,resolveVaultFileTarget:value=>{const file=parseVaultLink(value).path;return files.has(file)?file:null;}});
  let start=main.indexOf('function isBrokenVaultLink(');vm.runInContext(main.slice(start,main.indexOf('function invalidateVaultLinkRendering(',start)),context);
  start=main.indexOf('function makeLiveMarkdownDecorations(');vm.runInContext(main.slice(start,main.indexOf('function getNoteIndexTargets(',start)),context);
  const document='Note\n<[Image.png]>\n<[!!!Image.png]>\n<[Graph.md]>\n<[!!!Graph.md]>\n<[Missing.png]>\n[[!!!Budget.md#A5,D8]]';
  const state=EditorState.create({doc:document,extensions:[markdown()]});
  const inspect=()=>{const widgets=[],broken=[];context.makeLiveMarkdownDecorations({state}).between(0,state.doc.length,(from,to,value)=>{if(value.spec.widget instanceof Preview)widgets.push(value.spec.widget.file);if(value.spec.class?.includes('is-broken'))broken.push(state.sliceDoc(from,to));});return {widgets,broken};};
  assert.deepEqual(inspect(),{widgets:['Image.png','Graph.md'],broken:['<[Missing.png]>']});
  files.delete('Image.png');assert.deepEqual(inspect(),{widgets:['Graph.md'],broken:['<[Image.png]>','<[!!!Image.png]>','<[Missing.png]>']});
  files.set('Image.png','asset');assert.deepEqual(inspect().widgets,['Image.png','Graph.md']);assert.equal(state.doc.toString(),document);
});
