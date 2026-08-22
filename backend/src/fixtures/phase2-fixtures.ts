import { SignedFixture, signFixture } from './schema';

const ORG = '00000000-0000-4000-8000-000000000001';
const TIME = '2026-08-22T00:00:00.000Z';

const enrichment = (overrides: Record<string, unknown> = {}) => ({
  failureAttribution: 'unknown' as const, gatewayHealthScore: 1, gatewayInDowntime: false,
  downtimeScheduled: false, crossBorderFlag: false, priorAttemptCount: 0,
  partialRecoveryPossible: false, recommendedRetryMethod: null, source: 'fixture_signed' as const,
  enrichedAt: TIME, signalsUsed: [], ...overrides,
});

/** Signed, PII-free Phase 2 fixture sets. Set A models infrastructure paths;
 * Set B models fraud/dispute paths. The caller supplies the fixture-only key. */
export function createPhase2Fixtures(secret: string): { setA: SignedFixture[]; setB: SignedFixture[] } {
  const setA = [
    { id: '00000000-0000-4000-8000-000000000101', eventId: 'fixture-a-failure-1', eventType: 'payment.failed', orderId: 'fixture-order-a', amountPaise: 1_000, occurredAt: TIME, expected: { incidentStatus: 'OPEN' as const, groundTruth: 'not_fraud' as const }, enrichment: enrichment({ failureAttribution: 'gateway_degraded', gatewayHealthScore: 0.2, gatewayInDowntime: true, recommendedRetryMethod: 'netbanking', signalsUsed: ['error_source', 'downtimes'] }) },
    { id: '00000000-0000-4000-8000-000000000102', eventId: 'fixture-a-failure-2', eventType: 'payment.failed', orderId: 'fixture-order-a', amountPaise: 1_000, occurredAt: '2026-08-22T00:01:00.000Z', expected: { incidentStatus: 'OPEN' as const, groundTruth: 'not_fraud' as const }, enrichment: enrichment({ failureAttribution: 'gateway_degraded', gatewayHealthScore: 0.2, gatewayInDowntime: true }) },
    { id: '00000000-0000-4000-8000-000000000103', eventId: 'fixture-a-partial', eventType: 'payment.captured', orderId: 'fixture-order-a', amountPaise: 400, occurredAt: '2026-08-22T00:02:00.000Z', expected: { incidentStatus: 'MONITORING' as const, groundTruth: 'not_fraud' as const }, enrichment: enrichment() },
    { id: '00000000-0000-4000-8000-000000000104', eventId: 'fixture-a-full', eventType: 'payment.captured', orderId: 'fixture-order-a', amountPaise: 1_600, occurredAt: '2026-08-22T00:03:00.000Z', expected: { incidentStatus: 'RESOLVED' as const, groundTruth: 'not_fraud' as const }, enrichment: enrichment() },
    { id: '00000000-0000-4000-8000-000000000105', eventId: 'fixture-a-customer', eventType: 'payment.failed', orderId: 'fixture-order-customer', amountPaise: 500, occurredAt: '2026-08-22T00:05:00.000Z', expected: { incidentStatus: 'OPEN' as const, groundTruth: 'not_fraud' as const }, enrichment: enrichment({ failureAttribution: 'customer_drop' }) },
    { id: '00000000-0000-4000-8000-000000000106', eventId: 'fixture-a-out-of-order', eventType: 'payment.failed', orderId: 'fixture-order-late', amountPaise: 300, occurredAt: '2026-08-22T00:10:00.000Z', receivedAt: '2026-08-22T00:09:00.000Z', expected: { incidentStatus: 'OPEN' as const, groundTruth: 'not_fraud' as const }, enrichment: enrichment({ failureAttribution: 'issuer_timeout' }) },
  ].map(value => signFixture({ id: value.id, fixtureSet: 'development', organizationId: ORG, event: { eventId: value.eventId, eventType: value.eventType, occurredAt: value.occurredAt, receivedAt: value.receivedAt ?? value.occurredAt, orderId: value.orderId, amountPaise: value.amountPaise, currency: 'INR', paymentStatus: value.eventType === 'payment.captured' ? 'captured' : 'failed', paymentMethod: 'upi', providerData: {} }, enrichment: value.enrichment, expected: value.expected }, secret));
  const setB = [
    { id: '00000000-0000-4000-8000-000000000201', eventId: 'fixture-b-fraud', eventType: 'payment.failed', orderId: 'fixture-order-fraud', amountPaise: 900, expected: { incidentStatus: 'OPEN' as const, groundTruth: 'fraud' as const }, enrichment: enrichment({ failureAttribution: 'fraud_block', priorAttemptCount: 3, signalsUsed: ['error_reason'] }) },
    { id: '00000000-0000-4000-8000-000000000202', eventId: 'fixture-b-cross-border', eventType: 'payment.failed', orderId: 'fixture-order-cross-border', amountPaise: 700, expected: { incidentStatus: 'OPEN' as const, groundTruth: 'fraud' as const }, enrichment: enrichment({ crossBorderFlag: true, signalsUsed: ['international'] }) },
    { id: '00000000-0000-4000-8000-000000000203', eventId: 'fixture-b-dispute', eventType: 'payment.dispute.created', orderId: 'fixture-order-fraud', amountPaise: 900, expected: { incidentStatus: 'DISPUTE_OPENED' as const, groundTruth: 'fraud' as const }, enrichment: enrichment({ failureAttribution: 'fraud_block' }) },
  ].map(value => signFixture({ id: value.id, fixtureSet: 'held_out', organizationId: ORG, event: { eventId: value.eventId, eventType: value.eventType, occurredAt: TIME, receivedAt: TIME, orderId: value.orderId, amountPaise: value.amountPaise, currency: 'INR', paymentStatus: value.eventType === 'payment.dispute.created' ? 'created' : 'failed', paymentMethod: 'card', providerData: {} }, enrichment: value.enrichment, expected: value.expected }, secret));
  return { setA, setB };
}
