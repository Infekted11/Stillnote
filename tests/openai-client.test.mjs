import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const {OPENAI_BASE_URL,DEFAULT_OPENAI_MODEL,HOME_RESPONSE_SCHEMA,NOTE_RESPONSE_SCHEMA,listOpenAiModels,openAiChat,responseText}=createRequire(import.meta.url)('../electron/openai-client.cjs');
const {aiProvider}=createRequire(import.meta.url)('../electron/ai-providers.cjs');
const response=(body,status=200)=>({ok:status<400,status,json:async()=>body});
const output=text=>({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text}]}]});
test('OpenAI model discovery uses project authentication and filters unsupported modalities',async()=>{
  const models=await listOpenAiModels({apiKey:'openai-test',fetchImpl:async(url,options)=>{
    assert.equal(url,OPENAI_BASE_URL+'/models');assert.equal(options.headers.Authorization,'Bearer openai-test');
    return response({data:[{id:DEFAULT_OPENAI_MODEL},{id:'gpt-4.1-mini'},{id:'gpt-4.1-mini'},{id:'text-embedding-3-small'},{id:'gpt-4o-realtime-preview'},{id:'gpt-image-1'},{id:'gpt-5-chat-latest'},{}]});
  }});
  assert.deepEqual(models,['gpt-4.1-mini',DEFAULT_OPENAI_MODEL]);
});
test('Responses requests use stateless structured JSON and the existing conversation',async()=>{
  const messages=[{role:'system',content:'Reply with JSON'},{role:'user',content:'Summarize'}];
  const result=await openAiChat({apiKey:'openai-test',messages,fetchImpl:async(url,options)=>{
    assert.equal(url,OPENAI_BASE_URL+'/responses');assert.equal(options.headers.Authorization,'Bearer openai-test');
    const body=JSON.parse(options.body);assert.equal(body.model,DEFAULT_OPENAI_MODEL);assert.deepEqual(body.input,messages);
    assert.equal(body.store,false);assert.equal(body.text.format.type,'json_schema');assert.equal(body.text.format.strict,true);
    assert.deepEqual(body.text.format.schema,NOTE_RESPONSE_SCHEMA);assert.equal(body.max_tokens,undefined);assert.equal(body.messages,undefined);
    return response(output('{"kind":"answer","text":"Hello","tasks":[]}'));
  }});
  assert.equal(JSON.parse(result).text,'Hello');
});
test('Home requests use the tool-action schema without weakening it on API errors',async()=>{
  let calls=0;
  await assert.rejects(openAiChat({apiKey:'x',messages:[],schema:HOME_RESPONSE_SCHEMA,fetchImpl:async(url,options)=>{
    calls++;const body=JSON.parse(options.body);assert.equal(body.text.format.name,'stillnote_home');assert.deepEqual(body.text.format.schema,HOME_RESPONSE_SCHEMA);
    return response({error:{message:'Unsupported response format'}},400);
  }}),/Unsupported response format/);assert.equal(calls,1);
});
test('authentication and unsupported model errors are not retried',async()=>{
  let calls=0;
  await assert.rejects(openAiChat({apiKey:'bad',messages:[],fetchImpl:async()=>{calls++;return response({error:{message:'Invalid API key'}},401);}}),/Invalid API key/);
  assert.equal(calls,1);
  await assert.rejects(listOpenAiModels({apiKey:'x',fetchImpl:async()=>response({data:[]})}),/No supported/);
  await assert.rejects(openAiChat({apiKey:'x',model:'gpt-image-1',messages:[],fetchImpl:async()=>{throw new Error('Should not send');}}),/supported OpenAI text model/);
});
test('response extraction ignores reasoning and rejects incomplete responses and refusals',()=>{
  const data=output('{"text":"Hi"}');data.output.unshift({type:'reasoning',content:[{type:'output_text',text:'Private reasoning'}]});
  assert.equal(responseText(data),'{"text":"Hi"}');
  assert.throws(()=>responseText({status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output:[]}),/output limit/);
  assert.throws(()=>responseText({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'refusal',refusal:'No'}]}]}),/could not fulfill/);
  assert.throws(()=>responseText({status:'completed',output:[]}),/complete answer/);
});
test('structured output schemas close every object and require all declared fields',()=>{
  const visit=schema=>{
    if(schema.type==='object'){assert.equal(schema.additionalProperties,false);assert.deepEqual(schema.required,Object.keys(schema.properties));for(const property of Object.values(schema.properties))visit(property);}
    if(schema.items)visit(schema.items);if(schema.anyOf)schema.anyOf.forEach(visit);
  };
  visit(HOME_RESPONSE_SCHEMA);visit(NOTE_RESPONSE_SCHEMA);
});
const main=await readFile(new URL('../electron/main.cjs',import.meta.url),'utf8');
test('previous provider credentials cannot authenticate to OpenAI',async()=>{
  const context=vm.createContext({safeStorage:{isEncryptionAvailable:()=>true},readVaultCredentials:async()=>({ollamaApiKey:'old-key',nousApiKey:'old-nous-key'})});
  const start=main.indexOf('async function readOpenAiKey()');vm.runInContext(main.slice(start,main.indexOf('async function migrateLegacyCredentials()',start)),context);
  await assert.rejects(context.readOpenAiKey(),/OpenAI API key/);
  context.readVaultCredentials=async()=>({nousApiKey:'old-nous',openaiApiKey:'new-openai-key'});
  assert.equal(await context.readOpenAiKey(),'new-openai-key');
});
test('key settings save and clear only the OpenAI credential',async()=>{
  const handlers=new Map(),credentials={nousApiKey:'keep-old',desmosApiKey:'keep-desmos'};
  const context=vm.createContext({aiProvider,ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},vaultPath:'/vault',safeStorage:{isEncryptionAvailable:()=>true},readVaultCredentials:async()=>credentials,updateVaultCredentials:async updates=>Object.assign(credentials,updates)});
  const start=main.indexOf("  ipcMain.handle('ai:key-status'");vm.runInContext(main.slice(start,main.indexOf("  ipcMain.handle('desmos:key-status'",start)),context);
  assert.equal((await handlers.get('ai:key-status')()).configured,false);
  await handlers.get('ai:key-save')(null,' new-openai-key ');assert.equal(credentials.openaiApiKey,'new-openai-key');
  assert.equal((await handlers.get('ai:key-status')()).configured,true);
  await handlers.get('ai:key-clear')();assert.equal(credentials.openaiApiKey,null);assert.equal(credentials.nousApiKey,'keep-old');assert.equal(credentials.desmosApiKey,'keep-desmos');
});
test('Home and note assistants both route to OpenAI, with their respective schemas',async()=>{
  const handlers=new Map(),calls=[];
  const context=vm.createContext({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},vaultPath:'/vault',readAiProviderKey:async()=> 'openai-test',HOME_RESPONSE_SCHEMA,AbortController,setTimeout,clearTimeout,homeModelRequests:new Map(),homeSystemPrompt:()=> 'Home JSON system',aiProvider:(id)=>({...aiProvider(id),chat:async request=>{calls.push(request);return request.schema===HOME_RESPONSE_SCHEMA?'{"kind":"done","text":"Done","plan":[],"actions":[]}':'{"kind":"answer","text":"Answer","tasks":[]}';}})});
  const start=main.indexOf("  ipcMain.handle('home:step'");vm.runInContext(main.slice(start,main.indexOf("  ipcMain.handle('vault:list'",start)),context);
  const home=await handlers.get('home:step')(null,{vault:'/vault',mode:'work',requestId:'test',messages:[{role:'user',content:'Make a plan'}]});assert.equal(home.kind,'done');
  const note=await handlers.get('ai:chat')(null,{mode:'ask',document:'Note content',prompt:'Summarize'});assert.equal(note.text,'Answer');
  assert.equal(calls.length,2);assert(calls.every(call=>call.apiKey==='openai-test'&&call.model===DEFAULT_OPENAI_MODEL));
  assert.equal(calls[0].schema,HOME_RESPONSE_SCHEMA);assert.equal(calls[1].schema,undefined);
});
