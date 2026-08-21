const assert = require('node:assert/strict');
const { createHmac, randomInt } = require('node:crypto');
const { once } = require('node:events');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const webhookSecret = 'paymentops-local-smoke-secret';

const delay = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds));

async function availablePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string', 'Could not reserve a local test port');
  const port = address.port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

function signedHeaders(body, eventId) {
  const signature = createHmac('sha256', webhookSecret).update(body).digest('hex');
  return { 'content-type': 'application/json', 'x-razorpay-signature': signature, 'x-razorpay-event-id': eventId };
}

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
  return { response, body };
}

function paymentEvent(event, createdAt, paymentId, orderId, customerId, amount, extra = {}) {
  return {
    event,
    created_at: createdAt,
    payload: { payment: { entity: { id: paymentId, order_id: orderId, customer_id: customerId, amount, currency: 'INR', method: 'upi', status: event.replace('payment.', '') } } },
    ...extra,
  };
}

async function sendWebhook(baseUrl, eventId, payload) {
  const body = JSON.stringify(payload);
  const result = await request(baseUrl, '/webhooks/razorpay', { method: 'POST', headers: signedHeaders(body, eventId), body });
  assert.equal(result.response.status, 200, `Webhook ${eventId} failed: ${JSON.stringify(result.body)}`);
  return result.body;
}

