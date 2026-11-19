import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { aiProvider } = require('../electron/ai-providers.cjs');
const { HOME_RESPONSE_SCHEMA } = require('../electron/ai-schema.cjs');
const config = aiProvider('cohere');

test('Cohere discovers supported models and preserves Mistral as a separate provider', async () => {
  assert.equal(config.credential, 'cohereApiKey');
  assert.equal(aiProvider('mistral').credential, 'mistralApiKey');
  let calls = 0;
  const models = await config.listModels({ apiKey: 'test', fetchImpl: async (url, options) => {
    const endpoint = new URL(url);
    assert.equal(endpoint.pathname, '/v1/models');
    assert.equal(endpoint.searchParams.get('endpoint'), 'chat');
    assert.equal(options.headers.Authorization, 'Bearer test');
    if (++calls === 1) return Response.json({ models: [{ name: 'unsupported' }], next_page_token: 'second' });
    assert.equal(endpoint.searchParams.get('page_token'), 'second');
    return Response.json({ models: [{ name: config.defaultModel }, { name: 'command-r-08-2024', is_deprecated: true }] });
  } });
  assert.deepEqual(models, [config.defaultModel]);
});

test('Cohere validates Home actions and preserves the rate limit hold', async () => {
  const messages = [{ role: 'user', content: 'Create a canvas' }];
  const work = { kind: 'step', text: null, plan: [], actions: [
    { tool: 'create_structured_file', label: 'Create canvas', args: { path: 'Canvas.md', format: 'canvas', data: null } },
  ] };
  const chat = fetchImpl => config.chat({ apiKey: 'test', messages, schema: HOME_RESPONSE_SCHEMA, fetchImpl });
  const reply = result => Response.json({ finish_reason: 'COMPLETE', message: { content: [{ type: 'text', text: JSON.stringify(result) }] } });
  assert.deepEqual(JSON.parse(await chat(async (url, options) => {
    assert.equal(url, 'https://api.cohere.com/v2/chat');
    const request = JSON.parse(options.body);
    assert.deepEqual(request.response_format, { type: 'json_object' });
    assert.ok(request.messages[0].content.includes('create_structured_file'));
    return reply(work);
  })), work);
  await assert.rejects(chat(async () => reply({ ...work, actions: [{ tool: 'unsupported' }] })), /did not match/);
  await assert.rejects(chat(async () => Response.json({ message: 'Monthly limit exceeded' }, { status: 429 })),
    { status: 429, aiHold: { reason: 'rate-limit', retryMs: null } });
});
