import { createEvaluationFixtureSet } from './evaluation-fixture-factory';
import { SignedFixture } from './schema';

/** Development corpus: 300 signed fixtures used to tune deterministic rules. */
export function createDevelopmentFixtures(secret: string): SignedFixture[] {
  return createEvaluationFixtureSet('development', 10_000, 300, secret);
}
