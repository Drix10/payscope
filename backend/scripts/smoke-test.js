const assert = require('node:assert/strict');
const http = require('node:http');

process.env.PAYSCOPE_PIPELINE_ENABLED = 'false';
process.env.NODE_ENV = 'test';
const app = require('../dist/server').default;

function request(port, path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: options.method || 'GET', headers: options.headers }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject); if (options.body) req.write(options.body); req.end();
  });
}

(async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;
  try {
    const health = await request(port, '/health');
    assert.equal(health.status, 200); assert.equal(JSON.parse(health.body).pipeline, 'disabled');
    const retired = await request(port, '/api/retired-route');
    assert.equal(retired.status, 404);
    const webhook = await request(port, '/webhooks/razorpay', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(webhook.status, 503); assert.equal(JSON.parse(webhook.body).error.code, 'PIPELINE_NOT_ENABLED');
    console.log('Agentic MVP smoke test passed: health, fail-closed webhook, and retired-route rejection verified.');
  } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
