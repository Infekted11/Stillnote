import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const {createHomeTools,parseCsv,profileData}=createRequire(import.meta.url)('../electron/home-tools.cjs');
async function fixture(t,taskApi=async()=>{throw new Error('Google Tasks disconnected');}){const root=await fs.mkdtemp(path.join(os.tmpdir(),'stillnote-home-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return {root,tool:createHomeTools({root,taskApi,isSupportedFile:file=>/\.(md|csv|txt|pdf)$/.test(file)})};}
test('Work creates multiple linked files, protects collisions, and checks revisions',async t=>{
  const {tool}=await fixture(t);
  await tool('create_file',{path:'Project/A.md',content:'A\n'},'work');await tool('create_file',{path:'Project/B.md',content:'B\n'},'work');
  await assert.rejects(tool('create_file',{path:'Project/A.md',content:'Overwrite'},'work'),/EEXIST/);
  await tool('link_files',{path:'Project/A.md',target:'Project/B.md'},'work');
  const read=await tool('read_file',{path:'Project/A.md'});assert.match(read.text,/<\[Project\/B.md\]>/);
  await assert.rejects(tool('update_file',{path:'Project/A.md',revision:'wrong',content:'X'},'work'),/changed/);
  await tool('update_file',{path:'Project/A.md',revision:read.revision,content:read.text+'More\n'},'work');
  const relation=await tool('file_relations',{path:'Project/B.md'});assert.equal(relation.incoming[0].path,'Project/A.md');
});
test('Ask is read-only and tools reject hidden paths, traversal and symlinks',async t=>{
  const {root,tool}=await fixture(t);await fs.writeFile(path.join(root,'Note.md'),'Hello');
  await assert.rejects(tool('create_file',{path:'No.md',content:'x'},'ask'),/Ask mode/);
  for(const name of ['../outside.md','/tmp/outside.md','.env','Hidden/.secret.md','a/../Note.md'])await assert.rejects(tool('read_file',{path:name}),/vault-relative/);
  await fs.symlink(os.tmpdir(),path.join(root,'Alias'));await assert.rejects(tool('read_file',{path:'Alias/outside.md'}),/Symbolic/);
  const files=await tool('list_files');assert.deepEqual(files.files,['Note.md']);
});
test('search and read report useful excerpts and truncation',async t=>{
  const {root,tool}=await fixture(t);await fs.writeFile(path.join(root,'Research.md'),'Garden findings\n'+'x'.repeat(50000));
  const result=await tool('search_files',{query:'Garden'});assert.equal(result.matches[0].path,'Research.md');
  const read=await tool('read_file',{path:'Research.md',length:100});assert.equal(read.text.length,100);assert.equal(read.truncated,true);assert.equal(read.revision.length,64);
});
test('CSV analysis computes descriptive statistics and relationships without treating blanks as zero',async t=>{
  const {root,tool}=await fixture(t);await fs.writeFile(path.join(root,'Data.csv'),'Cost,Result\n1,2\n2,4\n3,6\n,8\n');
  const result=await tool('analyze_data',{path:'Data.csv'});assert.equal(result.rows,4);assert.equal(result.columns[0].mean,2);assert.equal(result.columns[0].empty,1);assert.equal(result.correlations[0].pearson,1);assert.equal(result.correlations[0].pairs,3);
  assert.deepEqual(parseCsv('Name,Notes\n"A","line one\nline two"\n'),[['Name','Notes'],['A','line one\nline two']]);
});
test('spreadsheet analysis excludes formulas explicitly',async t=>{
  const {root,tool}=await fixture(t);const data={rows:20,columns:2,cells:{A1:'Name',B1:'Value',A2:'One',B2:'2',A3:'Two',B3:'=B2*2'}};
  await fs.writeFile(path.join(root,'Data.md'),'Data\n<!-- stillnote:type=spreadsheet -->\n```stillnote-spreadsheet\n'+JSON.stringify(data)+'\n```');
  const result=await tool('analyze_data',{path:'Data.md'});assert.equal(result.rows,2);assert.equal(result.columns[1].numericCount,1);assert.match(result.note,/formulas are excluded/);
});
test('Google Tasks are created with real IDs and linked to the exact note line',async t=>{
  const list={id:'list-1',title:'Garden'},task={id:'task-1',title:'Plant seeds',notes:'Original notes'};let patched;
  const api=async(endpoint,options={})=>{
    if(endpoint.includes('/users/@me/lists?'))return {items:[list]};
    if(endpoint==='/users/@me/lists/list-1')return list;
    if(endpoint.includes('/tasks?'))return {items:[]};
    if(endpoint==='/lists/list-1/tasks'&&options.method==='POST'){assert.equal(JSON.parse(options.body).due,'2026-12-01T00:00:00.000Z');return task;}
    if(endpoint==='/lists/list-1/tasks/task-1'){if(options.method==='PATCH')patched=JSON.parse(options.body);return task;}
    throw new Error('Unexpected API '+endpoint);
  };
  const {root,tool}=await fixture(t,api);await fs.writeFile(path.join(root,'Garden.md'),'Garden\n');
  const created=await tool('create_task',{listId:'list-1',title:'Plant seeds',due:'2026-12-01'},'work');assert.equal(created.id,'task-1');
  // Existing task listing is needed to establish unique names before linking.
  const linkedApi=async(endpoint,options)=>endpoint.includes('/lists/list-1/tasks?')?{items:[task]}:api(endpoint,options);
  const linking=createHomeTools({root,taskApi:linkedApi,isSupportedFile:()=>true});
  const result=await linking('link_task',{path:'Garden.md',listId:'list-1',taskId:'task-1'},'work');
  assert.match(patched.notes,/Original notes/);assert.match(patched.notes,/stillnote:\/\/open\?note=Garden.md&line=3/);
  assert.equal(result.line,3);assert.match(await fs.readFile(path.join(root,'Garden.md'),'utf8'),/;;Garden\/Plant%20seeds;;/);
});
test('Google Tasks failures do not report success and invalid dates do not reach the service',async t=>{
  let calls=0;const {tool}=await fixture(t,async()=>{calls++;throw new Error('Disconnected');});
  await assert.rejects(tool('create_task',{listId:'x',title:'Task',due:'2026-02-31'},'work'),/valid/);assert.equal(calls,0);
  await assert.rejects(tool('create_task',{listId:'x',title:'Task'},'work'),/Disconnected/);
});
