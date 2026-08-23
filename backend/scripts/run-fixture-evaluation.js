/* Explicitly records a versioned fixture report. Development may run repeatedly;
 * held-out is database-enforced once per fixture version. */
require('dotenv/config');
const { createDevelopmentFixtures } = require('../dist/fixtures/development-fixtures');
const { createHeldOutFixtures } = require('../dist/fixtures/held-out-fixtures');
const { runFixtureEvaluation } = require('../dist/evaluation/run-evaluation');
const { requireDatabaseClient } = require('../dist/db/client');
const { MvpRepository } = require('../dist/db/mvp-repository');

if (process.env.PAYSCOPE_RUN_EVALUATION !== 'true') {
  console.log('Skipped fixture evaluation recording (set PAYSCOPE_RUN_EVALUATION=true for Supabase).');
  process.exit(0);
}
const organizationId = process.env.PAYSCOPE_ORGANIZATION_ID;
const secret = process.env.PAYSCOPE_FIXTURE_SIGNING_SECRET;
const split = process.env.PAYSCOPE_EVALUATION_SPLIT === 'held_out' ? 'held_out' : 'development';
if (!organizationId) throw new Error('PAYSCOPE_ORGANIZATION_ID is required to record an evaluation report.');
if (!secret || secret.length < 32) throw new Error('PAYSCOPE_FIXTURE_SIGNING_SECRET must be at least 32 characters.');

(async () => {
  const fixtures = split === 'held_out' ? createHeldOutFixtures(secret) : createDevelopmentFixtures(secret);
  const report = runFixtureEvaluation(fixtures, secret, split);
  const recorded = await new MvpRepository(requireDatabaseClient()).recordFixtureEvaluationReport(organizationId, report);
  console.log(JSON.stringify({ split: recorded.split, fixtureSetVersion: recorded.fixtureSetVersion, sampleCount: recorded.sampleCount, precision: recorded.precision, recall: recorded.recall, f1: recorded.f1, falsePositiveCostPaise: recorded.falsePositiveCostPaise }, null, 2));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
