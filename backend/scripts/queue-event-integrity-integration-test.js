/* Opt-in integration proof that every enqueue RPC writes a tenant-scoped source
 * event relation and that deleting that source cannot leave queue debris. */
require('dotenv/config');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { requireDatabaseClient } = require('../dist/db/client');
const { requireIntegrationOrganization } = require('./require-integration-organization');

if (process.env.PAYSCOPE_RUN_QUEUE_INTEGRITY_INTEGRATION !== 'true') {
  console.log('Skipped queue-event-integrity integration test (set PAYSCOPE_RUN_QUEUE_INTEGRITY_INTEGRATION=true for dedicated integration Supabase).');
  process.exit(0);
}

const organizationId = requireIntegrationOrganization();
const client = requireDatabaseClient();
const eventId = randomUUID();
const incidentId = randomUUID();
const correlationJobId = randomUUID();
const investigationJobId = randomUUID();
const now = new Date().toISOString();

(async () => {
  try {
    // Pre-enrich the event so this regression has no append-only audit fixture
    // residue. The completion RPC still must enqueue correlation idempotently.
    const { error: eventError } = await client.from('payscope_events').insert({
      id: eventId,
      organization_id: organizationId,
      razorpay_event_id: `integration-queue-integrity-${randomUUID()}`,
      event_type: 'payment.failed',
      payload_hash: 'a'.repeat(64),
      normalized: { eventId: `integration-queue-integrity-${eventId}`, eventType: 'payment.failed', occurredAt: now, receivedAt: now, amountPaise: 100, currency: 'INR', providerData: {} },
      enrichment: { source: 'fixture_signed' },
      enrichment_source: 'fixture_signed',
    });
    if (eventError) throw new Error(eventError.message);

    const { error: completionError } = await client.rpc('payscope_complete_enrichment_and_enqueue', {
      p_event_id: eventId,
      p_organization_id: organizationId,
      p_enrichment: { source: 'fixture_signed' },
      p_enrichment_source: 'fixture_signed',
      p_job_id: correlationJobId,
      p_job_payload: { jobId: correlationJobId, organizationId, type: 'correlate_event', attemptNumber: 1, createdAt: now, eventId, testFixture: true },
    });
    if (completionError) throw new Error(completionError.message);

    const incident = {
      id: incidentId,
      risk_tier: 'MEDIUM',
      status: 'OPEN',
      total_failed_amount_paise: 100,
      recovered_amount_paise: 0,
      correlated_event_ids: [eventId],
      opened_at: now,
      resolved_at: '',
      updated_at: now,
    };
    const { error: correlationError } = await client.rpc('payscope_persist_correlation', {
      p_event_id: eventId,
      p_organization_id: organizationId,
      p_incident: incident,
      p_enqueue_investigation: true,
      p_job_id: investigationJobId,
      p_job_payload: { jobId: investigationJobId, organizationId, type: 'investigate_incident', attemptNumber: 1, createdAt: now, incidentId, triggerEventId: eventId, testFixture: true },
    });
    if (correlationError) throw new Error(correlationError.message);

    const { data: jobs, error: jobsError } = await client.from('payscope_queue_jobs').select('id,source_event_id').in('id', [correlationJobId, investigationJobId]);
    if (jobsError) throw new Error(jobsError.message);
    assert.equal(jobs.length, 2, 'both downstream jobs must be inserted');
    assert.ok(jobs.every(job => job.source_event_id === eventId), 'each downstream job must reference its triggering event');

    const { error: deleteEventError } = await client.from('payscope_events').delete().eq('id', eventId).eq('organization_id', organizationId);
    if (deleteEventError) throw new Error(deleteEventError.message);
    const { data: remainingJobs, error: remainingJobsError } = await client.from('payscope_queue_jobs').select('id').in('id', [correlationJobId, investigationJobId]);
    if (remainingJobsError) throw new Error(remainingJobsError.message);
    assert.deepEqual(remainingJobs, [], 'source-event deletion must cascade all queued child jobs');
    console.log('Hosted queue source-event integrity and cascade checks passed.');
  } finally {
    await client.from('payscope_queue_jobs').delete().in('id', [correlationJobId, investigationJobId]);
    await client.from('payscope_incidents').delete().eq('id', incidentId).eq('organization_id', organizationId);
    await client.from('payscope_events').delete().eq('id', eventId).eq('organization_id', organizationId);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
