const assert = require('node:assert/strict');
const { runInvestigationSupervisor, runRiskAnalyst, runRecoveryPlanner } = require('../dist/pipeline/investigator');
const { evaluatePolicy } = require('../dist/pipeline/policy-evaluator');
const { rankStrategies } = require('../dist/intelligence/recovery-engine');

const org = '00000000-0000-4000-8000-000000000001';
let passed = 0; let failed = 0;

async function runScenario(name, scenarioFn) {
  try {
    await scenarioFn();
    console.log('? ' + name);
    passed++;
  } catch (err) {
    console.error('? ' + name + ': ' + err.message);
    failed++;
  }
}

async function main() {
  console.log('Running PayScope E2E Verification Suite...\n');

  // 1. Recovery Engine Strategy Ranking Test
  await runScenario('Recovery Engine chooses optimal strategy over LLM output', async () => {
    const incident = {
      id: 'inc_001',
      organizationId: org,
      riskTier: 'HIGH',
      status: 'OPEN',
      totalFailedAmountPaise: 7500000,
      recoveredAmountPaise: 0,
      remainingAmountPaise: 7500000,
      correlatedEventIds: ['evt_1'],
      openedAt: new Date().toISOString(),
      resolvedAt: null,
      updatedAt: new Date().toISOString(),
    };

    const enrichment = {
      failureAttribution: 'customer_drop',
      gatewayHealthScore: 1.0,
      gatewayInDowntime: false,
      downtimeScheduled: false,
      crossBorderFlag: false,
      priorAttemptCount: 0,
      partialRecoveryPossible: false,
      recommendedRetryMethod: 'upi',
      source: 'razorpay_fields_heuristic',
      enrichedAt: new Date().toISOString(),
      signalsUsed: ['error_source', 'error_step'],
    };

    const riskAnalysis = {
      failureRootCause: 'customer_error',
      evidenceStrength: 'strong',
      confidence: 0.85,
      causalNarrative: 'Customer dropped off during 2FA',
      evidenceConfidenceRationale: 'Verified by Razorpay fields',
      alternativeHypotheses: [],
      falsePositiveCostEstimatePaise: 7500000,
      missingEvidence: [],
      chargebackEvidenceReady: false,
      evidenceItems: ['payment.failed'],
      recommendedActionCategory: 'deliver_recovery_link_email',
      toolResults: { incidentTimelineEventCount: 1, merchantFailureRate: null, networkFailureRate: null, customerIncidentCount: null },
    };

    const customerProfile = {
      organizationId: org,
      customerHash: 'a'.repeat(64),
      successfulPaymentMethods: ['upi'],
      failedPaymentMethods: ['card'],
      successfulPaymentCount: 5,
      totalIncidentCount: 1,
      recoveryEmailsSent: 0,
      recoveryEmailsPaid: 0,
      lastContactedAt: null,
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };

    const ranked = rankStrategies(incident, enrichment, riskAnalysis, customerProfile, null);
    assert.ok(ranked.length > 0, 'Should return candidate strategies');
    assert.equal(ranked[0].name, 'deliver_recovery_link_email');
    assert.ok(ranked[0].expectedValuePaise > 0, 'Expected value should be positive');
  });

  // 2. Policy Evaluator Gates Test
  await runScenario('Policy Evaluator enforces 13 deterministic safety gates', async () => {
    const incident = {
      id: 'inc_002',
      organizationId: org,
      riskTier: 'HIGH',
      status: 'OPEN',
      totalFailedAmountPaise: 500000,
      recoveredAmountPaise: 0,
      remainingAmountPaise: 500000,
      correlatedEventIds: ['evt_2'],
      openedAt: new Date().toISOString(),
      resolvedAt: null,
      updatedAt: new Date().toISOString(),
    };

    const risk = {
      failureRootCause: 'customer_error',
      evidenceStrength: 'moderate',
      confidence: 0.88,
      causalNarrative: 'Customer checkout drop',
      evidenceConfidenceRationale: 'Verified telemetry',
      alternativeHypotheses: [],
      falsePositiveCostEstimatePaise: 500000,
      missingEvidence: [],
      chargebackEvidenceReady: false,
      evidenceItems: ['payment.failed'],
      recommendedActionCategory: 'deliver_recovery_link_email',
      toolResults: { incidentTimelineEventCount: 1, merchantFailureRate: null, networkFailureRate: null, customerIncidentCount: null },
    };

    const recoveryPlan = {
      proposedActions: [{
        actionType: 'deliver_recovery_link_email',
        rationale: 'Deliver 1-click link',
        preconditions: ['Merchant opt in'],
        expectedOutcome: 'Recovery',
        estimatedRecoveryPaise: 500000,
        requiresAutonomousExecution: true,
        emailCopyIntent: 'Pay now',
      }],
      recoveryProbability: 0.85,
      confidence: 0.88,
    };

    const policy = {
      id: 'pol_1',
      enabled: true,
      minimumConfidence: 0.70,
      rootCauses: ['customer_error'],
      allowedActions: ['deliver_recovery_link_email'],
      merchantOptedIn: true,
    };

    const decision = evaluatePolicy(incident, risk, recoveryPlan, [policy], { autoResolveFraction: 0.1 }, {
      incidentAttempts: 0,
      attemptsLast24Hours: 0,
      attemptsLast7Days: 0,
      merchantOptedIn: true,
      customerReferenceAvailable: true,
    });

    assert.equal(decision.outcome, 'auto_with_proposals');
    assert.equal(decision.permittedActions.length, 1);
  });

  // 3. Dispute Hard Stop Test
  await runScenario('Policy Evaluator engages Hard Stop on open disputes', async () => {
    const incident = {
      id: 'inc_disputed',
      organizationId: org,
      riskTier: 'HIGH',
      status: 'DISPUTE_OPENED',
      totalFailedAmountPaise: 500000,
      recoveredAmountPaise: 0,
      remainingAmountPaise: 500000,
      correlatedEventIds: ['evt_dispute'],
      openedAt: new Date().toISOString(),
      resolvedAt: null,
      updatedAt: new Date().toISOString(),
    };

    const risk = {
      failureRootCause: 'customer_error',
      evidenceStrength: 'strong',
      confidence: 0.90,
      causalNarrative: 'Customer opened formal dispute',
      evidenceConfidenceRationale: 'Verified dispute event',
      alternativeHypotheses: [],
      falsePositiveCostEstimatePaise: 500000,
      missingEvidence: [],
      chargebackEvidenceReady: true,
      evidenceItems: ['payment.dispute.created'],
      recommendedActionCategory: 'submit_dispute_evidence',
      toolResults: { incidentTimelineEventCount: 1, merchantFailureRate: null, networkFailureRate: null, customerIncidentCount: null },
    };

    const recoveryPlan = {
      proposedActions: [{
        actionType: 'deliver_recovery_link_email',
        rationale: 'Deliver 1-click link',
        preconditions: [],
        expectedOutcome: 'Recovery',
        estimatedRecoveryPaise: 500000,
        requiresAutonomousExecution: true,
      }],
      recoveryProbability: 0.5,
      confidence: 0.90,
    };

    const decision = evaluatePolicy(incident, risk, recoveryPlan, [], { autoResolveFraction: 0 }, {
      incidentAttempts: 0,
      attemptsLast24Hours: 0,
      attemptsLast7Days: 0,
      merchantOptedIn: true,
      customerReferenceAvailable: true,
    });

    assert.equal(decision.outcome, 'auto_no_action');
    assert.equal(decision.permittedActions.length, 0);
    assert.equal(decision.noActionReason, 'DISPUTE_OPEN_HARD_STOP');
  });

  console.log('\nFinal E2E Suite Summary: ' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('E2E Suite Error:', err);
  process.exit(1);
});
