const OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_OPENAI_MODEL = 'gpt-6.1-sol';
const {HOME_RESPONSE_SCHEMA,NOTE_RESPONSE_SCHEMA}=require('./ai-schema.cjs');
function isAssistantModel(id) {
  return /^(?:gpt-(?:[5-9](?:[.-]|$)|4\.1(?:-|$)|4o(?:-|$))|o[34](?:-|$))/.test(id)
    && !/(?:audio|realtime|transcribe|search|image|embedding|moderation|codex|chat-latest|tts|whisper)/i.test(id)
    && id !== 'gpt-4o-2024-05-13';
}
function apiError(data,status) {
  const detail=typeof data?.error==='string'?data.error:data?.error?.message;
  return new Error(detail?`OpenAI: ${detail}`:`OpenAI returned HTTP ${status}.`);
}
async function listOpenAiModels({apiKey,fetchImpl=fetch,signal}) {
  const response=await fetchImpl(`${OPENAI_BASE_URL}/models`,{headers:{Authorization:`Bearer ${apiKey}`},signal});
  const data=await response.json().catch(()=>null);if(!response.ok)throw apiError(data,response.status);
  const models=[...new Set((Array.isArray(data?.data)?data.data:[]).map(model=>typeof model?.id==='string'?model.id.trim():'').filter(isAssistantModel))].sort((a,b)=>a.localeCompare(b));
  if(!models.length)throw new Error('No supported text-assistant models were returned for this OpenAI API project.');
  return models;
}
function responseText(data) {
  if(data?.status==='incomplete')throw new Error('OpenAI could not complete the response'+(data.incomplete_details?.reason==='max_output_tokens'?' within the output limit':'')+'. Try a smaller request or file.');
  if(data?.status==='failed'||data?.error)throw apiError(data,500);
  const messages=(Array.isArray(data?.output)?data.output:[]).filter(item=>item.type==='message'&&item.role==='assistant');
  if(messages.some(message=>message.content?.some(part=>part.type==='refusal')))throw new Error('OpenAI could not fulfill this request.');
  const text=messages.flatMap(message=>Array.isArray(message.content)?message.content:[]).filter(part=>part.type==='output_text'&&typeof part.text==='string').map(part=>part.text).join('').trim();
  if(!text)throw new Error('OpenAI returned no complete answer. Try again.');
  return text;
}
async function openAiChat({apiKey,model=DEFAULT_OPENAI_MODEL,messages,schema=NOTE_RESPONSE_SCHEMA,signal,fetchImpl=fetch}) {
  if(!isAssistantModel(model))throw new Error('Select a supported OpenAI text model in Settings → AI settings.');
  const body={model,stream:false,store:false,max_output_tokens:16384,input:messages,text:{format:{type:'json_schema',name:schema===HOME_RESPONSE_SCHEMA?'stillnote_home':'stillnote_assistant',strict:true,schema}}};
  const response=await fetchImpl(`${OPENAI_BASE_URL}/responses`,{method:'POST',signal,headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json().catch(()=>null);if(!response.ok)throw apiError(data,response.status);
  return responseText(data);
}
module.exports={OPENAI_BASE_URL,DEFAULT_OPENAI_MODEL,HOME_RESPONSE_SCHEMA,NOTE_RESPONSE_SCHEMA,isAssistantModel,listOpenAiModels,openAiChat,responseText};
