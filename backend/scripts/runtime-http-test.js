/**
 * Runtime HTTP verification: proves, over real HTTP against the REAL server
 * module (src/server.ts), that
 *
 *   HTTP Razorpay callback -> signature verification -> encrypted callback
 *   inbox evidence -> durable webhook intake -> dashboard API-key auth
 *   (constant-time, rotation-aware) -> tenant-scoped endpoints.
 *
 * The Express app, middleware stack, routes, and config validation are the
 * production code paths; only the Supabase-backed repository is replaced by
 * an in-memory contract double so no external database is required.
 */
const assert = require('node:assert/strict');
const { createHmac, randomBytes } = require('crypto');
const { createPayScopeApp } = require('../dist/server');
const { decryptEmail } = require('../dist/security/encryption');

const org = '00000000-0000-4000-8000-000000000001';
const webhookSecret = 'runtime_webhook_secret_1234567890';
const previousWebhookSecret = 'runtime_previous_secret_12345678';
const callbackEncryptionKey = randomBytes(32).toString('base64');
const currentDashboardKey = 'dash_current_key_0123456789abcdef';
const previousDashboardKey = 'dash_previous_key_0123456789abcdef';

const recordedCallbacks = [];
const recordedIntake = [];
let duplicateNext = false;

const repositoryDouble = {
  async recordVerifiedCallback(organizationId, callback, rawBodyEncrypted, source) {
    recordedCallbacks.push({ organizationId, callback, rawBodyEncrypted, source });
  },
  async recordWebhookIntake(organizationId, rawBody, normalized) {
    recordedIntake.push({ organizationId, eventType: normalized.eventType, eventId: normalized.eventId });
    return { eventId: normalized.eventId, duplicate: duplicateNext, incidentId: null, createdNewIncident: false };
  },
  async healthCheck() {},
  async autonomyPolicy() {
    return { organizationId: org, maxAutoRecoveryPaise: 500000, maxAutoCapturePaise: 0, maxAutoRefundPaise: 0, recoveryEmailEnabled: true, subscriptionRetryEnabled: false, captureEnabled: false, refundEnabled: false, disputeEvidenceEnabled: false, maxContactsPerIncident: 2, maxContactsPer24h: 1, quietHoursStart: null, quietHoursEnd: null, updatedAt: new Date().toISOString() };
  },
  async dashboardMetrics() {
    return { operations: {}, evaluation: { status: 'not_run', split: null } };
  },
};

function signed(body, secret = webhookSecret) {
  return createHmac('sha256', secret).update(body).digest('hex');
}

