/* Opt-in integration proof that terminal correlation cancels a pending proposal
 * inside the same database transaction. Append-only audit evidence is kept. */
require('dotenv/config');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { requireDatabaseClient } = require('../dist/db/client');
const { requireIntegrationOrganization } = require('./require-integration-organization');

if (process.env.PAYSCOPE_RUN_TERMINAL_INTEGRATION !== 'true') {
  console.log('Skipped terminal-cancellation integration test (set PAYSCOPE_RUN_TERMINAL_INTEGRATION=true for dedicated integration Supabase).');
  process.exit(0);
}
const organizationId = requireIntegrationOrganization();
const client = requireDatabaseClient();
const eventId = randomUUID(); const incidentId = randomUUID(); const proposalId = randomUUID(); const now = new Date().toISOString();

(async () => {
  try {
    const { error: eventError } = await client.from('payscope_events').insert({ id: eventId, organization_id: organizationId, razorpay_event_id: `integration-terminal-${randomUUID()}`, event_type: 'payment.captured', payload_hash: 'c'.repeat(64), normalized: { eventId: `integration-terminal-${eventId}`, eventType: 'payment.captured', occurredAt: now, receivedAt: now, orderId: `integration-order-${eventId}`, amountPaise: 100, currency: 'INR', providerData: {} } });
    if (eventError) throw new Error(eventError.message);
    const { error: incidentError } = await client.from('payscope_incidents').insert({ id: incidentId, organization_id: organizationId, risk_tier: 'MEDIUM', status: 'OPEN', total_failed_amount_paise: 100, recovered_amount_paise: 0, correlated_event_ids: [eventId], opened_at: now, updated_at: now });
    if (incidentError) throw new Error(incidentError.message);
    const { error: proposalError } = await client.from('payscope_action_proposals').insert({ id: proposalId, organization_id: organizationId, incident_id: incidentId, action_type: 'flag_for_review', content: {} });
    if (proposalError) throw new Error(proposalError.message);
    const result = await client.rpc('payscope_persist_correlation', { p_event_id: eventId, p_organization_id: organizationId, p_incident: { id: incidentId, risk_tier: 'MEDIUM', status: 'RESOLVED', total_failed_amount_paise: 100, recovered_amount_paise: 100, correlated_event_ids: [eventId], opened_at: now, resolved_at: now, updated_at: now }, p_enqueue_investigation: false, p_job_id: randomUUID(), p_job_payload: null });
    if (result.error) throw new Error(result.error.message);
    const { data: proposal, error: readError } = await client.from('payscope_action_proposals').select('status').eq('id', proposalId).single();
    if (readError) throw new Error(readError.message);
    assert.equal(proposal.status, 'cancelled_by_recovery');
    const audit = await client.from('payscope_audit_entries').select('event_type').eq('organization_id', organizationId).eq('incident_id', incidentId);
    if (audit.error) throw new Error(audit.error.message);
    assert.ok(audit.data.some(entry => entry.event_type === 'correlation_transition'), 'terminal persistence must record its correlation transition');
    assert.ok(audit.data.some(entry => entry.event_type === 'proposal_cancelled'), 'terminal persistence must record proposal cancellation');
    console.log('Hosted terminal correlation atomically cancelled the pending proposal.');
  } finally {
    await client.from('payscope_action_proposals').delete().eq('id', proposalId);
    await client.from('payscope_investigations').delete().eq('incident_id', incidentId);
    await client.from('payscope_incidents').delete().eq('id', incidentId);
    await client.from('payscope_events').delete().eq('id', eventId);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
