import { createHash } from 'crypto';
import { EVALUATION_FIXTURE_VERSION } from '../fixtures/evaluation-fixture-factory';
import { SignedFixture, verifyFixture } from '../fixtures/schema';
import { calculateEvaluationMetrics } from './metrics';

export type FixtureEvaluationReport = {
  split: 'development' | 'held_out';
  fixtureSetVersion: string;
  runAt: string;
  configurationHash: string;
  modelId: string;
  sampleCount: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  falsePositiveCostPaise: number | null;
};

export const FIXTURE_EVALUATION_MODEL_ID = 'fixture-deterministic-baseline-v1';

/** Runs the locked deterministic baseline only over one verified corpus split. */
export function runFixtureEvaluation(fixtures: readonly unknown[], secret: string, split: 'development' | 'held_out', runAt = new Date().toISOString()): FixtureEvaluationReport {
  const verified = fixtures.map(fixture => verifyFixture(fixture, secret, split));
  if (!verified.length) throw new Error('Fixture evaluation requires at least one verified fixture');
  const metrics = calculateEvaluationMetrics(verified.map(fixture => {
    if (fixture.event.amountPaise === undefined) throw new Error(`Fixture ${fixture.id} has no evaluation amount`);
    return { id: fixture.id, groundTruth: fixture.expected.groundTruth, predictedFraud: predictedFraud(fixture), amountPaise: fixture.event.amountPaise };
  }));
  const report: FixtureEvaluationReport = {
    split,
    fixtureSetVersion: EVALUATION_FIXTURE_VERSION,
    runAt,
    configurationHash: evaluationConfigurationHash(verified),
    modelId: FIXTURE_EVALUATION_MODEL_ID,
    sampleCount: verified.length,
    precision: metricOrNull(metrics.precision),
    recall: metricOrNull(metrics.recall),
    f1: metricOrNull(metrics.f1),
    falsePositiveCostPaise: metrics.falsePositiveCostPaise,
  };
  if (report.precision === null || report.recall === null || report.f1 === null || report.falsePositiveCostPaise === null) {
    throw new Error('Fixture corpus did not provide enough classes for a complete evaluation report');
  }
  return report;
}

/** The baseline is explicit and auditable; it is not an inferred merchant outcome. */
export function predictedFraud(fixture: SignedFixture): boolean {
  return fixture.enrichment?.failureAttribution === 'fraud_block'
    || Boolean(fixture.enrichment?.crossBorderFlag && fixture.enrichment.priorAttemptCount >= 2);
}

function metricOrNull(value: number | 'not_available'): number | null { return typeof value === 'number' ? value : null; }
function evaluationConfigurationHash(fixtures: readonly SignedFixture[]): string {
  const corpusHash = createHash('sha256').update(canonicalJson(fixtures.map(withoutSignature))).digest('hex');
  return createHash('sha256').update(canonicalJson({ fixtureVersion: EVALUATION_FIXTURE_VERSION, corpusHash, baseline: 'fraud_block_or_cross_border_with_two_prior_attempts' })).digest('hex');
}

function withoutSignature(fixture: SignedFixture): Omit<SignedFixture, 'signature'> {
  const { signature: _signature, ...unsigned } = fixture;
  return unsigned;
}
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}
