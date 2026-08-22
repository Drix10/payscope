const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createMvpRouter } = require('../dist/api/mvp-router');

const organizationId = '00000000-0000-4000-8000-000000000001';
const incidentId = '00000000-0000-4000-8000-000000000002';
const calls = [];
const repository = {
  async listIncidents(org, limit) { calls.push(['list', org, limit]); return []; },
  async incidentDetail(org, id) { calls.push(['detail', org, id]); if (id !== incidentId) throw new Error('Incident was not found'); return { incident: { id }, events: [], proposals: [] }; },
  async auditEntries(org, id) { calls.push(['audit', org, id]); return []; },
  async proposalById(org, id) { calls.push(['proposal', org, id]); return { id, organizationId: org, incidentId, actionType: 'flag_for_review', content: {}, status: 'pending', proposedAt: '2026-08-22T00:00:00.000Z', approvedAt: null, approvedBy: null, deliveryResult: null }; },
  async approveProposal(org, id, actor, hash, delivery) { calls.push(['approve', org, id, actor, hash, delivery]); return { id, organizationId: org, incidentId, actionType: 'flag_for_review', content: {}, status: 'simulated', proposedAt: '2026-08-22T00:00:00.000Z', approvedAt: '2026-08-22T00:01:00.000Z', approvedBy: null, deliveryResult: delivery }; },
};
const app = express();
app.use(express.json());
app.use('/api/mvp', createMvpRouter(repository, organizationId, { approvalToken: 'test-approval-token', approvalActorId: 'demo-operator', communications: { async executeApprovedAction() { return { status: 'simulated', note: 'No delivery sent.', simulatedAt: '2026-08-22T00:01:00.000Z' }; } } }));

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
    const list = await request(port, '/api/mvp/incidents?limit=2');
    assert.equal(list.status, 200); assert.deepEqual(calls.shift(), ['list', organizationId, 2]);
    for (const path of ['/api/mvp/incidents?limit=0', '/api/mvp/incidents?limit=101', '/api/mvp/incidents?limit=abc', '/api/mvp/incidents/not-a-uuid', '/api/mvp/audit?incidentId=not-a-uuid']) {
      const result = await request(port, path);
      assert.equal(result.status, 400, path); assert.equal(result.body.error.code, 'INVALID_REQUEST', path);
    }
    const missing = await request(port, '/api/mvp/incidents/00000000-0000-4000-8000-000000000003');
    assert.equal(missing.status, 404); assert.equal(missing.body.error.code, 'INCIDENT_NOT_FOUND');
    const approvalUnauthorized = await request(port, `/api/mvp/proposals/${incidentId}/approve`, { method: 'POST' });
    assert.equal(approvalUnauthorized.status, 401);
    const approval = await request(port, `/api/mvp/proposals/${incidentId}/approve`, { method: 'POST', headers: { 'x-payscope-demo-approval-token': 'test-approval-token' } });
    assert.equal(approval.status, 200); assert.equal(approval.body.data.status, 'simulated');
    assert.equal(calls.at(-1)[0], 'approve'); assert.equal(calls.at(-1)[5].status, 'simulated');
    console.log('MVP API request-boundary checks passed.');
  } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
