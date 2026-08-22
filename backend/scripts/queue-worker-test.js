const assert = require('node:assert/strict');
const { QueueWorker, queueFailureDecision } = require('../dist/queue/queue-worker');

const now = Date.parse('2026-08-22T00:00:00.000Z');
assert.deepEqual(queueFailureDecision(1, now), { status: 'pending', attemptNumber: 2, nextAttemptAt: '2026-08-22T00:00:01.000Z' });
assert.deepEqual(queueFailureDecision(2, now), { status: 'pending', attemptNumber: 3, nextAttemptAt: '2026-08-22T00:00:05.000Z' });
assert.deepEqual(queueFailureDecision(3, now), { status: 'pending', attemptNumber: 4, nextAttemptAt: '2026-08-22T00:00:30.000Z' });
assert.deepEqual(queueFailureDecision(4, now), { status: 'dead', attemptNumber: 4, nextAttemptAt: null });

const org = '00000000-0000-4000-8000-000000000001';
const eventId = '00000000-0000-4000-8000-000000000002';
const jobId = '00000000-0000-4000-8000-000000000003';
const updates = [];
let claimCount = 0;
const query = {
  update(value) { updates.push(value); return this; },
  eq() { return this; },
  select() { return this; },
  async maybeSingle() { return { data: { id: jobId }, error: null }; },
};
const client = {
  async rpc() {
    claimCount += 1;
    if (claimCount > 1) return { data: [], error: null };
    return { data: [{ id: jobId, attempt_number: 4, locked_by: 'test-worker', payload: { jobId, organizationId: org, type: 'enrich_event', createdAt: '2026-08-22T00:00:00.000Z', eventId } }], error: null };
  },
  from() { return query; },
};

(async () => {
  const processed = [];
  const worker = new QueueWorker(client, 'test-worker', async job => processed.push(job), 60_000);
  worker.start();
  await worker.stopAndDrain();
  assert.equal(processed.length, 1, 'a fourth delivery must be executable before dead-lettering');
  assert.equal(processed[0].attemptNumber, 4);
  assert.equal(updates[0].status, 'complete');
  console.log('Agentic MVP queue retry and worker-lifecycle checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
