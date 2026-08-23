const assert = require('node:assert/strict');
const { EchoModelAdapter } = require('../dist/providers/model/echo-adapter');
const { runDurableInvestigation } = require('../dist/pipeline/investigation-runner');

const org = '00000000-0000-4000-8000-000000000001';
const incidentId = '00000000-0000-4000-8000-000000000002';
const incident = { id: incidentId, organizationId: org, riskTier: 'MEDIUM', status: 'OPEN', totalFailedAmountPaise: 1000, recoveredAmountPaise: 0, remainingAmountPaise: 1000, correlatedEventIds: [], openedAt: '2026-08-22T00:00:00.000Z', resolvedAt: null, updatedAt: '2026-08-22T00:00:00.000Z' };
const model = new EchoModelAdapter(request => request.systemPrompt.includes('Supervisor')
  ? { hypothesis: 'Gateway health', primaryFailureCategory: 'infrastructure', objectives: ['Assess gateway evidence'], evidencePriorities: [{ fact: 'Gateway signal is present', whyItMatters: 'It bounds the investigation.' }], subAgents: [], constraints: ['No financial execution'], noActionCriteria: ['Insufficient evidence'], estimatedAutoResolvable: false, requiresNoActionFallback: true, confidence: 0.8, reasoning: 'A durable policy is configured.' }
  : request.systemPrompt.includes('Risk Analyst')
    ? { failureRootCause: 'gateway_degraded', evidenceStrength: 'moderate', confidence: 0.8, causalNarrative: 'The gateway signal supports a tentative infrastructure cause.', evidenceConfidenceRationale: 'Network evidence is unavailable.', alternativeHypotheses: ['Issuer-side issue'], falsePositiveCostEstimatePaise: 0, missingEvidence: ['Network rate unavailable'], chargebackEvidenceReady: false, evidenceItems: ['No raw data used'], recommendedActionCategory: 'flag_for_review' }
    : { proposedActions: [{ actionType: 'flag_for_review', rationale: 'Record the bounded risk signal.', preconditions: ['Risk analysis exists'], expectedOutcome: 'A risk signal record is stored.', estimatedRecoveryPaise: null, requiresAutonomousExecution: true }], recoveryProbability: 0, confidence: 0.8 });
const calls = [];
const repository = {
  incidentDetail: async () => ({ incident, events: [], proposals: [] }),
  policyContext: async () => ({ policy: { id: '00000000-0000-4000-8000-000000000004', enabled: true, minimumConfidence: 0.8, rootCauses: ['gateway_degraded'], allowedActions: ['flag_for_review'], merchantOptedIn: false }, stats: { autoResolveFraction: 0 }, contact: { incidentAttempts: 0, attemptsLast24Hours: 0, attemptsLast7Days: 0, merchantOptedIn: false, customerReferenceAvailable: false } }),
  riskToolMetrics: async () => ({ merchantFailureRate: 0.2, networkFailureRate: 0.1, customerIncidentCount: null }),
  persistInvestigation: async (...args) => calls.push(['persist', args]),
  autonomouslySimulatePendingProposals: async (...args) => calls.push(['simulate', args]),
  recordInvestigationUnavailable: async (...args) => calls.push(['failed', args]),
};
(async () => {
  await runDurableInvestigation(repository, model, { jobId: '00000000-0000-4000-8000-000000000003', organizationId: org, type: 'investigate_incident', attemptNumber: 1, createdAt: '2026-08-22T00:00:00.000Z', incidentId, triggerEventId: '00000000-0000-4000-8000-000000000005' });
  assert.equal(calls.length, 2); assert.equal(calls[0][0], 'persist'); assert.equal(calls[1][0], 'simulate');
  assert.equal(calls[0][1][7].length, 1); assert.equal(calls[0][1][7][0].actionType, 'flag_for_review');
  console.log('Agentic MVP durable investigation runner checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
