const assert = require('node:assert/strict');
const { createPhase2Fixtures } = require('../dist/fixtures/phase2-fixtures');
const { verifyFixture } = require('../dist/fixtures/schema');
const { correlateEvent } = require('../dist/pipeline/correlation-engine');

const secret = 'payscope-phase-two-fixture-signing-key-32';
const org = '00000000-0000-4000-8000-000000000001';
const { setA, setB } = createPhase2Fixtures(secret);
for (const fixture of [...setA, ...setB]) verifyFixture(fixture, secret, fixture.fixtureSet);

let incident;
let events = [];
for (const fixture of setA.slice(0, 4)) {
  const result = correlateEvent({ id: fixture.id, event: fixture.event, enrichment: fixture.enrichment }, incident ? [{ incident, events }] : [], org, () => '00000000-0000-4000-8000-000000000999');
  assert.ok(result, `fixture ${fixture.event.eventId} must correlate`);
  incident = result.incident;
  events = [...events, { id: fixture.id, event: fixture.event, enrichment: fixture.enrichment }];
  assert.equal(incident.status, fixture.expected.incidentStatus);
}
assert.equal(incident.correlatedEventIds.length, 4, 'three related failures/recoveries remain one incident timeline');
assert.equal(incident.riskTier, 'MONITOR', 'infrastructure fixtures remain MONITOR or MEDIUM');
for (const fixture of setB.slice(0, 2)) {
  const result = correlateEvent({ id: fixture.id, event: fixture.event, enrichment: fixture.enrichment }, [], org, () => fixture.id);
  assert.ok(result); assert.ok(['HIGH', 'CRITICAL'].includes(result.incident.riskTier));
}
const fraud = setB[0]; const dispute = setB[2];
const fraudIncident = correlateEvent({ id: fraud.id, event: fraud.event, enrichment: fraud.enrichment }, [], org, () => '00000000-0000-4000-8000-000000000998').incident;
const disputed = correlateEvent({ id: dispute.id, event: dispute.event, enrichment: dispute.enrichment }, [{ incident: fraudIncident, events: [{ id: fraud.id, event: fraud.event, enrichment: fraud.enrichment }] }], org);
assert.equal(disputed.incident.status, 'DISPUTE_OPENED'); assert.equal(disputed.incident.riskTier, 'CRITICAL');
console.log('Signed Phase 2 infrastructure/fraud fixture correlation checks passed.');
