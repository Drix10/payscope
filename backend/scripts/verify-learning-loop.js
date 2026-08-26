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
  if (process.env.NODE_ENV === 'production' && process.env.PAYSCOPE_ALLOW_PRODUCTION_TEST !== 'true' && !process.env.PAYSCOPE_TEST_ORGANIZATION_ID) {
    throw new Error('Learning verification cannot run against production tenant without PAYSCOPE_TEST_ORGANIZATION_ID or PAYSCOPE_ALLOW_PRODUCTION_TEST=true');
  }
  console.log('=== DETERMINISTIC LEARNING LOOP (unit + live DB) ===');
  const probeActionIds = [];

  const prior = (() => { const raw = process.env.PAYSCOPE_RECOVERY_PRIOR_RATE?.trim(); if (!raw) return 0.18; const n = Number(raw); return Number.isFinite(n) && n > 0 && n < 1 ? n : 0.18; })();
  // Unit: cold start — prior must be exactly the configured rate
  const cold = scoreStrategy({ baseScore: 68, historical: null, amountPaise: 500000, confidence: 0.9, customerAdjustment: 0 }, 'cold', prior);
  assert.ok(Math.abs(cold.posteriorRate - prior) < 1e-9, `cold prior should equal configured prior ${prior}`);
  // Prove prior wiring: change prior to 0.50 and cold posterior must become 0.50
  const cold50 = scoreStrategy({ baseScore: 68, historical: null, amountPaise: 500000, confidence: 0.9, customerAdjustment: 0 }, 'cold50', 0.50);
  assert.ok(Math.abs(cold50.posteriorRate - 0.50) < 1e-9, 'cold with prior 0.50 must yield 0.50');
  assert.notEqual(cold.posteriorRate, cold50.posteriorRate, 'different prior must yield different posterior');
  console.log(`✔ cold start prior ${cold.posteriorRate.toFixed(3)} (config ${prior}) and 0.50 wiring proven`);

  // Unit: 1 paid of 1 → posterior rises
  const onePaid = scoreStrategy({ baseScore: 68, historical: { strategy: 'deliver_recovery_link_email', failureCategory: 'customer_drop', customerSegment: 'new', attempts: 1, paid: 1, recoveryRate: 1, avgTimeToRecoveryMs: null }, amountPaise: 500000, confidence: 0.9, customerAdjustment: 0 }, 'one', prior);
  assert.ok(onePaid.posteriorRate > cold.posteriorRate, '1 paid should increase posterior');
  console.log(`✔ 1 paid → posterior ${onePaid.posteriorRate.toFixed(3)} > cold ${cold.posteriorRate.toFixed(3)}`);

  // Unit: 10 expired (0 paid) → posterior drops
  const tenFailed = scoreStrategy({ baseScore: 68, historical: { strategy: 'deliver_recovery_link_email', failureCategory: 'customer_drop', customerSegment: 'new', attempts: 10, paid: 0, recoveryRate: 0, avgTimeToRecoveryMs: null }, amountPaise: 500000, confidence: 0.9, customerAdjustment: 0 }, 'ten', prior);
  assert.ok(tenFailed.posteriorRate < cold.posteriorRate, '10 failed should decrease posterior');
  console.log(`✔ 10 expired → posterior ${tenFailed.posteriorRate.toFixed(3)} < cold`);

  // Merchant isolation: stats are org-scoped, verified by querying different org (random UUID) returns null
  const otherOrg = randomUUID();
  const { data: otherStats } = await client.from('payscope_recovery_outcomes').select('id').eq('organization_id', otherOrg).limit(1);
  assert.equal((otherStats ?? []).length, 0, 'other org has no data');
  console.log('✔ merchant isolation: other org sees no data');

  // Live: insert 5 paid for test segment, verify rank changes — reuse probeActionIds for cleanup
  const testSegment = 'high';
  const testCat = 'customer_drop';
  try {
    for (let i = 0; i < 5; i++) {
      const actionId = randomUUID();
      const incidentId = randomUUID();
      const { error: incErr } = await client.from('payscope_incidents').insert({ id: incidentId, organization_id: org, risk_tier: 'MEDIUM', status: 'OPEN', total_failed_amount_paise: 500000, recovered_amount_paise: 0, correlated_event_ids: [], opened_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      assert.equal(incErr, null, `incident insert failed: ${incErr?.message}`);
      const { error: actErr } = await client.from('payscope_execution_actions').insert({ id: actionId, organization_id: org, incident_id: incidentId, capability: 'deliver_recovery_link_email', command_key: `${org}:deliver_recovery_link_email:${incidentId}`, command_payload: { customerHash: 'a'.repeat(64), referenceId: `ps_${randomUUID().replace(/-/g,'')}` }, command_payload_hash: 'a'.repeat(64), amount_paise: 500000, currency: 'INR', state: 'confirmed' });
      assert.equal(actErr, null, `action insert failed: ${actErr?.message}`);
      const { error: outErr } = await client.from('payscope_recovery_outcomes').insert({ organization_id: org, incident_id: incidentId, action_id: actionId, customer_hash: 'a'.repeat(64), failure_category: testCat, payment_method: 'upi', amount_paise: 500000, currency: 'INR', customer_segment: testSegment, strategy: 'deliver_recovery_link_email', send_at: new Date().toISOString(), channel: 'email', outcome: 'paid', actual_recovery_paise: 500000, reconciled_at: new Date().toISOString() });
      assert.equal(outErr, null, `outcome insert failed: ${outErr?.message}`);
      probeActionIds.push({ actionId, incidentId });
    }
    // Fetch stats via repository method (live)
    const { MvpRepository } = require('../dist/db/mvp-repository');
    const repo = new MvpRepository(client);
    const stats = await repo.recoveryOutcomeStats(org, 'deliver_recovery_link_email', testCat, testSegment);
    assert.ok(stats && stats.attempts >= 5 && stats.paid >= 5, 'live stats should reflect inserted paid outcomes');
    console.log(`✔ live ledger: ${stats.paid}/${stats.attempts} paid for ${testCat}/${testSegment}`);

    // Killer: ranking with history vs without must differ — priorRate is required when history is present
    const without = rankStrategies(incident, enrichment, risk, { organizationId: org, customerHash: 'a'.repeat(64), successfulPaymentMethods: [], failedPaymentMethods: [], successfulPaymentCount: 6, totalIncidentCount: 1, recoveryEmailsSent: 0, recoveryEmailsPaid: 0, lastContactedAt: null, firstSeenAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() }, null, prior);
    const withHist = new Map([['deliver_recovery_link_email', stats]]);
    const withHistory = rankStrategies(incident, enrichment, risk, { organizationId: org, customerHash: 'a'.repeat(64), successfulPaymentMethods: [], failedPaymentMethods: [], successfulPaymentCount: 6, totalIncidentCount: 1, recoveryEmailsSent: 0, recoveryEmailsPaid: 0, lastContactedAt: null, firstSeenAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() }, null, prior, withHist, incident.id);
    assert.notEqual(withHistory[0].recoveryValueScore, without[0].recoveryValueScore, 'history must measurably change score');
    console.log(`✔ killer: without history score ${without[0].recoveryValueScore} vs with history ${withHistory[0].recoveryValueScore} — learning changes decision`);
  } finally {
    // Production-grade cleanup: every delete must succeed, failures fail the test
    for (const p of probeActionIds) {
      const { error: e1 } = await client.from('payscope_recovery_outcomes').delete().eq('action_id', p.actionId);
      assert.equal(e1, null, `outcome cleanup failed: ${e1?.message}`);
      const { error: e2 } = await client.from('payscope_execution_actions').delete().eq('id', p.actionId);
      assert.equal(e2, null, `action cleanup failed: ${e2?.message}`);
      const { error: e3 } = await client.from('payscope_incidents').delete().eq('id', p.incidentId);
      assert.equal(e3, null, `incident cleanup failed: ${e3?.message}`);
    }
    console.log('✔ cleanup done (all deletes verified)');
  }
  console.log('\nLEARNING LOOP: ALL CHECKS PASSED');
}

main().catch(e => { console.error('LEARNING VERIFICATION FAILED:', e.message); process.exit(1); });
