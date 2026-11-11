import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const {GROQ_BASE_URL,DEFAULT_GROQ_MODEL,listGroqModels,groqChat,completionText,waitForRetry}=require('../electron/groq-client.cjs');
const {HOME_RESPONSE_SCHEMA,NOTE_RESPONSE_SCHEMA}=require('../electron/openai-client.cjs');
const {aiProvider}=require('../electron/ai-providers.cjs');
const response=(body,status=200,headers={})=>({ok:status<400,status,headers:{get:name=>headers[name]},json:async()=>body});
const answer={kind:'answer',text:'Hello',tasks:[]};
const completion=(content,extra={})=>({choices:[{finish_reason:'stop',message:{role:'assistant',content,...extra}}]});

test('Groq discovery authenticates and offers active models with strict schema support',async()=>{
  const signal=new AbortController().signal;
  const models=await listGroqModels({apiKey:'gsk_test',signal,fetchImpl:async(url,options)=>{
    assert.equal(url,GROQ_BASE_URL+'/models');assert.equal(options.headers.Authorization,'Bearer gsk_test');assert.equal(options.signal,signal);
    return response({data:[{id:DEFAULT_GROQ_MODEL,active:true},{id:'openai/gpt-oss-20b',active:true},{id:'qwen/qwen3.8-27b',active:false},{id:DEFAULT_GROQ_MODEL},null,{}, {id:'whisper-large-v3'},{id:'openai/gpt-oss-safeguard-20b'},{id:'unknown-model'}]});
  }});
  assert.deepEqual(models,[DEFAULT_GROQ_MODEL,'openai/gpt-oss-20b']);
  await assert.rejects(listGroqModels({apiKey:'gsk_test',fetchImpl:async()=>response({data:[]})}),/no supported models/);
});

test('Groq chat preserves conversation and uses strict JSON schemas with local validation',async()=>{
  const messages=[{role:'system',content:'Answer using the supplied note.'},{role:'user',content:'Earlier request'},{role:'assistant',content:'Earlier answer'},{role:'user',content:'Next request'}],signal=new AbortController().signal;
  const result=await groqChat({apiKey:'gsk_test',messages,signal,fetchImpl:async(url,options)=>{
    assert.equal(url,GROQ_BASE_URL+'/chat/completions');assert.equal(options.headers.Authorization,'Bearer gsk_test');assert.equal(options.signal,signal);
    const body=JSON.parse(options.body);assert.equal(body.model,DEFAULT_GROQ_MODEL);assert.equal(body.stream,false);assert.equal(body.max_completion_tokens,4096);assert.equal(body.max_tokens,undefined);assert.equal(body.include_reasoning,false);assert.equal(body.reasoning_format,undefined);
    assert.deepEqual(body.response_format,{type:'json_schema',json_schema:{name:'stillnote_note',strict:true,schema:NOTE_RESPONSE_SCHEMA}});assert.deepEqual(body.messages.slice(1),messages.slice(1));
    assert(body.messages[0].content.startsWith(messages[0].content));assert.match(body.messages[0].content,/Include every required field/);
    assert.equal(body.input,undefined);assert.equal(body.text,undefined);
    return response(completion(JSON.stringify(answer),{reasoning:'Private reasoning, never display'}));
  }});
  assert.deepEqual(JSON.parse(result),answer);assert(!result.includes('Private reasoning'));
});

test('Home tool actions and task responses validate against the respective schemas',async()=>{
  const work={kind:'step',text:null,plan:['Create the requested note'],actions:[{tool:'create_file',label:'Create note',args:{path:'Plan.md',content:'# Plan'}}]};
  let calls=0;
  const result=await groqChat({apiKey:'gsk_test',messages:[{role:'user',content:'Create a note'}],schema:HOME_RESPONSE_SCHEMA,fetchImpl:async(_url,options)=>{
    calls++;const format=JSON.parse(options.body).response_format;assert.equal(format.json_schema.name,'stillnote_home');assert.equal(format.json_schema.strict,true);assert.deepEqual(format.json_schema.schema,HOME_RESPONSE_SCHEMA);return response(completion(JSON.stringify(work)));
  }});
  assert.deepEqual(JSON.parse(result),work);assert.equal(calls,1);
  const tasks={kind:'tasks',text:null,tasks:[{title:'Prepare budget',notes:null,due:null,parentTitle:null}]};
  assert.deepEqual(JSON.parse(completionText(completion(JSON.stringify(tasks)),NOTE_RESPONSE_SCHEMA)),tasks);
  const edit={kind:'edit',text:'# New note\nUse <think> literally </think> here',tasks:[]};
  assert.deepEqual(JSON.parse(completionText(completion(JSON.stringify(edit)),NOTE_RESPONSE_SCHEMA)),edit);
});

