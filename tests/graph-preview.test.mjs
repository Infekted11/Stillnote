import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../src/graph-preview.js',import.meta.url),'utf8');
const {createGraphPreview}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
function harness(){
  const calls=[],api={};let destroyed=0;
  for(const name of ['GraphingCalculator','Geometry','Calculator3D'])api[name]=(host,options)=>{const call={name,options};calls.push(call);return {setState:state=>{call.state=state;state.changed=true;},updateSettings:settings=>{call.settings=settings;},clearHistory(){},destroy(){destroyed++;},asyncScreenshot:(_options,callback)=>callback('data:image/png;base64,AAAA')};};
  return {calls,api,get destroyed(){return destroyed;},deps:{getKey:async()=> 'test-key',loadApi:async()=>api},host:{isConnected:true}};
}
test('all three graph types hide equations and controls and never mutate saved state',async()=>{
  for(const [type,name] of [['graph','GraphingCalculator'],['geometry','Geometry'],['calculator3d','Calculator3D']]){
    const h=harness(),data={state:{expressions:{list:[{latex:'y=x^2'}]}}};
    const preview=createGraphPreview(h.host,type,data,h.deps);await preview.ready;
    assert.equal(h.calls[0].name,name);assert.equal(h.calls[0].options.expressions,false);assert.equal(h.calls[0].options.expressionsTopbar,false);assert.equal(h.calls[0].options.keypad,false);assert.equal(h.calls[0].options.settingsMenu,false);assert.equal(data.state.changed,undefined);
    assert.equal(await preview.screenshot(),'data:image/png;base64,AAAA');preview.destroy();preview.destroy();assert.equal(h.destroyed,1);
  }
});
test('missing keys, missing saved state, and disabled graph features give useful errors',async()=>{
  const h=harness();await assert.rejects(createGraphPreview(h.host,'graph',{},h.deps).ready,/Open and save/);
  await assert.rejects(createGraphPreview(h.host,'graph',{state:{}},{...h.deps,getKey:async()=>''}).ready,/Desmos API key/);
  h.api.enabledFeatures={Calculator3D:false};await assert.rejects(createGraphPreview(h.host,'calculator3d',{state:{}},h.deps).ready,/does not have access/);assert.equal(h.calls.length,0);
});
test('removing a pending graph preview prevents late mounting',async()=>{
  const h=harness();let resolveKey;
  const preview=createGraphPreview(h.host,'graph',{state:{}},{...h.deps,getKey:()=>new Promise(resolve=>{resolveKey=resolve;})});
  preview.destroy();resolveKey('key');await preview.ready;assert.equal(h.calls.length,0);
});