async function waitForHealth(baseUrl, child, output) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Smoke-test API exited during startup: ${output()}`);
    try {
      const result = await request(baseUrl, '/health');
      if (result.response.status === 200) return;
    } catch { /* The child is still starting. */ }
    await delay(80);
  }
  throw new Error(`Timed out waiting for smoke-test API: ${output()}`);
}

async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), delay(3_000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function verifyProductionTokenGate() {
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let output = '';
  const child = spawn(process.execPath, ['dist/server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'production',
      REQUIRE_API_AUTH: 'true',
      API_ACCESS_TOKEN: 'paymentops-smoke-api-token',
      CORS_ORIGINS: 'https://dashboard.example.test',
      RAZORPAY_ENVIRONMENT: 'test',
      RAZORPAY_WEBHOOK_SECRET: webhookSecret,
      SUPABASE_URL: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      RAZORPAY_KEY_ID: '',
      RAZORPAY_KEY_SECRET: '',
      OPENAI_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  try {
    await waitForHealth(baseUrl, child, () => output.slice(-2_000));
    const missingToken = await request(baseUrl, '/api/payment-ops/dashboard');
    assert.equal(missingToken.response.status, 401, 'Production API accepted a missing token');
    const legacyToken = await request(baseUrl, '/api/payment-ops/dashboard', { headers: { 'x-paymentops-key': 'paymentops-smoke-api-token' } });
    assert.equal(legacyToken.response.status, 401, 'Legacy custom token header is still accepted');
    const validToken = await request(baseUrl, '/api/payment-ops/dashboard', { headers: { authorization: 'Bearer paymentops-smoke-api-token' } });
    assert.equal(validToken.response.status, 200, 'Production API rejected a valid Bearer token');
  } finally {
    await stop(child);
  }
}

async function main() {
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let output = '';
  const child = spawn(process.execPath, ['dist/server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'development',
      REQUIRE_API_AUTH: 'false',
      RAZORPAY_ENVIRONMENT: 'test',
      RAZORPAY_WEBHOOK_SECRET: webhookSecret,
      PAYMENT_OPS_PUBLIC_URL: baseUrl,
      SUPABASE_URL: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      RAZORPAY_KEY_ID: '',
      RAZORPAY_KEY_SECRET: '',
      OPENAI_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });

  try {
    await waitForHealth(baseUrl, child, () => output.slice(-2_000));
    const timestamp = Math.floor(Date.now() / 1_000) - 60;

    const failed = await sendWebhook(baseUrl, 'evt_smoke_partial_failed', paymentEvent('payment.failed', timestamp, 'pay_smoke_partial_failed', 'order_smoke_partial', 'customer_smoke_partial', 1_000));
    const duplicate = await sendWebhook(baseUrl, 'evt_smoke_partial_failed', paymentEvent('payment.failed', timestamp, 'pay_smoke_partial_failed', 'order_smoke_partial', 'customer_smoke_partial', 1_000));
    assert.equal(duplicate.duplicate, true, 'Duplicate webhook was not marked duplicate');

    await sendWebhook(baseUrl, 'evt_smoke_partial_success_one', paymentEvent('payment.captured', timestamp + 1, 'pay_smoke_partial_success_one', 'order_smoke_partial', 'customer_smoke_partial', 300));
    let detail = await request(baseUrl, `/api/payment-ops/incidents/${encodeURIComponent(failed.incidentId)}`);
    assert.equal(detail.response.status, 200);
    assert.equal(detail.body.data.incident.status, 'monitoring', 'Partial recovery must not close an incident');
    assert.equal(detail.body.data.incident.recoveredAmountPaise, 300);

    await sendWebhook(baseUrl, 'evt_smoke_partial_success_two', paymentEvent('payment.captured', timestamp + 2, 'pay_smoke_partial_success_two', 'order_smoke_partial', 'customer_smoke_partial', 700));
    detail = await request(baseUrl, `/api/payment-ops/incidents/${encodeURIComponent(failed.incidentId)}`);
    assert.equal(detail.body.data.incident.status, 'recovered');
    assert.equal(detail.body.data.incident.recoveredAmountPaise, 1_000);

    await sendWebhook(baseUrl, 'evt_smoke_out_of_order_success', paymentEvent('payment.captured', timestamp + 12, 'pay_smoke_out_success', 'order_smoke_out', 'customer_smoke_out', 250));
    const outOfOrder = await sendWebhook(baseUrl, 'evt_smoke_out_of_order_failed', paymentEvent('payment.failed', timestamp + 11, 'pay_smoke_out_failed', 'order_smoke_out', 'customer_smoke_out', 250));
    detail = await request(baseUrl, `/api/payment-ops/incidents/${encodeURIComponent(outOfOrder.incidentId)}`);
    assert.equal(detail.body.data.incident.status, 'recovered', 'Out-of-order delivery should use provider timestamps');

    const privateEvent = await sendWebhook(baseUrl, 'evt_smoke_private_raw', paymentEvent('payment.failed', timestamp + 20, 'pay_smoke_private', 'order_smoke_private', 'customer_smoke_private', 500, { internal_only_marker: 'must-not-reach-the-browser' }));
    const manualInvestigation = await request(baseUrl, `/api/payment-ops/incidents/${encodeURIComponent(privateEvent.incidentId)}/investigate`, { method: 'POST' });
    assert.equal(manualInvestigation.response.status, 200, 'Manual investigation failed');
    await delay(500);
    const manualDetail = await request(baseUrl, `/api/payment-ops/incidents/${encodeURIComponent(privateEvent.incidentId)}`);
    assert.equal(manualDetail.body.data.audit.filter(entry => entry.action === 'investigation_completed').length, 1, 'Manual investigation caused a redundant debounced run');
    const events = await request(baseUrl, '/api/payment-ops/events');
    assert.equal(events.response.headers.get('cache-control'), 'no-store');
    assert.equal(JSON.stringify(events.body.data).includes('must-not-reach-the-browser'), false, 'Raw webhook data leaked to the events API');

    const unsigned = await request(baseUrl, '/webhooks/razorpay', { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-event-id': 'evt_smoke_unsigned' }, body: '{}' });
    assert.equal(unsigned.response.status, 401, 'Unsigned webhook was accepted');
    const removedDemoRoute = await request(baseUrl, '/api/payment-ops/demo/replay', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(removedDemoRoute.response.status, 404, 'Removed replay route still exists');

    const burstCustomer = `customer_smoke_burst_${randomInt(1_000_000)}`;
    for (let index = 1; index <= 101; index += 1) {
      await sendWebhook(baseUrl, `evt_smoke_burst_${index}`, paymentEvent('payment.failed', timestamp + 40, `pay_smoke_burst_${index}`, 'order_smoke_burst', burstCustomer, 100));
    }
    await delay(800);
    const incidentList = await request(baseUrl, '/api/payment-ops/incidents');
    const burstIncident = incidentList.body.data.find(incident => incident.customerReference === burstCustomer);
    assert(burstIncident, 'Expected burst incident was not created');
    const burstDetail = await request(baseUrl, `/api/payment-ops/incidents/${encodeURIComponent(burstIncident.incidentId)}`);
    const burst = burstDetail.body.data;
    assert.equal(burst.incident.eventCount, 101);
    assert.equal(burst.incident.eventIds.length, 100);
    assert.equal(burst.events.length, 100);
    assert.equal(burst.incident.agentRun.evidenceEventIds.length, 30);
    assert.equal(burst.audit.filter(entry => entry.action === 'investigation_completed').length, 1, 'Burst scheduled more than one automatic investigation');

    const action = await request(baseUrl, `/api/payment-ops/incidents/${encodeURIComponent(burstIncident.incidentId)}/actions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'monitor', operator: 'spoofed-browser-actor' }) });
    assert.equal(action.response.status, 200);
    assert.equal(action.body.data.operatorAction.operator, 'Payment operations admin', 'Client-controlled operator identity was accepted');

  } finally {
    await stop(child);
  }
  await verifyProductionTokenGate();
  console.log('PaymentOps smoke test passed: signature, idempotency, recovery, privacy, burst limits, debounce, actor control, and production Bearer-token gating verified.');
}

main().catch(error => {
  console.error(`PaymentOps smoke test failed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exitCode = 1;
});
