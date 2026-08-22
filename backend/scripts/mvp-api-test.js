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
};
const app = express();
app.use('/api/mvp', createMvpRouter(repository, organizationId));

function request(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path }, response => {
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
    console.log('MVP API request-boundary checks passed.');
  } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
