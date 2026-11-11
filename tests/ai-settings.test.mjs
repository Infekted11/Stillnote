import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function setup(){
  const elements=new Map(),stored=new Map([['stillnote-openai-model','gpt-saved'],['stillnote-groq-model','oss-saved']]);
  const element=()=>({value:'',textContent:'',dataset:{},replaceChildren(...children){this.children=children;}});
  const $=selector=>{if(!elements.has(selector))elements.set(selector,element());return elements.get(selector);};
  const context=vm.createContext({$,state:{aiProvider:'groq',vault:{path:'/vault'}},localStorage:{getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value)},document:{createElement:element},window:{stillnote:{}},setSettingsHealth:()=>{}});
  const config=source.indexOf('const AI_PROVIDERS =');vm.runInContext(source.slice(config,source.indexOf('const state =',config)),context);
  const start=source.indexOf('function aiModelStorageKey(');vm.runInContext(source.slice(start,source.indexOf('async function updateDesmosKeyStatus()',start)),context);
  const models=source.indexOf('let aiModelsRequest = 0;');vm.runInContext(source.slice(models,source.indexOf('function closeSettings()',models)),context);
  return {context,$,stored};
}
test('model preferences stay separate when a provider changes before discovery finishes',async()=>{
  const {context,$,stored}=setup(),free=deferred(),openai=deferred();
  context.window.stillnote.listAiModels=id=>id==='groq'?free.promise:openai.promise;
  const first=context.loadAiModels();assert.equal(context.selectedAiModel(),'oss-saved');
  context.state.aiProvider='openai';assert.equal(context.selectedAiModel(),'gpt-saved');
  const second=context.loadAiModels();openai.resolve(['gpt-new','gpt-saved']);await second;
  free.resolve(['oss-new']);await first;
  assert.equal($('#ai-model').dataset.provider,'openai');assert.equal($('#ai-model').value,'gpt-saved');assert.equal($('#ai-model').disabled,false);
  assert.equal($('#ai-model-status').textContent,'2 models available from OpenAI.');assert.equal(stored.get('stillnote-groq-model'),'oss-saved');
});
test('late key status and model errors cannot overwrite a different provider',async()=>{
  const {context,$}=setup(),oldStatus=deferred(),oldModels=deferred();
  context.window.stillnote.aiKeyStatus=id=>id==='groq'?oldStatus.promise:Promise.resolve({configured:true,vaultOpen:true,secureStorageAvailable:true});
  context.window.stillnote.listAiModels=id=>id==='groq'?oldModels.promise:Promise.resolve(['gpt-default']);
  const firstStatus=context.updateKeyStatus(),firstModels=context.loadAiModels();
  context.state.aiProvider='openai';await context.updateKeyStatus();await context.loadAiModels();
  oldStatus.reject(new Error('Stale Groq key error'));oldModels.reject(new Error('Stale Groq model error'));await firstStatus;await firstModels;
  assert.equal($('#ai-key-status').textContent,'Key saved in this vault');assert.equal($('#ai-model-status').textContent,'1 models available from OpenAI.');
});
test('provider settings clear an unsaved key and show the selected destination and allowance',()=>{
  const {context,$}=setup();$('#ai-key').value='unsaved-openai-key';context.syncAiProviderSettings();
  assert.equal($('#ai-key').value,'');assert.match($('#ai-provider-info').textContent,/daily and per-minute limits/);assert.match($('#ai-key-help').textContent,/sent directly to Groq/);
  context.state.aiProvider='openai';context.syncAiProviderSettings();assert.equal($('#ai-key-label').textContent,'OpenAI API key');assert.match($('.assistant-footnote').textContent,/OpenAI/);
});
test('Anthropic selection persists, has its own model preference, and shows the correct destination',async()=>{
  const {context,$,stored}=setup();
  assert.equal(context.resolveAiProvider('anthropic'),'anthropic');assert.equal(context.resolveAiProvider('openai'),'openai');assert.equal(context.resolveAiProvider('groq'),'groq');assert.equal(context.resolveAiProvider('freemodel'),'groq');assert.equal(context.resolveAiProvider('__proto__'),'groq');
  context.state.aiProvider='anthropic';context.syncAiProviderSettings();
  assert.equal($('#ai-provider').value,'anthropic');assert.equal($('#ai-key-label').textContent,'Anthropic API key');assert.match($('#ai-key-help').textContent,/platform.claude.com\/settings\/keys/);assert.match($('#ai-provider-info').textContent,/billed separately from Claude subscriptions/);assert.match($('.assistant-footnote').textContent,/Anthropic/);
  context.window.stillnote.listAiModels=async provider=>{assert.equal(provider,'anthropic');return ['claude-haiku-5-5','claude-sonnet-5-5'];};
  await context.loadAiModels();assert.equal($('#ai-model').value,'claude-sonnet-5-5');assert.equal(stored.get('stillnote-anthropic-model'),'claude-sonnet-5-5');assert.equal(stored.get('stillnote-groq-model'),'oss-saved');assert.equal(stored.get('stillnote-openai-model'),'gpt-saved');
});
