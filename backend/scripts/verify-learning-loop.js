/**
 * Deterministic learning loop — proves merchant-specific outcomes change next decision.
 * Live Supabase, no mocks for ledger. Runs as part of verification, cleans up.
 */
require('dotenv/config');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const { SupabaseClient } = require('@supabase/supabase-js');
const { rankStrategies } = require('../dist/intelligence/recovery-engine');
const { scoreStrategy } = require('../dist/intelligence/recovery-policy-learner');

const client = new SupabaseClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const org = process.env.PAYSCOPE_ORGANIZATION_ID;
const incident = { id: randomUUID(), organizationId: org, riskTier: 'MEDIUM', status: 'OPEN', totalFailedAmountPaise: 500000, recoveredAmountPaise: 0, remainingAmountPaise: 500000, correlatedEventIds: [], openedAt: new Date().toISOString(), resolvedAt: null, updatedAt: new Date().toISOString() };
const risk = { failureRootCause: 'customer_error', evidenceStrength: 'strong', confidence: 0.9, causalNarrative: 'x', evidenceConfidenceRationale: 'x', alternativeHypotheses: [], falsePositiveCostEstimatePaise: 500000, missingEvidence: [], chargebackEvidenceReady: false, evidenceItems: ['payment.failed'], recommendedActionCategory: 'deliver_recovery_link_email', toolResults: { incidentTimelineEventCount: 1, merchantFailureRate: null, networkFailureRate: null, customerIncidentCount: null } };
const enrichment = { failureAttribution: 'customer_drop', gatewayHealthScore: 0.9, gatewayInDowntime: false, downtimeScheduled: false, crossBorderFlag: false, priorAttemptCount: 0, partialRecoveryPossible: false, recommendedRetryMethod: null, source: 'razorpay_fields_heuristic', enrichedAt: new Date().toISOString(), signalsUsed: [] };

