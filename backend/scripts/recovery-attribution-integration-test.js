/* Opt-in Test Mode proof that dashboard recovery metrics require a proposal
 * approval plus a 24-hour captured payment carrying its proposal reference. */
require('dotenv/config');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { requireDatabaseClient } = require('../dist/db/client');
const { requireIntegrationOrganization } = require('./require-integration-organization');

if (process.env.PAYSCOPE_RUN_ATTRIBUTION_INTEGRATION !== 'true') {
  console.log('Skipped recovery-attribution integration test (set PAYSCOPE_RUN_ATTRIBUTION_INTEGRATION=true for Test Mode Supabase).');
  process.exit(0);
}
const organizationId = requireIntegrationOrganization();
const client = requireDatabaseClient();
const incidentId = randomUUID(); const failedEventId = randomUUID(); const capturedEventId = randomUUID(); const proposalId = randomUUID();
const approvedAt = new Date().toISOString();
const capturedAt = new Date(Date.parse(approvedAt) + 60_000).toISOString();

(async () => {
  const before = await client.rpc('payscope_dashboard_metrics', { p_organization_id: organizationId });
  if (before.error) throw new Error(before.error.message);
  const baseline = before.data.operations;
  try {
    for (const [id, eventType, occurredAt, amountPaise, providerData] of [
      [failedEventId, 'payment.failed', approvedAt, 1_000, {}],
      [capturedEventId, 'payment.captured', capturedAt, 1_500, { payment_link_reference_id: `ps:${proposalId}` }],
    ]) {
      const { error } = await client.from('payscope_events').insert({
        id, organization_id: organizationId, razorpay_event_id: `integration-attribution-${id}`,
        event_type: eventType, payload_hash: 'a'.repeat(64),
        normalized: { eventId: `integration-attribution-${id}`, eventType, occurredAt, receivedAt: occurredAt, amountPaise, currency: 'INR', providerData },
      });
      if (error) throw new Error(error.message);
    }
    const { error: incidentError } = await client.from('payscope_incidents').insert({
      id: incidentId, organization_id: organizationId, risk_tier: 'MEDIUM', status: 'OPEN',
      total_failed_amount_paise: 1_000, recovered_amount_paise: 0,
      correlated_event_ids: [failedEventId], opened_at: approvedAt, updated_at: approvedAt,
    });
    if (incidentError) throw new Error(incidentError.message);
    const { error: proposalError } = await client.from('payscope_action_proposals').insert({
      id: proposalId, organization_id: organizationId, incident_id: incidentId,
      action_type: 'retry_link_sms', content: { paymentLinkReferenceId: `ps:${proposalId}` },
      status: 'simulated', approved_at: approvedAt,
      delivery_result: { status: 'simulated', note: 'integration proof; no customer message sent', simulatedAt: approvedAt },
    });
    if (proposalError) throw new Error(proposalError.message);
    const after = await client.rpc('payscope_dashboard_metrics', { p_organization_id: organizationId });
    if (after.error) throw new Error(after.error.message);
    assert.equal(after.data.operations.attributedRecoveries, baseline.attributedRecoveries + 1, 'one uniquely referenced captured payment must be credited once');
    assert.equal(after.data.operations.recoveredPaise, baseline.recoveredPaise + 1_000, 'recovery is capped at the incident amount');
    console.log('Hosted causal recovery-attribution checks passed.');
  } finally {
    await client.from('payscope_action_proposals').delete().eq('id', proposalId).eq('organization_id', organizationId);
    await client.from('payscope_incidents').delete().eq('id', incidentId).eq('organization_id', organizationId);
    await client.from('payscope_events').delete().in('id', [failedEventId, capturedEventId]).eq('organization_id', organizationId);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
