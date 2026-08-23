/* Proves the audit lifecycle emitted by the canonical durable RPCs. Fixture
 * rows intentionally remain in the isolated integration tenant because audit
 * evidence is immutable by design. */
require('dotenv/config');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { requireDatabaseClient } = require('../dist/db/client');
const { requireIntegrationOrganization } = require('./require-integration-organization');

if (process.env.PAYSCOPE_RUN_AUDIT_LIFECYCLE_INTEGRATION !== 'true') {
  console.log('Skipped audit-lifecycle integration test (set PAYSCOPE_RUN_AUDIT_LIFECYCLE_INTEGRATION=true for dedicated integration Supabase).');
  process.exit(0);
}
const organizationId = requireIntegrationOrganization();
const client = requireDatabaseClient();
const eventId = randomUUID(); const incidentId = randomUUID(); const intakeJobId = randomUUID(); const enrichmentJobId = randomUUID();
const now = new Date().toISOString();
const normalized = { eventId: `integration-audit-lifecycle-${eventId}`, eventType: 'payment.failed', occurredAt: now, receivedAt: now, orderId: `integration-order-${eventId}`, amountPaise: 1_000, currency: 'INR', paymentStatus: 'failed', paymentMethod: 'upi', providerData: {} };

(async () => {
  const intake = await client.rpc('payscope_ingest_event_and_enqueue', {
    p_event_id: eventId, p_organization_id: organizationId, p_razorpay_event_id: normalized.eventId,
    p_event_type: normalized.eventType, p_payload_hash: 'b'.repeat(64), p_normalized: normalized,
    p_job_id: intakeJobId, p_job_payload: { jobId: intakeJobId, organizationId, type: 'enrich_event', attemptNumber: 1, createdAt: now, eventId, testFixture: true },
  });
  if (intake.error) throw new Error(intake.error.message);
  assert.equal(intake.data[0].duplicate, false);
  const defer = await client.from('payscope_queue_jobs').update({ next_attempt_at: '2099-01-01T00:00:00.000Z' }).eq('id', intakeJobId).eq('organization_id', organizationId);
  if (defer.error) throw new Error(defer.error.message);
  const enriched = await client.rpc('payscope_complete_enrichment_and_enqueue', {
    p_event_id: eventId, p_organization_id: organizationId, p_enrichment: null, p_enrichment_source: 'unavailable',
    p_job_id: enrichmentJobId, p_job_payload: { jobId: enrichmentJobId, organizationId, type: 'correlate_event', attemptNumber: 1, createdAt: now, eventId, testFixture: true },
  });
  if (enriched.error) throw new Error(enriched.error.message);
  const correlation = await client.rpc('payscope_persist_correlation', {
    p_event_id: eventId, p_organization_id: organizationId,
    p_incident: { id: incidentId, risk_tier: 'MEDIUM', status: 'OPEN', total_failed_amount_paise: 1_000, recovered_amount_paise: 0, correlated_event_ids: [eventId], opened_at: now, resolved_at: '', updated_at: now },
    p_enqueue_investigation: false, p_job_id: randomUUID(), p_job_payload: null,
  });
  if (correlation.error) throw new Error(correlation.error.message);
  const persisted = await client.rpc('payscope_persist_investigation_with_proposals', {
    p_organization_id: organizationId, p_incident_id: incidentId,
    p_plan: { hypothesis: 'fixture hypothesis' }, p_risk_analysis: { confidence: 0.9 },
    p_recovery_plan: { proposedActions: [] },
    p_policy_decision: { outcome: 'auto_no_action', noActionReason: 'fixture no-action', matchedPolicyId: null, permittedActions: [] },
    p_proposals: [], p_model_id: 'fixture-audit-lifecycle', p_tokens_used: 0, p_latency_ms: 0,
  });
  if (persisted.error) throw new Error(persisted.error.message);
  const audit = await client.from('payscope_audit_entries').select('event_type,incident_id,enrichment_snapshot').eq('organization_id', organizationId).order('sequence_number', { ascending: false }).limit(250);
  if (audit.error) throw new Error(audit.error.message);
  const types = new Set(audit.data
    .filter(entry => entry.incident_id === incidentId || entry.enrichment_snapshot?.event_id === eventId)
    .map(entry => entry.event_type));
  for (const type of ['event_received', 'event_enriched', 'incident_opened', 'policy_decision_recorded', 'autonomous_no_action_recorded', 'investigation_completed']) assert.ok(types.has(type), `missing ${type}`);
  console.log('Hosted durable audit lifecycle coverage checks passed.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
