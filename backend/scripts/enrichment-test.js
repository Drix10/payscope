const assert = require('node:assert/strict');
const { HeuristicEnrichmentAdapter } = require('../dist/providers/enrichment/heuristic-adapter');

const event = {
  eventId: 'evt_gateway', eventType: 'payment.failed', occurredAt: '2026-08-22T00:00:00.000Z', receivedAt: '2026-08-22T00:00:00.000Z',
  paymentId: 'pay_gateway', amountPaise: 1000, currency: 'INR', paymentMethod: 'upi', paymentStatus: 'failed',
  providerData: { error_source: 'gateway', error_step: 'payment_response', error_reason: 'payment_failed', attempts: 2, international: false },
};
const client = {
  fetchPayment: async () => ({ error_source: 'gateway', error_step: 'payment_response', error_reason: 'payment_failed', attempts: 2, international: false }),
  fetchDowntimes: async () => ({ items: [{ status: 'started', method: 'upi' }] }),
};
(async () => {
  const adapter = new HeuristicEnrichmentAdapter(client, () => new Date('2026-08-22T00:00:00.000Z'));
  const result = await adapter.enrich(event);
  assert.equal(result.source, 'razorpay_fields_heuristic');
  assert.equal(result.failureAttribution, 'gateway_degraded');
  assert.equal(result.gatewayHealthScore, 0.2);
  assert.equal(result.recommendedRetryMethod, 'netbanking');
  assert.deepEqual(result.signalsUsed.sort(), ['attempts', 'downtimes', 'error_reason', 'error_source', 'error_step', 'international']);
  const partial = await adapter.enrich({ ...event, eventType: 'payment.captured', amountPaise: 500, providerData: { order_amount_paise: 1000 } });
  assert.equal(partial.partialRecoveryPossible, true);
  console.log('Agentic MVP enrichment checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
