import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const {ANTHROPIC_BASE_URL,ANTHROPIC_VERSION,DEFAULT_ANTHROPIC_MODEL,listAnthropicModels,anthropicChat,anthropicResponseText}=require('../electron/anthropic-client.cjs');
const {HOME_RESPONSE_SCHEMA,NOTE_RESPONSE_SCHEMA}=require('../electron/ai-schema.cjs');
const {aiProvider}=require('../electron/ai-providers.cjs');
const response=(body,status=200,headers={})=>({ok:status<400,status,headers:{get:name=>headers[name]},json:async()=>body});
const answer={kind:'answer',text:'Hello',tasks:[]};
const message=result=>({type:'message',role:'assistant',stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(result)}]});
const supported=id=>({id,lifecycle:'active',capabilities:{structured_outputs:{supported:true}}});
const prompt=[{role:'user',content:'Summarize this note'}];

test('Anthropic model discovery follows authenticated pages and filters capability and lifecycle',async()=>{
  const signal=new AbortController().signal;let calls=0;
  const models=await listAnthropicModels({apiKey:'anthropic-test',signal,fetchImpl:async(url,options)=>{
    calls++;const parsed=new URL(url);assert.equal(parsed.origin+parsed.pathname,ANTHROPIC_BASE_URL+'/models');assert.equal(parsed.searchParams.get('limit'),'100');
    assert.equal(options.headers.Authorization,'Bearer anthropic-test');assert.equal(options.headers['anthropic-version'],ANTHROPIC_VERSION);assert.equal(options.signal,signal);
    if(calls===1){assert.equal(parsed.searchParams.has('after_id'),false);return response({data:[supported(DEFAULT_ANTHROPIC_MODEL),supported(DEFAULT_ANTHROPIC_MODEL),{...supported('claude-retired'),lifecycle:'retired'},{id:'claude-unsupported',capabilities:{structured_outputs:{supported:false}}},null,{}],has_more:true,last_id:'cursor/with space'});}
    assert.equal(parsed.searchParams.get('after_id'),'cursor/with space');
    return response({data:[supported('claude-haiku-5-5')],has_more:false});
  }});
  assert.equal(calls,2);assert.deepEqual(models,['claude-haiku-5-5',DEFAULT_ANTHROPIC_MODEL]);
});

test('empty catalogs, malformed pagination and later-page failures do not return partial models',async()=>{
  await assert.rejects(listAnthropicModels({apiKey:'x',fetchImpl:async()=>response({data:[],has_more:false})}),/no Claude models/);
  let calls=0;
  await assert.rejects(listAnthropicModels({apiKey:'x',fetchImpl:async()=>{calls++;return response({data:[supported(DEFAULT_ANTHROPIC_MODEL)],has_more:true,last_id:'repeated'});}}),/invalid model pagination/);assert.equal(calls,2);
  calls=0;
  await assert.rejects(listAnthropicModels({apiKey:'x',fetchImpl:async()=>++calls===1?response({data:[supported(DEFAULT_ANTHROPIC_MODEL)],has_more:true,last_id:'page1'}):response({error:{message:'Account not permitted'}},403)}),/Account not permitted/);
});

test('Messages requests separate system prompts from conversation and send native JSON schema output',async()=>{
  const messages=[{role:'system',content:'Answer using the current note.'},{role:'user',content:'Earlier request'},{role:'assistant',content:'Earlier answer'},...prompt],signal=new AbortController().signal;
  const result=await anthropicChat({apiKey:'anthropic-test',messages,signal,fetchImpl:async(url,options)=>{
    assert.equal(url,ANTHROPIC_BASE_URL+'/messages');assert.equal(options.method,'POST');assert.equal(options.headers.Authorization,'Bearer anthropic-test');assert.equal(options.headers['anthropic-version'],ANTHROPIC_VERSION);assert.equal(options.signal,signal);
    const body=JSON.parse(options.body);assert.equal(body.model,DEFAULT_ANTHROPIC_MODEL);assert.equal(body.stream,false);assert.equal(body.max_tokens,16384);
    assert(body.system.startsWith(messages[0].content));assert.deepEqual(body.messages,messages.slice(1));assert.deepEqual(body.output_config,{format:{type:'json_schema',schema:NOTE_RESPONSE_SCHEMA}});
    assert.equal(body.response_format,undefined);assert.equal(body.temperature,undefined);assert.equal(body.tools,undefined);
    const data=message(answer);data.content.unshift({type:'thinking',thinking:'Private analysis',signature:'private signature'});return response(data);
  }});
  assert.deepEqual(JSON.parse(result),answer);assert(!result.includes('Private'));
});

