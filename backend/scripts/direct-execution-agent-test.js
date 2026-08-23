const assert = require('node:assert/strict');
const { EchoModelAdapter } = require('../dist/providers/model/echo-adapter');
const { runDurableInvestigation } = require('../dist/pipeline/investigation-runner');

const org = '00000000-0000-4000-8000-000000000001';
const incidentId = '00000000-0000-4000-8000-000000000002';
const event = { id: '00000000-0000-4000-8000-000000000003', organizationId: org, event: { eventId: 'evt_direct', eventType: 'payment.failed', occurredAt: '2026-08-23T00:00:00.000Z', receivedAt: '2026-08-23T00:00:00.000Z', customerHash: 'a'.repeat(64), paymentId: 'pay_1', amountPaise: 1000, currency: 'INR', paymentMethod: 'upi', providerData: {} }, enrichment: null };
const incident = { id: incidentId, organizationId: org, riskTier: 'MEDIUM', status: 'OPEN', totalFailedAmountPaise: 1000, recoveredAmountPaise: 0, remainingAmountPaise: 1000, correlatedEventIds: [event.id], openedAt: event.event.occurredAt, resolvedAt: null, updatedAt: event.event.occurredAt };
const enrichment = { failureAttribution: 'customer_drop', gatewayHealthScore: 0.9, gatewayInDowntime: false, downtimeScheduled: false, crossBorderFlag: false, priorAttemptCount: 0, partialRecoveryPossible: false, recommendedRetryMethod: null, source: 'fixture_signed', enrichedAt: event.event.occurredAt, signalsUsed: ['fixture'] };
const model = new EchoModelAdapter(request => request.systemPrompt.includes('Supervisor')
  ? { hypothesis: 'Retry by email', primaryFailureCategory: 'customer_error', objectives: ['Offer secure recovery link'], evidencePriorities: [{ fact: 'Payment failed', whyItMatters: 'A verified failure exists.' }], subAgents: [], constraints: ['No PII'], noActionCriteria: ['No opted-in email'], estimatedAutoResolvable: false, requiresNoActionFallback: true, confidence: 0.9, reasoning: 'Bounded evidence supports recovery.' }
  : request.systemPrompt.includes('Risk Analyst')
    ? { failureRootCause: 'customer_error', evidenceStrength: 'moderate', confidence: 0.9, causalNarrative: 'The failure has no fraud or dispute signal.', evidenceConfidenceRationale: 'Verified failure event is present.', alternativeHypotheses: [], falsePositiveCostEstimatePaise: 0, missingEvidence: [], chargebackEvidenceReady: false, evidenceItems: ['payment.failed'], recommendedActionCategory: 'propose_recovery' }
    : { proposedActions: [{ actionType: 'deliver_recovery_link_email', rationale: 'Offer a secure retry link.', preconditions: ['Eligible opted-in email exists'], expectedOutcome: 'SMTP acceptance is recorded and payment-link completion is reconciled.', estimatedRecoveryPaise: 1000, emailCopyIntent: 'Your payment could not be completed. Please use the secure link to try again. To opt out, reply stop.', requiresAutonomousExecution: true }], recoveryProbability: 0.7, confidence: 0.9 });
const retiredCapabilityModel = new EchoModelAdapter(request => request.systemPrompt.includes('Recovery Planner')
  ? { proposedActions: [{ actionType: 'retry_link_sms', rationale: 'This must be rejected before direct persistence.', preconditions: ['none'], expectedOutcome: 'none', estimatedRecoveryPaise: 1000, requiresAutonomousExecution: true }], recoveryProbability: 0.7, confidence: 0.9 }
  : request.systemPrompt.includes('Supervisor')
    ? { hypothesis: 'Legacy capability test', primaryFailureCategory: 'customer_error', objectives: ['Reject retired output'], evidencePriorities: [{ fact: 'Payment failed', whyItMatters: 'A verified failure exists.' }], subAgents: [], constraints: ['No PII'], noActionCriteria: ['No opted-in email'], estimatedAutoResolvable: false, requiresNoActionFallback: true, confidence: 0.9, reasoning: 'Bounded evidence supports validation.' }
    : { failureRootCause: 'customer_error', evidenceStrength: 'moderate', confidence: 0.9, causalNarrative: 'The failure has no fraud or dispute signal.', evidenceConfidenceRationale: 'Verified failure event is present.', alternativeHypotheses: [], falsePositiveCostEstimatePaise: 0, missingEvidence: [], chargebackEvidenceReady: false, evidenceItems: ['payment.failed'], recommendedActionCategory: 'propose_recovery' });

const calls = [];
const repository = {
  incidentDetail: async () => ({ incident, events: [{ ...event, enrichment }], proposals: [], investigation: null }),
  policyContext: async () => ({ policy: { id: '00000000-0000-4000-8000-000000000004', enabled: true, minimumConfidence: 0.8, rootCauses: ['customer_error'], allowedActions: ['deliver_recovery_link_email'], merchantOptedIn: true }, stats: { autoResolveFraction: 0.1 }, contact: { incidentAttempts: 0, attemptsLast24Hours: 0, attemptsLast7Days: 0, merchantOptedIn: true, customerReferenceAvailable: true } }),
  riskToolMetrics: async () => ({ merchantFailureRate: 0.1, networkFailureRate: 0.1, customerIncidentCount: 0 }),
  incidentMemory: async () => [{ type: 'execution', content: { priorOutcome: 'none' }, importance: 50, createdAt: event.event.occurredAt }],
  persistDirectInvestigation: async (...args) => calls.push(args),
  recordInvestigationUnavailable: async (...args) => calls.push(['failed', args]),
};

const job = { jobId: '00000000-0000-4000-8000-000000000005', organizationId: org, type: 'investigate_incident', attemptNumber: 1, createdAt: event.event.occurredAt, incidentId, triggerEventId: event.id };
runDurableInvestigation(repository, model, job, { directExecution: true })
  .then(async () => {
    assert.equal(calls.length, 1, JSON.stringify(calls)); assert.notEqual(calls[0][0], 'failed', JSON.stringify(calls)); assert.equal(calls[0][7][0].actionType, 'deliver_recovery_link_email'); assert.equal(calls[0][7][0].content.emailCopyIntent.includes('opt out'), true);
    await runDurableInvestigation(repository, retiredCapabilityModel, { ...job, jobId: '00000000-0000-4000-8000-000000000006' }, { directExecution: true });
    assert.equal(calls.at(-1)[0], 'failed', 'retired direct capability must become an audited unavailable outcome, not an outbox retry');
    console.log('Direct agent capability and memory-context checks passed.');
  })
  .catch(error => { console.error(error); process.exitCode = 1; });
