import { SignedFixture, signFixture } from './schema';

export const EVALUATION_FIXTURE_VERSION = 'synthetic-fixtures-v1';
export const EVALUATION_ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';
const BASE_TIME_MS = Date.parse('2026-08-01T00:00:00.000Z');

/**
 * Produces a reproducible, PII-free fixture corpus. The development and
 * held-out modules call this independently with non-overlapping UUID ranges;
 * no held-out fixture is read by the development runner.
 */
export function createEvaluationFixtureSet(
  fixtureSet: 'development' | 'held_out',
  startOrdinal: number,
  count: number,
  secret: string,
): SignedFixture[] {
  return Array.from({ length: count }, (_, offset) => createFixture(fixtureSet, startOrdinal + offset, secret));
}

function createFixture(fixtureSet: 'development' | 'held_out', ordinal: number, secret: string): SignedFixture {
  const pattern = ordinal % 10;
  const fraud = pattern <= 2;
  const falsePositive = pattern === 3;
  const crossBorder = pattern === 1;
  const fraudSignal = pattern === 0 || falsePositive;
  const occurredAt = new Date(BASE_TIME_MS + ordinal * 60_000).toISOString();
  const amountPaise = 100 + ((ordinal * 137) % 25_000);
  const id = `00000000-0000-4000-8000-${ordinal.toString().padStart(12, '0')}`;
  const enrichment = {
    failureAttribution: fraudSignal ? 'fraud_block' as const : crossBorder ? 'unknown' as const : pattern % 2 ? 'issuer_timeout' as const : 'gateway_degraded' as const,
    gatewayHealthScore: pattern % 2 ? 0.8 : 0.2,
    gatewayInDowntime: !fraud && !falsePositive && pattern % 2 === 0,
    downtimeScheduled: false,
    crossBorderFlag: crossBorder,
    priorAttemptCount: crossBorder ? 3 : pattern === 2 ? 1 : 0,
    partialRecoveryPossible: false,
    recommendedRetryMethod: !fraud && !falsePositive ? 'upi' : null,
    source: 'fixture_signed' as const,
    enrichedAt: occurredAt,
    signalsUsed: fraudSignal ? ['fixture_fraud_signal'] : crossBorder ? ['fixture_cross_border', 'fixture_attempt_pattern'] : ['fixture_gateway_or_issuer_signal'],
  };
  return signFixture({
    id,
    fixtureSet,
    organizationId: EVALUATION_ORGANIZATION_ID,
    event: {
      eventId: `${fixtureSet}-evaluation-${ordinal}`,
      eventType: 'payment.failed',
      occurredAt,
      receivedAt: occurredAt,
      orderId: `${fixtureSet}-order-${ordinal}`,
      amountPaise,
      currency: 'INR',
      paymentStatus: 'failed',
      paymentMethod: 'card',
      providerData: {},
    },
    enrichment,
    expected: { incidentStatus: fraud ? 'DISMISSED' : 'OPEN', groundTruth: fraud ? 'fraud' : 'not_fraud' },
  }, secret);
}
