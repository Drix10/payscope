const assert = require('node:assert/strict');
const { PipelineJobProcessor } = require('../dist/pipeline/job-processor');

const org = '00000000-0000-4000-8000-000000000001';
const id = '00000000-0000-4000-8000-000000000010';
const event = { id, organizationId: org, event: { eventId: 'evt', eventType: 'payment.failed', occurredAt: '2026-08-22T00:00:00.000Z', receivedAt: '2026-08-22T00:00:00.000Z', orderId: 'order', amountPaise: 1000, currency: 'INR', providerData: {} }, enrichment: null };
const calls = [];
const repository = {
  eventById: async () => event,
  completeEnrichmentAndEnqueueCorrelation: async (_event, enrichment) => calls.push(['enriched', enrichment]),
  correlationCandidates: async () => [],
  persistCorrelation: async (_event, incident, enqueue) => calls.push(['correlated', incident.status, enqueue]),
};
const enrichment = { enrich: async () => ({ failureAttribution: 'unknown', gatewayHealthScore: 1, gatewayInDowntime: false, downtimeScheduled: false, crossBorderFlag: false, priorAttemptCount: 0, partialRecoveryPossible: false, recommendedRetryMethod: null, source: 'fixture_signed', enrichedAt: '2026-08-22T00:00:00.000Z', signalsUsed: [] }), isAvailable: async () => true };
const processor = new PipelineJobProcessor(repository, enrichment, async job => calls.push(['investigate', job.incidentId]));
(async () => {
  await processor.process({ jobId: '00000000-0000-4000-8000-000000000020', organizationId: org, type: 'enrich_event', attemptNumber: 1, createdAt: '2026-08-22T00:00:00.000Z', eventId: id });
  await processor.process({ jobId: '00000000-0000-4000-8000-000000000021', organizationId: org, type: 'correlate_event', attemptNumber: 1, createdAt: '2026-08-22T00:00:00.000Z', eventId: id });
  assert.equal(calls[0][0], 'enriched');
  assert.deepEqual(calls[1], ['correlated', 'OPEN', true]);
  await processor.process({ jobId: '00000000-0000-4000-8000-000000000022', organizationId: org, type: 'investigate_incident', attemptNumber: 1, createdAt: '2026-08-22T00:00:00.000Z', incidentId: id, triggerEventId: id });
  assert.deepEqual(calls[2], ['investigate', id]);
  console.log('Agentic MVP job processor checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
