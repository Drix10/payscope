/* Opt-in Test Mode proof for Phase 3's server-scoped Risk Analyst facts and
 * compact audit-integrity summary. Temporary rows are deleted in finally. */
require('dotenv/config');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { requireDatabaseClient } = require('../dist/db/client');
const { requireIntegrationOrganization } = require('./require-integration-organization');

if (process.env.PAYSCOPE_RUN_PHASE3_INTEGRATION !== 'true') {
  console.log('Skipped Phase 3 risk-tool integration test (set PAYSCOPE_RUN_PHASE3_INTEGRATION=true for Test Mode Supabase).');
  process.exit(0);
}

const organizationId = requireIntegrationOrganization();
const client = requireDatabaseClient();
const eventId = randomUUID();
const incidentId = randomUUID();
const method = `risk-tool-${randomUUID().slice(0, 18)}`;
const customerHash = createHash('sha256').update(`risk-tool-${eventId}`).digest('hex');
const now = new Date().toISOString();

(async () => {
  try {
    const { error: eventError } = await client.from('payscope_events').insert({
      id: eventId,
      organization_id: organizationId,
      razorpay_event_id: `integration-risk-tools-${randomUUID()}`,
      event_type: 'payment.failed',
      payload_hash: 'f'.repeat(64),
      normalized: { eventId: `integration-risk-tools-${eventId}`, eventType: 'payment.failed', occurredAt: now, receivedAt: now, customerHash, paymentMethod: method, amountPaise: 100, currency: 'INR', providerData: {} },
      enrichment: { failureAttribution: 'gateway_degraded', gatewayHealthScore: 0.2, gatewayInDowntime: true, downtimeScheduled: false, crossBorderFlag: false, priorAttemptCount: 0, partialRecoveryPossible: false, recommendedRetryMethod: null, source: 'fixture_signed', enrichedAt: now, signalsUsed: ['fixture'] },
      enrichment_source: 'fixture_signed',
    });
    if (eventError) throw new Error(eventError.message);
    const { error: incidentError } = await client.from('payscope_incidents').insert({ id: incidentId, organization_id: organizationId, risk_tier: 'MEDIUM', status: 'OPEN', total_failed_amount_paise: 100, recovered_amount_paise: 0, correlated_event_ids: [eventId], opened_at: now, updated_at: now });
    if (incidentError) throw new Error(incidentError.message);

    const metrics = await client.rpc('payscope_risk_tool_metrics', { p_organization_id: organizationId, p_gateway: method, p_customer_hash: customerHash, p_window_hours: 1 });
    if (metrics.error) throw new Error(metrics.error.message);
    assert.equal(metrics.data.networkFailureRate, 1, 'the gateway proxy must use only the injected organization/method facts');
    assert.equal(metrics.data.customerIncidentCount, 1, 'the customer count must be incident-scoped and tenant-scoped');
    const invalidWindow = await client.rpc('payscope_risk_tool_metrics', { p_organization_id: organizationId, p_gateway: method, p_customer_hash: customerHash, p_window_hours: 2 });
    assert.ok(invalidWindow.error, 'the aggregate window allowlist must reject arbitrary values');
    const integrity = await client.rpc('payscope_audit_chain_summary', { p_organization_id: organizationId });
    if (integrity.error) throw new Error(integrity.error.message);
    assert.equal(integrity.data.status, 'intact');
    assert.equal(typeof integrity.data.entryCount, 'number');
    console.log('Hosted Phase 3 risk-tool scope and audit-integrity checks passed.');
  } finally {
    await client.from('payscope_incidents').delete().eq('id', incidentId);
    await client.from('payscope_events').delete().eq('id', eventId);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
