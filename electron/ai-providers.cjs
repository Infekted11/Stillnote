const {DEFAULT_OPENAI_MODEL,listOpenAiModels,openAiChat}=require('./openai-client.cjs');
const {DEFAULT_GROQ_MODEL,listGroqModels,groqChat}=require('./groq-client.cjs');
const {DEFAULT_ANTHROPIC_MODEL,listAnthropicModels,anthropicChat}=require('./anthropic-client.cjs');
const {DEFAULT_MISTRAL_MODEL,listMistralModels,mistralChat}=require('./mistral-client.cjs');
const {DEFAULT_COHERE_MODEL,listCohereModels,cohereChat}=require('./cohere-client.cjs');
const providers={
  cohere:{id:'cohere',name:'Cohere',credential:'cohereApiKey',defaultModel:DEFAULT_COHERE_MODEL,listModels:listCohereModels,chat:cohereChat},
  mistral:{id:'mistral',name:'Mistral',credential:'mistralApiKey',defaultModel:DEFAULT_MISTRAL_MODEL,listModels:listMistralModels,chat:mistralChat},
  groq:{id:'groq',name:'Groq',credential:'groqApiKey',defaultModel:DEFAULT_GROQ_MODEL,listModels:listGroqModels,chat:groqChat},
  anthropic:{id:'anthropic',name:'Anthropic',credential:'anthropicApiKey',defaultModel:DEFAULT_ANTHROPIC_MODEL,listModels:listAnthropicModels,chat:anthropicChat},
  openai:{id:'openai',name:'OpenAI',credential:'openaiApiKey',defaultModel:DEFAULT_OPENAI_MODEL,listModels:listOpenAiModels,chat:openAiChat},
};
// Preserve the meaning of old IPC callers that omit a provider.
function aiProvider(id='openai'){if(!Object.hasOwn(providers,id))throw new Error('Unknown AI provider.');return providers[id];}
module.exports={aiProvider};
