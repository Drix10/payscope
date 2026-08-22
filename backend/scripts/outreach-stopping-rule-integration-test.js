/* Opt-in Test Mode proof that simulated outreach is rechecked and counted in
 * the database, rather than trusting a stale policy decision from the worker. */
require('dotenv/config');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { requireDatabaseClient } = require('../dist/db/client');

if (process.env.PAYSCOPE_RUN_OUTREACH_INTEGRATION !== 'true') {
  console.log('Skipped outreach stopping-rule integration test (set PAYSCOPE_RUN_OUTREACH_INTEGRATION=true for Test Mode Supabase).');
  process.exit(0);
}
const organizationId = process.env.PAYSCOPE_DEMO_ORGANIZATION_ID;
if (!organizationId) throw new Error('PAYSCOPE_DEMO_ORGANIZATION_ID is required for the outreach integration test.');
const client = requireDatabaseClient();
const eventId = randomUUID(); const incidentId = randomUUID(); const firstProposalId = randomUUID(); const secondProposalId = randomUUID(); const customerHash = 'd'.repeat(64); const now = new Date().toISOString();
let originalPolicy;

(async () => {
  try {
    const policyResult = await client.from('payscope_merchant_policies').select('merchant_opted_in_to_recovery, allowed_actions').eq('organization_id', organizationId).single();
    if (policyResult.error) throw new Error(policyResult.error.message);
    originalPolicy = policyResult.data;
    const { error: policyError } = await client.from('payscope_merchant_policies').update({ merchant_opted_in_to_recovery: true, allowed_actions: ['retry_link_sms'] }).eq('organization_id', organizationId);
    if (policyError) throw new Error(policyError.message);
    const { error: eventError } = await client.from('payscope_events').insert({ id: eventId, organization_id: organizationId, razorpay_event_id: `integration-outreach-${randomUUID()}`, event_type: 'payment.failed', payload_hash: 'd'.repeat(64), normalized: { eventId: `integration-outreach-${eventId}`, eventType: 'payment.failed', occurredAt: now, receivedAt: now, customerHash, amountPaise: 100, currency: 'INR', providerData: {} } });
    if (eventError) throw new Error(eventError.message);
    const { error: incidentError } = await client.from('payscope_incidents').insert({ id: incidentId, organization_id: organizationId, risk_tier: 'MEDIUM', status: 'OPEN', total_failed_amount_paise: 100, recovered_amount_paise: 0, correlated_event_ids: [eventId], opened_at: now, updated_at: now });
    if (incidentError) throw new Error(incidentError.message);
    const { error: proposalError } = await client.from('payscope_action_proposals').insert([{ id: firstProposalId, organization_id: organizationId, incident_id: incidentId, action_type: 'retry_link_sms', content: {} }, { id: secondProposalId, organization_id: organizationId, incident_id: incidentId, action_type: 'retry_link_sms', content: {} }]);
    if (proposalError) throw new Error(proposalError.message);
    const delivery = { status: 'simulated', note: 'integration test; no customer message sent', simulatedAt: now };
    const first = await client.rpc('payscope_approve_proposal', { p_organization_id: organizationId, p_proposal_id: firstProposalId, p_actor_id: 'integration-test', p_actor_session_hash: 'e'.repeat(64), p_delivery_result: delivery });
    if (first.error) throw new Error(first.error.message);
    const second = await client.rpc('payscope_approve_proposal', { p_organization_id: organizationId, p_proposal_id: secondProposalId, p_actor_id: 'integration-test', p_actor_session_hash: 'e'.repeat(64), p_delivery_result: delivery });
    assert.ok(second.error, 'one-per-24h stopping rule must reject a second simulated outreach approval');
    const contacts = await client.from('payscope_contact_attempts').select('id').eq('organization_id', organizationId).eq('incident_id', incidentId);
    if (contacts.error) throw new Error(contacts.error.message);
    assert.equal(contacts.data.length, 1);
    console.log('Hosted simulated-outreach stopping-rule checks passed.');
  } finally {
    await client.from('payscope_contact_attempts').delete().eq('organization_id', organizationId).eq('incident_id', incidentId);
    await client.from('payscope_action_proposals').delete().in('id', [firstProposalId, secondProposalId]);
    await client.from('payscope_investigations').delete().eq('incident_id', incidentId);
    await client.from('payscope_incidents').delete().eq('id', incidentId);
    await client.from('payscope_events').delete().eq('id', eventId);
    if (originalPolicy) await client.from('payscope_merchant_policies').update(originalPolicy).eq('organization_id', organizationId);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
