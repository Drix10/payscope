const assert = require('node:assert/strict');
const http = require('node:http');
process.env.PAYSCOPE_PIPELINE_ENABLED = 'false';
process.env.CORS_ORIGINS = 'https://payscope-ai.vercel.app';
const app = require('../dist/server').default;

function request(port, origin) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/api/mvp/incidents', method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'content-type' } }, response => {
      response.resume(); response.on('end', () => resolve(response));
    });
    req.on('error', reject); req.end();
  });
}

(async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const allowed = await request(server.address().port, 'https://payscope-ai.vercel.app');
    assert.equal(allowed.statusCode, 204);
    assert.equal(allowed.headers['access-control-allow-origin'], 'https://payscope-ai.vercel.app');
    assert.match(String(allowed.headers['access-control-allow-headers']), /content-type/i);
    const denied = await request(server.address().port, 'https://untrusted.example');
    assert.equal(denied.headers['access-control-allow-origin'], undefined);
    console.log('Read-only CORS preflight checks passed.');
  } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