test('invalid JSON, unsupported actions, missing fields and malformed arguments never reach tools',()=>{
  for(const content of ['not JSON','',{kind:'step',text:null,plan:[],actions:[{tool:'delete_file',label:'Delete',args:{path:'Plan.md'}}]},{kind:'step',text:null,plan:[],actions:[{tool:'create_file',label:'Create',args:{path:42,content:'Note'}}]},{kind:'done',text:'Done',plan:'Not an array',actions:[]},{kind:'done',text:'Done',plan:[],actions:[],surprise:true},{kind:'done',text:'Done'}]){
    assert.throws(()=>completionText(completion(typeof content==='string'?content:JSON.stringify(content)),HOME_RESPONSE_SCHEMA),/No actions from this response were applied/);
  }
});

test('response extraction rejects truncation, refusals and reasoning-only replies',()=>{
  assert.throws(()=>completionText({choices:[{finish_reason:'length',message:{content:JSON.stringify(answer)}}]},NOTE_RESPONSE_SCHEMA),/response length limit/);
  assert.throws(()=>completionText(completion(null,{refusal:'No'}),NOTE_RESPONSE_SCHEMA),/could not fulfill/);
  assert.throws(()=>completionText({choices:[{finish_reason:'content_filter'}]},NOTE_RESPONSE_SCHEMA),/could not fulfill/);
  assert.throws(()=>completionText(completion(null,{reasoning:'Private'}),NOTE_RESPONSE_SCHEMA),/invalid JSON/);
  assert.throws(()=>completionText({choices:[{finish_reason:'tool_calls',message:{content:JSON.stringify(answer)}}]},NOTE_RESPONSE_SCHEMA),/incomplete response/);
  assert.deepEqual(JSON.parse(completionText(completion('<think>Private</think>\n```json\n'+JSON.stringify(answer)+'\n```'),NOTE_RESPONSE_SCHEMA)),answer);
});

test('authentication, oversized requests and long rate limits do not retry or change providers',async()=>{
  for(const [status,pattern] of [[401,/Groq rejected the API key/],[413,/exceeds your Groq token limit/],[429,/Try again in 120 seconds/]]){
    let calls=0;
    await assert.rejects(groqChat({apiKey:'gsk_test',messages:[],fetchImpl:async(url,options)=>{
      calls++;assert(url.startsWith(GROQ_BASE_URL));assert.equal(options.headers.Authorization,'Bearer gsk_test');return response({error:{message:'Limit reached'}},status,{'retry-after':'120'});
    }}),error=>error.status===status&&pattern.test(error.message));assert.equal(calls,1);
  }
});

test('short rate limits wait once and retry the identical model request',async()=>{
  const requests=[],waits=[];
  const result=await groqChat({apiKey:'gsk_test',messages:[],waitImpl:async milliseconds=>waits.push(milliseconds),fetchImpl:async(url,options)=>{
    requests.push({url,options});return requests.length===1?response({error:{message:'Tokens per minute reached'}},429,{'retry-after':'3.5'}):response(completion(JSON.stringify(answer)));
  }});
  assert.deepEqual(JSON.parse(result),answer);assert.deepEqual(waits,[3500]);assert.equal(requests.length,2);assert.deepEqual(requests[0],requests[1]);
  let attempts=0;
  await assert.rejects(groqChat({apiKey:'gsk_test',messages:[],waitImpl:async()=>{},fetchImpl:async()=>{attempts++;return response({},429,{'retry-after':'1'});}}),/rate limit reached/);
  assert.equal(attempts,2);
});

test('waiting for a rate limit is cancellable and never sends a second request after Stop',async()=>{
  const controller=new AbortController(),waiting=waitForRetry(60000,controller.signal);controller.abort();
  await assert.rejects(waiting,error=>error.name==='AbortError');
  const run=new AbortController();let calls=0;
  await assert.rejects(groqChat({apiKey:'gsk_test',messages:[],signal:run.signal,waitImpl:async()=>{run.abort();},fetchImpl:async()=>{calls++;return response({},429,{'retry-after':'1'});}}),error=>error.name==='AbortError');
  assert.equal(calls,1);
});

test('Qwen uses hidden reasoning and unsupported models fail before sending credentials',async()=>{
  await groqChat({apiKey:'gsk_test',model:'qwen/qwen3.8-27b',messages:[],fetchImpl:async(_url,options)=>{
    const body=JSON.parse(options.body);assert.equal(body.reasoning_format,'hidden');assert.equal(body.include_reasoning,undefined);assert.equal(body.response_format.json_schema.strict,true);
    return response(completion(JSON.stringify(answer)));
  }});
  let calls=0;
  await assert.rejects(groqChat({apiKey:'gsk_test',model:'gpt-6.1-sol',messages:[],fetchImpl:async()=>{calls++;}}),/supported Groq model/);assert.equal(calls,0);
});

