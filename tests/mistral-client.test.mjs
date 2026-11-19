import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { aiProvider } = require('../electron/ai-providers.cjs');
const { HOME_RESPONSE_SCHEMA } = require('../electron/ai-schema.cjs');
const config = aiProvider('mistral');

test('Mistral discovers available chat models and keeps its own credential', async () => {
  assert.equal(config.credential, 'mistralApiKey');
  assert.equal(aiProvider('groq').credential, 'groqApiKey');
  const models = await config.listModels({ apiKey: 'test', fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.mistral.ai/v1/models');
    assert.equal(options.headers.Authorization, 'Bearer test');
    return Response.json({ data: [
      { id: 'mistral-small-2603', aliases: ['mistral-small-latest'], capabilities: { completion_chat: true } },
      { id: 'embed', capabilities: { completion_chat: false } },
      { id: 'old', archived: true, capabilities: { completion_chat: true } },
    ] });
  } });
  assert.deepEqual(models, ['mistral-small-2603', config.defaultModel]);
});

const messages = [{ role: 'system', content: 'Home instructions' }, { role: 'user', content: 'Create a canvas' }];
const action = { tool: 'create_structured_file', label: 'Create a canvas', args: { path: 'Canvas.md', format: 'canvas', data: null } };
const work = { kind: 'step', text: null, plan: [], actions: [action] };
const completion = (result, finish_reason = 'stop') => Response.json({ choices: [{ finish_reason, message: { content: JSON.stringify(result) } }] });

test('Mistral validates Home Work actions and sidebar edits before returning them', async () => {
  const reply = await config.chat({ apiKey: 'test', messages, schema: HOME_RESPONSE_SCHEMA, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.mistral.ai/v1/chat/completions');
    const request = JSON.parse(options.body);
    assert.deepEqual(request.response_format, { type: 'json_object' });
    assert.ok(request.messages[0].content.includes('create_structured_file'));
    assert.deepEqual(request.messages[1], messages[1]);
    return completion(work);
  } });
  assert.deepEqual(JSON.parse(reply), work);
  await assert.rejects(config.chat({ messages, schema: HOME_RESPONSE_SCHEMA, fetchImpl: async () =>
    completion({ ...work, actions: [{ ...action, args: { ...action.args, format: 'unsupported' } }] }) }), /did not match/);
  const edit = { kind: 'edit', text: 'Updated', tasks: [] };
  assert.deepEqual(JSON.parse(await config.chat({ messages, fetchImpl: async () => completion(edit) })), edit);
  await assert.rejects(config.chat({ messages, fetchImpl: async () => completion(edit, 'length') }), /incomplete/);
});

test('Mistral rate limits use Stillnote holds and preserve the retry header', async () => {
  let requests = 0;
  await assert.rejects(config.chat({ messages, fetchImpl: async () => {
    requests++;
    return Response.json({ message: 'Rate limit exceeded' }, { status: 429, headers: { 'Retry-After': '5' } });
  } }), { status: 429, aiHold: { reason: 'rate-limit', retryMs: 5000 } });
  assert.equal(requests, 1);
});
