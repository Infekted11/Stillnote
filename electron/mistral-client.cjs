const { providerError } = require('./ai-hold.cjs');
const { NOTE_RESPONSE_SCHEMA, validateResult } = require('./ai-schema.cjs');

const MISTRAL_BASE_URL = 'https://api.mistral.ai/v1';
const DEFAULT_MISTRAL_MODEL = 'mistral-small-latest';

function apiError(data, response) {
  const { status } = response;
  const detail = data?.error ?? data;
  const message = typeof detail === 'string' ? detail : detail?.message;
  let text = typeof message === 'string' ? 'Mistral: ' + message : 'Mistral returned HTTP ' + status + '.';
  if (status === 401) text = 'Mistral rejected the API key. Save a Mistral Studio key in AI settings.';
  if (status === 429) text = 'Mistral rate limit reached. Check usage and limits in Mistral Studio.';
  return providerError(new Error(text), { error: detail }, status, response);
}

async function listMistralModels({ apiKey, signal, fetchImpl = fetch }) {
  signal?.throwIfAborted();
  const response = await fetchImpl(MISTRAL_BASE_URL + '/models', {
    headers: { Authorization: 'Bearer ' + apiKey }, signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw apiError(data, response);
  const models = new Set();
  for (const model of Array.isArray(data?.data) ? data.data : []) {
    if (model?.archived || model?.capabilities?.completion_chat !== true || typeof model.id !== 'string' || !model.id.trim()) continue;
    models.add(model.id);
    for (const alias of Array.isArray(model.aliases) ? model.aliases : []) {
      if (typeof alias === 'string' && alias.trim()) models.add(alias);
    }
  }
  if (!models.size) throw new Error('Mistral returned no chat models available to this API key.');
  return [...models].sort();
}

async function mistralChat({ apiKey, model = DEFAULT_MISTRAL_MODEL, messages, schema = NOTE_RESPONSE_SCHEMA, signal, fetchImpl = fetch }) {
  signal?.throwIfAborted();
  const instructions = [
    ...messages.filter(message => message.role === 'system').map(message => message.content),
    'Return exactly one JSON object matching the schema below. Put proposed actions in the JSON actions array. Do not emit native tool calls. Use null or empty arrays for unused required fields.',
    JSON.stringify(schema),
  ].join('\n\n');
  const response = await fetchImpl(MISTRAL_BASE_URL + '/chat/completions', {
    method: 'POST', signal,
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, stream: false, max_tokens: 4096, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: instructions }, ...messages.filter(message => message.role !== 'system')],
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw apiError(data, response);
  const choice = data?.choices?.[0];
  if (choice?.finish_reason !== 'stop' || choice.message?.tool_calls?.length || choice.message?.refusal) {
    throw new Error('Mistral returned an incomplete assistant reply. Try a smaller request or another model.');
  }
  const content = choice.message?.content;
  const text = Array.isArray(content)
    ? content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('')
    : content;
  let result;
  try { result = JSON.parse(text); } catch { throw new Error('Mistral returned invalid assistant JSON.'); }
  if (!validateResult(result, schema)) throw new Error('Mistral returned a reply that did not match the assistant format. Try another model.');
  return JSON.stringify(result);
}

module.exports = { DEFAULT_MISTRAL_MODEL, listMistralModels, mistralChat };
