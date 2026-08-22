/* Opt-in Test Mode proof for SKIP LOCKED claiming and stale-lease recovery. */
require('dotenv/config');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { requireDatabaseClient } = require('../dist/db/client');

if (process.env.PAYSCOPE_RUN_QUEUE_INTEGRATION !== 'true') {
  console.log('Skipped queue lease integration test (set PAYSCOPE_RUN_QUEUE_INTEGRATION=true for Test Mode Supabase).');
  process.exit(0);
}
const organizationId = process.env.PAYSCOPE_DEMO_ORGANIZATION_ID;
if (!organizationId) throw new Error('PAYSCOPE_DEMO_ORGANIZATION_ID is required for the queue lease integration test.');
const client = requireDatabaseClient();
const jobId = randomUUID(); const eventId = randomUUID(); const now = new Date().toISOString();

(async () => {
  try {
    const { error: eventError } = await client.from('payscope_events').insert({ id: eventId, organization_id: organizationId, razorpay_event_id: `integration-lease-${randomUUID()}`, event_type: 'payment.failed', payload_hash: 'e'.repeat(64), normalized: { eventId: `integration-lease-${eventId}`, eventType: 'payment.failed', occurredAt: now, receivedAt: now, amountPaise: 100, currency: 'INR', providerData: {} } });
    if (eventError) throw new Error(eventError.message);
    const { error: insertError } = await client.from('payscope_queue_jobs').insert({ id: jobId, organization_id: organizationId, source_event_id: eventId, job_key: `integration-lease:${jobId}`, job_type: 'enrich_event', payload: { jobId, organizationId, type: 'enrich_event', attemptNumber: 1, createdAt: now, eventId, testFixture: true }, next_attempt_at: '2099-01-01T00:00:00.000Z' });
    if (insertError) throw new Error(insertError.message);
    // Make the row due only immediately before both contenders claim it.
    const { error: dueError } = await client.from('payscope_queue_jobs').update({ next_attempt_at: now }).eq('id', jobId);
    if (dueError) throw new Error(dueError.message);
    const [left, right] = await Promise.all([client.rpc('payscope_claim_queue_job', { p_worker_id: `integration-a-${jobId}`, p_fixture_job_id: jobId }), client.rpc('payscope_claim_queue_job', { p_worker_id: `integration-b-${jobId}`, p_fixture_job_id: jobId })]);
    if (left.error || right.error) throw new Error(left.error?.message ?? right.error?.message);
    const claims = [...(left.data ?? []), ...(right.data ?? [])];
    assert.equal(claims.filter(row => row.id === jobId).length, 1, 'exactly one concurrent worker may claim a due job');
    const { error: staleError } = await client.from('payscope_queue_jobs').update({ status: 'running', locked_at: '2000-01-01T00:00:00.000Z', locked_by: 'integration-stale' }).eq('id', jobId);
    if (staleError) throw new Error(staleError.message);
    const { data: reclaimed, error: reclaimError } = await client.rpc('payscope_requeue_stale_jobs', { p_lock_timeout_seconds: 30 });
    if (reclaimError) throw new Error(reclaimError.message);
    assert.ok(Number(reclaimed) >= 1, 'stale lock must become due again');
    console.log('Hosted queue claim-contention and stale-lease recovery checks passed.');
  } finally {
    await client.from('payscope_queue_jobs').delete().eq('id', jobId);
    await client.from('payscope_events').delete().eq('id', eventId);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
