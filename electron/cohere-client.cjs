const { providerError } = require('./ai-hold.cjs');
const { NOTE_RESPONSE_SCHEMA, validateResult } = require('./ai-schema.cjs');

const COHERE_URL = 'https://api.cohere.com';
const DEFAULT_COHERE_MODEL = 'command-a-03-2025';
const COHERE_JSON_MODELS = new Set([
  DEFAULT_COHERE_MODEL, 'command-a-plus-05-2026', 'command-r-08-2024', 'command-r-plus-08-2024',
]);
const headers = apiKey => ({ Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' });

async function requestJson(url, options, fetchImpl) {
  options.signal?.throwIfAborted();
  const response = await fetchImpl(url, options);
  const data = await response.json().catch(() => null);
  if (response.ok) return data;
  const { status } = response;
  let text = data?.message || 'HTTP ' + status;
  if (status === 401 || status === 498) text = 'Save a valid Cohere API key in AI settings.';
  if (status === 429) text = 'API limit reached. Check your monthly evaluation allowance and short-term usage.';
  throw providerError(new Error('Cohere: ' + text), { error: data }, status, response);
}

async function listCohereModels({ apiKey, signal, fetchImpl = fetch }) {
  const query = new URLSearchParams({ endpoint: 'chat', page_size: '100' });
  const models = new Set(), pages = new Set();
  while (true) {
    const data = await requestJson(COHERE_URL + '/v1/models?' + query, { headers: headers(apiKey), signal }, fetchImpl);
    if (!Array.isArray(data?.models)) throw new Error('Cohere returned an invalid model catalog.');
    for (const model of data.models) {
      if (!model?.is_deprecated && COHERE_JSON_MODELS.has(model?.name)) models.add(model.name);
    }
    const next = data.next_page_token;
    if (!next) break;
    if (typeof next !== 'string' || pages.has(next) || pages.size >= 19) throw new Error('Cohere returned invalid model pagination.');
    pages.add(next);
    query.set('page_token', next);
  }
  if (!models.size) throw new Error('Cohere returned no supported chat models for this key.');
  return [...models].sort();
}

async function cohereChat({ apiKey, model = DEFAULT_COHERE_MODEL, messages, schema = NOTE_RESPONSE_SCHEMA, signal, fetchImpl = fetch }) {
  if (!COHERE_JSON_MODELS.has(model)) throw new Error('Choose a supported Cohere model in AI settings.');
  const instruction = [
    ...messages.filter(message => message.role === 'system').map(message => message.content),
    'Return a single JSON object matching the schema. Put proposed actions in the JSON actions array. Use null or empty arrays for unused required fields.',
    JSON.stringify(schema),
  ].join('\n\n');
  const data = await requestJson(COHERE_URL + '/v2/chat', {
    method: 'POST', signal, headers: headers(apiKey),
    body: JSON.stringify({
      model, stream: false, max_tokens: 4096, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: instruction }, ...messages.filter(message => message.role !== 'system')],
    }),
  }, fetchImpl);
  if (data?.finish_reason?.toLowerCase() !== 'complete' || data.message?.tool_calls?.length) {
    throw new Error('Cohere returned an incomplete reply. Try a smaller request or another model.');
  }
  const content = data.message?.content;
  const text = Array.isArray(content) && content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('');
  let result;
  try { result = JSON.parse(text); } catch { throw new Error('Cohere returned invalid assistant JSON.'); }
  if (!validateResult(result, schema)) throw new Error('Cohere returned a reply that did not match the assistant format.');
  return JSON.stringify(result);
}

module.exports = { DEFAULT_COHERE_MODEL, listCohereModels, cohereChat };
