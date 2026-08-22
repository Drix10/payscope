const assert = require('node:assert/strict');
const { LoggingCommunicationsAdapter } = require('../dist/providers/communications/logging-adapter');

(async () => {
  const adapter = new LoggingCommunicationsAdapter();
  const result = await adapter.executeApprovedAction({ id: '00000000-0000-4000-8000-000000000001', actionType: 'hinglish_voice_script', content: {} });
  assert.equal(result.status, 'simulated');
  assert.match(result.note, /no customer message/i);
  assert.ok(Number.isFinite(Date.parse(result.simulatedAt)));
  console.log('Logging communications adapter test passed: simulated delivery only.');
})().catch(error => { console.error(error); process.exitCode = 1; });
