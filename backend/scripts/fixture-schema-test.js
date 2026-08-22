const assert = require('node:assert/strict');
const { signFixture, verifyFixture } = require('../dist/fixtures/schema');
const secret = 'fixture-signing-secret-must-be-at-least-32-chars';
const fixture = signFixture({ id: '00000000-0000-4000-8000-000000000001', fixtureSet: 'development', organizationId: '00000000-0000-4000-8000-000000000002', event: { eventId: 'fixture-event', eventType: 'payment.failed', occurredAt: '2026-08-22T00:00:00.000Z', receivedAt: '2026-08-22T00:00:00.000Z', amountPaise: 100, providerData: {} }, enrichment: null, expected: { incidentStatus: 'ESCALATED', groundTruth: 'fraud' } }, secret);
assert.equal(verifyFixture(fixture, secret, 'development').id, fixture.id);
assert.throws(() => verifyFixture({ ...fixture, expected: { ...fixture.expected, groundTruth: 'not_fraud' } }, secret));
assert.throws(() => verifyFixture(fixture, secret, 'held_out'));
console.log('Signed fixture schema checks passed.');
