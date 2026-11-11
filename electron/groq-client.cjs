const {NOTE_RESPONSE_SCHEMA,validateResult} = require('./ai-schema.cjs');
const GROQ_BASE_URL='https://api.groq.com/openai/v1';
const DEFAULT_GROQ_MODEL='openai/gpt-oss-120b';
// Only offer models documented to support strict JSON schemas for Work actions.
const GROQ_STRUCTURED_MODELS=new Set(['openai/gpt-oss-120b','openai/gpt-oss-20b','qwen/qwen3.8-27b']);
function apiError(data,status,response) {
  const detail=typeof data?.error==='string'?data.error:data?.error?.message;
  const retry=response?.headers?.get?.('retry-after');
  let message=detail?`Groq: ${detail}`:`Groq returned HTTP ${status}.`;
  if(status===401)message='Groq rejected the API key. Add a valid Groq key in Settings → AI settings.';
  if(status===429)message='Groq rate limit reached. '+(retry&&/^\d+(?:\.\d+)?$/.test(retry)?`Try again in ${Math.ceil(Number(retry))} seconds. `:'Wait for the limit to reset. ')+(detail?`${detail} `:'')+'Check your per-minute and daily limits at console.groq.com/settings/limits.';
  if(status===413)message='This request exceeds your Groq token limit. Try a smaller request or file, or check your account limits at console.groq.com/settings/limits.';
  const error=new Error(message);error.status=status;return error;
}
async function listGroqModels({apiKey,fetchImpl=fetch,signal}) {
  const response=await fetchImpl(`${GROQ_BASE_URL}/models`,{headers:{Authorization:`Bearer ${apiKey}`},signal});
  const data=await response.json().catch(()=>null);if(!response.ok)throw apiError(data,response.status,response);
  const models=[...new Set((Array.isArray(data?.data)?data.data:[]).filter(model=>model&&model.active!==false&&GROQ_STRUCTURED_MODELS.has(model.id)).map(model=>model.id))].sort((a,b)=>a.localeCompare(b));
  if(!models.length)throw new Error('Groq returned no supported models with strict JSON output. Check model permissions for your API key.');return models;
}
function completionText(data,schema) {
  const choice=data?.choices?.[0];
  if(choice?.finish_reason==='length')throw new Error('Groq reached the response length limit. Try a smaller request or file.');
  if(choice?.message?.refusal||choice?.finish_reason==='content_filter')throw new Error('Groq could not fulfill this request.');
  if(choice?.finish_reason!=='stop')throw new Error('Groq returned an incomplete response. No actions from this response were applied. Try again.');
  const content=choice?.message?.content;
  let text=typeof content==='string'?content:Array.isArray(content)?content.filter(part=>part.type==='text'&&typeof part.text==='string').map(part=>part.text).join(''):'';
  text=text.replace(/^\s*<think>[\s\S]*?<\/think>\s*/i,'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
  let result;try{result=JSON.parse(text);}catch{throw new Error('Groq returned invalid JSON. No actions from this response were applied. Try again or select another model.');}
  if(!validateResult(result,schema))throw new Error('Groq returned an invalid assistant response. No actions from this response were applied. Try another model.');
  return JSON.stringify(result);
}
function waitForRetry(milliseconds,signal) {
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const onAbort=()=>{clearTimeout(timer);reject(signal.reason);};
    const timer=setTimeout(()=>{signal?.removeEventListener('abort',onAbort);resolve();},milliseconds);
    signal?.addEventListener('abort',onAbort,{once:true});
  });
}
async function groqChat({apiKey,model=DEFAULT_GROQ_MODEL,messages,schema=NOTE_RESPONSE_SCHEMA,signal,fetchImpl=fetch,waitImpl=waitForRetry}) {
  if(!GROQ_STRUCTURED_MODELS.has(model))throw new Error('Choose a supported Groq model in AI settings.');
  const instruction='Respond only with the requested JSON object. Include every required field, using null or empty arrays for unused values. Do not include reasoning text.';
  const system={role:'system',content:[...messages.filter(message=>message.role==='system').map(message=>message.content),instruction].join('\n\n')};
  const reasoning=model.startsWith('openai/gpt-oss-')?{include_reasoning:false}:{reasoning_format:'hidden'};
  const options={method:'POST',signal,headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model,stream:false,max_completion_tokens:4096,...reasoning,response_format:{type:'json_schema',json_schema:{name:schema===NOTE_RESPONSE_SCHEMA?'stillnote_note':'stillnote_home',strict:true,schema}},messages:[system,...messages.filter(message=>message.role!=='system')]})};
  for(let attempt=0;attempt<2;attempt++){
    signal?.throwIfAborted();
    const response=await fetchImpl(`${GROQ_BASE_URL}/chat/completions`,options);
    const data=await response.json().catch(()=>null);
    if(response.ok)return completionText(data,schema);
    const retry=response.headers?.get?.('retry-after');
    // A rejected model request ran no actions. Retry once only for a short reset.
    if(response.status===429&&attempt===0&&retry&&/^\d+(?:\.\d+)?$/.test(retry)&&Number(retry)<=60){await waitImpl(Math.max(250,Math.ceil(Number(retry)*1000)),signal);continue;}
    throw apiError(data,response.status,response);
  }
}
module.exports={GROQ_BASE_URL,DEFAULT_GROQ_MODEL,listGroqModels,groqChat,validateResult,completionText,waitForRetry};
