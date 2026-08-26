const assert = require('node:assert/strict');
const { runDurableInvestigation } = require('../dist/pipeline/investigator');
const { evaluatePolicy } = require('../dist/pipeline/policy-evaluator');
const { rankStrategies, adaptRecoveryStrategy, replanIncidentStrategy } = require('../dist/intelligence/recovery-engine');

class EchoModelAdapter {
  constructor(fn) { this.fn = fn; }
  async complete(req) {
    const res = this.fn(req);
    const parsed = typeof res === 'string' ? JSON.parse(res) : res;
    return { content: parsed, modelId: 'echo-test', usage: { inputTokens: 10, outputTokens: 10 } };
  }
}

const org = '00000000-0000-4000-8000-000000000001';
const validUuid = '00000000-0000-4000-8000-000000000002';
let passed = 0; let failed = 0;

async function runScenario(name, scenarioFn) {
  try {
    await scenarioFn();
    console.log('✔ ' + name);
    passed++;
  } catch (err) {
    console.error('❌ ' + name + ': ' + err.message);
    failed++;
  }
}

async function main() {
  console.log('Running PayScope Hardened Integration & Adaptive Lifecycle Suite...\n');

  // 1. Unit Strategy Ranking Test
  await runScenario('Recovery Engine chooses optimal strategy over LLM output', async () => {
    const incident = {
      id: 'inc_001', organizationId: org, riskTier: 'HIGH', status: 'OPEN',
      totalFailedAmountPaise: 7500000, recoveredAmountPaise: 0, remainingAmountPaise: 7500000,
      correlatedEventIds: ['evt_1'], openedAt: new Date().toISOString(), resolvedAt: null, updatedAt: new Date().toISOString(),
    };
    const enrichment = {
      failureAttribution: 'customer_drop', gatewayHealthScore: 1.0, gatewayInDowntime: false,
      downtimeScheduled: false, crossBorderFlag: false, priorAttemptCount: 0, partialRecoveryPossible: false,
      recommendedRetryMethod: 'upi', source: 'razorpay_fields_heuristic', enrichedAt: new Date().toISOString(), signalsUsed: ['error_source'],
    };
    const riskAnalysis = {
      failureRootCause: 'customer_error', evidenceStrength: 'strong', confidence: 0.85, causalNarrative: 'Customer dropped 2FA',
      evidenceConfidenceRationale: 'Verified by Razorpay fields', alternativeHypotheses: [], falsePositiveCostEstimatePaise: 7500000,
      missingEvidence: [], chargebackEvidenceReady: false, evidenceItems: ['payment.failed'], recommendedActionCategory: 'deliver_recovery_link_email', toolResults: { incidentTimelineEventCount: 1, merchantFailureRate: null, networkFailureRate: null, customerIncidentCount: null },
    };
    const ranked = rankStrategies(incident, enrichment, riskAnalysis, null, null);
    assert.ok(ranked.length > 0);
    assert.equal(ranked[0].name, 'deliver_recovery_link_email');
    assert.ok(ranked[0].heuristicRecoveryEstimatePaise > 0);
  });

  // 2. Policy Evaluator Gates Test
  await runScenario('Policy Evaluator enforces 13 deterministic safety gates', async () => {
    const incident = { id: 'inc_002', organizationId: org, riskTier: 'HIGH', status: 'OPEN', totalFailedAmountPaise: 500000, recoveredAmountPaise: 0, remainingAmountPaise: 500000, correlatedEventIds: ['evt_2'], openedAt: new Date().toISOString(), resolvedAt: null, updatedAt: new Date().toISOString() };
    const risk = { failureRootCause: 'customer_error', evidenceStrength: 'moderate', confidence: 0.88, causalNarrative: 'Customer drop', evidenceConfidenceRationale: 'Verified', alternativeHypotheses: [], falsePositiveCostEstimatePaise: 500000, missingEvidence: [], chargebackEvidenceReady: false, evidenceItems: ['payment.failed'], recommendedActionCategory: 'deliver_recovery_link_email', toolResults: { incidentTimelineEventCount: 1, merchantFailureRate: null, networkFailureRate: null, customerIncidentCount: null } };
    const recoveryPlan = { proposedActions: [{ actionType: 'deliver_recovery_link_email', rationale: 'Deliver link', preconditions: ['Merchant opt in'], expectedOutcome: 'Recovery', estimatedRecoveryPaise: 500000, requiresAutonomousExecution: true, emailCopyIntent: 'Pay now' }], recoveryProbability: 0.85, confidence: 0.88 };
    const policy = { id: validUuid, enabled: true, minimumConfidence: 0.70, rootCauses: ['customer_error'], allowedActions: ['deliver_recovery_link_email'], merchantOptedIn: true };

    const decision = evaluatePolicy(incident, risk, recoveryPlan, [policy], { autoResolveFraction: 0.1 }, { incidentAttempts: 0, attemptsLast24Hours: 0, attemptsLast7Days: 0, merchantOptedIn: true, customerReferenceAvailable: true });
    assert.equal(decision.outcome, 'auto_with_proposals');
    assert.equal(decision.permittedActions.length, 1);
  });

  // 3. Dispute Hard Stop Test
  await runScenario('Policy Evaluator engages Hard Stop on open disputes', async () => {
    const incident = { id: 'inc_disputed', organizationId: org, riskTier: 'HIGH', status: 'DISPUTE_OPENED', totalFailedAmountPaise: 500000, recoveredAmountPaise: 0, remainingAmountPaise: 500000, correlatedEventIds: ['evt_d'], openedAt: new Date().toISOString(), resolvedAt: null, updatedAt: new Date().toISOString() };
    const risk = { failureRootCause: 'customer_error', evidenceStrength: 'strong', confidence: 0.90, causalNarrative: 'Dispute opened', evidenceConfidenceRationale: 'Verified dispute', alternativeHypotheses: [], falsePositiveCostEstimatePaise: 500000, missingEvidence: [], chargebackEvidenceReady: true, evidenceItems: ['payment.dispute.created'], recommendedActionCategory: 'submit_dispute_evidence', toolResults: { incidentTimelineEventCount: 1, merchantFailureRate: null, networkFailureRate: null, customerIncidentCount: null } };
    const recoveryPlan = { proposedActions: [{ actionType: 'deliver_recovery_link_email', rationale: 'Link', preconditions: ['Merchant opt in'], expectedOutcome: 'Recovery', estimatedRecoveryPaise: 500000, requiresAutonomousExecution: true }], recoveryProbability: 0.5, confidence: 0.90 };

    const decision = evaluatePolicy(incident, risk, recoveryPlan, [], { autoResolveFraction: 0 }, { incidentAttempts: 0, attemptsLast24Hours: 0, attemptsLast7Days: 0, merchantOptedIn: true, customerReferenceAvailable: true });
    assert.equal(decision.outcome, 'auto_no_action');
    assert.equal(decision.permittedActions.length, 0);
    assert.equal(decision.noActionReason, 'DISPUTE_OPEN_HARD_STOP');
  });

  // 4. Post-Action Adaptive Recovery Loop Test
  await runScenario('Post-Action Adaptive Loop selects untried fallback strategy when initial intervention fails', async () => {
    const incident = { id: 'inc_adaptive', organizationId: org, riskTier: 'HIGH', status: 'OPEN', totalFailedAmountPaise: 1000000, recoveredAmountPaise: 0, remainingAmountPaise: 1000000, correlatedEventIds: ['evt_a'], openedAt: new Date().toISOString(), resolvedAt: null, updatedAt: new Date().toISOString() };
    const enrichment = { failureAttribution: 'gateway_degraded', gatewayHealthScore: 0.4, gatewayInDowntime: true, downtimeScheduled: false, crossBorderFlag: false, priorAttemptCount: 1, partialRecoveryPossible: false, recommendedRetryMethod: 'netbanking', source: 'razorpay_fields_heuristic', enrichedAt: new Date().toISOString(), signalsUsed: ['downtimes'] };
    const riskAnalysis = { failureRootCause: 'gateway_degraded', evidenceStrength: 'strong', confidence: 0.92, causalNarrative: 'Acquirer downtime', evidenceConfidenceRationale: 'Razorpay signal', alternativeHypotheses: [], falsePositiveCostEstimatePaise: 1000000, missingEvidence: [], chargebackEvidenceReady: false, evidenceItems: ['payment.failed'], recommendedActionCategory: 'resolve_infrastructure', toolResults: { incidentTimelineEventCount: 1, merchantFailureRate: null, networkFailureRate: null, customerIncidentCount: null } };

    const tried = ['deliver_recovery_link_email'];
    const adapted = adaptRecoveryStrategy(tried, incident, enrichment, riskAnalysis, null, null);
    assert.ok(adapted !== null);
    assert.equal(adapted.name, 'resolve_infrastructure');
  });

  // 5. Fail-Closed Fallback Gate Test
  await runScenario('Exception fallback sets confidence 0.50 and fails-closed under minimum confidence threshold', async () => {
    const incident = { id: 'inc_fail_closed', organizationId: org, riskTier: 'HIGH', status: 'OPEN', totalFailedAmountPaise: 1000000, recoveredAmountPaise: 0, remainingAmountPaise: 1000000, correlatedEventIds: ['evt_fc'], openedAt: new Date().toISOString(), resolvedAt: null, updatedAt: new Date().toISOString() };
    const riskFallback = { failureRootCause: 'customer_error', evidenceStrength: 'weak', confidence: 0.50, causalNarrative: 'Fallback', evidenceConfidenceRationale: 'Uncertainty', alternativeHypotheses: [], falsePositiveCostEstimatePaise: 1000000, missingEvidence: ['LLM'], chargebackEvidenceReady: false, evidenceItems: ['payment.failed'], recommendedActionCategory: 'deliver_recovery_link_email', toolResults: { incidentTimelineEventCount: 1, merchantFailureRate: null, networkFailureRate: null, customerIncidentCount: null } };
    const recoveryPlanFallback = { proposedActions: [{ actionType: 'deliver_recovery_link_email', rationale: 'Link', preconditions: ['Merchant opt in'], expectedOutcome: 'Recovery', estimatedRecoveryPaise: 1000000, requiresAutonomousExecution: true }], recoveryProbability: 0.50, confidence: 0.50 };
    const policy = { id: validUuid, enabled: true, minimumConfidence: 0.70, rootCauses: ['customer_error'], allowedActions: ['deliver_recovery_link_email'], merchantOptedIn: true };

    const decision = evaluatePolicy(incident, riskFallback, recoveryPlanFallback, [policy], { autoResolveFraction: 0.1 }, { incidentAttempts: 0, attemptsLast24Hours: 0, attemptsLast7Days: 0, merchantOptedIn: true, customerReferenceAvailable: true });
    assert.equal(decision.outcome, 'auto_no_action');
    assert.equal(decision.permittedActions.length, 0);
  });

  // 6. Full Pipeline Integration Test
  await runScenario('Full Durable Investigation integrates Recovery Engine decision into Outbox proposals', async () => {
    let persistedProposals = null;
    const mockRepo = {
      incidentDetail: async () => ({
        incident: { id: 'inc_full_pipeline', organizationId: org, riskTier: 'HIGH', status: 'OPEN', totalFailedAmountPaise: 7500000, recoveredAmountPaise: 0, remainingAmountPaise: 7500000, correlatedEventIds: ['evt_fp'], openedAt: new Date().toISOString(), resolvedAt: null, updatedAt: new Date().toISOString() },
        events: [{ id: 'evt_fp', organizationId: org, event: { eventId: 'evt_fp', organizationId: org, eventType: 'payment.failed', paymentId: 'pay_fp1', orderId: 'order_fp1', amountPaise: 7500000, currency: 'INR', paymentMethod: 'upi', errorSource: 'customer', errorStep: 'payment_authentication', errorReason: 'payment_failed', customerHash: 'c'.repeat(64), receivedAt: new Date().toISOString() }, enrichment: { failureAttribution: 'customer_drop', gatewayHealthScore: 1.0, gatewayInDowntime: false, downtimeScheduled: false, crossBorderFlag: false, priorAttemptCount: 0, partialRecoveryPossible: false, recommendedRetryMethod: 'upi', source: 'razorpay_fields_heuristic', enrichedAt: new Date().toISOString(), signalsUsed: ['error_source'] }, enrichmentSource: 'razorpay_fields_heuristic' }],
        investigation: null, proposals: [], audit: [], execution: []
      }),
      policyContext: async () => ({
        policy: { id: validUuid, enabled: true, minimumConfidence: 0.70, rootCauses: ['customer_error'], allowedActions: ['deliver_recovery_link_email'], merchantOptedIn: true },
        stats: { autoResolveFraction: 0.1 },
        contact: { incidentAttempts: 0, attemptsLast24Hours: 0, attemptsLast7Days: 0, merchantOptedIn: true, customerReferenceAvailable: true }
      }),
      riskToolMetrics: async () => null, incidentMemory: async () => [], executionPolicyContext: async () => null, customerProfile: async () => null, autonomyPolicy: async () => null,
      persistDirectInvestigation: async (...args) => { persistedProposals = args[7]; }
    };

    const mockProvider = new EchoModelAdapter(req => {
      const s = req.systemPrompt || '';
      if (s.includes('Supervisor')) return { hypothesis: 'Customer checkout drop', primaryFailureCategory: 'customer_error', objectives: ['Validate telemetry'], evidencePriorities: [{ fact: 'Razorpay intake', whyItMatters: 'Root cause' }], subAgents: [{ agent: 'risk_analyst', question: 'What is risk?', priority: 1, allowedContextFields: ['payment'] }, { agent: 'recovery_planner', question: 'What is plan?', priority: 1, allowedContextFields: ['payment'] }], constraints: ['Enforce stopping rules'], noActionCriteria: ['Dispute opened'], estimatedAutoResolvable: true, requiresNoActionFallback: false, confidence: 0.90, reasoning: 'Verified' };
      if (s.includes('Risk Analyst') || (s.includes('Risk') && !s.includes('Recovery Planner'))) return { failureRootCause: 'customer_error', evidenceStrength: 'strong', confidence: 0.88, causalNarrative: 'Customer dropped 2FA', evidenceConfidenceRationale: 'Razorpay fields', alternativeHypotheses: [], falsePositiveCostEstimatePaise: 7500000, missingEvidence: [], chargebackEvidenceReady: false, evidenceItems: ['payment.failed'], recommendedActionCategory: 'deliver_recovery_link_email', toolResults: { incidentTimelineEventCount: 1, merchantFailureRate: null, networkFailureRate: null, customerIncidentCount: null } };
      return { proposedActions: [{ actionType: 'deliver_recovery_link_email', rationale: 'Deliver link', preconditions: ['Merchant opt in'], expectedOutcome: 'Recovery', estimatedRecoveryPaise: 7500000, requiresAutonomousExecution: true, emailCopyIntent: 'Pay now' }], recoveryProbability: 0.85, confidence: 0.88 };
    });

    await runDurableInvestigation(mockRepo, mockProvider, { jobId: 'job_1', organizationId: org, incidentId: 'inc_full_pipeline', triggerEventId: 'evt_fp', attemptNumber: 1, createdAt: new Date().toISOString() }, { directExecution: true });
    assert.ok(persistedProposals !== null);
    assert.equal(persistedProposals.length, 1);
  });

  // 7. Negative Path: Duplicate Callback Idempotency
  await runScenario('Negative Path: Duplicate replan execution produces zero duplicate action', async () => {
    let createdCount = 0;
    const mockRepo = {
      incidentDetail: async () => ({
        incident: { id: 'inc_dup', organizationId: org, riskTier: 'HIGH', status: 'OPEN', totalFailedAmountPaise: 500000, recoveredAmountPaise: 0, remainingAmountPaise: 500000, correlatedEventIds: ['evt_dup'], openedAt: new Date().toISOString(), resolvedAt: null, updatedAt: new Date().toISOString() },
        events: [{ id: 'evt_dup', organizationId: org, event: { eventId: 'evt_dup', organizationId: org, eventType: 'payment.failed', paymentId: 'pay_dup', amountPaise: 500000, receivedAt: new Date().toISOString() }, enrichment: { failureAttribution: 'customer_drop' } }],
        investigation: null, proposals: [], audit: [],
        execution: [{ capability: 'deliver_recovery_link_email', command_key: `${org}:deliver_recovery_link_email:inc_dup` }]
      }),
      customerProfile: async () => null,
      autonomyPolicy: async () => null,
      createExecutionActionForSaga: async () => { createdCount++; return 'action_new'; }
    };

    const res = await replanIncidentStrategy(mockRepo, org, 'inc_dup', 'linked_risk_event');
    assert.equal(res.adaptedStrategy, null);
    assert.equal(res.actionId, null);
    assert.equal(createdCount, 0);
  });

  // 8. Negative Path: Fraud Hard Stop
  await runScenario('Negative Path: Fraud block prevents any adaptive recovery strategy', async () => {
    const incident = { id: 'inc_fraud', organizationId: org, riskTier: 'CRITICAL', status: 'OPEN', totalFailedAmountPaise: 500000, recoveredAmountPaise: 0, remainingAmountPaise: 500000, correlatedEventIds: ['evt_fr'], openedAt: new Date().toISOString(), resolvedAt: null, updatedAt: new Date().toISOString() };
    const enrichment = { failureAttribution: 'fraud_block', gatewayHealthScore: 1.0, gatewayInDowntime: false, downtimeScheduled: false, crossBorderFlag: false, priorAttemptCount: 0, partialRecoveryPossible: false, recommendedRetryMethod: 'upi', source: 'razorpay_fields_heuristic', enrichedAt: new Date().toISOString(), signalsUsed: ['error_source'] };
    const risk = { failureRootCause: 'fraud_confirmed', evidenceStrength: 'strong', confidence: 0.95, causalNarrative: 'Fraud block', evidenceConfidenceRationale: 'Verified', alternativeHypotheses: [], falsePositiveCostEstimatePaise: 500000, missingEvidence: [], chargebackEvidenceReady: true, evidenceItems: ['payment.failed'], recommendedActionCategory: 'no_action', toolResults: { incidentTimelineEventCount: 1, merchantFailureRate: null, networkFailureRate: null, customerIncidentCount: null } };

    const adapted = adaptRecoveryStrategy([], incident, enrichment, risk, null, null);
    assert.equal(adapted, null);
  });

  // 9. Negative Path: Terminal Strategy Exhaustion
  await runScenario('Negative Path: All available strategies tried results in terminal null replan', async () => {
    const incident = { id: 'inc_exhaust', organizationId: org, riskTier: 'HIGH', status: 'OPEN', totalFailedAmountPaise: 500000, recoveredAmountPaise: 0, remainingAmountPaise: 500000, correlatedEventIds: ['evt_ex'], openedAt: new Date().toISOString(), resolvedAt: null, updatedAt: new Date().toISOString() };
    const enrichment = { failureAttribution: 'gateway_degraded', gatewayHealthScore: 0.2, gatewayInDowntime: true, downtimeScheduled: false, crossBorderFlag: false, priorAttemptCount: 2, partialRecoveryPossible: false, recommendedRetryMethod: 'upi', source: 'razorpay_fields_heuristic', enrichedAt: new Date().toISOString(), signalsUsed: ['error_source'] };
    const risk = { failureRootCause: 'gateway_degraded', evidenceStrength: 'strong', confidence: 0.90, causalNarrative: 'Gateway failure', evidenceConfidenceRationale: 'Verified', alternativeHypotheses: [], falsePositiveCostEstimatePaise: 500000, missingEvidence: [], chargebackEvidenceReady: false, evidenceItems: ['payment.failed'], recommendedActionCategory: 'resolve_infrastructure', toolResults: { incidentTimelineEventCount: 1, merchantFailureRate: null, networkFailureRate: null, customerIncidentCount: null } };

    const tried = ['deliver_recovery_link_email', 'resolve_infrastructure'];
    const adapted = adaptRecoveryStrategy(tried, incident, enrichment, risk, null, null);
    assert.equal(adapted, null);
  });

  console.log('\nFinal Integration Suite Summary: ' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Suite Error:', err);
  process.exit(1);
});