test('Home actions and file edits use the correct schema and preserve document contents',async()=>{
  const action={kind:'step',text:null,plan:['Create a plan'],actions:[{tool:'create_file',label:'Create plan',args:{path:'Plan.md',content:'# Plan'}}]};
  const result=await anthropicChat({apiKey:'x',messages:prompt,schema:HOME_RESPONSE_SCHEMA,fetchImpl:async(_url,options)=>{
    assert.deepEqual(JSON.parse(options.body).output_config.format.schema,HOME_RESPONSE_SCHEMA);return response(message(action));
  }});
  assert.deepEqual(JSON.parse(result),action);
  const edit={kind:'edit',text:'# Note\n<think>Literal text</think>\n```js\nconst example = true;\n```',tasks:[]};
  const data=message(edit),text=data.content[0].text;data.content=[{type:'text',text:text.slice(0,20)},{type:'thinking',thinking:'Hidden'},{type:'text',text:text.slice(20)}];
  assert.deepEqual(JSON.parse(anthropicResponseText(data)),edit);
  const tasks={kind:'tasks',text:null,tasks:[{title:'Prepare budget',notes:null,due:null,parentTitle:null}]};
  assert.deepEqual(JSON.parse(anthropicResponseText(message(tasks))),tasks);
});

test('refusals, partial answers, invalid JSON and invalid actions cannot be applied',()=>{
  for(const reason of ['refusal','max_tokens','model_context_window_exceeded','tool_use',null]){
    assert.throws(()=>anthropicResponseText({...message(answer),stop_reason:reason}),/could not fulfill|limit|incomplete response/);
  }
  assert.throws(()=>anthropicResponseText({...message(answer),content:[{type:'thinking',thinking:'Private'}]}),/invalid JSON/);
  assert.throws(()=>anthropicResponseText(message({kind:'edit',text:42,tasks:[]})),/invalid assistant response/);
  assert.throws(()=>anthropicResponseText(message({kind:'step',text:null,plan:[],actions:[{tool:'delete_file',label:'Delete',args:{path:'Note.md'}}]}),HOME_RESPONSE_SCHEMA),/No actions from this response were applied/);
  assert.throws(()=>anthropicResponseText({type:'error',error:{message:'Failed request'}}),/Failed request/);
});

test('authentication, credit, rate limit and overload failures do not retry or switch providers',async()=>{
  for(const [status,pattern] of [[401,/rejected the API key/],[400,/credit balance/],[429,/Try again in 15 seconds/],[529,/temporarily overloaded/]]){
    let calls=0;
    await assert.rejects(anthropicChat({apiKey:'anthropic-test',messages:prompt,fetchImpl:async(url,options)=>{
      calls++;assert.equal(url,ANTHROPIC_BASE_URL+'/messages');assert.equal(options.headers.Authorization,'Bearer anthropic-test');return response({error:{message:'Your credit balance is too low.'}},status,{'retry-after':'15'});
    }}),error=>error.status===status&&pattern.test(error.message));assert.equal(calls,1);
  }
});

test('invalid models and cancelled requests fail before sending; in-flight cancellation is forwarded',async()=>{
  let calls=0;
  await assert.rejects(anthropicChat({apiKey:'x',model:'gpt-6.1-sol',messages:prompt,fetchImpl:async()=>{calls++;}}),/Choose a Claude model/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(anthropicChat({apiKey:'x',messages:prompt,signal:controller.signal,fetchImpl:async()=>{calls++;}}),error=>error.name==='AbortError');assert.equal(calls,0);
  const running=new AbortController();
  await assert.rejects(anthropicChat({apiKey:'x',messages:prompt,signal:running.signal,fetchImpl:async(_url,options)=>{calls++;assert.equal(options.signal,running.signal);running.abort();options.signal.throwIfAborted();}}),error=>error.name==='AbortError');assert.equal(calls,1);
});

test('Anthropic credentials never reuse other providers and saving/removing preserves their keys',async()=>{
  const main=await readFile(new URL('../electron/main.cjs',import.meta.url),'utf8');
  const credentials={groqApiKey:'groq-test',openaiApiKey:'openai-test',desmosApiKey:'desmos-test'},handlers=new Map();
  const context=vm.createContext({aiProvider,vaultPath:'/vault',safeStorage:{isEncryptionAvailable:()=>true},readVaultCredentials:async()=>credentials,updateVaultCredentials:async updates=>Object.assign(credentials,updates),ipcMain:{handle:(name,fn)=>handlers.set(name,fn)}});
  vm.runInContext(main.slice(main.indexOf('async function readOpenAiKey()'),main.indexOf('async function migrateLegacyCredentials()')),context);
  await assert.rejects(context.readAiProviderKey('anthropic'),/Anthropic API key/);
  const start=main.indexOf("  ipcMain.handle('ai:key-status'");vm.runInContext(main.slice(start,main.indexOf("  ipcMain.handle('desmos:key-status'",start)),context);
  assert.equal((await handlers.get('ai:key-status')(null,'anthropic')).configured,false);
  await handlers.get('ai:key-save')(null,' anthropic-test ','anthropic');assert.equal(await context.readAiProviderKey('anthropic'),'anthropic-test');
  assert.equal((await handlers.get('ai:key-status')(null,'anthropic')).configured,true);
  await handlers.get('ai:key-clear')(null,'anthropic');assert.equal(credentials.anthropicApiKey,null);assert.equal(credentials.groqApiKey,'groq-test');assert.equal(credentials.openaiApiKey,'openai-test');assert.equal(credentials.desmosApiKey,'desmos-test');
});
