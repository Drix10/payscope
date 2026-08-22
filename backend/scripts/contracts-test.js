const assert = require('node:assert/strict');
const { createRuntimeConfig } = require('../dist/config/runtime-config');
const { ActionProposalSchema, AuditEntrySchema, IncidentSchema, PolicyDecisionSchema, RecoveryPlanSchema, VulcanEnrichmentSchema } = require('../dist/domain/contracts');
const { STOPPING_RULES } = require('../dist/config/stopping-rules');

const now = '2026-08-22T00:00:00.000Z';
const id = '00000000-0000-4000-8000-000000000001';

assert.equal(STOPPING_RULES.MAX_CONTACT_ATTEMPTS_PER_INCIDENT, 2);
assert.equal(STOPPING_RULES.MIN_HUMAN_REVIEW_FRACTION_PER_ORG_PER_DAY, 0.10);
assert.throws(() => createRuntimeConfig({ NODE_ENV: 'test', RAZORPAY_ENVIRONMENT: 'live' }), /Test Mode/);
assert.equal(createRuntimeConfig({ NODE_ENV: 'test' }).razorpayEnvironment, 'test');
assert.equal(VulcanEnrichmentSchema.safeParse({ failureAttribution: 'unknown', gatewayHealthScore: 0.5, gatewayInDowntime: false, downtimeScheduled: false, crossBorderFlag: false, priorAttemptCount: 0, partialRecoveryPossible: false, recommendedRetryMethod: null, source: 'fixture_signed', enrichedAt: now, signalsUsed: [] }).success, true);
assert.equal(RecoveryPlanSchema.safeParse({ proposedActions: [{ actionType: 'auto_resolve_infrastructure', rationale: 'Gateway downtime confirmed', estimatedRecoveryPaise: null, requiresOperatorApproval: true }], recoveryProbability: 0.5, confidence: 0.7 }).success, true);
assert.equal(RecoveryPlanSchema.safeParse({ proposedActions: [{ actionType: 'refund', rationale: 'No', estimatedRecoveryPaise: null, requiresOperatorApproval: true }], recoveryProbability: 0.5, confidence: 0.7 }).success, false);
assert.equal(IncidentSchema.safeParse({ id, organizationId: id, riskTier: 'MEDIUM', status: 'OPEN', totalFailedAmountPaise: 1000, recoveredAmountPaise: 300, remainingAmountPaise: 700, correlatedEventIds: [], openedAt: now, resolvedAt: null, updatedAt: now }).success, true);
assert.equal(IncidentSchema.safeParse({ id, organizationId: id, riskTier: 'MEDIUM', status: 'OPEN', totalFailedAmountPaise: 1000, recoveredAmountPaise: 300, remainingAmountPaise: 800, correlatedEventIds: [], openedAt: now, resolvedAt: null, updatedAt: now }).success, false);
const policyGates = ['fraud', 'dispute', 'auto_resolve_ceiling', 'human_review_floor', 'critical_tier', 'contact_limits', 'merchant_policy'].map(name => ({ name, result: 'passed', rationale: 'Test gate completed.' }));
assert.equal(PolicyDecisionSchema.safeParse({ outcome: 'auto_no_action', permittedActions: [], escalationReason: null, matchedPolicyId: null, gates: policyGates }).success, true);
assert.equal(ActionProposalSchema.safeParse({ id, organizationId: id, incidentId: id, actionType: 'flag_for_review', content: {}, status: 'pending', proposedAt: now, approvedAt: null, approvedBy: null, deliveryResult: null }).success, true);
assert.equal(AuditEntrySchema.safeParse({ id, organizationId: id, incidentId: null, sequenceNumber: 0, eventType: 'audit_genesis', actorType: 'system', actorId: 'payscope', actorSessionHash: null, decision: 'audit_chain_initialized', rationale: 'Organization audit chain initialized', confidence: null, enrichmentSnapshot: null, prevEntryHash: 'a'.repeat(64), entryHash: 'b'.repeat(64), createdAt: now }).success, true);
console.log('Canonical MVP contract checks passed.');
