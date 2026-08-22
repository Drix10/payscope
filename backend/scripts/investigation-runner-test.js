const assert = require('node:assert/strict');
const { EchoModelAdapter } = require('../dist/providers/model/echo-adapter');
const { runDurableInvestigation } = require('../dist/pipeline/investigation-runner');

const org = '00000000-0000-4000-8000-000000000001';
const incidentId = '00000000-0000-4000-8000-000000000002';
const incident = { id: incidentId, organizationId: org, riskTier: 'MEDIUM', status: 'OPEN', totalFailedAmountPaise: 1000, recoveredAmountPaise: 0, remainingAmountPaise: 1000, correlatedEventIds: [], openedAt: '2026-08-22T00:00:00.000Z', resolvedAt: null, updatedAt: '2026-08-22T00:00:00.000Z' };
const model = new EchoModelAdapter(request => request.systemPrompt.includes('Supervisor')
  ? { hypothesis: 'Gateway health', primaryFailureCategory: 'infrastructure', subAgents: [], estimatedAutoResolvable: false, requiresHumanReview: true, confidence: 0.8, reasoning: 'No durable policy is configured.' }
  : request.systemPrompt.includes('Risk Analyst')
    ? { failureRootCause: 'gateway_degraded', evidenceStrength: 'moderate', confidence: 0.8, falsePositiveCostEstimatePaise: 0, missingEvidence: ['Network rate unavailable'], chargebackEvidenceReady: false, evidenceItems: ['No raw data used'], recommendedActionCategory: 'flag_for_review' }
    : { proposedActions: [], noActionReason: 'No merchant recovery opt-in.', recoveryProbability: 0, confidence: 0.8 });
const calls = [];
const repository = {
  incidentDetail: async () => ({ incident, events: [], proposals: [] }),
  persistInvestigation: async (...args) => calls.push(['persist', args]),
  recordInvestigationUnavailable: async (...args) => calls.push(['failed', args]),
};
(async () => {
  await runDurableInvestigation(repository, model, { jobId: '00000000-0000-4000-8000-000000000003', organizationId: org, type: 'investigate_incident', attemptNumber: 1, createdAt: '2026-08-22T00:00:00.000Z', incidentId });
  assert.equal(calls.length, 1); assert.equal(calls[0][0], 'persist');
  console.log('Agentic MVP durable investigation runner checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
