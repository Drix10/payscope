/* Opt-in Test Mode proof for the database transaction behind webhook intake.
 * It creates only uniquely named temporary rows and removes them in finally. */
require('dotenv/config');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { requireDatabaseClient } = require('../dist/db/client');

if (process.env.PAYSCOPE_RUN_DURABLE_INTEGRATION !== 'true') {
  console.log('Skipped durable intake integration test (set PAYSCOPE_RUN_DURABLE_INTEGRATION=true for Test Mode Supabase).');
  process.exit(0);
}

const organizationId = process.env.PAYSCOPE_DEMO_ORGANIZATION_ID;
if (!organizationId) throw new Error('PAYSCOPE_DEMO_ORGANIZATION_ID is required for the durable intake integration test.');
const client = requireDatabaseClient();
const createdJobIds = [];
const createdEventIds = [];
const now = new Date().toISOString();
const normalized = (eventId) => ({ eventId, eventType: 'payment.failed', occurredAt: now, receivedAt: now, amountPaise: 100, currency: 'INR', providerData: {} });
// Fixture jobs are invisible to the live VPS worker. The database integration
// check claims none of them, so cleanup cannot race an enrichment hand-off.
const payload = (jobId, eventId) => ({ jobId, organizationId, type: 'enrich_event', attemptNumber: 1, createdAt: now, eventId, testFixture: true });
const eventRow = (id, razorpayEventId) => ({ id, organization_id: organizationId, razorpay_event_id: razorpayEventId, event_type: 'payment.failed', payload_hash: 'f'.repeat(64), normalized: normalized(razorpayEventId) });

(async () => {
  try {
    // The primary-key collision happens after the event INSERT in the RPC. A
    // missing event afterwards proves the function rolled back atomically.
    const collisionJobId = randomUUID(); const collisionEventId = randomUUID(); const collisionParentEventId = randomUUID();
    createdJobIds.push(collisionJobId); createdEventIds.push(collisionParentEventId);
    const collisionParentRazorpayId = `integration-collision-parent-${randomUUID()}`;
    const { error: collisionEventError } = await client.from('payscope_events').insert(eventRow(collisionParentEventId, collisionParentRazorpayId));
    if (collisionEventError) throw new Error(`Could not prepare collision event: ${collisionEventError.message}`);
    const { error: setupError } = await client.from('payscope_queue_jobs').insert({ id: collisionJobId, organization_id: organizationId, source_event_id: collisionParentEventId, job_key: `integration-collision:${collisionJobId}`, job_type: 'enrich_event', payload: payload(collisionJobId, collisionParentEventId), next_attempt_at: '2099-01-01T00:00:00.000Z' });
    if (setupError) throw new Error(`Could not prepare rollback check: ${setupError.message}`);
    const rollbackRazorpayId = `integration-rollback-${randomUUID()}`;
    const { error: rollbackError } = await client.rpc('payscope_ingest_event_and_enqueue', { p_event_id: collisionEventId, p_organization_id: organizationId, p_razorpay_event_id: rollbackRazorpayId, p_event_type: 'payment.failed', p_payload_hash: 'a'.repeat(64), p_normalized: normalized(rollbackRazorpayId), p_job_id: collisionJobId, p_job_payload: payload(collisionJobId, collisionEventId) });
    assert.ok(rollbackError, 'forced queue primary-key collision must fail the intake RPC');
    const { data: rolledBack, error: rollbackReadError } = await client.from('payscope_events').select('id').eq('organization_id', organizationId).eq('razorpay_event_id', rollbackRazorpayId);
    if (rollbackReadError) throw new Error(rollbackReadError.message);
    assert.deepEqual(rolledBack, [], 'event insert must roll back when its queue insert fails');

    const eventId = randomUUID(); const jobId = randomUUID(); const razorpayEventId = `integration-duplicate-${randomUUID()}`;
    createdEventIds.push(eventId); createdJobIds.push(jobId);
    const args = { p_event_id: eventId, p_organization_id: organizationId, p_razorpay_event_id: razorpayEventId, p_event_type: 'payment.failed', p_payload_hash: 'b'.repeat(64), p_normalized: normalized(razorpayEventId), p_job_id: jobId, p_job_payload: payload(jobId, eventId) };
    const first = await client.rpc('payscope_ingest_event_and_enqueue', args);
    if (first.error) throw new Error(first.error.message);
    const second = await client.rpc('payscope_ingest_event_and_enqueue', { ...args, p_event_id: randomUUID(), p_job_id: randomUUID() });
    if (second.error) throw new Error(second.error.message);
    assert.equal(first.data[0].duplicate, false); assert.equal(second.data[0].duplicate, true);
    const { data: eventRows, error: eventRowsError } = await client.from('payscope_events').select('id').eq('organization_id', organizationId).eq('razorpay_event_id', razorpayEventId);
    if (eventRowsError) throw new Error(eventRowsError.message);
    const { data: jobRows, error: jobRowsError } = await client.from('payscope_queue_jobs').select('id').eq('job_key', `enrich:${eventId}`);
    if (jobRowsError) throw new Error(jobRowsError.message);
    assert.equal(eventRows.length, 1); assert.equal(jobRows.length, 1);
    console.log('Hosted durable intake rollback and duplicate-idempotency checks passed.');
  } finally {
    if (createdJobIds.length) await client.from('payscope_queue_jobs').delete().in('id', createdJobIds);
    if (createdEventIds.length) await client.from('payscope_events').delete().in('id', createdEventIds);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
