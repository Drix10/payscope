const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { AgenticWebhookIntake } = require('../dist/pipeline/agentic-webhook-intake');

const secret = 'webhook-test-secret-with-enough-length';
const body = Buffer.from(JSON.stringify({ event: 'payment.failed', created_at: 1787356800, payload: { payment: { entity: { id: 'pay_1', amount: 1000, currency: 'INR', created_at: 1787356800 } } } }));
const repository = {
  demoOrganization: async id => ({ id, customerHashSecret: 'x'.repeat(32) }),
  ingestEventWithEnrichmentJob: async (_org, id, hash, event) => ({ eventId: `${id}:${hash.slice(0, 6)}:${event.eventType}`, duplicate: false }),
};
const config = { organizationId: '00000000-0000-4000-8000-000000000001', webhookSecret: secret };
(async () => {
  const intake = new AgenticWebhookIntake(repository, config);
  const result = await intake.receive(body, createHmac('sha256', secret).update(body).digest('hex'), 'evt_1');
  assert.equal(result.duplicate, false);
  assert.equal(result.ignored, false);
  assert.match(result.eventId, /^evt_1:/);
  const irrelevant = Buffer.from(JSON.stringify({ event: 'engage.balance.low_balance', payload: {} }));
  const ignored = await intake.receive(irrelevant, createHmac('sha256', secret).update(irrelevant).digest('hex'), undefined);
  assert.deepEqual(ignored, { eventId: null, duplicate: false, ignored: true }, 'signed non-incident events are acknowledged without database access');
  await assert.rejects(() => intake.receive(body, '0'.repeat(64), 'evt_1'));
  console.log('Feature-gated agentic webhook intake checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
