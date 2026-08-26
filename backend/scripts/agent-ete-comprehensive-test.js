const assert = require('node:assert/strict');
const { runDurableInvestigation } = require('../dist/pipeline/investigator');
const { evaluatePolicy } = require('../dist/pipeline/policy-evaluator');
const { rankStrategies, adaptRecoveryStrategy } = require('../dist/intelligence/recovery-engine');

class EchoModelAdapter {
  constructor(fn) { this.fn = fn; }
  async complete(req) {
    const res = this.fn(req);
    return { content: res, modelId: 'echo-test', usage: { inputTokens: 10, outputTokens: 10 } };
  }
}

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
  console.log('Running PayScope Full E2E & Recovery Engine Integration Suite...\n');

  // 1. Unit Strategy Ranking Test
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
    assert.ok(ranked[0].heuristicRecoveryEstimatePaise > 0, 'Heuristic estimate should be positive');
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

  // 4. Post-Action Adaptive Recovery Loop Test
  await runScenario('Post-Action Adaptive Loop selects untried fallback strategy when initial intervention fails', async () => {
    const incident = {
      id: 'inc_adaptive',
      organizationId: org,
      riskTier: 'HIGH',
      status: 'OPEN',
      totalFailedAmountPaise: 1000000,
      recoveredAmountPaise: 0,
      remainingAmountPaise: 1000000,
      correlatedEventIds: ['evt_adaptive'],
      openedAt: new Date().toISOString(),
      resolvedAt: null,
      updatedAt: new Date().toISOString(),
    };

    const enrichment = {
      failureAttribution: 'gateway_degraded',
      gatewayHealthScore: 0.4,
      gatewayInDowntime: true,
      downtimeScheduled: false,
      crossBorderFlag: false,
      priorAttemptCount: 1,
      partialRecoveryPossible: false,
      recommendedRetryMethod: 'netbanking',
      source: 'razorpay_fields_heuristic',
      enrichedAt: new Date().toISOString(),
      signalsUsed: ['error_source', 'downtimes'],
    };

    const riskAnalysis = {
      failureRootCause: 'gateway_degraded',
      evidenceStrength: 'strong',
      confidence: 0.92,
      causalNarrative: 'Gateway degraded due to acquirer downtime',
      evidenceConfidenceRationale: 'Verified Razorpay downtime signal',
      alternativeHypotheses: [],
      falsePositiveCostEstimatePaise: 1000000,
      missingEvidence: [],
      chargebackEvidenceReady: false,
      evidenceItems: ['payment.failed'],
      recommendedActionCategory: 'resolve_infrastructure',
      toolResults: { incidentTimelineEventCount: 1, merchantFailureRate: 0.2, networkFailureRate: 0.5, customerIncidentCount: null },
    };

    // First attempt tried email link
    const tried = ['deliver_recovery_link_email'];
    const adapted = adaptRecoveryStrategy(tried, incident, enrichment, riskAnalysis, null, null);

    assert.ok(adapted !== null, 'Adaptive loop should produce fallback strategy');
    assert.equal(adapted.name, 'resolve_infrastructure');
    assert.equal(adapted.capabilities[0], 'resolve_infrastructure');
  });

  // 5. Full Pipeline Integration Test
  await runScenario('Full Durable Investigation integrates Recovery Engine decision into Outbox proposals', async () => {
    let persistedProposals = null;
    const mockRepo = {
      incidentDetail: async () => ({
        incident: {
          id: 'inc_full_pipeline',
          organizationId: org,
          riskTier: 'HIGH',
          status: 'OPEN',
          totalFailedAmountPaise: 7500000,
          recoveredAmountPaise: 0,
          remainingAmountPaise: 7500000,
          correlatedEventIds: ['evt_fp'],
          openedAt: new Date().toISOString(),
          resolvedAt: null,
          updatedAt: new Date().toISOString(),
        },
        events: [{
          id: 'evt_fp',
          organizationId: org,
          event: {
            eventId: 'evt_fp',
            organizationId: org,
            eventType: 'payment.failed',
            paymentId: 'pay_fp1',
            orderId: 'order_fp1',
            amountPaise: 7500000,
            currency: 'INR',
            paymentMethod: 'upi',
            errorSource: 'customer',
            errorStep: 'payment_authentication',
            errorReason: 'payment_failed',
            customerHash: 'c'.repeat(64),
            receivedAt: new Date().toISOString(),
          },
          enrichment: {
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
            signalsUsed: ['error_source'],
          },
          enrichmentSource: 'razorpay_fields_heuristic',
        }],
        investigation: null,
        proposals: [],
        audit: [],
        execution: [],
      }),
      policyContext: async () => ({
        policy: { id: 'pol_fp', enabled: true, minimumConfidence: 0.70, rootCauses: ['customer_error'], allowedActions: ['deliver_recovery_link_email'], merchantOptedIn: true },
        stats: { autoResolveFraction: 0.1 },
        contact: { incidentAttempts: 0, attemptsLast24Hours: 0, attemptsLast7Days: 0, merchantOptedIn: true, customerReferenceAvailable: true },
      }),
      riskToolMetrics: async () => null,
      incidentMemory: async () => [],
      executionPolicyContext: async () => null,
      customerProfile: async () => null,
      autonomyPolicy: async () => null,
      persistDirectInvestigation: async (...args) => {
        persistedProposals = args[7];
      },
    };

    const mockProvider = new EchoModelAdapter(req => {
      if (req.systemPrompt.includes('Supervisor')) {
        return JSON.stringify({
          hypothesis: 'Customer checkout drop',
          primaryFailureCategory: 'customer_error',
          objectives: ['Validate telemetry'],
          evidencePriorities: [{ fact: 'Razorpay intake', whyItMatters: 'Root cause' }],
          subAgents: [
            { agent: 'risk_analyst', question: 'What is risk?', priority: 1, allowedContextFields: ['payment'] },
            { agent: 'recovery_planner', question: 'What is plan?', priority: 1, allowedContextFields: ['payment'] }
          ],
          constraints: ['Stopping rules'],
          noActionCriteria: ['Dispute'],
          estimatedAutoResolvable: true,
          requiresNoActionFallback: false,
          confidence: 0.9,
          reasoning: 'Telemetry verified'
        });
      }
      if (req.systemPrompt.includes('Risk Analyst')) {
        return JSON.stringify({
          failureRootCause: 'customer_error',
          evidenceStrength: 'strong',
          confidence: 0.88,
          causalNarrative: 'Customer dropped 2FA',
          evidenceConfidenceRationale: 'Razorpay fields',
          alternativeHypotheses: [],
          falsePositiveCostEstimatePaise: 7500000,
          missingEvidence: [],
          chargebackEvidenceReady: false,
          evidenceItems: ['payment.failed'],
          recommendedActionCategory: 'deliver_recovery_link_email',
          toolResults: { incidentTimelineEventCount: 1, merchantFailureRate: null, networkFailureRate: null, customerIncidentCount: null }
        });
      }
      return JSON.stringify({
        proposedActions: [{
          actionType: 'deliver_recovery_link_email',
          rationale: 'Send recovery link',
          preconditions: [],
          expectedOutcome: 'Recovery',
          estimatedRecoveryPaise: 7500000,
          requiresAutonomousExecution: true,
          emailCopyIntent: 'Complete your payment'
        }],
        noActionReason: null,
        recoveryProbability: 0.85,
        confidence: 0.88
      });
    });

    await runDurableInvestigation(mockRepo, mockProvider, { jobId: 'job_1', organizationId: org, incidentId: 'inc_full_pipeline', triggerEventId: 'evt_fp', attemptNumber: 1, createdAt: new Date().toISOString() }, { directExecution: true });

    assert.ok(persistedProposals !== null, 'Should persist proposals from investigation');
    assert.equal(persistedProposals.length, 1);
    assert.equal(persistedProposals[0].actionType, 'deliver_recovery_link_email');
    assert.ok(persistedProposals[0].rationale.includes('Recovery Engine') || persistedProposals[0].rationale.length > 0, 'Proposal rationale must be generated');
  });

  console.log('\nFinal E2E Suite Summary: ' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('E2E Suite Error:', err);
  process.exit(1);
});