async function main() {
  const runtime = createPayScopeApp({
    NODE_ENV: 'development',
    PAYSCOPE_PIPELINE_ENABLED: 'true',
    SUPABASE_URL: 'https://verification-harness.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'verification-harness-not-a-real-key',
    RAZORPAY_WEBHOOK_SECRET: webhookSecret,
    RAZORPAY_WEBHOOK_SECRET_PREVIOUS: previousWebhookSecret,
    PAYSCOPE_ORGANIZATION_ID: org,
    PAYSCOPE_WORKER_ID: 'runtime-verification',
    PAYSCOPE_CALLBACK_ENCRYPTION_KEY: callbackEncryptionKey,
    PAYSCOPE_DASHBOARD_API_KEY: currentDashboardKey,
    PAYSCOPE_DASHBOARD_API_KEY_PREVIOUS: previousDashboardKey,
    PORT: String(20000 + Math.floor(Math.random() * 40000)),
  }, { repository: repositoryDouble });

  assert.equal(runtime.pipelineEnabled, true);
  assert.equal(runtime.config.dashboardApiKeys.length, 2, 'rotation must expose exactly the active and previous keys');

  const server = runtime.app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let passed = 0; let failed = 0;
  const check = (name, fn) => ({ name, fn });

  const checks = [
    check('GET /health reports the autonomous pipeline through real wiring', async () => {
      const res = await fetch(`${base}/health`);
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.pipeline, 'autonomous');
      assert.equal(body.worker, 'configured');
    }),

    check('webhook with invalid signature rejected before any persistence', async () => {
      const body = JSON.stringify({ id: 'evt_rt_bad', event: 'payment.failed', payload: { payment: { entity: { id: 'pay_rt_bad', amount: 100000, created_at: Math.floor(Date.now() / 1000) } } } });
      const res = await fetch(`${base}/webhooks/razorpay`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': 'ab'.repeat(32), 'x-razorpay-event-id': 'evt_rt_bad' }, body });
      assert.equal(res.status, 401);
      assert.equal(recordedCallbacks.length, 0);
      assert.equal(recordedIntake.length, 0);
    }),

    check('webhook eventId header mismatch rejected without persistence', async () => {
      const body = Buffer.from(JSON.stringify({ id: 'evt_rt_mm', event: 'payment.failed', payload: { payment: { entity: { id: 'pay_rt_mm', amount: 100000, created_at: Math.floor(Date.now() / 1000) } } } }));
      const res = await fetch(`${base}/webhooks/razorpay`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': signed(body), 'x-razorpay-event-id': 'evt_different' }, body });
      assert.equal(res.status, 422);
      assert.equal(recordedCallbacks.length, 0);
    }),

    check('valid callback: verified, encrypted evidence stored, durable event recorded', async () => {
      const referenceId = `ps_${'7'.repeat(32)}`;
      const body = Buffer.from(JSON.stringify({ id: 'evt_rt_ok', event: 'payment_link.paid', payload: { payment_link: { entity: { id: 'pl_rt', reference_id: referenceId, amount: 100000, status: 'paid', created_at: Math.floor(Date.now() / 1000) } } } }));
      const res = await fetch(`${base}/webhooks/razorpay`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': signed(body), 'x-razorpay-event-id': 'evt_rt_ok' }, body });
      const json = await res.json();
      assert.equal(res.status, 200);
      assert.equal(json.received, true);
      assert.equal(json.duplicate, false);

      // Callback evidence chain
      assert.equal(recordedCallbacks.length, 1);
      const evidence = recordedCallbacks[0];
      assert.equal(evidence.organizationId, org);
      assert.equal(evidence.source, 'http_webhook');
      assert.equal(evidence.callback.provider, 'razorpay');
      assert.equal(evidence.callback.verifiedSecretVersion, 1);
      assert.equal(evidence.callback.normalized.referenceId, referenceId);
      // Encrypted at rest; ciphertext round-trips to exact raw bytes.
      const decrypted = decryptEmail(evidence.rawBodyEncrypted, callbackEncryptionKey);
      assert.equal(Buffer.from(decrypted, 'utf8').equals(body), true);

      // Durable event chain
      assert.equal(recordedIntake.length, 1);
      assert.equal(recordedIntake[0].eventType, 'payment_link.paid');
      assert.equal(recordedIntake[0].eventId, 'evt_rt_ok');
    }),

    check('previous-secret signature accepted and tagged as secret version 2', async () => {
      const body = Buffer.from(JSON.stringify({ id: 'evt_rt_prev', event: 'payment_link.expired', payload: { payment_link: { entity: { id: 'pl_rt_prev', reference_id: `ps_${'8'.repeat(32)}`, amount: 100000, status: 'expired', created_at: Math.floor(Date.now() / 1000) } } } }));
      const res = await fetch(`${base}/webhooks/razorpay`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': signed(body, previousWebhookSecret), 'x-razorpay-event-id': 'evt_rt_prev' }, body });
      assert.equal(res.status, 200);
      const latest = recordedCallbacks.at(-1);
      assert.equal(latest.callback.verifiedSecretVersion, 2);
    }),

    check('duplicate delivery reported through the same runtime path', async () => {
      duplicateNext = true;
      const body = Buffer.from(JSON.stringify({ id: 'evt_rt_dup', event: 'payment.failed', payload: { payment: { entity: { id: 'pay_rt_dup', amount: 100000, created_at: Math.floor(Date.now() / 1000) } } } }));
      const res = await fetch(`${base}/webhooks/razorpay`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': signed(body), 'x-razorpay-event-id': 'evt_rt_dup' }, body });
      const json = await res.json();
      assert.equal(res.status, 200);
      assert.equal(json.duplicate, true);
      duplicateNext = false;
    }),

    check('dashboard rejects missing and unknown credentials', async () => {
      const missing = await fetch(`${base}/api/mvp/dashboard/metrics`);
      assert.equal(missing.status, 401);
      const wrong = await fetch(`${base}/api/mvp/dashboard/metrics`, { headers: { authorization: 'Bearer not_the_key' } });
      assert.equal(wrong.status, 401);
      const wrongHeader = await fetch(`${base}/api/mvp/dashboard/metrics`, { headers: { 'x-payscope-api-key': 'not_the_key' } });
      assert.equal(wrongHeader.status, 401);
      const bothHeaders = await fetch(`${base}/api/mvp/dashboard/metrics`, { headers: { authorization: `Bearer ${currentDashboardKey}`, 'x-payscope-api-key': currentDashboardKey } });
      assert.equal(bothHeaders.status, 401, 'requests presenting two credentials must be rejected');
    }),

    check('dashboard accepts active bearer key and previous key via header (rotation)', async () => {
      const active = await fetch(`${base}/api/mvp/dashboard/metrics`, { headers: { authorization: `Bearer ${currentDashboardKey}` } });
      assert.equal(active.status, 200);
      const previous = await fetch(`${base}/api/mvp/dashboard/metrics`, { headers: { 'x-payscope-api-key': previousDashboardKey } });
      assert.equal(previous.status, 200);
      const policy = await fetch(`${base}/api/mvp/autonomy-policy`, { headers: { authorization: `Bearer ${currentDashboardKey}` } });
      const policyBody = await policy.json();
      assert.equal(policy.status, 200);
      assert.equal(policyBody.data.organizationId, org, 'responses are bound to the single configured organization');
    }),
  ];

  for (const { name, fn } of checks) {
    try {
      await fn();
      console.log('✔ ' + name);
      passed++;
    } catch (error) {
      console.error('❌ ' + name + ': ' + error.message);
      failed++;
    }
  }

  await new Promise(resolve => server.close(resolve));
  console.log(`\nRuntime HTTP Verification Summary: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(error => {
  console.error('Runtime verification error:', error);
  process.exit(1);
});