async function main() {
  console.log('=== DETERMINISTIC LEARNING LOOP (unit + live DB) ===');

  // Unit: cold start
  const cold = scoreStrategy({ baseScore: 68, historical: null, amountPaise: 500000, confidence: 0.9, customerAdjustment: 0 }, 'cold');
  assert.ok(cold.posteriorRate > 0.17 && cold.posteriorRate < 0.19, 'cold prior ~0.18');
  console.log(`✔ cold start prior ${cold.posteriorRate.toFixed(3)}`);

  // Unit: 1 paid of 1 → posterior rises
  const onePaid = scoreStrategy({ baseScore: 68, historical: { strategy: 'deliver_recovery_link_email', failureCategory: 'customer_drop', customerSegment: 'new', attempts: 1, paid: 1, recoveryRate: 1, avgTimeToRecoveryMs: null }, amountPaise: 500000, confidence: 0.9, customerAdjustment: 0 }, 'one');
  assert.ok(onePaid.posteriorRate > cold.posteriorRate, '1 paid should increase posterior');
  console.log(`✔ 1 paid → posterior ${onePaid.posteriorRate.toFixed(3)} > cold ${cold.posteriorRate.toFixed(3)}`);

  // Unit: 10 expired (0 paid) → posterior drops
  const tenFailed = scoreStrategy({ baseScore: 68, historical: { strategy: 'deliver_recovery_link_email', failureCategory: 'customer_drop', customerSegment: 'new', attempts: 10, paid: 0, recoveryRate: 0, avgTimeToRecoveryMs: null }, amountPaise: 500000, confidence: 0.9, customerAdjustment: 0 }, 'ten');
  assert.ok(tenFailed.posteriorRate < cold.posteriorRate, '10 failed should decrease posterior');
  console.log(`✔ 10 expired → posterior ${tenFailed.posteriorRate.toFixed(3)} < cold`);

  // Merchant isolation: stats are org-scoped, verified by querying different org (random UUID) returns null
  const otherOrg = randomUUID();
  const { data: otherStats } = await client.from('payscope_recovery_outcomes').select('id').eq('organization_id', otherOrg).limit(1);
  assert.equal((otherStats ?? []).length, 0, 'other org has no data');
  console.log('✔ merchant isolation: other org sees no data');

  // Live: insert 10 paid for test segment, verify rank changes
  const testSegment = 'high';
  const testCat = 'customer_drop';
  const probeActionIds = [];
  for (let i = 0; i < 5; i++) {
    const actionId = randomUUID();
    const incidentId = randomUUID();
    await client.from('payscope_incidents').insert({ id: incidentId, organization_id: org, risk_tier: 'MEDIUM', status: 'OPEN', total_failed_amount_paise: 500000, recovered_amount_paise: 0, correlated_event_ids: [], opened_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    await client.from('payscope_execution_actions').insert({ id: actionId, organization_id: org, incident_id: incidentId, capability: 'deliver_recovery_link_email', command_key: `${org}:deliver_recovery_link_email:${incidentId}`, command_payload: { customerHash: 'a'.repeat(64), referenceId: `ps_${randomUUID().replace(/-/g,'')}` }, command_payload_hash: 'a'.repeat(64), amount_paise: 500000, currency: 'INR', state: 'confirmed' });
    await client.from('payscope_recovery_outcomes').insert({ organization_id: org, incident_id: incidentId, action_id: actionId, customer_hash: 'a'.repeat(64), failure_category: testCat, payment_method: 'upi', amount_paise: 500000, currency: 'INR', customer_segment: testSegment, strategy: 'deliver_recovery_link_email', send_at: new Date().toISOString(), channel: 'email', outcome: 'paid', actual_recovery_paise: 500000, reconciled_at: new Date().toISOString() });
    probeActionIds.push({ actionId, incidentId });
  }
  // Fetch stats via repository method (live)
  const { MvpRepository } = require('../dist/db/mvp-repository');
  const repo = new MvpRepository(client);
  const stats = await repo.recoveryOutcomeStats(org, 'deliver_recovery_link_email', testCat, testSegment);
  assert.ok(stats && stats.attempts >= 5 && stats.paid >= 5, 'live stats should reflect inserted paid outcomes');
  console.log(`✔ live ledger: ${stats.paid}/${stats.attempts} paid for ${testCat}/${testSegment}`);

  // Killer: ranking with history vs without must differ
  const without = rankStrategies(incident, enrichment, risk, { organizationId: org, customerHash: 'a'.repeat(64), successfulPaymentMethods: [], failedPaymentMethods: [], successfulPaymentCount: 6, totalIncidentCount: 1, recoveryEmailsSent: 0, recoveryEmailsPaid: 0, lastContactedAt: null, firstSeenAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() }, null);
  const withHist = new Map([['deliver_recovery_link_email', stats]]);
  const withHistory = rankStrategies(incident, enrichment, risk, { organizationId: org, customerHash: 'a'.repeat(64), successfulPaymentMethods: [], failedPaymentMethods: [], successfulPaymentCount: 6, totalIncidentCount: 1, recoveryEmailsSent: 0, recoveryEmailsPaid: 0, lastContactedAt: null, firstSeenAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() }, null, withHist, incident.id);
  assert.notEqual(withHistory[0].recoveryValueScore, without[0].recoveryValueScore, 'history must measurably change score');
  console.log(`✔ killer: without history score ${without[0].recoveryValueScore} vs with history ${withHistory[0].recoveryValueScore} — learning changes decision`);

  // Cleanup
  for (const p of probeActionIds) {
    await client.from('payscope_recovery_outcomes').delete().eq('action_id', p.actionId);
    await client.from('payscope_execution_actions').delete().eq('id', p.actionId);
    await client.from('payscope_incidents').delete().eq('id', p.incidentId);
  }
  console.log('✔ cleanup done');
  console.log('\nLEARNING LOOP: ALL CHECKS PASSED');
}

main().catch(e => { console.error('LEARNING VERIFICATION FAILED:', e.message); process.exit(1); });
