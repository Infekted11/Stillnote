import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,writeFile,readFile,rm,stat} from 'node:fs/promises';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
const {watchVaultChanges}=createRequire(import.meta.url)('../electron/vault-watch.cjs');
const delay=()=>new Promise(resolve=>setTimeout(resolve,25));
test('directory events are debounced, include nested paths and ignore hidden credentials',async()=>{
  let emit,closed=0;const calls=[];
  const stop=watchVaultChanges('/vault',change=>calls.push(change),{delay:5,watchImpl:(root,options,callback)=>{assert.equal(root,'/vault');assert.equal(options.recursive,true);emit=callback;return {on(){},close(){closed++;}};}});
  emit('rename','Folder/Image.png');emit('rename','Folder/Image.png');emit('rename','Budget.md');emit('change','.stillnote-credentials.enc');emit('change','Folder/.private/key');
  await delay();assert.equal(calls.length,1);assert.deepEqual(calls[0],{vault:'/vault',paths:['Folder/Image.png','Budget.md']});
  emit('rename','Later.md');stop();await delay();assert.equal(calls.length,1);assert.equal(closed,1);
});
test('autosave cannot recreate a deleted Markdown file',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'stillnote-deleted-write-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const source=await readFile(new URL('../electron/main.cjs',import.meta.url),'utf8'),handlers=new Map();
  const context=vm.createContext({fs,path,Buffer,ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},resolveInVault:relative=>path.join(root,relative),isEditableTextFile:()=>true});
  const start=source.indexOf("  ipcMain.handle('note:write'");vm.runInContext(source.slice(start,source.indexOf("  ipcMain.handle('asset:read'",start)),context);
  await assert.rejects(handlers.get('note:write')(null,'Deleted.md','stale buffer'),/removed from the vault/);await assert.rejects(stat(path.join(root,'Deleted.md')),error=>error.code==='ENOENT');
  await writeFile(path.join(root,'Exists.md'),'Old');await handlers.get('note:write')(null,'Exists.md','New');assert.equal(await readFile(path.join(root,'Exists.md'),'utf8'),'New');
});
test('catalog additions, deletions, type changes and vault changes invalidate previews',async()=>{
  const source=await readFile(new URL('../src/main.js',import.meta.url),'utf8');let invalidated=0;
  const context=vm.createContext({vaultCatalogSignature:null,state:{vault:{path:'/vault'},tree:[{path:'Graph.md',format:'graph'}]},invalidateVaultLinkRendering:()=>{invalidated++;}});
  const start=source.indexOf('function refreshVaultLinksIfChanged()');vm.runInContext(source.slice(start,source.indexOf('function renderFiles()',start)),context);
  context.refreshVaultLinksIfChanged();context.refreshVaultLinksIfChanged();assert.equal(invalidated,1);
  context.state.tree=[];context.refreshVaultLinksIfChanged();assert.equal(invalidated,2);
  context.state.tree=[{path:'Graph.md',format:'graph'}];context.refreshVaultLinksIfChanged();assert.equal(invalidated,3);
  context.state.tree[0].format='note';context.refreshVaultLinksIfChanged();assert.equal(invalidated,4);
  context.state.vault.path='/other';context.refreshVaultLinksIfChanged();assert.equal(invalidated,5);
});
