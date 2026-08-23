const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { ExecutionWorker } = require('../dist/execution/execution-worker');
const { ExecutionPreconditionError } = require('../dist/execution/execution-repository');
const { encryptEmail } = require('../dist/security/encryption');
const { RazorpayExecutionClient } = require('../dist/providers/execution/razorpay-execution-client');

const org = '00000000-0000-4000-8000-000000000001';
const actionId = '00000000-0000-4000-8000-000000000002';
const incidentId = '00000000-0000-4000-8000-000000000003';
const key = randomBytes(32).toString('base64');

function outbox() { return { id: '00000000-0000-4000-8000-000000000004', organizationId: org, actionId, commandType: 'deliver_recovery_link_email', attemptNumber: 1 }; }
function action(emailSendStartedAt = null) { return { id: actionId, organizationId: org, incidentId, capability: 'deliver_recovery_link_email', commandPayload: { customerHash: 'a'.repeat(64), referenceId: 'ps_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', copyIntent: 'Please complete your pending payment. To opt out, reply stop.' }, state: 'queued', amountPaise: 1000, currency: 'INR', emailSendStartedAt }; }

async function acceptedEmailScenario() {
  const calls = []; let claimed = false;
  const repository = {
    claim: async () => claimed ? null : (claimed = true, outbox()),
    action: async () => action(), paymentLinkReceipt: async () => null,
    recipientEnvelope: async () => encryptEmail('customer@example.com', key),
    markEmailSendStarted: async () => true,
    recordReceipt: async input => calls.push(['receipt', input]),
    completeOutbox: async () => calls.push(['complete']), failOutbox: async () => calls.push(['fail']),
    appendMemory: async (...args) => calls.push(['memory', args]),
  };
  const email = { send: async input => { assert.equal(input.to, 'customer@example.com'); assert.match(input.paymentLinkUrl, /^https:\/\/rzp\.io\//); return { kind: 'accepted', messageId: 'message-1', acceptedCount: 1, rejectedCount: 0, response: '250 queued' }; }, close: async () => {} };
  const razorpay = { createPaymentLink: async () => ({ id: 'plink_1', shortUrl: 'https://rzp.io/i/abc', referenceId: 'ps_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', status: 'created', amount: 1000, currency: 'INR' }), paymentLinkByReference: async () => null };
  const worker = new ExecutionWorker(repository, razorpay, email, key, 'test-worker'); worker.accepting = true;
  assert.equal(await worker.processOne(), true);
  assert.equal(calls.filter(([kind]) => kind === 'receipt').length, 2);
  assert.equal(calls.find(([kind, value]) => kind === 'receipt' && value.kind === 'smtp_accepted')[1].state, 'accepted');
  assert.ok(calls.some(([kind]) => kind === 'memory'));
  assert.ok(calls.some(([kind]) => kind === 'complete'));
  assert.equal(calls.some(([kind]) => kind === 'fail'), false);
}

async function ambiguousEmailScenario() {
  const calls = []; let claimed = false;
  const repository = { claim: async () => claimed ? null : (claimed = true, outbox()), action: async () => action('2026-08-23T00:00:00.000Z'), recordReceipt: async input => calls.push(input), completeOutbox: async () => calls.push({ complete: true }), failOutbox: async () => calls.push({ fail: true }) };
  const email = { send: async () => { throw new Error('must not resend'); }, close: async () => {} };
  const worker = new ExecutionWorker(repository, {}, email, key, 'test-worker'); worker.accepting = true;
  await worker.processOne();
  assert.equal(calls[0].kind, 'unreconciled'); assert.equal(calls[0].terminalReason, 'SMTP_RESULT_AMBIGUOUS_NO_RESEND'); assert.ok(calls.some(value => value.complete)); assert.equal(calls.some(value => value.fail), false);
}

async function withdrawnRecipientScenario() {
  const calls = []; let claimed = false;
  const repository = {
    claim: async () => claimed ? null : (claimed = true, outbox()), action: async () => action(), paymentLinkReceipt: async () => null,
    recipientEnvelope: async () => { throw new ExecutionPreconditionError('recipient_unavailable'); },
    recordReceipt: async input => calls.push(['receipt', input]), completeOutbox: async () => calls.push(['complete']), failOutbox: async () => calls.push(['fail']),
  };
  const razorpay = { createPaymentLink: async () => { throw new Error('a recipient failure must not create a payment link'); } };
  const worker = new ExecutionWorker(repository, razorpay, { close: async () => {} }, key, 'test-worker'); worker.accepting = true;
  await worker.processOne();
  assert.equal(calls.find(([kind]) => kind === 'receipt')[1].terminalReason, 'PRE_DISPATCH_RECIPIENT_UNAVAILABLE');
  assert.ok(calls.some(([kind]) => kind === 'complete')); assert.equal(calls.some(([kind]) => kind === 'fail'), false);
}

async function paymentLinkReferenceLookupScenario() {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ payment_links: [{ id: 'plink_1', short_url: 'https://rzp.io/i/abc', reference_id: 'ps_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', amount: 1000, currency: 'INR', status: 'created' }] }) });
  try {
    const link = await new RazorpayExecutionClient('rzp_live_key', 'secret').paymentLinkByReference('ps_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    assert.equal(link.id, 'plink_1'); assert.equal(link.shortUrl, 'https://rzp.io/i/abc');
  } finally { global.fetch = originalFetch; }
}

async function paymentLinkReferenceMismatchScenario() {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ payment_links: [{ id: 'plink_1', short_url: 'https://rzp.io/i/abc', reference_id: 'ps_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', amount: 1000, currency: 'INR', status: 'created' }] }) });
  try {
    await assert.rejects(() => new RazorpayExecutionClient('rzp_live_key', 'secret').paymentLinkByReference('ps_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), /mismatched reference/);
  } finally { global.fetch = originalFetch; }
}

Promise.resolve().then(acceptedEmailScenario).then(ambiguousEmailScenario).then(withdrawnRecipientScenario).then(paymentLinkReferenceLookupScenario).then(paymentLinkReferenceMismatchScenario).then(() => console.log('Execution worker idempotency and encrypted-email checks passed.')).catch(error => { console.error(error); process.exitCode = 1; });
