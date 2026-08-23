const assert = require('node:assert/strict');
const { QueueWorker, isTerminalQueueJobError, queueFailureDecision } = require('../dist/queue/queue-worker');

const now = Date.parse('2026-08-22T00:00:00.000Z');
assert.deepEqual(queueFailureDecision(1, now), { status: 'pending', attemptNumber: 2, nextAttemptAt: '2026-08-22T00:00:01.000Z' });
assert.deepEqual(queueFailureDecision(2, now), { status: 'pending', attemptNumber: 3, nextAttemptAt: '2026-08-22T00:00:05.000Z' });
assert.deepEqual(queueFailureDecision(3, now), { status: 'pending', attemptNumber: 4, nextAttemptAt: '2026-08-22T00:00:30.000Z' });
assert.deepEqual(queueFailureDecision(4, now), { status: 'dead', attemptNumber: 4, nextAttemptAt: null });
assert.equal(isTerminalQueueJobError(new Error('PayScope event was not found')), true);
assert.equal(isTerminalQueueJobError(new Error('Investigation job is missing triggerEventId')), true);
assert.equal(isTerminalQueueJobError(new Error('temporary database outage')), false);

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

const waitFor = async (predicate, message) => {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};

(async () => {
  const processed = [];
  const worker = new QueueWorker(client, 'test-worker', async job => processed.push(job), 60_000);
  worker.start();
  await worker.stopAndDrain();
  assert.equal(processed.length, 1, 'a fourth delivery must be executable before dead-lettering');
  assert.equal(processed[0].attemptNumber, 4);
  assert.equal(updates[0].status, 'complete');

  // A deleted/stale durable resource cannot appear later. It is dead-lettered
  // immediately instead of producing four noisy retries.
  const staleUpdates = [];
  const staleQuery = { update(value) { staleUpdates.push(value); return this; }, eq() { return this; }, select() { return this; }, async maybeSingle() { return { data: { id: jobId }, error: null }; } };
  let staleClaims = 0;
  const staleClient = {
    async rpc() { staleClaims += 1; return staleClaims === 1 ? { data: [{ id: jobId, attempt_number: 1, locked_by: 'stale-worker', payload: { jobId, organizationId: org, type: 'enrich_event', createdAt: '2026-08-22T00:00:00.000Z', eventId } }], error: null } : { data: [], error: null }; },
    from() { return staleQuery; },
  };
  const previousStaleError = console.error;
  console.error = () => {};
  try {
    const staleWorker = new QueueWorker(staleClient, 'stale-worker', async () => { throw new Error('PayScope event was not found'); }, 60_000);
    staleWorker.start();
    await waitFor(() => staleUpdates.length === 1, 'stale job was not terminalized');
    await staleWorker.stopAndDrain();
  } finally { console.error = previousStaleError; }
  assert.equal(staleUpdates[0].status, 'dead');

  // A burst drains serially as soon as a completion is persisted; it does not
  // create one timer/promise per job or wait an entire poll interval per row.
  const burstProcessed = [];
  let burstClaims = 0;
  const burstJobIds = ['00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000005'];
  const burstClient = {
    async rpc() {
      burstClaims += 1;
      if (burstClaims > 2) return { data: [], error: null };
      const claimedJobId = burstJobIds[burstClaims - 1];
      return { data: [{ id: claimedJobId, attempt_number: 1, locked_by: 'burst-worker', payload: { jobId: claimedJobId, organizationId: org, type: 'enrich_event', createdAt: '2026-08-22T00:00:00.000Z', eventId } }], error: null };
    },
    from() { return query; },
  };
  const burstWorker = new QueueWorker(burstClient, 'burst-worker', async job => burstProcessed.push(job.jobId), 60_000);
  burstWorker.start();
  await waitFor(() => burstProcessed.length === 2, 'worker did not serially drain both immediately available jobs');
  await burstWorker.stopAndDrain();
  assert.equal(burstClaims, 3, 'worker must stop draining only after an empty claim');

  // A failed claim releases internal state, allowing the scheduled retry to
  // recover instead of leaving the singleton worker permanently busy.
  let recoveryClaims = 0;
  const recoveryClient = {
    async rpc() {
      recoveryClaims += 1;
      if (recoveryClaims === 1) return { data: null, error: { message: 'temporary database outage' } };
      if (recoveryClaims === 2) return { data: [{ id: '00000000-0000-4000-8000-000000000006', attempt_number: 1, locked_by: 'recovery-worker', payload: { jobId: '00000000-0000-4000-8000-000000000006', organizationId: org, type: 'enrich_event', createdAt: '2026-08-22T00:00:00.000Z', eventId } }], error: null };
      return { data: [], error: null };
    },
    from() { return query; },
  };
  const previousError = console.error;
  console.error = () => {};
  try {
    const recoveryProcessed = [];
    const recoveryWorker = new QueueWorker(recoveryClient, 'recovery-worker', async job => recoveryProcessed.push(job.jobId), 5);
    recoveryWorker.start();
    await waitFor(() => recoveryProcessed.length === 1, 'worker did not recover after a transient claim failure');
    await recoveryWorker.stopAndDrain();
  } finally {
    console.error = previousError;
  }
  console.log('Agentic MVP queue retry and worker-lifecycle checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
