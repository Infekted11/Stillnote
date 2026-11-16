import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { groqChat } from '../electron/groq-client.cjs';
import { openAiChat } from '../electron/openai-client.cjs';
import { anthropicChat } from '../electron/anthropic-client.cjs';
import { aiHoldResponse } from '../electron/ai-hold.cjs';
import { requestWithAiHold } from '../src/ai-hold.js';
import { runHomeAgent } from '../src/home-agent.js';

test('both AI IPC handlers return the hold details before the request leaves Electron', async () => {
  const source = await readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  const handlers = new Map(), active = new Map();
  const context = vm.createContext({
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, vaultPath: '/vault', homeModelRequests: active,
    AbortController, setTimeout, clearTimeout, aiHoldResponse, HOME_RESPONSE_SCHEMA: {},
    readAiProviderKey: async () => 'test', homeSystemPrompt: () => '', contextBudget: () => 1,
    agendaContextMessage: () => '', vaultDirectoryInstructions: '', noteSyntaxInstructions: '',
    vaultDirectoryMessage: async () => ({ role: 'user', content: 'Directory' }),
    aiProvider: () => ({ name: 'Groq', id: 'groq', defaultModel: 'test', chat: async ({ deferRateLimit }) => {
      assert.equal(deferRateLimit, true);
      throw Object.assign(new Error('Rate limited'), { aiHold: { reason: 'rate-limit', retryMs: 45000 } });
    } }),
  });
  vm.runInContext(source.slice(source.indexOf("  ipcMain.handle('home:step'"), source.indexOf("  ipcMain.handle('vault:list'")), context);
  const request = { vault: '/vault', requestId: 'test', prompt: 'Hello', messages: [{ role: 'user', content: 'Hello' }] };
  for (const channel of ['home:step', 'ai:chat']) {
    assert.deepEqual(await handlers.get(channel)(null, request), { kind: 'hold', provider: 'Groq', reason: 'rate-limit', retryMs: 45000 });
    assert.equal(active.size, 0);
  }
});

test('each provider classifies rate limits and credit or spending blocks from API responses', async () => {
  const cases = [
    ['Groq', groqChat, 429, { code: 'rate_limit_exceeded' }, { 'retry-after': '0.5' }, 'rate-limit', 500],
    ['OpenAI', openAiChat, 429, { code: 'rate_limit_exceeded' }, {
      'x-ratelimit-remaining-tokens': '0', 'x-ratelimit-reset-tokens': '1m2.5s',
      'x-ratelimit-remaining-requests': '1', 'x-ratelimit-reset-requests': '1h',
    }, 'rate-limit', 62500],
    ['Anthropic', anthropicChat, 429, { type: 'rate_limit_error' }, { 'retry-after': '21' }, 'rate-limit', 21000],
    ['Groq', groqChat, 400, { code: 'blocked_api_access' }, {}, 'credits', null],
    ['OpenAI', openAiChat, 429, { code: 'insufficient_quota' }, {}, 'credits', null],
    ['Anthropic', anthropicChat, 400, { message: 'Your credit balance is too low to access the Anthropic API.' }, {}, 'credits', null],
    ['Anthropic', anthropicChat, 429, { type: 'rate_limit_error', details: { error_code: 'enforced_spend_limit_reached' } }, {}, 'credits', null],
    ['OpenAI', openAiChat, 401, { code: 'invalid_api_key' }, {}, null, null],
  ];
  for (const [name, chat, status, error, headers, reason, retryMs] of cases) {
    let calls = 0;
    await assert.rejects(chat({
      apiKey: 'test', messages: [{ role: 'user', content: 'Hello' }], deferRateLimit: true,
      fetchImpl: async () => {
        calls++;
        return { ok: false, status, headers: { get: key => headers[key] }, json: async () => ({ error }) };
      },
    }), error => {
      assert.deepEqual(aiHoldResponse(error, { name }), reason ? { kind: 'hold', provider: name, reason, retryMs } : null);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('Home holds the blocked model step and resumes without replaying completed work', async t => {
  t.mock.timers.enable({ apis: ['Date'] });
  const signal = new AbortController().signal;
  const calls = [], statuses = [], waits = [], executed = [];
  const responses = [
    { kind: 'step', actions: [{ tool: 'create_file', args: { path: 'Plan.md' } }] },
    { kind: 'hold', reason: 'rate-limit', provider: 'Groq', retryMs: 3000 },
    { kind: 'hold', reason: 'credits', provider: 'Groq', retryMs: null },
    { kind: 'done', text: 'Created the plan.' },
  ];
  const result = await runHomeAgent({
    mode: 'work', prompt: 'Create the plan',
    modelStep: payload => requestWithAiHold(async () => {
      calls.push(payload);
      return responses.shift();
    }, { signal, onStatus: status => statuses.push(status), waitFor: async ms => { waits.push(ms); t.mock.timers.tick(ms); } }),
    tool: async (name, args) => { executed.push(name); return { path: args.path }; },
  });

  assert.equal(result.kind, 'done');
  assert.deepEqual(executed, ['create_file']);
  assert.deepEqual(calls.slice(1), [calls[1], calls[1], calls[1]]);
  assert.deepEqual(waits, [3000, 300000]);
  assert.match(statuses[0], /^On hold.*rate limit/);
  assert.match(statuses[2], /^On hold.*credits/);
});

test('stopping a held request cancels its wait before another provider call', async () => {
  const controller = new AbortController();
  let calls = 0;
  const result = requestWithAiHold(async () => {
    calls++;
    return { kind: 'hold', reason: 'credits', provider: 'OpenAI', retryMs: null };
  }, { signal: controller.signal, onStatus: () => setImmediate(() => controller.abort()) });
  await assert.rejects(result, error => error.name === 'AbortError');
  assert.equal(calls, 1);
});
