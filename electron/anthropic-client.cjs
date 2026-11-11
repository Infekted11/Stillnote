const {NOTE_RESPONSE_SCHEMA,validateResult}=require('./ai-schema.cjs');
const ANTHROPIC_BASE_URL='https://api.anthropic.com/v1';
const ANTHROPIC_VERSION='2026-10-21';
const DEFAULT_ANTHROPIC_MODEL='claude-sonnet-5-5';
const isClaudeModel=id=>typeof id==='string'&&/^claude-[a-z0-9][a-z0-9-]*$/.test(id);
const headers=apiKey=>({Authorization:`Bearer ${apiKey}`,'anthropic-version':ANTHROPIC_VERSION,'Content-Type':'application/json'});
function apiError(data,status,response) {
  const detail=typeof data?.error==='string'?data.error:data?.error?.message;
  const retry=response?.headers?.get?.('retry-after');
  let message=detail?`Anthropic: ${detail}`:`Anthropic returned HTTP ${status}.`;
  if(status===401)message='Anthropic rejected the API key. Add a valid Anthropic key in Settings → AI settings.';
  if(status===429)message='Anthropic rate limit reached. '+(retry&&/^\d+(?:\.\d+)?$/.test(retry)?`Try again in ${Math.ceil(Number(retry))} seconds. `:'Try again shortly. ')+(detail||'');
  if(status===529)message='Anthropic is temporarily overloaded. Try again shortly.';
  const error=new Error(message);error.status=status;return error;
}
async function listAnthropicModels({apiKey,signal,fetchImpl=fetch}) {
  const models=new Set(),cursors=new Set();let cursor;
  for(let page=0;page<20;page++){
    signal?.throwIfAborted();
    const query=new URLSearchParams({limit:'100'});if(cursor)query.set('after_id',cursor);
    const response=await fetchImpl(`${ANTHROPIC_BASE_URL}/models?${query}`,{headers:headers(apiKey),signal});
    const data=await response.json().catch(()=>null);if(!response.ok)throw apiError(data,response.status,response);
    for(const model of Array.isArray(data?.data)?data.data:[]){
      if(isClaudeModel(model?.id)&&model.lifecycle!=='retired'&&model.capabilities?.structured_outputs?.supported===true)models.add(model.id);
    }
    if(!data?.has_more){if(!models.size)throw new Error('Anthropic returned no Claude models with structured-output support. Check your API account and model access.');return [...models].sort((a,b)=>a.localeCompare(b));}
    cursor=data.last_id;
    if(typeof cursor!=='string'||!cursor||cursors.has(cursor))throw new Error('Anthropic returned invalid model pagination. Try loading the models again.');
    cursors.add(cursor);
  }
  throw new Error('The Anthropic model catalog exceeded the loading limit. Try loading the models again.');
}
function anthropicResponseText(data,schema=NOTE_RESPONSE_SCHEMA) {
  if(data?.type==='error'||data?.error)throw apiError(data,500);
  if(data?.stop_reason==='refusal')throw new Error('Anthropic could not fulfill this request.');
  if(data?.stop_reason==='max_tokens'||data?.stop_reason==='model_context_window_exceeded')throw new Error('Anthropic reached the response or context limit. Try a smaller request or file. No actions from this response were applied.');
  if(data?.stop_reason!=='end_turn')throw new Error('Anthropic returned an incomplete response. No actions from this response were applied. Try again.');
  const text=(Array.isArray(data.content)?data.content:[]).filter(block=>block?.type==='text'&&typeof block.text==='string').map(block=>block.text).join('').trim();
  let result;try{result=JSON.parse(text);}catch{throw new Error('Anthropic returned invalid JSON. No actions from this response were applied. Try again.');}
  if(!validateResult(result,schema))throw new Error('Anthropic returned an invalid assistant response. No actions from this response were applied.');
  return JSON.stringify(result);
}
async function anthropicChat({apiKey,model=DEFAULT_ANTHROPIC_MODEL,messages,schema=NOTE_RESPONSE_SCHEMA,signal,fetchImpl=fetch}) {
  if(!isClaudeModel(model))throw new Error('Choose a Claude model in Settings → AI settings.');
  signal?.throwIfAborted();
  const instruction='Respond only with the requested JSON object. Include every required field, using null or empty arrays for unused values. Do not include private reasoning.';
  const system=[...messages.filter(message=>message.role==='system').map(message=>message.content),instruction].join('\n\n');
  const conversation=messages.filter(message=>['user','assistant'].includes(message.role)).map(({role,content})=>({role,content}));
  if(!conversation.length)throw new Error('Write a question or an edit request first.');
  const response=await fetchImpl(`${ANTHROPIC_BASE_URL}/messages`,{method:'POST',signal,headers:headers(apiKey),body:JSON.stringify({model,stream:false,max_tokens:16384,system,messages:conversation,output_config:{format:{type:'json_schema',schema}}})});
  const data=await response.json().catch(()=>null);if(!response.ok)throw apiError(data,response.status,response);
  return anthropicResponseText(data,schema);
}
module.exports={ANTHROPIC_BASE_URL,ANTHROPIC_VERSION,DEFAULT_ANTHROPIC_MODEL,listAnthropicModels,anthropicChat,anthropicResponseText};
