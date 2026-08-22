import { createEvaluationFixtureSet } from './evaluation-fixture-factory';
import { SignedFixture } from './schema';

/** Held-out corpus: 200 separately-addressed signed fixtures. Do not tune on it. */
export function createHeldOutFixtures(secret: string): SignedFixture[] {
  return createEvaluationFixtureSet('held_out', 20_000, 200, secret);
}
