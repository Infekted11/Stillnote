import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const {collectLinkedContext,limitLinkedContext,linkedContextMessage,contextBudget}=require('../electron/sidebar-context.cjs');
const isEditableTextFile=file=>/\.(md|js|csv)$/i.test(file),isSupportedFile=file=>/\.(md|js|csv|pdf|png|mp3)$/i.test(file);
async function fixture(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'stillnote-sidebar-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(path.join(root,'Folder'));await writeFile(path.join(root,'Current.md'),'Saved text without the new links');
  await writeFile(path.join(root,'Linked.md'),'Linked facts: revenue is 42. <[Second.md]>');await writeFile(path.join(root,'Second.md'),'Secondary-only secret must not be included');
  await writeFile(path.join(root,'Folder','data.csv'),'Month,Total\nJan,42');await writeFile(path.join(root,'program.js'),'const answer = 42;');
  await writeFile(path.join(root,'report.pdf'),'%PDF placeholder');await writeFile(path.join(root,'image.png'),'binary-image');await writeFile(path.join(root,'clip.mp3'),'binary-audio');
  await writeFile(path.join(root,'.private.md'),'Credentials must not be included');
  return {root,collect:document=>collectLinkedContext({root,sourcePath:'Current.md',document,isEditableTextFile,isSupportedFile})};
}
test('current unsaved direct links include full text, deduplicate aliases/fragments, and stop at one level',async t=>{
  const {root,collect}=await fixture(t);
  const context=await collect('<[Linked#Heading|alias]> [[LINKED.md#L2]] <[Folder/data.csv#A5,D8]> <[program.js]> <[Current.md]>');
  assert.deepEqual(context.files.map(file=>file.path),['Linked.md','Folder/data.csv','program.js']);assert.match(context.files[0].text,/revenue is 42/);assert.match(context.files[1].text,/Jan,42/);assert.match(context.files[2].text,/answer = 42/);
  assert(!JSON.stringify(context).includes('Secondary-only secret'));assert.equal(await readFile(path.join(root,'Current.md'),'utf8'),'Saved text without the new links');
  await writeFile(path.join(root,'Linked.md'),'Updated linked facts');assert.equal((await collect('<[Linked.md]>')).files[0].text,'Updated linked facts');
});
test('missing, hidden, traversal, symlink and external references cannot expose unrelated content',async t=>{
  const {root,collect}=await fixture(t);await symlink(path.join(root,'.private.md'),path.join(root,'Alias.md'));
  const context=await collect('<[missing.md]> <[.private.md]> <[../outside.md]> <[Alias.md]> <[https://example.com/file.md]>');
  assert.equal(context.files.length,4);assert(context.files.every(file=>file.kind==='unavailable'&&file.error));assert(!JSON.stringify(context).includes('Credentials must'));
});
test('PDFs carry a text budget and binary media is explicitly metadata-only',async t=>{
  const {collect}=await fixture(t),context=await collect('<[report.pdf]> <[image.png]> <[clip.mp3]>');
  assert.equal(context.files[0].kind,'pdf');assert(context.files[0].textBudget>0);assert.equal(context.files[0].text,'');
  assert(context.files.slice(1).every(file=>file.kind==='binary'&&!file.text&&file.note.includes('not been analyzed')));
});
test('JSON-escaped canvas links resolve and embedded binary data is excluded from text context',async t=>{
  const {root,collect}=await fixture(t);await writeFile(path.join(root,'Quoted "name".md'),'Quoted name facts');
  const document='Canvas\n<!-- stillnote:type=canvas -->\n```stillnote-canvas\n'+JSON.stringify({elements:[{text:'<[Quoted "name".md]>'}]})+'\n```';
  assert((await collect(document)).files.some(file=>file.text==='Quoted name facts'));
  await writeFile(path.join(root,'Canvas.md'),'Canvas\ndata:image/png;base64,QUJDREVG\nGeometry facts');const context=await collect('<[Canvas.md]>');assert(!context.files[0].text.includes('QUJDREVG'));assert(context.files[0].text.includes('Geometry facts'));
});
test('context limits retain references with visible truncation and report omitted files',()=>{
  const files=Array.from({length:105},(_,index)=>({path:`File${index}.md`,kind:'text',text:'"\\\n'.repeat(10000)}));
  const limited=limitLinkedContext({files},16000);assert.equal(limited.omitted,5);assert.equal(limited.files.length,100);assert(limited.files.every(file=>file.truncated));assert(JSON.stringify(limited).length<=16000);
  assert(contextBudget('groq')<contextBudget('anthropic'));assert.equal(linkedContextMessage({files:[]},'openai'),'');
});
test('vault changes stop collection instead of returning content from another vault',async t=>{
  const {root}=await fixture(t);let checks=0;
  await assert.rejects(collectLinkedContext({root,sourcePath:'Current.md',document:'<[Linked.md]>',isEditableTextFile,isSupportedFile,checkCurrent:()=>{if(++checks>2)throw new Error('Vault changed');}}),/Vault changed/);
});
const main=await readFile(new URL('../electron/main.cjs',import.meta.url),'utf8');
test('all sidebar providers receive linked context as untrusted read-only data',async()=>{
  for(const provider of ['groq','openai','anthropic']){
    const handlers=new Map(),calls=[];
    const context=vm.createContext({vaultPath:'/vault',linkedContextMessage,ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},readAiProviderKey:async()=>provider+'-key',aiProvider:()=>({id:provider,name:provider,defaultModel:'test-model',chat:async request=>{calls.push(request);return '{"kind":"answer","text":"42","tasks":[]}';}}),AbortController,setTimeout,clearTimeout});
    const start=main.indexOf("  ipcMain.handle('ai:chat'");vm.runInContext(main.slice(start,main.indexOf("  ipcMain.handle('vault:list'",start)),context);
    await handlers.get('ai:chat')(null,{provider,vault:'/vault',notePath:'Current.md',mode:'ask',prompt:'Compare',document:'Current note',linkedContext:{files:[{path:'Linked.md',kind:'text',text:'Revenue: 42'}]}});
    const request=calls[0];assert.match(request.messages[0].content,/Linked files are read-only/);assert.match(request.messages.at(-1).content,/Current file: Current.md/);assert.match(request.messages.at(-1).content,/Revenue: 42/);assert.match(request.messages.at(-1).content,/Current note/);
    await assert.rejects(handlers.get('ai:chat')(null,{vault:'/different',prompt:'Compare'}),/active vault changed/);assert.equal(calls.length,1);
  }
});
const renderer=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
test('linked PDF extraction includes selectable text, excludes scanned pages, and releases the reader',async()=>{
  let destroyed=0,scanned=false;
  const context=vm.createContext({window:{stillnote:{readAsset:async()=>({data:'data:application/pdf;base64,AA=='})}},bytesFromDataUrl:()=>new Uint8Array([0]),getPdfJs:async()=>({getDocument:()=>({promise:Promise.resolve({numPages:1,getPage:async()=>({getTextContent:async()=>({items:scanned?[]:[{str:'PDF linked facts'}]})}),destroy:async()=>{destroyed++;}})})})});
  const start=renderer.indexOf('async function readLinkedPdfContext(');vm.runInContext(renderer.slice(start,renderer.indexOf('async function submitAssistantMessage(',start)),context);
  const result=await context.readLinkedPdfContext('Report.pdf',1000,()=>true);assert.match(result.text,/PDF linked facts/);assert.equal(destroyed,1);
  scanned=true;await assert.rejects(context.readLinkedPdfContext('Scanned.pdf',1000,()=>true),/No selectable PDF text/);assert.equal(destroyed,2);
  await assert.rejects(context.readLinkedPdfContext('Report.pdf',1000,()=>false),/active file or vault changed/);
});
