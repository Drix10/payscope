const assert = require('node:assert/strict');

// Emulate Node 20/21, where `globalThis.WebSocket` is absent. This must not
// contact Supabase; it only verifies that construction is safe on the VPS.
const originalWebSocket = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');

try {
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    writable: true,
    value: undefined,
  });

  const { createDatabaseClient } = require('../dist/db/client');
  const client = createDatabaseClient({
    supabaseUrl: 'https://example.supabase.co',
    supabaseServiceRoleKey: 'test-service-role-key',
  });

  assert.ok(client, 'a configured client should be created');
  assert.equal(typeof client.realtime.transport, 'function');
  console.log('Database client test passed: Node without native WebSocket uses the explicit server transport.');
} finally {
  if (originalWebSocket) Object.defineProperty(globalThis, 'WebSocket', originalWebSocket);
  else delete globalThis.WebSocket;
}
