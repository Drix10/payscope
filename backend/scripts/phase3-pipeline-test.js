const assert = require('node:assert/strict');
const { EchoModelAdapter } = require('../dist/providers/model/echo-adapter');
const { runDurableInvestigation } = require('../dist/pipeline/investigation-runner');

const org = '00000000-0000-4000-8000-000000000001';
const incidentId = '00000000-0000-4000-8000-000000000002';
const job = { jobId: '00000000-0000-4000-8000-000000000003', organizationId: org, type: 'investigate_incident', attemptNumber: 1, createdAt: '2026-08-22T00:00:00.000Z', incidentId };
const incident = { id: incidentId, organizationId: org, riskTier: 'MEDIUM', status: 'OPEN', totalFailedAmountPaise: 1000, recoveredAmountPaise: 0, remainingAmountPaise: 1000, correlatedEventIds: [], openedAt: '2026-08-22T00:00:00.000Z', resolvedAt: null, updatedAt: '2026-08-22T00:00:00.000Z' };
const event = { id: '00000000-0000-4000-8000-000000000004', organizationId: org, event: { eventId: 'evt_phase3', eventType: 'payment.failed', occurredAt: '2026-08-22T00:00:00.000Z', receivedAt: '2026-08-22T00:00:00.000Z', customerHash: 'a'.repeat(64), paymentMethod: 'upi', amountPaise: 1000, currency: 'INR', providerData: {} }, enrichment: null };

function supervisor(requiresHumanReview = false) { return { hypothesis: 'Bounded fixture hypothesis', primaryFailureCategory: 'infrastructure', subAgents: [], estimatedAutoResolvable: !requiresHumanReview, requiresHumanReview, confidence: 0.9, reasoning: 'Fixture-only reasoning.' }; }
function risk(root = 'gateway_degraded', evidence = 'strong') { return { failureRootCause: root, evidenceStrength: evidence, confidence: 0.9, falsePositiveCostEstimatePaise: 0, missingEvidence: [], chargebackEvidenceReady: false, evidenceItems: ['Tenant-scoped fixture evidence'], recommendedActionCategory: root.startsWith('fraud') ? 'escalate_fraud' : 'auto_resolve_no_action' }; }
function recovery(action = 'auto_resolve_infrastructure') { return { proposedActions: action ? [{ actionType: action, rationale: 'Bounded fixture proposal.', estimatedRecoveryPaise: null, requiresOperatorApproval: true }] : [], recoveryProbability: 0.1, confidence: 0.9 }; }

async function scenario({ enrichment, policy, metrics, output, expect }) {
  const calls = []; const timeouts = [];
  const repository = {
    incidentDetail: async () => ({ incident, events: [{ ...event, enrichment }], proposals: [] }),
    policyContext: async () => ({ policy, stats: { autoResolveFraction: 0.2, humanReviewFraction: 0.2 }, contact: { incidentAttempts: 0, attemptsLast24Hours: 0, attemptsLast7Days: 0, merchantOptedIn: false, customerReferenceAvailable: true } }),
    riskToolMetrics: async () => metrics,
    persistInvestigation: async (...args) => calls.push(['persist', args]),
    recordInvestigationUnavailable: async (...args) => calls.push(['failed', args]),
  };
  const model = new EchoModelAdapter(request => {
    timeouts.push(request.timeoutMs);
    return request.systemPrompt.includes('Supervisor') ? output.supervisor : request.systemPrompt.includes('Risk Analyst') ? output.risk : output.recovery;
  });
  await runDurableInvestigation(repository, model, job);
  expect(calls);
  assert.ok(timeouts.every(value => Number.isInteger(value) && value > 0 && value <= 9500), 'every model call must receive the shared remaining pipeline deadline');
}

(async () => {
  const infrastructurePolicy = { id: '00000000-0000-4000-8000-000000000005', enabled: true, minimumConfidence: 0.8, rootCauses: ['gateway_degraded'], allowedActions: ['auto_resolve_infrastructure'], merchantOptedIn: false };
  const fixtureEnrichment = { failureAttribution: 'gateway_degraded', gatewayHealthScore: 0.2, gatewayInDowntime: true, downtimeScheduled: false, crossBorderFlag: false, priorAttemptCount: 0, partialRecoveryPossible: false, recommendedRetryMethod: null, source: 'fixture_signed', enrichedAt: '2026-08-22T00:00:00.000Z', signalsUsed: ['fixture'] };
  await scenario({ enrichment: fixtureEnrichment, policy: infrastructurePolicy, metrics: { merchantFailureRate: 0.2, networkFailureRate: 1, customerIncidentCount: 0 }, output: { supervisor: supervisor(), risk: risk(), recovery: recovery() }, expect: calls => {
    assert.equal(calls[0][0], 'persist'); assert.equal(calls[0][1][6][0].actionType, 'auto_resolve_infrastructure');
    assert.equal(calls[0][1][3].toolResults.networkFailureRate, 1);
  } });
  await scenario({ enrichment: { ...fixtureEnrichment, crossBorderFlag: true }, policy: infrastructurePolicy, metrics: { merchantFailureRate: 0.2, networkFailureRate: 0.2, customerIncidentCount: 3 }, output: { supervisor: supervisor(), risk: risk('fraud_confirmed', 'strong'), recovery: recovery('flag_for_review') }, expect: calls => {
    assert.equal(calls[0][1][5].outcome, 'escalate'); assert.equal(calls[0][1][6].length, 0, 'fraud hard stop must persist no proposal');
  } });
  await scenario({ enrichment: null, policy: infrastructurePolicy, metrics: { merchantFailureRate: null, networkFailureRate: null, customerIncidentCount: null }, output: { supervisor: supervisor(true), risk: risk('unknown', 'weak'), recovery: recovery(null) }, expect: calls => {
    assert.equal(calls[0][1][2].requiresHumanReview, true); assert.ok(calls[0][1][3].missingEvidence.length >= 3);
  } });
  await scenario({ enrichment: fixtureEnrichment, policy: infrastructurePolicy, metrics: { merchantFailureRate: 0.2, networkFailureRate: 0.2, customerIncidentCount: 0 }, output: { supervisor: { invalid: true }, risk: risk(), recovery: recovery() }, expect: calls => {
    assert.equal(calls.length, 1); assert.equal(calls[0][0], 'failed', 'invalid structured model output must escalate without persisting a proposal');
  } });
  console.log('Phase 3 deterministic pipeline scenarios passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