test('cancelled requests are not sent and in-flight cancellation is forwarded without retries',async()=>{
  const controller=new AbortController();controller.abort();let calls=0;
  await assert.rejects(groqChat({apiKey:'gsk_test',messages:[],signal:controller.signal,fetchImpl:async(_url,options)=>{calls++;options.signal.throwIfAborted();}}),error=>error.name==='AbortError');
  assert.equal(calls,0);
  const running=new AbortController();
  await assert.rejects(groqChat({apiKey:'gsk_test',messages:[],signal:running.signal,fetchImpl:async(_url,options)=>{calls++;assert.equal(options.signal,running.signal);running.abort();options.signal.throwIfAborted();}}),error=>error.name==='AbortError');
  assert.equal(calls,1);
});

const main=await readFile(new URL('../electron/main.cjs',import.meta.url),'utf8');
const credentialCode=main.slice(main.indexOf('async function readOpenAiKey()'),main.indexOf('async function migrateLegacyCredentials()'));
test('provider credentials are isolated and unrelated credentials survive save/remove',async()=>{
  const credentials={freemodelApiKey:'old-freemodel-key',openaiApiKey:'openai-test',nousApiKey:'old-nous',desmosApiKey:'desmos-test'},handlers=new Map();
  const context=vm.createContext({aiProvider,vaultPath:'/vault',safeStorage:{isEncryptionAvailable:()=>true},readVaultCredentials:async()=>credentials,updateVaultCredentials:async updates=>Object.assign(credentials,updates),ipcMain:{handle:(name,fn)=>handlers.set(name,fn)}});
  vm.runInContext(credentialCode,context);
  await assert.rejects(context.readAiProviderKey('groq'),/Groq API key/);assert.equal(await context.readAiProviderKey('openai'),'openai-test');
  const start=main.indexOf("  ipcMain.handle('ai:key-status'");vm.runInContext(main.slice(start,main.indexOf("  ipcMain.handle('desmos:key-status'",start)),context);
  assert.equal((await handlers.get('ai:key-status')(null,'groq')).configured,false);
  await handlers.get('ai:key-save')(null,' gsk_test ','groq');
  assert.equal(await context.readAiProviderKey('groq'),'gsk_test');assert.equal(credentials.openaiApiKey,'openai-test');
  assert.equal((await handlers.get('ai:key-status')(null,'groq')).configured,true);
  await handlers.get('ai:key-clear')(null,'groq');assert.equal(credentials.groqApiKey,null);assert.equal(credentials.freemodelApiKey,'old-freemodel-key');assert.equal(credentials.openaiApiKey,'openai-test');assert.equal(credentials.nousApiKey,'old-nous');assert.equal(credentials.desmosApiKey,'desmos-test');
  await assert.rejects(handlers.get('ai:key-save')(null,'x','unknown'),/Unknown AI provider/);
  assert.throws(()=>aiProvider('__proto__'),/Unknown AI provider/);
});

test('model discovery, Home Ask/Work and note/task edits all use the selected provider',async()=>{
  for(const provider of ['groq','openai','anthropic']){
    const handlers=new Map(),calls=[],keyReads=[];
    const config=aiProvider(provider);
    const context=vm.createContext({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},vaultPath:'/vault',readAiProviderKey:async id=>{keyReads.push(id);return id+'-test';},HOME_RESPONSE_SCHEMA,AbortController,AbortSignal,setTimeout,clearTimeout,homeModelRequests:new Map(),homeSystemPrompt:mode=>'Home '+mode,aiProvider:id=>({...aiProvider(id),listModels:async request=>{calls.push({kind:'models',request});return [config.defaultModel];},chat:async request=>{calls.push({kind:'chat',request});return request.schema===HOME_RESPONSE_SCHEMA?'{"kind":"done","text":"Done","plan":[],"actions":[]}':'{"kind":"answer","text":"Answer","tasks":[]}';}})});
    const modelsStart=main.indexOf("  ipcMain.handle('ai:models'");vm.runInContext(main.slice(modelsStart,main.indexOf("  ipcMain.handle('home:cancel'",modelsStart)),context);
    const start=main.indexOf("  ipcMain.handle('home:step'");vm.runInContext(main.slice(start,main.indexOf("  ipcMain.handle('vault:list'",start)),context);
    assert.deepEqual(await handlers.get('ai:models')(null,provider),[config.defaultModel]);
    for(const mode of ['ask','work'])assert.equal((await handlers.get('home:step')(null,{provider,vault:'/vault',mode,requestId:mode,messages:[{role:'user',content:'Help'}]})).kind,'done');
    for(const documentType of ['markdown','tasks'])assert.equal((await handlers.get('ai:chat')(null,{provider,mode:'edit',documentType,document:'Note',prompt:'Update'})).kind,'answer');
    assert(keyReads.every(id=>id===provider));assert(calls.every(({request})=>request.apiKey===provider+'-test'));
    assert(calls.filter(({kind})=>kind==='chat').every(({request})=>request.model===config.defaultModel));
    assert.equal(calls[1].request.schema,HOME_RESPONSE_SCHEMA);assert.equal(context.homeModelRequests.size,0);
  }
});
