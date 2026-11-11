const {DEFAULT_OPENAI_MODEL,listOpenAiModels,openAiChat}=require('./openai-client.cjs');
const {DEFAULT_GROQ_MODEL,listGroqModels,groqChat}=require('./groq-client.cjs');
const {DEFAULT_ANTHROPIC_MODEL,listAnthropicModels,anthropicChat}=require('./anthropic-client.cjs');
const providers={
  groq:{id:'groq',name:'Groq',credential:'groqApiKey',defaultModel:DEFAULT_GROQ_MODEL,listModels:listGroqModels,chat:groqChat},
  anthropic:{id:'anthropic',name:'Anthropic',credential:'anthropicApiKey',defaultModel:DEFAULT_ANTHROPIC_MODEL,listModels:listAnthropicModels,chat:anthropicChat},
  openai:{id:'openai',name:'OpenAI',credential:'openaiApiKey',defaultModel:DEFAULT_OPENAI_MODEL,listModels:listOpenAiModels,chat:openAiChat},
};
// Preserve the meaning of old IPC callers; the app explicitly selects Groq by default.
function aiProvider(id='openai'){if(!Object.hasOwn(providers,id))throw new Error('Unknown AI provider.');return providers[id];}
module.exports={aiProvider};
