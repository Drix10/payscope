const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { normalizeRazorpayWebhook, rawPayloadHash, verifyRazorpayWebhook } = require('../dist/pipeline/webhook-intake');

const secret = 'webhook-test-secret-with-enough-length';
const body = Buffer.from(JSON.stringify({
  event: 'payment.failed',
  created_at: 1787356800,
  payload: {
    payment: { entity: { id: 'pay_test', order_id: 'order_test', customer_id: 'cust_test', amount: 5000, currency: 'INR', status: 'failed', method: 'upi', created_at: 1787356800, error_source: 'gateway', error_step: 'payment_response', error_reason: 'payment_failed', attempts: 2, international: false, acquirer_data: { rrn: '123' } } },
    order: { entity: { id: 'order_test', amount: 10000 } },
  },
}));
const signature = createHmac('sha256', secret).update(body).digest('hex');
verifyRazorpayWebhook(body, signature, secret);
assert.throws(() => verifyRazorpayWebhook(body, '0'.repeat(64), secret));
const event = normalizeRazorpayWebhook(body, 'evt_test', 'x'.repeat(32), '2026-08-22T00:00:00.000Z');
assert.equal(event.eventType, 'payment.failed');
assert.equal(event.providerData.error_source, 'gateway');
assert.equal(event.providerData.order_amount_paise, 10000);
assert.equal(event.customerHash.length, 64);
assert.equal(normalizeRazorpayWebhook(body, 'evt_same_customer', 'x'.repeat(32), '2026-08-22T00:00:00.000Z').customerHash, event.customerHash);
assert.notEqual(normalizeRazorpayWebhook(body, 'evt_other_org', 'y'.repeat(32), '2026-08-22T00:00:00.000Z').customerHash, event.customerHash);
assert.equal(rawPayloadHash(body).length, 64);
assert.equal(JSON.stringify(event).includes('cust_test'), false);
const noisyBody = Buffer.from(JSON.stringify({ event: 'payment.failed', created_at: 1787356800, payload: { payment: { entity: { id: 'pay_noisy', amount: 1, currency: 'INR', created_at: 1787356800, acquirer_data: { rrn: 'safe', card_number: 'must-not-store', nested: { data: 'must-not-store' } } } } } }));
const noisy = normalizeRazorpayWebhook(noisyBody, 'evt_noisy', 'x'.repeat(32), '2026-08-22T00:00:00.000Z');
assert.deepEqual(noisy.providerData.acquirer_data, { rrn: 'safe' });
assert.equal(JSON.stringify(noisy).includes('must-not-store'), false);
const orderPaidBody = Buffer.from(JSON.stringify({ event: 'order.paid', created_at: 1787356800, payload: { order: { entity: { id: 'order_paid', amount: 7654, currency: 'INR', status: 'paid', created_at: 1787356800 } } } }));
const orderPaid = normalizeRazorpayWebhook(orderPaidBody, 'evt_order_paid', 'x'.repeat(32), '2026-08-22T00:00:00.000Z');
assert.equal(orderPaid.amountPaise, 7654, 'order.paid must retain the order amount when no payment entity is present');
assert.equal(orderPaid.currency, 'INR');
console.log('Agentic MVP webhook intake checks passed.');
