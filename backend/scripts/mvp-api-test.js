const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createMvpRouter } = require('../dist/api/mvp-router');

const organizationId = '00000000-0000-4000-8000-000000000001';
const incidentId = '00000000-0000-4000-8000-000000000002';
const calls = [];
const repository = {
  async healthCheck(org) { calls.push(['health', org]); },
  async listIncidents(org, limit, status) { calls.push(['list', org, limit, status]); return []; },
  async incidentDetail(org, id) {
    calls.push(['detail', org, id]);
    if (id !== incidentId) throw new Error('Incident was not found');
    return { incident: { id }, events: [{ id: 'evt-private', organizationId: org, event: { eventType: 'payment.failed', occurredAt: '2026-08-22T00:00:00.000Z', receivedAt: '2026-08-22T00:00:00.000Z', amountPaise: 100, paymentMethod: 'upi', paymentId: 'pay_internal', customerHash: 'a'.repeat(64), providerData: { rrn: 'internal-reference' } }, enrichment: null, enrichmentSource: 'unavailable' }], proposals: [], investigation: null };
  },
  async auditEntries(org, id) { calls.push(['audit', org, id]); return [{ id: '00000000-0000-4000-8000-000000000010', organizationId: org, incidentId: id, sequenceNumber: 1, eventType: 'investigation_completed', actorType: 'system', actorId: 'worker', actorSessionHash: 'a'.repeat(64), decision: 'auto_no_action', rationale: 'Safe test rationale.', confidence: 0.8, enrichmentSnapshot: { source: 'fixture_signed', private: 'not-for-browser' }, prevEntryHash: 'b'.repeat(64), entryHash: 'c'.repeat(64), createdAt: '2026-08-22T00:00:00.000Z' }]; },
  async auditIntegrity(org) { calls.push(['integrity', org]); return { status: 'intact', entryCount: 1, checkedAt: '2026-08-22T00:00:00.000Z' }; },
  async dashboardMetrics(org) { calls.push(['metrics', org]); return { operations: { totalAtRiskPaise: 100, proposalsGenerated: 1, proposalsSimulated: 0, attributedRecoveries: null, recoveredPaise: null, recoveryRate: null, contactToRecoveryRatio: null }, evaluation: { status: 'not_run', split: null, fixtureSetVersion: null, runAt: null, configurationHash: null, modelId: null, sampleCount: 0, precision: null, recall: null, f1: null, falsePositiveCostPaise: null }, exceptions: ['No COD/RTO decisioning', 'No dispute outreach', 'No fraud outreach', 'No-policy no action', 'Communications simulated', 'Causal simulated-action recovery evidence'] }; },
  async dashboardQuery(org, query, limit) { calls.push(['query', org, query, limit]); return { query, interpretation: 'Tenant-scoped read-only test response.', matchedIncidentCount: 0, matchedRemainingAmountPaise: 0, incidents: [], limitations: ['Read-only tenant summary.', 'No action is available.'] }; },
};
const app = express();
app.use(express.json());
app.use('/api/mvp', createMvpRouter(repository, organizationId, { enrichmentAdapter: 'razorpay_fields_heuristic', razorpayEnvironment: 'live', directExecutionEnabled: false, directExecutionReady: () => false }));

function request(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); resolve({ status: response.statusCode, body: text.startsWith('{') ? JSON.parse(text) : null }); });
    });
    req.on('error', reject); req.end();
  });
}

(async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;
  try {
    const health = await request(port, '/api/mvp/health');
    assert.equal(health.status, 200); assert.equal(health.body.data.pipeline, 'autonomous'); assert.equal(health.body.data.razorpayEnvironment, 'live'); assert.equal(health.body.data.communications, 'autonomous_simulation'); assert.deepEqual(calls.shift(), ['health', organizationId]);
    const list = await request(port, '/api/mvp/incidents?limit=2');
    assert.equal(list.status, 200); assert.deepEqual(calls.shift(), ['list', organizationId, 2, undefined]);
    const filtered = await request(port, '/api/mvp/incidents?status=OPEN');
    assert.equal(filtered.status, 200); assert.deepEqual(calls.shift(), ['list', organizationId, 100, 'OPEN']);
    for (const path of ['/api/mvp/incidents?limit=0', '/api/mvp/incidents?status=RETIRED', '/api/mvp/incidents/not-a-uuid', '/api/mvp/audit?incidentId=not-a-uuid']) {
      const result = await request(port, path);
      assert.equal(result.status, 400, path); assert.equal(result.body.error.code, 'INVALID_REQUEST', path);
    }
    const missing = await request(port, '/api/mvp/incidents/00000000-0000-4000-8000-000000000003');
    assert.equal(missing.status, 404); assert.equal(missing.body.error.code, 'INCIDENT_NOT_FOUND');
    const detail = await request(port, `/api/mvp/incidents/${incidentId}`);
    assert.equal(detail.status, 200); assert.equal(detail.body.data.events[0].event.paymentId, undefined);
    assert.equal(JSON.stringify(detail.body.data).includes('internal-reference'), false);
    assert.equal(JSON.stringify(detail.body.data).includes('customerHash'), false);
    const audit = await request(port, `/api/mvp/audit?incidentId=${incidentId}`);
    assert.equal(audit.status, 200); assert.equal(audit.body.data[0].actorSessionHash, undefined);
    assert.equal(audit.body.data[0].entryHash, undefined); assert.equal(JSON.stringify(audit.body.data).includes('not-for-browser'), false);
    const integrity = await request(port, '/api/mvp/audit/integrity');
    assert.equal(integrity.status, 200); assert.equal(integrity.body.data.status, 'intact');
    const metrics = await request(port, '/api/mvp/dashboard/metrics');
    assert.equal(metrics.status, 200); assert.equal(metrics.body.data.operations.proposalsSimulated, 0);
    const dashboard = await request(port, '/api/mvp/dashboard/query?q=show%20open%20incidents&limit=5');
    assert.equal(dashboard.status, 200); assert.deepEqual(calls.at(-1), ['query', organizationId, 'show open incidents', 5]);
    const retiredRoute = await request(port, `/api/mvp/proposals/${incidentId}/approve`);
    assert.equal(retiredRoute.status, 404, 'the retired action route must not be mounted');
    const unavailableApp = express();
    unavailableApp.use('/api/mvp', createMvpRouter(repository, organizationId, { enrichmentAdapter: 'razorpay_fields_heuristic', razorpayEnvironment: 'live', directExecutionEnabled: true, directExecutionReady: () => false }));
    const unavailableServer = unavailableApp.listen(0, '127.0.0.1');
    await new Promise(resolve => unavailableServer.once('listening', resolve));
    try {
      const unavailable = await request(unavailableServer.address().port, '/api/mvp/health');
      assert.equal(unavailable.status, 503); assert.equal(unavailable.body.data.communications, 'email_execution_unavailable');
    } finally { await new Promise(resolve => unavailableServer.close(resolve)); }
    console.log('Read-only autonomous MVP API request-boundary checks passed.');
  } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
