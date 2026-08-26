const assert = require('node:assert/strict');
const { createHmac } = require('crypto');
const { runDurableInvestigation } = require('../dist/pipeline/investigator');
const { PipelineJobProcessor } = require('../dist/pipeline/job-processor');
const { evaluatePolicy } = require('../dist/pipeline/policy-evaluator');
const { rankStrategies, adaptRecoveryStrategy, replanIncidentStrategy } = require('../dist/intelligence/recovery-engine');
const { receiveWebhook } = require('../dist/pipeline/intake');
const { decryptEmail } = require('../dist/security/encryption');

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
const webhookSecret = 'test_webhook_secret_12345678901234567890';
const previousWebhookSecret = 'previous_webhook_secret_123456789012';
const callbackEncryptionKey = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY'; // base64 of 32 bytes
let passed = 0; let failed = 0;

function signWebhook(body, secret = webhookSecret) {
  return createHmac('sha256', secret).update(body).digest('hex');
}

function webhookRepository(overrides = {}) {
  return {
    recordVerifiedCallback: async () => {},
    recordWebhookIntake: async () => ({ eventId: 'unknown', duplicate: false, incidentId: null, createdNewIncident: false }),
    ...overrides,
  };
}

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
    const ranked = rankStrategies(incident, enrichment, riskAnalysis, null, null, 0.18);
    assert.ok(ranked.length > 0);
    assert.equal(ranked[0].name, 'deliver_recovery_link_email');
    assert.ok(ranked[0].heuristicRecoveryEstimatePaise > 0);
  });

  // 2. Policy Evaluator Gates Test
  await runScenario('Policy Evaluator enforces deterministic safety gates', async () => {
    const incident = { id: 'inc_002', organizationId: org, riskTier: 'HIGH', status: 'OPEN', totalFailedAmountPaise: 500000, recoveredAmountPaise: 0, remainingAmountPaise: 500000, correlatedEventIds: ['evt_2'], openedAt: new Date().toISOString(), resolvedAt: null, updatedAt: new Date().toISOString() };
    const risk = { failureRootCause: 'customer_error', evidenceStrength: 'moderate', confidence: 0.88, causalNarrative: 'Customer drop', evidenceConfidenceRationale: 'Verified', alternativeHypotheses: [], falsePositiveCostEstimatePaise: 500000, missingEvidence: [], chargebackEvidenceReady: false, evidenceItems: ['payment.failed'], recommendedActionCategory: 'deliver_recovery_link_email', toolResults: { incidentTimelineEventCount: 1, merchantFailureRate: null, networkFailureRate: null, customerIncidentCount: null } };
    const recoveryPlan = { proposedActions: [{ actionType: 'deliver_recovery_link_email', rationale: 'Deliver link', preconditions: ['Merchant opt in'], expectedOutcome: 'Recovery', estimatedRecoveryPaise: 500000, requiresAutonomousExecution: true, emailCopyIntent: 'Pay now' }], heuristicRecoveryScore: 0.85, confidence: 0.88 };
    const policy = { id: validUuid, enabled: true, minimumConfidence: 0.70, rootCauses: ['customer_error'], allowedActions: ['deliver_recovery_link_email'], merchantOptedIn: true };

    const decision = evaluatePolicy(incident, risk, recoveryPlan, [policy], { autoResolveFraction: 0.1 }, { incidentAttempts: 0, attemptsLast24Hours: 0, attemptsLast7Days: 0, merchantOptedIn: true, customerReferenceAvailable: true });
    assert.equal(decision.outcome, 'auto_with_proposals');
    assert.equal(decision.permittedActions.length, 1);
  });

  // 3. Dispute Hard Stop Test
  await runScenario('Policy Evaluator engages Hard Stop on open disputes', async () => {
    const incident = { id: 'inc_disputed', organizationId: org, riskTier: 'HIGH', status: 'DISPUTE_OPENED', totalFailedAmountPaise: 500000, recoveredAmountPaise: 0, remainingAmountPaise: 500000, correlatedEventIds: ['evt_d'], openedAt: new Date().toISOString(), resolvedAt: null, updatedAt: new Date().toISOString() };
    const risk = { failureRootCause: 'customer_error', evidenceStrength: 'strong', confidence: 0.90, causalNarrative: 'Dispute opened', evidenceConfidenceRationale: 'Verified dispute', alternativeHypotheses: [], falsePositiveCostEstimatePaise: 500000, missingEvidence: [], chargebackEvidenceReady: true, evidenceItems: ['payment.dispute.created'], recommendedActionCategory: 'submit_dispute_evidence', toolResults: { incidentTimelineEventCount: 1, merchantFailureRate: null, networkFailureRate: null, customerIncidentCount: null } };
    const recoveryPlan = { proposedActions: [{ actionType: 'deliver_recovery_link_email', rationale: 'Link', preconditions: ['Merchant opt in'], expectedOutcome: 'Recovery', estimatedRecoveryPaise: 500000, requiresAutonomousExecution: true }], heuristicRecoveryScore: 0.5, confidence: 0.90 };

    const decision = evaluatePolicy(incident, risk, recoveryPlan, [], { autoResolveFraction: 0 }, { incidentAttempts: 0, attemptsLast24Hours: 0, attemptsLast7Days: 0, merchantOptedIn: true, customerReferenceAvailable: true });
    assert.equal(decision.outcome, 'auto_no_action');
    assert.equal(decision.permittedActions.length, 0);
    assert.equal(decision.noActionReason, 'DISPUTE_OPEN_HARD_STOP');
  });

  // 4. Strategy exhaustion after the only provider-backed capability fails.
  // resolve_infrastructure/record_risk_signal are deliberately NOT provider-backed;
  // legitimate autonomy means STOP, never a fake second strategy.
  await runScenario('Post-failure adaptive loop stops safely when no untried provider-backed capability exists', async () => {
    const incident = { id: 'inc_adaptive', organizationId: org, riskTier: 'HIGH', status: 'OPEN', totalFailedAmountPaise: 1000000, recoveredAmountPaise: 0, remainingAmountPaise: 1000000, correlatedEventIds: ['evt_a'], openedAt: new Date().toISOString(), resolvedAt: null, updatedAt: new Date().toISOString() };
    const enrichment = { failureAttribution: 'gateway_degraded', gatewayHealthScore: 0.4, gatewayInDowntime: true, downtimeScheduled: false, crossBorderFlag: false, priorAttemptCount: 1, partialRecoveryPossible: false, recommendedRetryMethod: 'netbanking', source: 'razorpay_fields_heuristic', enrichedAt: new Date().toISOString(), signalsUsed: ['downtimes'] };
    const riskAnalysis = { failureRootCause: 'gateway_degraded', evidenceStrength: 'strong', confidence: 0.92, causalNarrative: 'Acquirer downtime', evidenceConfidenceRationale: 'Razorpay signal', alternativeHypotheses: [], falsePositiveCostEstimatePaise: 1000000, missingEvidence: [], chargebackEvidenceReady: false, evidenceItems: ['payment.failed'], recommendedActionCategory: 'resolve_infrastructure', toolResults: { incidentTimelineEventCount: 1, merchantFailureRate: null, networkFailureRate: null, customerIncidentCount: null } };

    const adapted = adaptRecoveryStrategy(['deliver_recovery_link_email'], incident, enrichment, riskAnalysis, null, null, 0.18);
    assert.equal(adapted, null, 'strategy exhaustion must terminate in safe no-action, not a fake infrastructure capability');
  });

  // 5. Fail-Closed Fallback Gate Test
  await runScenario('Exception fallback sets confidence 0.50 and fails-closed under minimum confidence threshold', async () => {
    const incident = { id: 'inc_fail_closed', organizationId: org, riskTier: 'HIGH', status: 'OPEN', totalFailedAmountPaise: 1000000, recoveredAmountPaise: 0, remainingAmountPaise: 1000000, correlatedEventIds: ['evt_fc'], openedAt: new Date().toISOString(), resolvedAt: null, updatedAt: new Date().toISOString() };
    const riskFallback = { failureRootCause: 'customer_error', evidenceStrength: 'weak', confidence: 0.50, causalNarrative: 'Fallback', evidenceConfidenceRationale: 'Uncertainty', alternativeHypotheses: [], falsePositiveCostEstimatePaise: 1000000, missingEvidence: ['LLM'], chargebackEvidenceReady: false, evidenceItems: ['payment.failed'], recommendedActionCategory: 'deliver_recovery_link_email', toolResults: { incidentTimelineEventCount: 1, merchantFailureRate: null, networkFailureRate: null, customerIncidentCount: null } };
    const recoveryPlanFallback = { proposedActions: [{ actionType: 'deliver_recovery_link_email', rationale: 'Link', preconditions: ['Merchant opt in'], expectedOutcome: 'Recovery', estimatedRecoveryPaise: 1000000, requiresAutonomousExecution: true }], heuristicRecoveryScore: 0.50, confidence: 0.50 };
    const policy = { id: validUuid, enabled: true, minimumConfidence: 0.70, rootCauses: ['customer_error'], allowedActions: ['deliver_recovery_link_email'], merchantOptedIn: true };

    const decision = evaluatePolicy(incident, riskFallback, recoveryPlanFallback, [policy], { autoResolveFraction: 0.1 }, { incidentAttempts: 0, attemptsLast24Hours: 0, attemptsLast7Days: 0, merchantOptedIn: true, customerReferenceAvailable: true });
    assert.equal(decision.outcome, 'auto_no_action');
    assert.equal(decision.permittedActions.length, 0);
  });

  // 5b. A deterministic strategy hard-stop must not quietly become the
  // default email command when the model supplied a recovery suggestion.
  await runScenario('Recovery Engine exhaustion creates no executable proposal', async () => {
    let persistedProposals = null;
    const mockRepo = {
      incidentDetail: async () => ({
        incident: { id: 'inc_no_strategy', organizationId: org, riskTier: 'CRITICAL', status: 'OPEN', totalFailedAmountPaise: 500000, recoveredAmountPaise: 0, remainingAmountPaise: 500000, correlatedEventIds: ['evt_ns'], openedAt: new Date().toISOString(), resolvedAt: null, updatedAt: new Date().toISOString() },
        events: [{ id: 'evt_ns', organizationId: org, event: { eventId: 'evt_ns', organizationId: org, eventType: 'payment.failed', paymentId: 'pay_ns', amountPaise: 500000, receivedAt: new Date().toISOString() }, enrichment: { failureAttribution: 'fraud_block' } }],
        investigation: null, proposals: [], audit: [], execution: []
      }),
      policyContext: async () => ({ policy: { id: validUuid, enabled: true, minimumConfidence: 0.70, rootCauses: ['fraud_confirmed'], allowedActions: ['deliver_recovery_link_email'], merchantOptedIn: true }, stats: { autoResolveFraction: 0.1 }, contact: { incidentAttempts: 0, attemptsLast24Hours: 0, attemptsLast7Days: 0, merchantOptedIn: true, customerReferenceAvailable: true } }),
      riskToolMetrics: async () => null, incidentMemory: async () => [], executionPolicyContext: async () => null, customerProfile: async () => null, autonomyPolicy: async () => null,
      persistDirectInvestigation: async (...args) => { persistedProposals = args[7]; }
    };
    const mockProvider = new EchoModelAdapter(req => {
      if (req.systemPrompt.includes('Supervisor')) return { hypothesis: 'Fraud signal', primaryFailureCategory: 'fraud_confirmed', objectives: ['Stop'], evidencePriorities: [], subAgents: [], constraints: [], noActionCriteria: ['Fraud'], estimatedAutoResolvable: false, requiresNoActionFallback: true, confidence: 0.9, reasoning: 'Signal' };
      if (req.systemPrompt.includes('Risk Analyst')) return { failureRootCause: 'fraud_confirmed', evidenceStrength: 'strong', confidence: 0.95, causalNarrative: 'Fraud', evidenceConfidenceRationale: 'Signal', alternativeHypotheses: [], falsePositiveCostEstimatePaise: 500000, missingEvidence: [], chargebackEvidenceReady: false, evidenceItems: ['payment.failed'], recommendedActionCategory: 'no_action', toolResults: { incidentTimelineEventCount: 1, merchantFailureRate: null, networkFailureRate: null, customerIncidentCount: null } };
      return { proposedActions: [{ actionType: 'deliver_recovery_link_email', rationale: 'Do not use', preconditions: [], expectedOutcome: 'None', estimatedRecoveryPaise: 500000, requiresAutonomousExecution: true }], heuristicRecoveryScore: 0.9, confidence: 0.9 };
    });
    await runDurableInvestigation(mockRepo, mockProvider, { jobId: 'job_ns', organizationId: org, incidentId: 'inc_no_strategy', triggerEventId: 'evt_ns', attemptNumber: 1, createdAt: new Date().toISOString() }, { directExecution: true });
    assert.deepEqual(persistedProposals, []);
  });

  // 6. Webhook signature verification with bounded previous-secret rotation,
  // encrypted callback evidence, and durable intake — through receiveWebhook.
  await runScenario('Webhook rotation accepts prior secret and stores encrypted callback evidence', async () => {
    const payload = Buffer.from(JSON.stringify({ id: 'evt_old_secret', event: 'payment.failed', payload: { payment: { entity: { id: 'pay_old_secret', amount: 500000, created_at: Math.floor(Date.now() / 1000) } } } }));
    const recordedCallbacks = [];
    let intakeRecorded = false;
    const repository = {
      recordVerifiedCallback: async (organizationId, callback, rawBodyEncrypted, source) => {
        recordedCallbacks.push({ organizationId, callback, rawBodyEncrypted, source });
      },
      recordWebhookIntake: async () => {
        intakeRecorded = true;
        return { eventId: 'evt_old_secret', duplicate: false, incidentId: 'inc_old_secret', createdNewIncident: true };
      }
    };
    const result = await receiveWebhook(payload, signWebhook(payload, previousWebhookSecret), 'evt_old_secret', repository,
      { webhookSecret, previousWebhookSecret, organizationId: org, callbackEncryptionKey });
    assert.equal(result.duplicate, false);
    assert.equal(intakeRecorded, true);
    assert.equal(recordedCallbacks.length, 1);
    const evidence = recordedCallbacks[0];
    assert.equal(evidence.organizationId, org);
    assert.equal(evidence.source, 'http_webhook');
    assert.equal(evidence.callback.verifiedSecretVersion, 2, 'prior-secret verification must be recorded as secret version 2');
    // The stored body is encrypted at rest and decrypts to the exact raw bytes.
    const decrypted = decryptEmail(evidence.rawBodyEncrypted, callbackEncryptionKey);
    assert.equal(Buffer.from(decrypted, 'utf8').equals(payload), true);
    assert.equal(Buffer.from(evidence.rawBodyEncrypted.ciphertext, 'base64').includes(payload.slice(0, 16)), false, 'ciphertext must not contain plaintext fragments');
  });

  await runScenario('receiveWebhook rejects unsigned, tampered, and header-mismatched callbacks', async () => {
    const payload = Buffer.from(JSON.stringify({ id: 'evt_x', event: 'payment.failed', payload: { payment: { entity: { id: 'pay_bad_sig', amount: 500000, created_at: Math.floor(Date.now() / 1000) } } } }));
    const repository = webhookRepository();
    const config = { webhookSecret, organizationId: org, callbackEncryptionKey };
    await assert.rejects(() => receiveWebhook(payload, undefined, 'evt_x', repository, config), /signature/i);
    await assert.rejects(() => receiveWebhook(payload, signWebhook(Buffer.from('tampered')), 'evt_x', repository, config), /invalid/i);
    const goodSig = signWebhook(payload);
    await assert.rejects(() => receiveWebhook(payload, goodSig, 'evt_other_event_id', repository, config), /does not match/i);
  });

  // 7. Full Pipeline Integration Test
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
      return { proposedActions: [{ actionType: 'deliver_recovery_link_email', rationale: 'Deliver link', preconditions: ['Merchant opt in'], expectedOutcome: 'Recovery', estimatedRecoveryPaise: 7500000, requiresAutonomousExecution: true, emailCopyIntent: 'Pay now' }], heuristicRecoveryScore: 0.85, confidence: 0.88 };
    });

    await runDurableInvestigation(mockRepo, mockProvider, { jobId: 'job_1', organizationId: org, incidentId: 'inc_full_pipeline', triggerEventId: 'evt_fp', attemptNumber: 1, createdAt: new Date().toISOString() }, { directExecution: true });
    assert.ok(persistedProposals !== null);
    assert.equal(persistedProposals.length, 1);
  });

  // 8. Database unavailability must fail closed, not become "no history".
  await runScenario('Customer-profile database failure blocks autonomous action (fail closed)', async () => {
    let persistedProposals = null;
    const dbError = new Error('could not connect to database');
    const mockRepo = {
      incidentDetail: async () => ({
        incident: { id: 'inc_db_down', organizationId: org, riskTier: 'HIGH', status: 'OPEN', totalFailedAmountPaise: 1000000, recoveredAmountPaise: 0, remainingAmountPaise: 1000000, correlatedEventIds: ['evt_db'], openedAt: new Date().toISOString(), resolvedAt: null, updatedAt: new Date().toISOString() },
        events: [{ id: 'evt_db', organizationId: org, event: { eventId: 'evt_db', eventType: 'payment.failed', customerHash: 'd'.repeat(64), occurredAt: new Date().toISOString(), currency: 'INR', receivedAt: new Date().toISOString() }, enrichment: { failureAttribution: 'customer_drop', source: 'razorpay_fields_heuristic', enrichedAt: new Date().toISOString(), signalsUsed: [] } }],
        investigation: null, proposals: [], audit: [], execution: []
      }),
      policyContext: async () => ({ policy: { id: validUuid, enabled: true, minimumConfidence: 0.70, rootCauses: ['customer_error'], allowedActions: ['deliver_recovery_link_email'], merchantOptedIn: true }, stats: { autoResolveFraction: 0.1 }, contact: { incidentAttempts: 0, attemptsLast24Hours: 0, attemptsLast7Days: 0, merchantOptedIn: true, customerReferenceAvailable: true } }),
      executionPolicyContext: async () => ({ policy: { enabledCapabilities: ['deliver_recovery_link_email'], maxAmountPaise: 2000000, allowedCurrencies: ['INR'], emailConsentRequired: false, providerHealthy: true, emergencyPaused: false, retryBudget: 3 }, existingCommandKeys: new Set() }),
      riskToolMetrics: async () => null,
      incidentMemory: async () => [],
      customerProfile: async () => { throw dbError; },
      autonomyPolicy: async () => { throw dbError; },
      persistDirectInvestigation: async (...args) => { persistedProposals = args[7]; }
    };
    const mockProvider = new EchoModelAdapter(req => {
      const s = req.systemPrompt || '';
      if (s.includes('Supervisor')) return { hypothesis: 'Drop', primaryFailureCategory: 'customer_error', objectives: [], evidencePriorities: [], subAgents: [], constraints: [], noActionCriteria: [], estimatedAutoResolvable: true, requiresNoActionFallback: false, confidence: 0.9, reasoning: 'x' };
      if (s.includes('Risk Analyst') || (s.includes('Risk') && !s.includes('Recovery Planner'))) return { failureRootCause: 'customer_error', evidenceStrength: 'strong', confidence: 0.95, causalNarrative: 'drop', evidenceConfidenceRationale: 'verified', alternativeHypotheses: [], falsePositiveCostEstimatePaise: 1000000, missingEvidence: [], chargebackEvidenceReady: false, evidenceItems: ['payment.failed'], recommendedActionCategory: 'deliver_recovery_link_email', toolResults: { incidentTimelineEventCount: 1, merchantFailureRate: null, networkFailureRate: null, customerIncidentCount: null } };
      return { proposedActions: [{ actionType: 'deliver_recovery_link_email', rationale: 'Link', preconditions: [], expectedOutcome: 'Recovery', estimatedRecoveryPaise: 1000000, requiresAutonomousExecution: true }], heuristicRecoveryScore: 0.9, confidence: 0.9 };
    });
    await runDurableInvestigation(mockRepo, mockProvider, { jobId: 'job_db', organizationId: org, incidentId: 'inc_db_down', triggerEventId: 'evt_db', attemptNumber: 1, createdAt: new Date().toISOString() }, { directExecution: true });
    assert.deepEqual(persistedProposals, [], 'a database outage must produce zero proposals, never a "new customer" action');
  });

  // 9. Replan requires an auditable decision sink and a terminal prior action.
  await runScenario('Negative Path: Duplicate replan execution produces zero duplicate action', async () => {
    let createdCount = 0;
    const auditDecisions = [];
    const mockRepo = {
      incidentDetail: async () => ({
        incident: { id: 'inc_dup', organizationId: org, riskTier: 'HIGH', status: 'OPEN', totalFailedAmountPaise: 500000, recoveredAmountPaise: 0, remainingAmountPaise: 500000, correlatedEventIds: ['evt_dup'], openedAt: new Date().toISOString(), resolvedAt: null, updatedAt: new Date().toISOString() },
        events: [{ id: 'evt_dup', organizationId: org, event: { eventId: 'evt_dup', eventType: 'payment.failed', customerHash: 'e'.repeat(64), occurredAt: new Date().toISOString(), currency: 'INR', receivedAt: new Date().toISOString() }, enrichment: { failureAttribution: 'customer_drop', source: 'razorpay_fields_heuristic', enrichedAt: new Date().toISOString(), signalsUsed: [] } }],
        investigation: { riskAnalysis: { failureRootCause: 'customer_error', evidenceStrength: 'strong', confidence: 0.88, causalNarrative: 'Customer drop', evidenceConfidenceRationale: 'Verified', alternativeHypotheses: [], falsePositiveCostEstimatePaise: 500000, missingEvidence: [], chargebackEvidenceReady: false, evidenceItems: ['payment.failed'], recommendedActionCategory: 'deliver_recovery_link_email', toolResults: { incidentTimelineEventCount: 1, merchantFailureRate: null, networkFailureRate: null, customerIncidentCount: null } } },
        proposals: [], audit: [],
        execution: [{ id: 'act_1', capability: 'deliver_recovery_link_email', state: 'failed', command_key: `${org}:deliver_recovery_link_email:inc_dup` }]
      }),
      recordAdaptiveReplanDecision: async input => { auditDecisions.push(input); },
      policyContext: async () => ({ policy: { id: validUuid, enabled: true, minimumConfidence: 0.70, rootCauses: ['customer_error'], allowedActions: ['deliver_recovery_link_email'], merchantOptedIn: true }, stats: { autoResolveFraction: 0.1 }, contact: { incidentAttempts: 0, attemptsLast24Hours: 0, attemptsLast7Days: 0, merchantOptedIn: true, customerReferenceAvailable: true } }),
      executionPolicyContext: async () => ({ policy: { enabledCapabilities: ['deliver_recovery_link_email'], maxAmountPaise: 2000000, allowedCurrencies: ['INR'], emailConsentRequired: false, providerHealthy: true, emergencyPaused: false, retryBudget: 3 }, existingCommandKeys: new Set([`${org}:deliver_recovery_link_email:inc_dup`]) }),
      customerProfile: async () => ({ organizationId: org, customerHash: 'e'.repeat(64), successfulPaymentMethods: [], failedPaymentMethods: [], successfulPaymentCount: 0, totalIncidentCount: 1, recoveryEmailsSent: 1, recoveryEmailsPaid: 0, lastContactedAt: new Date().toISOString(), firstSeenAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() }),
      autonomyPolicy: async () => ({ organizationId: org, maxAutoRecoveryPaise: 500000, maxAutoCapturePaise: 0, maxAutoRefundPaise: 0, recoveryEmailEnabled: true, subscriptionRetryEnabled: false, captureEnabled: false, refundEnabled: false, disputeEvidenceEnabled: false, maxContactsPerIncident: 2, maxContactsPer24h: 1, quietHoursStart: null, quietHoursEnd: null, updatedAt: new Date().toISOString() }),
      createExecutionActionForSaga: async () => { createdCount++; return 'action_new'; }
    };

    const res = await replanIncidentStrategy(mockRepo, org, 'inc_dup', 'linked_risk_event', 0.18);
    assert.equal(res.adaptedStrategy, null, 'the only provider-backed capability was already tried; replan must stop');
    assert.equal(res.actionId, null);
    assert.equal(createdCount, 0);
    assert.ok(auditDecisions.length >= 1, 'every skipped replan must be durably audited');
    assert.equal(auditDecisions[auditDecisions.length - 1].decision, 'no_action');
  });

  // 10. Non-terminal prior actions must never unlock adaptive replanning.
  await runScenario('Negative Path: accepted/dispatched prior action does not unlock adaptive replan', async () => {
    const auditDecisions = [];
    const mockRepo = {
      incidentDetail: async () => ({
        incident: { id: 'inc_live', organizationId: org, riskTier: 'HIGH', status: 'OPEN', totalFailedAmountPaise: 500000, recoveredAmountPaise: 0, remainingAmountPaise: 500000, correlatedEventIds: ['evt_live'], openedAt: new Date().toISOString(), resolvedAt: null, updatedAt: new Date().toISOString() },
        events: [{ id: 'evt_live', organizationId: org, event: { eventId: 'evt_live', eventType: 'payment.failed', customerHash: 'f'.repeat(64), occurredAt: new Date().toISOString(), currency: 'INR', receivedAt: new Date().toISOString() }, enrichment: { failureAttribution: 'customer_drop', source: 'razorpay_fields_heuristic', enrichedAt: new Date().toISOString(), signalsUsed: [] } }],
        investigation: { riskAnalysis: { failureRootCause: 'customer_error', evidenceStrength: 'strong', confidence: 0.88, causalNarrative: 'ok', evidenceConfidenceRationale: 'ok', alternativeHypotheses: [], falsePositiveCostEstimatePaise: 500000, missingEvidence: [], chargebackEvidenceReady: false, evidenceItems: ['payment.failed'], recommendedActionCategory: 'deliver_recovery_link_email', toolResults: { incidentTimelineEventCount: 1, merchantFailureRate: null, networkFailureRate: null, customerIncidentCount: null } } },
        proposals: [], audit: [],
        execution: [{ id: 'act_live', capability: 'deliver_recovery_link_email', state: 'accepted', command_key: `${org}:deliver_recovery_link_email:inc_live` }]
      }),
      recordAdaptiveReplanDecision: async input => { auditDecisions.push(input); },
      createExecutionActionForSaga: async () => { throw new Error('must never be called'); }
    };
    const res = await replanIncidentStrategy(mockRepo, org, 'inc_live', 'payment_link_expired', 0.18);
    assert.equal(res.adaptedStrategy, null);
    assert.equal(res.actionId, null);
    assert.equal(auditDecisions[0].decision, 'no_action');
    assert.match(auditDecisions[0].rationale, /no prior action is failed/i);
  });

  // 11. Full worker path: expired link reconciles the action to a terminal
  // state and drives adaptive replan even when event correlation misses,
  // then terminates safely on strategy exhaustion.
  await runScenario('Worker path: expired link reconciles terminal state and triggers audited exhaustion stop', async () => {
    const referenceId = `ps_${'a'.repeat(32)}`;
    const state = {
      incident: { id: 'inc_worker', organizationId: org, riskTier: 'HIGH', status: 'OPEN', totalFailedAmountPaise: 1000000, recoveredAmountPaise: 0, remainingAmountPaise: 1000000, correlatedEventIds: ['evt_w1'], openedAt: new Date().toISOString(), resolvedAt: null, updatedAt: new Date().toISOString() },
      execution: [{ id: 'act_w1', capability: 'deliver_recovery_link_email', state: 'accepted', command_key: `${org}:deliver_recovery_link_email:inc_worker` }]
    };
    const auditDecisions = [];
    const createdActions = [];
    const investigationsDispatched = [];
    let compensated = false;
    const repository = {
      eventById: async (_orgId, eventId) => ({ id: eventId, organizationId: org, event: { eventId, eventType: eventId === 'evt_w2' ? 'payment_link.expired' : 'payment.failed', occurredAt: new Date().toISOString(), receivedAt: new Date().toISOString(), providerData: eventId === 'evt_w2' ? { payment_link_reference_id: referenceId } : {}, amountPaise: 1000000, currency: 'INR' }, enrichment: null, status: 'pending' }),
      completeEnrichmentAndEnqueueCorrelation: async () => {},
      correlationCandidates: async () => [], // correlation window missed: hours have passed
      persistCorrelation: async () => {},
      reconcileDirectPaymentLinkEvent: async () => {
        compensated = true;
        // Mirrors payscope_record_compensation: terminal states never regress.
        if (!['confirmed', 'failed', 'cancelled'].includes(state.execution[0].state)) {
          state.execution[0].state = 'cancelled'; // compensation target for link_expired
        }
        return { incidentId: 'inc_worker' };   // referenceId-scoped lookup still finds the owner
      },
      incidentDetail: async () => ({
        incident: state.incident,
        events: [{ id: 'evt_w1', organizationId: org, event: { eventId: 'evt_w1', eventType: 'payment.failed', customerHash: 'a'.repeat(64), occurredAt: new Date().toISOString(), currency: 'INR', receivedAt: new Date().toISOString() }, enrichment: { failureAttribution: 'customer_drop', source: 'razorpay_fields_heuristic', enrichedAt: new Date().toISOString(), signalsUsed: [] } }],
        investigation: { riskAnalysis: { failureRootCause: 'customer_error', evidenceStrength: 'strong', confidence: 0.9, causalNarrative: 'drop', evidenceConfidenceRationale: 'verified', alternativeHypotheses: [], falsePositiveCostEstimatePaise: 1000000, missingEvidence: [], chargebackEvidenceReady: false, evidenceItems: ['payment.failed'], recommendedActionCategory: 'deliver_recovery_link_email', toolResults: { incidentTimelineEventCount: 1, merchantFailureRate: null, networkFailureRate: null, customerIncidentCount: null } } },
        proposals: [], audit: [], execution: state.execution
      }),
      recordAdaptiveReplanDecision: async input => { auditDecisions.push(input); },
      policyContext: async () => ({ policy: { id: validUuid, enabled: true, minimumConfidence: 0.70, rootCauses: ['customer_error'], allowedActions: ['deliver_recovery_link_email'], merchantOptedIn: true }, stats: { autoResolveFraction: 0.1 }, contact: { incidentAttempts: 1, attemptsLast24Hours: 1, attemptsLast7Days: 1, merchantOptedIn: true, customerReferenceAvailable: true } }),
      executionPolicyContext: async () => ({ policy: { enabledCapabilities: ['deliver_recovery_link_email'], maxAmountPaise: 2000000, allowedCurrencies: ['INR'], emailConsentRequired: false, providerHealthy: true, emergencyPaused: false, retryBudget: 3 }, existingCommandKeys: new Set([`${org}:deliver_recovery_link_email:inc_worker`]) }),
      customerProfile: async () => null,
      autonomyPolicy: async () => ({ organizationId: org, maxAutoRecoveryPaise: 500000, maxAutoCapturePaise: 0, maxAutoRefundPaise: 0, recoveryEmailEnabled: true, subscriptionRetryEnabled: false, captureEnabled: false, refundEnabled: false, disputeEvidenceEnabled: false, maxContactsPerIncident: 2, maxContactsPer24h: 1, quietHoursStart: null, quietHoursEnd: null, updatedAt: new Date().toISOString() }),
      createExecutionActionForSaga: async (_orgId, _incId, capability) => { createdActions.push(capability); return 'act_new'; }
    };
    const processor = new PipelineJobProcessor(repository, { enrich: async () => { throw new Error('not used'); } }, async job => investigationsDispatched.push(job));

    // Expired-link job arrives; correlation misses but reconciliation finds the action by referenceId.
    await processor.process({ jobId: 'job_w2', organizationId: org, type: 'correlate_event', attemptNumber: 1, createdAt: new Date().toISOString(), eventId: 'evt_w2' });
    assert.equal(compensated, true, 'expired link must be reconciled to a terminal cancelled state');
    assert.equal(state.execution[0].state, 'cancelled');
    // Adaptive engine now sees a terminal prior action; the only provider-backed
    // capability was already used -> legitimate autonomy means audited STOP.
    assert.equal(createdActions.length, 0, 'no fake Strategy B may be created after exhaustion');
    const stopDecision = auditDecisions.find(d => d.triggerReason === 'payment_link_expired');
    assert.ok(stopDecision, 'expiry-driven replan must be evaluated and audited even when correlation misses');
    assert.equal(stopDecision.decision, 'no_action');

    // Replay of the same expired event: compensation is monotonic (terminal
    // states never regress), replan re-evaluates and still safely stops.
    const compensatedStateBefore = state.execution[0].state;
    await processor.process({ jobId: 'job_w3', organizationId: org, type: 'correlate_event', attemptNumber: 1, createdAt: new Date().toISOString(), eventId: 'evt_w2' });
    assert.equal(state.execution[0].state, compensatedStateBefore, 'replayed compensation must not mutate a terminal action');
    assert.equal(createdActions.length, 0, 'replay must not create any additional action');
    assert.ok(auditDecisions.every(d => d.decision === 'no_action'), 'every replayed replan decision must be a durably audited stop');
  });

  console.log('\nFinal Integration Suite Summary: ' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Suite Error:', err);
  process.exit(1);
});
