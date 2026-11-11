// Each preview owns a separate Desmos instance and never saves changes to its source.
export function createGraphPreview(host, type, data, {getKey,loadApi,isCurrent=()=>host.isConnected,onResize=()=>{}}) {
  let calculator=null,disposed=false;
  const current=()=>!disposed&&isCurrent();
  const destroy=()=>{disposed=true;calculator?.destroy();calculator=null;};
  const ready=(async()=>{
    if(!data?.state||typeof data.state!=='object')throw new Error('Open and save this graph file to create its preview.');
    const key=await getKey();if(!current())return;
    if(!key)throw new Error('Add a Desmos API key in Settings → Graphing to show this preview.');
    const api=await loadApi(key);if(!current())return;
    const factory={graph:'GraphingCalculator',geometry:'Geometry',calculator3d:'Calculator3D'}[type];
    const feature={geometry:'GeometryCalculator',calculator3d:'Calculator3D'}[type];
    if(!factory||typeof api[factory]!=='function'||feature&&api.enabledFeatures?.[feature]===false)throw new Error('This Desmos API key does not have access to this graph type.');
    const options={expressions:false,expressionsTopbar:false,keypad:false,settingsMenu:false,zoomButtons:false,showResetButtonOnGraphpaper:false,pointsOfInterest:false,trace:false,actions:false,lockViewport:true,autosize:true,border:false,invertedColors:false};
    calculator=api[factory](host,options);
    calculator.setState(structuredClone(data.state));
    calculator.updateSettings?.(options);
    calculator.clearHistory?.();onResize();
  })().catch(error=>{destroy();throw error;});
  async function screenshot(){
    await ready;if(!calculator||!current())throw new Error('The graph preview is no longer available.');
    if(typeof calculator.asyncScreenshot==='function')return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('Graph snapshot timed out.')),15000);
      calculator.asyncScreenshot({width:1000,height:650,targetPixelRatio:1},image=>{clearTimeout(timeout);image?resolve(image):reject(new Error('Graph snapshot is unavailable.'));});
    });
    if(typeof calculator.screenshot==='function')return calculator.screenshot({width:1000,height:650,targetPixelRatio:1});
    throw new Error('This Desmos tool does not support exporting a snapshot.');
  }
  return {ready,destroy,screenshot};
}
