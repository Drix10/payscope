/* Opt-in integration proof that simulated outreach is rechecked and counted in
 * the database, rather than trusting a stale policy decision from the worker. */
require('dotenv/config');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { requireDatabaseClient } = require('../dist/db/client');
const { requireIntegrationOrganization } = require('./require-integration-organization');

if (process.env.PAYSCOPE_RUN_OUTREACH_INTEGRATION !== 'true') {
  console.log('Skipped outreach stopping-rule integration test (set PAYSCOPE_RUN_OUTREACH_INTEGRATION=true for dedicated integration Supabase).');
  process.exit(0);
}
const organizationId = requireIntegrationOrganization();
const client = requireDatabaseClient();
const eventId = randomUUID(); const incidentId = randomUUID(); const firstProposalId = randomUUID(); const secondProposalId = randomUUID();
// A unique, deterministic-for-this-run hash keeps the 24-hour customer-level
// stopping rule meaningful when this hosted test is repeated.
const customerHash = createHash('sha256').update(`integration-outreach:${eventId}`).digest('hex'); const now = new Date().toISOString();
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
    const runs = await Promise.all([
      client.rpc('payscope_autonomously_simulate_pending_proposals', { p_organization_id: organizationId, p_incident_id: incidentId }),
      client.rpc('payscope_autonomously_simulate_pending_proposals', { p_organization_id: organizationId, p_incident_id: incidentId }),
    ]);
    assert.ok(runs.every(result => !result.error), `autonomous simulation must be idempotent: ${JSON.stringify(runs.map(result => result.error?.message ?? null))}`);
    const proposals = await client.from('payscope_action_proposals').select('status').in('id', [firstProposalId, secondProposalId]);
    if (proposals.error) throw new Error(proposals.error.message);
    assert.equal(proposals.data.filter(row => row.status === 'simulated').length, 1, 'only one outreach action may be simulated in 24 hours');
    assert.equal(proposals.data.filter(row => row.status === 'failed').length, 1, 'the competing outreach action must be terminally blocked');
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
