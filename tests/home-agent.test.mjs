import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source=await readFile(new URL('../src/home-agent.js',import.meta.url),'utf8');
const {runHomeAgent,compactHomeContext}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('Work performs multiple action levels and uses actual results before finishing',async()=>{
  let round=0;const executed=[],progress=[];
  const result=await runHomeAgent({mode:'work',prompt:'Create and link two project files',modelStep:async({messages})=>{
    round++;
    if(round===1)return {kind:'step',plan:['Create notes','Link notes','Verify'],actions:[{tool:'create_file',args:{path:'A.md',content:'A'}},{tool:'create_file',args:{path:'B.md',content:'B'}}]};
    if(round===2){assert(messages.some(m=>m.content.includes('A.md')));return {kind:'step',actions:[{tool:'link_files',args:{path:'A.md',target:'B.md'}},{tool:'read_file',args:{path:'A.md'}}]};}
    return {kind:'done',text:'Created and linked <[A.md]> and <[B.md]>.'};
  },tool:async(name,args)=>{executed.push(name);return {path:args.path,revision:'abc',summary:'Success'};},onProgress:value=>progress.push(value.label)});
  assert.equal(result.kind,'done');assert.deepEqual(executed,['create_file','create_file','link_files','read_file']);
  assert.equal(result.events.length,4);assert(result.context.some(m=>m.content.includes('Recorded action outcomes')));assert(progress.length>4);
});
test('clarification pauses before any actions, and a follow-up retains context',async()=>{
  const first=await runHomeAgent({mode:'work',prompt:'Organize my project',modelStep:async()=>({kind:'question',text:'Which project and task list?',actions:[{tool:'create_file'}]}),tool:async()=>{throw new Error('Should not execute');}});
  assert.equal(first.kind,'question');assert.equal(first.events.length,0);
  const next=await runHomeAgent({mode:'work',prompt:'The Garden project, with no tasks yet',context:first.context,modelStep:async({messages})=>{assert(messages.some(m=>m.content.includes('Which project')));return {kind:'done',text:'Understood.'};},tool:async()=>{}});
  assert.equal(next.kind,'done');
});
test('Ask rejects write actions without executing the tool',async()=>{
  let rounds=0,executed=0;
  const result=await runHomeAgent({mode:'ask',prompt:'Create a file',modelStep:async()=>++rounds===1?{kind:'step',actions:[{tool:'create_file',args:{}}]}:{kind:'question',text:'Switch to Work?'},tool:async()=>{executed++;}});
  assert.equal(executed,0);assert.equal(result.events[0].status,'error');assert.match(result.events[0].summary,/read-only/);
});
test('cancelling preserves completed actions and never starts the next mutation',async()=>{
  let cancelled=false,calls=0;
  const result=await runHomeAgent({mode:'work',prompt:'Create two files',stopped:()=>cancelled,modelStep:async()=>({kind:'step',actions:[{tool:'create_file',args:{path:'A.md'}},{tool:'create_file',args:{path:'B.md'}}]}),tool:async()=>{calls++;cancelled=true;return {path:'A.md'};}});
  assert.equal(calls,1);assert.equal(result.kind,'stopped');assert.equal(result.events[0].status,'done');assert(result.context.some(m=>m.content.includes('A.md')));
});
test('failed actions stop the batch and are reported to the next planning step',async()=>{
  let round=0,calls=0;
  const result=await runHomeAgent({mode:'work',prompt:'Create tasks',modelStep:async({messages})=>{
    if(!round++)return {kind:'step',actions:[{tool:'create_task',args:{}},{tool:'create_task',args:{}}]};
    assert(messages.some(m=>m.content.includes('Disconnected')));return {kind:'question',text:'Connect Google Tasks first?'};
  },tool:async()=>{calls++;throw new Error('Disconnected');}});
  assert.equal(calls,1);assert.equal(result.events[0].status,'error');assert.equal(result.kind,'question');
});
test('context compaction preserves the original objective and the newest observations',()=>{
  const messages=[{role:'user',content:'Original project objective'},...Array.from({length:50},(_,i)=>({role:'user',content:String(i)+'x'.repeat(5000)}))];
  const result=compactHomeContext(messages,30000);assert.equal(result[0].content,'Original project objective');assert.match(result.at(-1).content,/^49/);assert(result.reduce((n,m)=>n+m.content.length,0)<=30000);
});
test('aborting an in-flight model request returns stopped and retains completed work',async()=>{
  let cancelled=false;
  const result=await runHomeAgent({mode:'work',prompt:'Plan',stopped:()=>cancelled,modelStep:async()=>{cancelled=true;throw new Error('Aborted');},tool:async()=>{}});
  assert.equal(result.kind,'stopped');assert.match(result.text,/Stopped/);
});
test('malformed action batches are rejected before any mutations start',async()=>{
  let calls=0;
  const result=await runHomeAgent({mode:'work',prompt:'Create',modelStep:async()=>({kind:'step',actions:[{tool:'create_file',args:{}},null]}),tool:async()=>{calls++;}});
  assert.equal(result.kind,'error');assert.equal(calls,0);
});
