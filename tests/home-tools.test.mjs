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
test('AI note writes turn added Markdown tables into separate spreadsheets with live vault links',async t=>{
  const {root,tool}=await fixture(t);
  const note='Project/Plan.md';
  const oldTable='| Old |\n| --- |\n| Keep |';
  const table='| Item | Notes | Cost |\n| --- | :--- | ---: |\n| Apple | | 5 |\n| Pear | Red \\| green | 8 |';
  const original='Plan\n\n'+oldTable+'\n';
  await fs.mkdir(path.join(root,'Project'));
  await fs.writeFile(path.join(root,note),original);
  await fs.writeFile(path.join(root,'Project/Plan Table.md'),'Existing file');
  const content=original+'\n## Budget\n\n'+table+'\n\n```md\n'+table+'\n```\n';
  const read=await tool('read_file',{path:note});
  const result=await tool('update_file',{path:note,revision:read.revision,content},'work');
  assert.deepEqual(result.sheets,['Project/Plan Table 2.md']);
  const updated=await tool('read_file',{path:note});
  assert.equal(updated.revision,result.revision);
  assert.equal(updated.text,original+'\n## Budget\n\n<[Project/Plan Table 2.md]>\n\n```md\n'+table+'\n```\n');
  assert.equal(await fs.readFile(path.join(root,'Project/Plan Table.md'),'utf8'),'Existing file');
  const sheet=await tool('read_file',{path:result.sheets[0]});
  assert.match(sheet.text,/stillnote:type=spreadsheet/);
  assert.deepEqual(JSON.parse(sheet.text.split('\n')[4]),{version:1,rows:3,columns:3,cells:{A1:'Item',B1:'Notes',C1:'Cost',A2:'Apple',C2:'5',A3:'Pear',B3:'Red | green',C3:'8'}});
  assert.equal((await tool('file_relations',{path:result.sheets[0]})).incoming[0].path,note);

  const newNote=await tool('create_file',{path:'Project/New.md',content:'New\n\n'+table+'\n'},'work');
  assert.match((await tool('read_file',{path:newNote.path})).text,/<\[Project\/New Table.md\]>/);
  await assert.rejects(tool('create_file',{path:'Project/New.md',content:'New\n\n'+table+'\n'},'work'),/EEXIST/);
  assert.equal((await fs.readdir(path.join(root,'Project'))).includes('New Table 2.md'),false);

  const answer={path:'Project/AI Answer.md',content:table};
  await assert.rejects(tool('prepare_note_tables',answer,'ask'),/Ask mode/);
  const prepared=await tool('prepare_note_tables',answer,'work');
  assert.equal(prepared.content,'<[Project/AI Answer Table.md]>');
  await assert.rejects(fs.access(path.join(root,answer.path)),{code:'ENOENT'});
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

test('Home edits Gantt tasks by their displayed numbers and preserves legacy data and links', async t => {
  const { root, tool } = await fixture(t);
  const file = 'Launch.md';
  const googleTask = { listId: 'list', taskId: 'remote', status: 'needsAction' };
  const original = {
    version: 1, colorLegend: 'Keep',
    rows: [
      { title: 'Research', parentId: 'phase', id: 'research', googleTask, start: '2026-11-16', end: '2026-11-16' },
      { title: 'Phase', id: 'phase' },
      { title: 'Publish', taskNumber: 2, predecessors: ['research'] },
    ],
  };
  const prefix = 'Launch\r\n<!-- stillnote:type=gantt -->\r\n\r\n\x60\x60\x60stillnote-gantt\r\n';
  const suffix = '\r\n\x60\x60\x60\r\n\r\nKeep this Markdown.\r\n';
  await fs.writeFile(path.join(root, file), prefix + JSON.stringify(original) + suffix);

  const read = await tool('read_gantt', { path: file });
  assert.deepEqual(read.tasks.map(task => [task.number, task.title, task.parentNumber]), [
    [3, 'Phase', null], [4, 'Research', 3], [2, 'Publish', null],
  ]);
  const args = {
    path: file, revision: read.revision, changes: [
      { action: 'update', taskNumber: 4, start: '2026-11-17', end: '2026-11-18', progress: 50 },
      { action: 'add', title: 'Review', parentNumber: 3, predecessorNumbers: [4], start: '2026-11-19T10:00', milestone: true },
    ],
  };
  await assert.rejects(tool('edit_gantt', args), /Ask mode/);
  await assert.rejects(tool('update_file', { path: file, revision: read.revision, content: 'Broken' }, 'work'), /edit_gantt/);
  const edited = await tool('edit_gantt', args, 'work');
  assert.deepEqual(edited.taskNumbers, [4, 5]);
  await assert.rejects(tool('edit_gantt', args, 'work'), /changed/);
  const saved = await fs.readFile(path.join(root, file), 'utf8');
  assert.ok(saved.startsWith(prefix) && saved.endsWith(suffix));
  assert.ok(!saved.replace(/\r\n/g, '').includes('\n'));
  const data = JSON.parse(saved.slice(prefix.length, -suffix.length));
  assert.equal(data.colorLegend, 'Keep');
  assert.deepEqual(data.rows[0].googleTask, googleTask);
  assert.equal(data.rows[0].id, 'research');
  const updated = await tool('read_gantt', { path: file });
  assert.equal(updated.revision, edited.revision);
  const review = updated.tasks.find(task => task.number === 5);
  assert.equal(review.title, 'Review');
  assert.equal(review.end, review.start);
  assert.deepEqual(review.predecessorNumbers, [4]);
  assert.equal(updated.tasks.find(task => task.number === 4).progress, 50);

  await assert.rejects(tool('edit_gantt', { path: file, revision: updated.revision, changes: [
    { action: 'update', taskNumber: 2, title: 'Rename' },
    { action: 'update', taskNumber: 4, predecessorNumbers: [5] },
  ] }, 'work'), /dependency cycle/);
  assert.equal(await fs.readFile(path.join(root, file), 'utf8'), saved);

  await tool('edit_gantt', { path: file, revision: updated.revision, changes: [
    { action: 'remove', taskNumber: 4 },
    { action: 'remove', taskNumber: 3 },
    { action: 'add', title: 'Follow up' },
  ] }, 'work');
  const afterRemoval = await tool('read_gantt', { path: file });
  assert.deepEqual(afterRemoval.tasks.map(task => [task.number, task.parentNumber, task.predecessorNumbers]), [
    [2, null, []], [5, null, []], [6, null, []],
  ]);
});

test('Home creates native chart, sheet, canvas and graph files and preserves requested text extensions', async t => {
  const { tool } = await fixture(t);
  const create = (format, data) => tool('create_structured_file', {
    path: 'Project/' + format + '.md', format, data: data == null ? null : JSON.stringify(data),
  }, 'work');
  const examples = [
    ['gantt', {tasks:[{title:'Design',start:'2026-11-24',end:'2026-11-26'}]}, data => assert.equal(data.rows[0].taskNumber, 1)],
    ['spreadsheet', {cells:{B2:42}}, data => assert.equal(data.cells.B2, '42')],
    ['canvas', {elements:[{type:'text',x:10,y:10,w:100,h:50,text:'Idea'}]}, data => assert.equal(data.elements[0].text, 'Idea')],
    ['graph', {expressions:['y=x^2']}, data => assert.deepEqual(data.expressions, ['y=x^2'])],
    ['geometry', null, data => assert.equal(data.state, null)],
    ['calculator3d', null, data => assert.equal(data.state, null)],
  ];
  for (const [format, data, verify] of examples) {
    const result = await create(format, data);
    assert.equal(result.format, format);
    const saved = await tool('read_file', {path:result.path});
    assert.ok(saved.text.includes('<!-- stillnote:type=' + format + ' -->'));
    verify(JSON.parse(saved.text.split('\n').slice(4,-2).join('\n')));
  }
  await assert.rejects(create('gantt', null), /EEXIST/);
  await assert.rejects(tool('create_structured_file', {path:'Ask.md',format:'canvas',data:null}), /Ask mode/);
  await assert.rejects(tool('create_structured_file', {path:'Invalid.md',format:'spreadsheet',data:'{"rows":1,"cells":{"A2":"outside"}}'}, 'work'), /valid addresses/);
  const csv = await tool('create_file', {path:'Project/Data.csv',content:'Name,Count\nDesign,42\n'}, 'work');
  assert.equal((await tool('read_file', {path:csv.path})).text, 'Name,Count\nDesign,42\n');
});
