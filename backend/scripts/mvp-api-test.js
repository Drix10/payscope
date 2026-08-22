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
  async incidentDetail(org, id) { calls.push(['detail', org, id]); if (id !== incidentId) throw new Error('Incident was not found'); return { incident: { id }, events: [{ id: 'evt-private', organizationId: org, event: { eventType: 'payment.failed', occurredAt: '2026-08-22T00:00:00.000Z', receivedAt: '2026-08-22T00:00:00.000Z', amountPaise: 100, paymentMethod: 'upi', paymentId: 'pay_internal', customerHash: 'a'.repeat(64), providerData: { rrn: 'internal-reference' } }, enrichment: null, enrichmentSource: 'unavailable' }], proposals: [], investigation: null }; },
  async auditEntries(org, id) { calls.push(['audit', org, id]); return [{ id: '00000000-0000-4000-8000-000000000010', organizationId: org, incidentId: id, sequenceNumber: 1, eventType: 'investigation_completed', actorType: 'system', actorId: 'worker', actorSessionHash: 'a'.repeat(64), decision: 'auto_no_action', rationale: 'Safe test rationale.', confidence: 0.8, enrichmentSnapshot: { source: 'fixture_signed', private: 'not-for-browser' }, prevEntryHash: 'b'.repeat(64), entryHash: 'c'.repeat(64), createdAt: '2026-08-22T00:00:00.000Z' }]; },
  async auditIntegrity(org) { calls.push(['integrity', org]); return { status: 'intact', entryCount: 1, checkedAt: '2026-08-22T00:00:00.000Z' }; },
  async dashboardMetrics(org) { calls.push(['metrics', org]); return { operations: { totalAtRiskPaise: 100, proposalsGenerated: 1, proposalsApproved: 0, attributedRecoveries: null, recoveredPaise: null, recoveryRate: null, contactToRecoveryRatio: null }, evaluation: { status: 'not_run', split: null, fixtureSetVersion: null, runAt: null, configurationHash: null, modelId: null, sampleCount: 0, precision: null, recall: null, f1: null, falsePositiveCostPaise: null }, exceptions: ['COD/RTO unavailable', 'No dispute outreach', 'No fraud outreach', 'Human review for unmatched policy', 'Communications simulated', 'Test Mode recovery simulated'] }; },
  async dashboardQuery(org, query, limit) { calls.push(['query', org, query, limit]); return { query, interpretation: 'Tenant-scoped read-only test response.', matchedIncidentCount: 0, matchedRemainingAmountPaise: 0, incidents: [], limitations: ['Read-only tenant summary.', 'No action is available.'] }; },
  async proposalById(org, id) { calls.push(['proposal', org, id]); return { id, organizationId: org, incidentId, actionType: 'flag_for_review', content: {}, status: 'pending', proposedAt: '2026-08-22T00:00:00.000Z', approvedAt: null, approvedBy: null, deliveryResult: null }; },
  async approveProposal(org, id, actor, hash, delivery) { calls.push(['approve', org, id, actor, hash, delivery]); return { id, organizationId: org, incidentId, actionType: 'flag_for_review', content: {}, status: 'simulated', proposedAt: '2026-08-22T00:00:00.000Z', approvedAt: '2026-08-22T00:01:00.000Z', approvedBy: null, deliveryResult: delivery }; },
};
const app = express();
app.use(express.json());
app.use('/api/mvp', createMvpRouter(repository, organizationId, { approvalToken: 'test-approval-token', approvalActorId: 'demo-operator', enrichmentAdapter: 'razorpay_fields_heuristic', communications: { async executeApprovedAction() { return { status: 'simulated', note: 'No delivery sent.', simulatedAt: '2026-08-22T00:01:00.000Z' }; } } }));

function request(port, path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: options.method || 'GET', headers: options.headers }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
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
    assert.equal(health.status, 200); assert.equal(health.body.data.database, 'ready'); assert.deepEqual(calls.shift(), ['health', organizationId]);
    const list = await request(port, '/api/mvp/incidents?limit=2');
    assert.equal(list.status, 200); assert.deepEqual(calls.shift(), ['list', organizationId, 2, undefined]);
    const filtered = await request(port, '/api/mvp/incidents?status=OPEN');
    assert.equal(filtered.status, 200); assert.deepEqual(calls.shift(), ['list', organizationId, 100, 'OPEN']);
    for (const path of ['/api/mvp/incidents?limit=0', '/api/mvp/incidents?limit=101', '/api/mvp/incidents?limit=abc', '/api/mvp/incidents/not-a-uuid', '/api/mvp/audit?incidentId=not-a-uuid']) {
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
    assert.equal(metrics.status, 200); assert.equal(metrics.body.data.operations.recoveredPaise, null); assert.deepEqual(calls.at(-1), ['metrics', organizationId]);
    const dashboard = await request(port, '/api/mvp/dashboard/query?q=show%20open%20incidents&limit=5');
    assert.equal(dashboard.status, 200); assert.deepEqual(calls.at(-1), ['query', organizationId, 'show open incidents', 5]);
    for (const path of ['/api/mvp/dashboard/query', '/api/mvp/dashboard/query?q=', '/api/mvp/dashboard/query?q=open&limit=0', '/api/mvp/dashboard/query?q=open&limit=21']) {
      const result = await request(port, path);
      assert.equal(result.status, 400, path); assert.equal(result.body.error.code, 'INVALID_REQUEST', path);
    }
    const approvalUnauthorized = await request(port, `/api/mvp/proposals/${incidentId}/approve`, { method: 'POST' });
    assert.equal(approvalUnauthorized.status, 401);
    const approval = await request(port, `/api/mvp/proposals/${incidentId}/approve`, { method: 'POST', headers: { 'x-payscope-demo-approval-token': 'test-approval-token' } });
    assert.equal(approval.status, 200); assert.equal(approval.body.data.status, 'simulated');
    assert.equal(calls.at(-1)[0], 'approve'); assert.equal(calls.at(-1)[5].status, 'simulated');
    console.log('MVP API request-boundary checks passed.');
  } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
