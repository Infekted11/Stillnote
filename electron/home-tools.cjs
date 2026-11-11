const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { linksIn, matchesPath } = require('./file-links.cjs');
const READ_TOOLS = new Set(['list_files','search_files','read_file','file_relations','analyze_data','list_task_lists','list_tasks']);
const TEXT = new Set(['.md','.txt','.csv','.tsv','.json','.js','.cjs','.mjs','.jsx','.ts','.tsx','.py','.html','.css','.java','.c','.h','.cpp','.hpp','.rs','.go','.sql','.sh','.xml','.yaml','.yml','.toml','.swift','.kt','.rb','.php']);
const revision = text => crypto.createHash('sha256').update(text).digest('hex');
function parseCsv(text, delimiter = ',') {
  const rows=[]; let row=[], value='', quoted=false;
  for (let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='"') { if(quoted&&text[i+1]==='"'){value+='"';i++;} else quoted=!quoted; }
    else if(!quoted&&c===delimiter){row.push(value);value='';}
    else if(!quoted&&(c==='\n'||c==='\r')){if(c==='\r'&&text[i+1]==='\n')i++;row.push(value);if(row.some(x=>x.trim()))rows.push(row);row=[];value='';}
    else value+=c;
  }
  if(quoted)throw new Error('CSV contains an unclosed quoted field.');
  row.push(value);if(row.some(x=>x.trim()))rows.push(row);
  return rows;
}
function profileData(rows) {
  if(!rows.length)return {rows:0,columns:[],correlations:[]};
  const width=Math.max(...rows.map(row=>row.length));
  const numeric=value=>String(value??'').trim()!==''&&Number.isFinite(Number(value));
  const columns=Array.from({length:width},(_,i)=>{
    const values=rows.slice(1).map(row=>row[i]??''), numbers=values.filter(numeric).map(Number), sorted=[...numbers].sort((a,b)=>a-b);
    const counts=new Map();for(const value of values){const key=String(value);if(key.trim())counts.set(key,(counts.get(key)||0)+1);}
    return {name:String(rows[0][i]||`Column ${i+1}`),count:values.length,empty:values.filter(v=>!String(v).trim()).length,numericCount:numbers.length,
      ...(numbers.length?{sum:numbers.reduce((a,b)=>a+b,0),mean:numbers.reduce((a,b)=>a+b,0)/numbers.length,min:sorted[0],max:sorted.at(-1),median:(sorted[Math.floor((sorted.length-1)/2)]+sorted[Math.floor(sorted.length/2)])/2}:{}),
      common:[...counts].sort((a,b)=>b[1]-a[1]).slice(0,5)};
  });
  const correlations=[];
  for(let a=0;a<width;a++)for(let b=a+1;b<width;b++){
    const pairs=rows.slice(1).filter(row=>numeric(row[a])&&numeric(row[b])).map(row=>[Number(row[a]),Number(row[b])]);if(pairs.length<3)continue;
    const mx=pairs.reduce((n,p)=>n+p[0],0)/pairs.length,my=pairs.reduce((n,p)=>n+p[1],0)/pairs.length;
    const xx=pairs.reduce((n,p)=>n+(p[0]-mx)**2,0),yy=pairs.reduce((n,p)=>n+(p[1]-my)**2,0);
    if(xx&&yy)correlations.push({a:columns[a].name,b:columns[b].name,pairs:pairs.length,pearson:pairs.reduce((n,p)=>n+(p[0]-mx)*(p[1]-my),0)/Math.sqrt(xx*yy)});
  }
  return {rows:rows.length-1,columns,correlations:correlations.sort((a,b)=>Math.abs(b.pearson)-Math.abs(a.pearson)).slice(0,30),note:'First row is treated as headers. Non-numeric values and formulas are excluded from numeric statistics. Correlation does not establish causation.'};
}
function createHomeTools({root,taskApi,isSupportedFile}) {
  async function target(relative) {
    if(typeof relative!=='string'||!relative||path.isAbsolute(relative)||relative.includes('\\')||relative.split('/').some(s=>!s||s==='.'||s==='..'||s.startsWith('.')))throw new Error('Use a vault-relative path without hidden folders or traversal.');
    const base=await fs.realpath(root),parts=relative.split('/');let current=base;
    for(const part of parts){current=path.join(current,part);try{if((await fs.lstat(current)).isSymbolicLink())throw new Error('Symbolic links are not available to Home AI.');}catch(error){if(error.code!=='ENOENT')throw error;}}
    return current;
  }
  async function files(){const found=[];async function walk(folder,prefix=''){for(const entry of await fs.readdir(folder,{withFileTypes:true})){if(entry.name.startsWith('.')||entry.isSymbolicLink())continue;const name=prefix+entry.name;if(entry.isDirectory())await walk(path.join(folder,entry.name),name+'/');else if(entry.isFile()&&isSupportedFile(name))found.push(name);}}await walk(root);return found.sort();}
  async function read(relative){const file=await target(relative);if(!TEXT.has(path.extname(relative).toLowerCase()))throw new Error('This file cannot be read as text. PDFs can be read through the PDF reader; other binary files provide metadata only.');const stat=await fs.stat(file);if(stat.size>1_000_000)throw new Error('File exceeds the 1 MB Home text-reading limit.');return fs.readFile(file,'utf8');}
  async function pages(endpoint){const all=[];let token;do{const sep=endpoint.includes('?')?'&':'?';const page=await taskApi(endpoint+sep+'maxResults=100'+(token?'&pageToken='+encodeURIComponent(token):''));all.push(...(page.items||[]));token=page.nextPageToken;}while(token&&all.length<500);return {items:all,truncated:!!token};}
  return async function execute(name,args={},mode='ask') {
    if(mode!=='work'&&!READ_TOOLS.has(name))throw new Error('Ask mode cannot modify files or tasks.');
    if(name==='list_files'){const all=await files();return {files:all.slice(0,2000),total:all.length,truncated:all.length>2000};}
    if(name==='read_file'){if(!TEXT.has(path.extname(args.path||'').toLowerCase())){const info=await fs.stat(await target(args.path));return {path:args.path,kind:/\.pdf$/i.test(args.path)?'pdf':'binary',bytes:info.size,note:'Metadata only; file content has not been analyzed.'};}const text=await read(args.path),offset=Math.max(0,Number(args.offset)||0),length=Math.min(50000,Math.max(1,Number(args.length)||30000));return {path:args.path,text:text.slice(offset,offset+length),revision:revision(text),totalCharacters:text.length,offset,truncated:offset+length<text.length};}
    if(name==='search_files'){
      const terms=String(args.query||'').toLowerCase().split(/\s+/).filter(Boolean);if(!terms.length)throw new Error('Enter search words.');
      const results=[];for(const file of await files()){let text='';if(TEXT.has(path.extname(file).toLowerCase()))try{text=await read(file);}catch{}const lower=(file+'\n'+text).toLowerCase(),score=terms.reduce((n,term)=>n+(lower.includes(term)?1:0),0);if(score){const first=text.toLowerCase().indexOf(terms.find(term=>text.toLowerCase().includes(term))||'');results.push({path:file,score,excerpt:text.slice(Math.max(0,first-150),Math.max(0,first-150)+2000)});}}return {matches:results.sort((a,b)=>b.score-a.score).slice(0,12)};
    }
    if(name==='file_relations'){
      await target(args.path);const outgoing=[],incoming=[];
      for(const file of await files()){if(!TEXT.has(path.extname(file).toLowerCase()))continue;let text;try{text=await read(file);}catch{continue;}for(const link of linksIn(text)){if(file===args.path)outgoing.push({path:link.target,line:link.line});if(matchesPath(link.target,args.path))incoming.push({path:file,line:link.line});}}
      return {path:args.path,outgoing:outgoing.slice(0,200),incoming:incoming.slice(0,200),note:'These are explicit links. Describe inferred thematic relationships separately.'};
    }
    if(name==='analyze_data'){
      const text=await read(args.path);let rows;
      if(/\.(csv|tsv)$/i.test(args.path))rows=parseCsv(text,/\.tsv$/i.test(args.path)?'\t':',');
      else{const match=text.match(/```stillnote-spreadsheet\s*\n([\s\S]*?)\n```/);if(!match)throw new Error('Choose a spreadsheet, CSV, or TSV file.');const data=JSON.parse(match[1]);if(data.rows*data.columns>50000)throw new Error('Spreadsheet is too large to analyze.');const label=i=>{let s='';for(let n=i+1;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};rows=Array.from({length:data.rows},(_,r)=>Array.from({length:data.columns},(_,c)=>data.cells?.[label(c)+(r+1)]??''));while(rows.length&&rows.at(-1).every(v=>!String(v).trim()))rows.pop();}
      if(rows.length>10000||Math.max(0,...rows.map(row=>row.length))>60)throw new Error('Analyze at most 10,000 rows and 60 columns per file.');return {path:args.path,...profileData(rows)};
    }
    if(name==='create_file'){
      if(!TEXT.has(path.extname(args.path||'').toLowerCase()))throw new Error('Choose a supported text file extension.');const file=await target(args.path);if(typeof args.content!=='string'||args.content.length>150000)throw new Error('Provide text up to 150,000 characters.');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,args.content,{encoding:'utf8',flag:'wx'});return {path:args.path,revision:revision(args.content),summary:'Created file'};
    }
    if(name==='update_file'){
      const original=await read(args.path);if(args.revision!==revision(original))throw new Error('The file changed. Read it again before editing.');if(typeof args.content!=='string'||args.content.length>150000)throw new Error('Provide the complete updated text, up to 150,000 characters.');await fs.writeFile(await target(args.path),args.content,'utf8');return {path:args.path,revision:revision(args.content),summary:'Updated file'};
    }
    if(name==='link_files'){
      const original=await read(args.path);await fs.access(await target(args.target));if(!/\.md$/i.test(args.path)||/stillnote:type=/.test(original))throw new Error('Add file links to an ordinary Markdown note.');const syntax=`<[${args.target}]>`;if(/[\[\]#|\r\n]/.test(args.target))throw new Error('This filename cannot be represented as a Stillnote link.');if(!original.includes(syntax))await fs.writeFile(await target(args.path),original+'\n'+syntax+'\n','utf8');return {path:args.path,target:args.target,summary:'Linked files'};
    }
    if(name==='list_task_lists')return pages('/users/@me/lists');
    if(name==='list_tasks'){if(!args.listId)throw new Error('Choose a task list first.');return pages(`/lists/${encodeURIComponent(args.listId)}/tasks?showCompleted=true&showHidden=true`);}
    if(name==='create_task_list'){
      const title=String(args.title||'').trim();if(!title)throw new Error('Provide a task list title.');const existing=await pages('/users/@me/lists');if(existing.items.some(list=>list.title?.trim().toLowerCase()===title.toLowerCase()))throw new Error('A task list already has this title. Choose the existing list or ask for a distinct title.');return taskApi('/users/@me/lists',{method:'POST',body:JSON.stringify({title})});
    }
    if(name==='create_task'){
      if(!args.listId||!String(args.title||'').trim())throw new Error('A task list and title are required.');const body={title:String(args.title).trim(),notes:String(args.notes||'')};
      if(args.due){if(!/^\d{4}-\d{2}-\d{2}$/.test(args.due)||(Number.isNaN(Date.parse(args.due))||new Date(args.due).toISOString().slice(0,10)!==args.due))throw new Error('Use a valid YYYY-MM-DD due date.');body.due=args.due+'T00:00:00.000Z';}
      const existing=await pages(`/lists/${encodeURIComponent(args.listId)}/tasks?showCompleted=false`);if(existing.items.some(task=>task.title?.trim().toLowerCase()===body.title.toLowerCase()))throw new Error('This task title already exists in the list. Inspect it before creating another task.');
      const task=await taskApi(`/lists/${encodeURIComponent(args.listId)}/tasks`+(args.parentId?'?parent='+encodeURIComponent(args.parentId):''),{method:'POST',body:JSON.stringify(body)});return {...task,summary:'Created task'};
    }
    if(name==='link_task'){
      const original=await read(args.path);if(!/\.md$/i.test(args.path)||/stillnote:type=/.test(original))throw new Error('Link a task to an ordinary Markdown note.');
      const base=`/lists/${encodeURIComponent(args.listId)}`,taskPath=base+'/tasks/'+encodeURIComponent(args.taskId);
      const [list,task]=await Promise.all([taskApi('/users/@me/lists/'+encodeURIComponent(args.listId)),taskApi(taskPath)]);
      const [lists,tasks]=await Promise.all([pages('/users/@me/lists'),pages(base+'/tasks?showCompleted=true&showHidden=true')]);
      if(lists.items.filter(item=>item.title?.trim().toLowerCase()===list.title?.trim().toLowerCase()).length!==1||tasks.items.filter(item=>item.title?.trim().toLowerCase()===task.title?.trim().toLowerCase()).length!==1)throw new Error('Task and task-list titles must be unique to create a working reference. Ask for distinct titles first.');
      const syntax=`;;${encodeURIComponent(list.title)}/${encodeURIComponent(task.title)};;`,updated=original.includes(syntax)?original:original.replace(/\s*$/,'')+'\n\n'+syntax+'\n';
      const line=updated.slice(0,updated.indexOf(syntax)).split('\n').length,link=`stillnote://open?${new URLSearchParams({note:args.path,line:String(line)})}`;
      const notes=String(task.notes||'');if(!notes.includes(link))await taskApi(taskPath,{method:'PATCH',body:JSON.stringify({notes:notes+(notes?'\n\n':'')+'Stillnote note: '+link})});
      if(await read(args.path)!==original)throw new Error('The note changed while linking. Read it again; the task backlink was saved.');
      if(updated!==original)await fs.writeFile(await target(args.path),updated,'utf8');return {path:args.path,taskId:task.id,reference:syntax,line,summary:'Linked task and note in both directions'};
    }
    throw new Error('Unknown Home AI tool: '+name);
  };
}
module.exports={createHomeTools,READ_TOOLS,parseCsv,profileData};
