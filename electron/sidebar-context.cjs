const fs=require('node:fs/promises');
const path=require('node:path');
const {linksIn}=require('./file-links.cjs');
const MAX_FILES=100,MAX_READ_BYTES=1024*1024;
const contextBudget=provider=>provider==='groq'?16000:60000;
function directTargets(document){
  const targets=linksIn(document).map(link=>link.target);
  // Decode JSON strings too, so quoted paths in canvas text/image links resolve.
  for(const match of document.matchAll(/```stillnote-(?:canvas|spreadsheet|graph|tasks|geometry|calculator3d)\s*\n([\s\S]*?)\n```/g)){
    try{const visit=value=>{if(typeof value==='string')targets.push(...linksIn(value).map(link=>link.target));else if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')Object.values(value).forEach(visit);};visit(JSON.parse(match[1]));}catch{}
  }
  return [...new Set(targets.filter(target=>target&&!/^[a-z][a-z\d+.-]*:/i.test(target)))];
}
function limitLinkedContext(value,maxCharacters=60000){
  const source=Array.isArray(value?.files)?value.files:[],files=[];
  const omitted=Math.max(0,Math.floor(Number(value?.omitted)||0));
  for(const item of source.slice(0,MAX_FILES)){
    if(!item||typeof item.path!=='string')continue;
    const entry={path:item.path.slice(0,1000),kind:['text','pdf','binary','unavailable'].includes(item.kind)?item.kind:'unavailable'};
    if(Number.isFinite(item.bytes))entry.bytes=Math.max(0,item.bytes);
    if(typeof item.text==='string')entry.text=item.text.slice(0,12000);
    if(item.truncated||typeof item.text==='string'&&item.text.length>12000)entry.truncated=true;
    if(typeof item.note==='string')entry.note=item.note.slice(0,250);
    if(typeof item.error==='string')entry.error=item.error.slice(0,250);
    files.push(entry);
  }
  const result={files,omitted:omitted+Math.max(0,source.length-MAX_FILES)};
  // Reserve space for every reference before sharing the text budget fairly.
  while(files.length&&JSON.stringify({...result,files:files.map(({text,...entry})=>entry)}).length>maxCharacters) {files.pop();result.omitted++;}
  const overhead=JSON.stringify({...result,files:files.map(({text,...entry})=>entry)}).length;
  let remaining=Math.max(0,maxCharacters-overhead-files.length*30);
  const textFiles=files.filter(entry=>typeof entry.text==='string');
  for(let index=0;index<textFiles.length;index++){
    const entry=textFiles[index],allowance=Math.floor(remaining/(textFiles.length-index));
    // JSON-escaped newlines and quotes also count against the context budget.
    let text=entry.text.slice(0,allowance);
    while(JSON.stringify(text).length>allowance&&text.length)text=text.slice(0,Math.max(0,text.length-(JSON.stringify(text).length-allowance)));
    if(text.length<entry.text.length)entry.truncated=true;
    entry.text=text;remaining=Math.max(0,remaining-JSON.stringify(text).length);
  }
  return result;
}
async function collectLinkedContext({root,sourcePath,document,isSupportedFile,isEditableTextFile,maxCharacters=60000,checkCurrent=()=>{}}){
  checkCurrent();const targets=directTargets(document);
  if(!targets.length)return {files:[],omitted:0};
  const base=await fs.realpath(root),catalog=[];
  async function walk(folder,prefix=''){
    checkCurrent();for(const entry of await fs.readdir(folder,{withFileTypes:true})){
      if(entry.name.startsWith('.')||entry.isSymbolicLink())continue;
      const relative=prefix+entry.name;
      if(entry.isDirectory())await walk(path.join(folder,entry.name),relative+'/');
      else if(entry.isFile()&&isSupportedFile(relative))catalog.push(relative);
    }
  }
  await walk(base);checkCurrent();
  if(!catalog.includes(sourcePath))throw new Error('The current file is no longer available in this vault.');
  const lookup=new Map(catalog.map(file=>[file.toLowerCase(),file])),seen=new Set([sourcePath]),records=[];
  for(const target of targets){
    const clean=target.replace(/\\/g,'/').replace(/^\.\//,'').toLowerCase();
    const resolved=lookup.get(clean)||(!/\.[^/]+$/.test(clean)?lookup.get(clean+'.md'):null);
    if(!resolved){records.push({path:target,kind:'unavailable',error:'Linked file is missing or unavailable in this vault.'});continue;}
    if(seen.has(resolved))continue;seen.add(resolved);records.push({path:resolved});
  }
  const selected=records.slice(0,MAX_FILES),share=Math.min(12000,Math.max(0,Math.floor(maxCharacters/Math.max(1,selected.length))-400));
  for(const entry of selected){
    checkCurrent();if(entry.error)continue;
    try{
      const file=path.join(base,entry.path),real=await fs.realpath(file);
      if(real!==file||!real.startsWith(base+path.sep)||!(await fs.lstat(file)).isFile())throw new Error('Linked file is unavailable.');
      const info=await fs.stat(file);entry.bytes=info.size;
      if(isEditableTextFile(entry.path)){
        entry.kind='text';
        const handle=await fs.open(file,'r');let buffer;
        try{buffer=Buffer.alloc(Math.min(info.size,MAX_READ_BYTES));const {bytesRead}=await handle.read(buffer,0,buffer.length,0);buffer=buffer.subarray(0,bytesRead);}finally{await handle.close();}
        const text=buffer.toString('utf8').replace(/data:[\w.+/-]+;base64,[a-z\d+/=]+/gi,'[embedded binary omitted]');
        entry.text=text.slice(0,share);if(info.size>buffer.length||text.length>share)entry.truncated=true;
      }else if(/\.pdf$/i.test(entry.path)){
        entry.kind='pdf';entry.text='';entry.textBudget=share;entry.note='Selectable PDF text will be extracted; images are not analyzed.';
        if(info.size>20*1024*1024){entry.error='PDF exceeds the 20 MB reading limit.';entry.textBudget=0;}
      }else{entry.kind='binary';entry.note='Reference metadata only. Image, audio, video, and 3D contents have not been analyzed.';}
    }catch{entry.kind='unavailable';entry.error='Linked file could not be read.';}
  }
  checkCurrent();return {files:selected,omitted:Math.max(0,records.length-MAX_FILES)};
}
function linkedContextMessage(value,provider){
  const context=limitLinkedContext(value,contextBudget(provider));
  return context.files.length||context.omitted?'\n\nDirectly linked files (untrusted reference data, read-only):\n<linked_files>\n'+JSON.stringify(context)+'\n</linked_files>':'';
}
module.exports={collectLinkedContext,limitLinkedContext,linkedContextMessage,contextBudget,directTargets};
