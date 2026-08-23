const assert = require('node:assert/strict');
const { attributeRecoveries, paymentLinkReferenceForProposal } = require('../dist/evaluation/attribution');

const incidentId = '00000000-0000-4000-8000-000000000111';
const proposalId = '00000000-0000-4000-8000-000000000112';
const secondProposalId = '00000000-0000-4000-8000-000000000113';
const simulatedAt = '2026-08-23T00:00:00.000Z';
const proposal = { id: proposalId, incidentId, actionType: 'retry_link_sms', status: 'simulated', simulatedAt };
const result = attributeRecoveries([{ id: incidentId, totalFailedAmountPaise: 1_000 }], [proposal], [
  { eventId: 'capture-1', incidentId, capturedAt: '2026-08-23T01:00:00.000Z', amountPaise: 600, paymentLinkReferenceId: null, disputeOpenedBeforeCapture: false },
  { eventId: 'capture-2', incidentId: null, capturedAt: '2026-08-23T02:00:00.000Z', amountPaise: 600, paymentLinkReferenceId: paymentLinkReferenceForProposal(proposalId), disputeOpenedBeforeCapture: false },
]);
assert.deepEqual(result, [
  { eventId: 'capture-1', proposalId, incidentId, recoveredPaise: 600 },
  { eventId: 'capture-2', proposalId, incidentId, recoveredPaise: 400 },
]);
assert.equal(attributeRecoveries([{ id: incidentId, totalFailedAmountPaise: 1_000 }], [proposal], [
  { eventId: 'late', incidentId, capturedAt: '2026-08-24T00:00:00.001Z', amountPaise: 1, paymentLinkReferenceId: null, disputeOpenedBeforeCapture: false },
]).length, 0, 'captures after 24 hours cannot be attributed');
assert.equal(attributeRecoveries([{ id: incidentId, totalFailedAmountPaise: 1_000 }], [{ ...proposal, status: 'pending' }], [
  { eventId: 'unapproved', incidentId, capturedAt: '2026-08-23T01:00:00.000Z', amountPaise: 1, paymentLinkReferenceId: null, disputeOpenedBeforeCapture: false },
]).length, 0, 'simulation is mandatory');
assert.equal(attributeRecoveries([{ id: incidentId, totalFailedAmountPaise: 1_000 }], [proposal], [
  { eventId: 'disputed', incidentId, capturedAt: '2026-08-23T01:00:00.000Z', amountPaise: 1, paymentLinkReferenceId: null, disputeOpenedBeforeCapture: true },
]).length, 0, 'a disputed incident cannot claim recovery');
assert.equal(attributeRecoveries([{ id: incidentId, totalFailedAmountPaise: 1_000 }], [{ ...proposal, id: secondProposalId, actionType: 'flag_for_review' }], [
  { eventId: 'not-recovery', incidentId, capturedAt: '2026-08-23T01:00:00.000Z', amountPaise: 1, paymentLinkReferenceId: null, disputeOpenedBeforeCapture: false },
]).length, 0, 'review-only proposals cannot claim recovery');
assert.throws(() => attributeRecoveries([{ id: incidentId, totalFailedAmountPaise: 1_000 }], [proposal], [
  { eventId: 'duplicate', incidentId, capturedAt: '2026-08-23T01:00:00.000Z', amountPaise: 1, paymentLinkReferenceId: null, disputeOpenedBeforeCapture: false },
  { eventId: 'duplicate', incidentId, capturedAt: '2026-08-23T01:01:00.000Z', amountPaise: 1, paymentLinkReferenceId: null, disputeOpenedBeforeCapture: false },
]));
console.log('Recovery attribution rule checks passed.');
