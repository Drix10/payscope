const assert = require('node:assert/strict');
const { EchoModelAdapter } = require('../dist/providers/model/echo-adapter');
const { runInvestigationSupervisor } = require('../dist/pipeline/investigation-supervisor');
const { runRiskAnalyst } = require('../dist/pipeline/risk-analyst');
const { runRecoveryPlanner } = require('../dist/pipeline/recovery-planner');
const { evaluatePolicy } = require('../dist/pipeline/policy-evaluator');

const org = '00000000-0000-4000-8000-000000000001';
const incident = { id: '00000000-0000-4000-8000-000000000002', organizationId: org, riskTier: 'MEDIUM', status: 'OPEN', totalFailedAmountPaise: 1000, recoveredAmountPaise: 0, remainingAmountPaise: 1000, correlatedEventIds: [], openedAt: '2026-08-22T00:00:00.000Z', resolvedAt: null, updatedAt: '2026-08-22T00:00:00.000Z' };
const enrichment = { failureAttribution: 'gateway_degraded', gatewayHealthScore: 0.2, gatewayInDowntime: true, downtimeScheduled: false, crossBorderFlag: false, priorAttemptCount: 1, partialRecoveryPossible: false, recommendedRetryMethod: 'netbanking', source: 'fixture_signed', enrichedAt: '2026-08-22T00:00:00.000Z', signalsUsed: [] };
const model = new EchoModelAdapter(request => request.systemPrompt.includes('Supervisor')
  ? { hypothesis: 'Gateway downtime', primaryFailureCategory: 'infrastructure', objectives: ['Classify the bounded failure signal'], evidencePriorities: [{ fact: 'Gateway downtime is active', whyItMatters: 'It supports an infrastructure hypothesis.' }], subAgents: [], constraints: ['No PII or financial action'], noActionCriteria: ['Missing evidence requires no action'], estimatedAutoResolvable: true, requiresNoActionFallback: false, confidence: 0.9, reasoning: 'Downtime is active.' }
  : request.systemPrompt.includes('Risk Analyst')
    ? { failureRootCause: 'gateway_degraded', evidenceStrength: 'strong', confidence: 0.9, causalNarrative: 'The supplied downtime signal aligns with the failure.', evidenceConfidenceRationale: 'The enrichment is direct and no contrary signal is present.', alternativeHypotheses: [], falsePositiveCostEstimatePaise: 0, missingEvidence: [], chargebackEvidenceReady: false, evidenceItems: ['Gateway downtime'], recommendedActionCategory: 'auto_resolve_no_action' }
    : { proposedActions: [{ actionType: 'auto_resolve_infrastructure', rationale: 'Infrastructure issue', preconditions: ['Gateway degradation evidence is present'], expectedOutcome: 'An infrastructure action record is stored.', estimatedRecoveryPaise: null, requiresAutonomousExecution: true }], recoveryProbability: 0.1, confidence: 0.9 });

(async () => {
  const supervisor = await runInvestigationSupervisor(model, { incident, enrichment, merchantPolicyCount: 1, autoResolveBudgetRemaining: 0.5 }, org);
  assert.equal(supervisor.plan.estimatedAutoResolvable, true);
  const risk = await runRiskAnalyst(model, { getIncidentTimeline: async () => [], getMerchantFailureRate: async () => 0.3, getNetworkFailureRate: async () => 0.28, getCustomerIncidentCount: async () => 0 }, { incident, enrichment, gateway: 'upi' }, org);
  const recovery = await runRecoveryPlanner(model, { incident, riskAnalysis: risk.analysis, merchantOptedInToRecovery: false }, org);
  const decision = evaluatePolicy(incident, risk.analysis, recovery.plan, [{ id: 'policy', enabled: true, minimumConfidence: 0.8, rootCauses: ['gateway_degraded'], allowedActions: ['auto_resolve_infrastructure'], merchantOptedIn: false }], { autoResolveFraction: 0.2 }, { incidentAttempts: 0, attemptsLast24Hours: 0, attemptsLast7Days: 0, merchantOptedIn: false, customerReferenceAvailable: false });
  assert.equal(decision.outcome, 'auto_with_proposals');
  assert.equal(decision.permittedActions[0].actionType, 'auto_resolve_infrastructure');
  const fraud = evaluatePolicy({ ...incident, riskTier: 'HIGH' }, { ...risk.analysis, failureRootCause: 'fraud_confirmed' }, recovery.plan, [], { autoResolveFraction: 0.2 }, { incidentAttempts: 0, attemptsLast24Hours: 0, attemptsLast7Days: 0, merchantOptedIn: false, customerReferenceAvailable: false });
  assert.equal(fraud.noActionReason, 'FRAUD_CONFIRMED_HARD_STOP');
  const stoppedOutreach = evaluatePolicy(incident, risk.analysis, { proposedActions: [{ actionType: 'retry_link_sms', rationale: 'Retry safely', preconditions: ['Customer reference exists'], expectedOutcome: 'A retry record is stored.', estimatedRecoveryPaise: 1000, requiresAutonomousExecution: true }], recoveryProbability: 0.2, confidence: 0.8 }, [], { autoResolveFraction: 0.2 }, { incidentAttempts: 2, attemptsLast24Hours: 1, attemptsLast7Days: 3, merchantOptedIn: true, customerReferenceAvailable: true });
  assert.equal(stoppedOutreach.outcome, 'auto_no_action');
  assert.equal(stoppedOutreach.permittedActions.length, 0);
  assert.throws(() => evaluatePolicy(incident, risk.analysis, recovery.plan, [], { autoResolveFraction: 2 }, { incidentAttempts: 0, attemptsLast24Hours: 0, attemptsLast7Days: 0, merchantOptedIn: false, customerReferenceAvailable: false }));
  console.log('Agentic MVP supervisor, analyst, planner, and policy checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
