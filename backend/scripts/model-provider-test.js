const assert = require('node:assert/strict');
const { z } = require('zod');
const { EchoModelAdapter } = require('../dist/providers/model/echo-adapter');
const { MeshModelAdapter, assertInputWithinBudget } = require('../dist/providers/model/mesh-adapter');

(async () => {
  const adapter = new EchoModelAdapter(() => ({ answer: 'safe' }));
  const result = await adapter.complete({ systemPrompt: 'system', userContent: 'user', maxInputTokens: 10, maxTokens: 10, responseSchema: z.object({ answer: z.string() }), tenantId: 'tenant' });
  assert.deepEqual(result.content, { answer: 'safe' });
  assert.equal(result.modelId, 'echo-fixture-v1');
  assert.throws(() => assertInputWithinBudget('x'.repeat(9), 2));
  await assert.rejects(() => new MeshModelAdapter('test-key').complete({ systemPrompt: 'system', userContent: '{}', maxInputTokens: 10, maxTokens: 769, responseSchema: z.object({}), tenantId: 'tenant' }), /output token budget/);
  let captured;
  const mesh = new MeshModelAdapter('mesh-test-key', 'google/gemini-3-flash-preview', 3_000, 'https://mesh.test/v1/chat/completions', async (_url, init) => {
    captured = JSON.parse(init.body);
    return new Response(JSON.stringify({ model: 'google/gemini-3-flash-preview', choices: [{ message: { content: '```json\n{"answer":"structured"}\n```' } }], usage: { prompt_tokens: 8, completion_tokens: 3 } }), { status: 200 });
  });
  const structured = await mesh.complete({ systemPrompt: 'system', userContent: 'user', maxInputTokens: 10, maxTokens: 10, responseSchema: z.object({ answer: z.string() }).strict(), tenantId: 'tenant' });
  assert.deepEqual(structured.content, { answer: 'structured' });
  assert.equal(captured.response_format.type, 'json_schema');
  assert.equal(captured.response_format.json_schema.strict, true);
  assert.equal(captured.response_format.json_schema.schema.type, 'object');
  assert.equal(captured.temperature, 0);
  const invalid = new EchoModelAdapter(() => ({ answer: 1 }));
  await assert.rejects(() => invalid.complete({ systemPrompt: '', userContent: '', maxInputTokens: 1, maxTokens: 1, responseSchema: z.object({ answer: z.string() }), tenantId: 'tenant' }));
  console.log('Agentic MVP model-provider checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
