import { SupabaseClient } from '@supabase/supabase-js';
import { QUEUE_RETRY_DELAYS_MS } from '../config/stopping-rules';
import { QueueJob, QueueJobSchema } from '../domain/contracts';
import { logger } from '../observability';

type ClaimedQueueRow = {
  id: string;
  payload: unknown;
  attempt_number: number;
  locked_by: string | null;
};

export type QueueProcessor = (job: QueueJob) => Promise<void>;

export type QueueFailureDecision = {
  status: 'pending' | 'dead';
  attemptNumber: number;
  nextAttemptAt: string | null;
};

export function queueFailureDecision(currentAttempt: number, now = Date.now()): QueueFailureDecision {
  const nextAttempt = currentAttempt + 1;
  if (nextAttempt > 4) return { status: 'dead', attemptNumber: currentAttempt, nextAttemptAt: null };
  const delay = QUEUE_RETRY_DELAYS_MS[Math.min(currentAttempt - 1, QUEUE_RETRY_DELAYS_MS.length - 1)];
  return { status: 'pending', attemptNumber: nextAttempt, nextAttemptAt: new Date(now + delay).toISOString() };
}

/** Fail closed for jobs whose referenced durable resource no longer exists. */
export function isTerminalQueueJobError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /PayScope (event|incident) was not found|job is missing (eventId|incidentId|triggerEventId)/i.test(error.message);
}

/** A single VPS worker that claims jobs atomically through Supabase RPC. */
export class QueueWorker {
  private timer: ReturnType<typeof setInterval> | undefined;
  private processing = false;
  private acceptingWork = false;
  private inFlight: Promise<boolean> | undefined;

  constructor(
    private readonly client: SupabaseClient,
    private readonly workerId: string,
    private readonly processJob: QueueProcessor,
    private readonly pollIntervalMs = 5_000,
  ) {}

  start(): void {
    if (this.timer) return;
    this.acceptingWork = true;
    this.timer = setInterval(() => this.kick(), this.pollIntervalMs);
    this.timer.unref();
    this.kick();
  }

  stop(): void {
    this.acceptingWork = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Stops claiming new work and waits for a claimed job to settle. */
  async stopAndDrain(): Promise<void> {
    this.stop();
    await this.inFlight;
  }

  async processOne(): Promise<boolean> {
    if (!this.acceptingWork || this.processing) return false;
    this.processing = true;
    const operation = this.processOneInternal();
    this.inFlight = operation;
    try {
      return await operation;
    } finally {
      if (this.inFlight === operation) this.inFlight = undefined;
    }
  }

  private kick(): void {
    void this.processAvailable();
  }

  /**
   * A poll only needs to wake the worker; once it has claimed work, continue
   * draining sequentially. This avoids an artificial five-second delay per
   * job during a webhook burst without creating concurrent jobs or timers.
   */
  private async processAvailable(): Promise<void> {
    try {
      const claimed = await this.processOne();
      if (claimed && this.acceptingWork) setImmediate(() => this.kick());
    } catch (error) {
      // A later interval retries a transient claim failure. `processOne` has
      // already released its in-flight/processing state in its finally block.
      logger.error({ errorClass: error instanceof Error ? error.name : 'unknown' }, 'PayScope queue worker error');
    }
  }

  private async processOneInternal(): Promise<boolean> {
    try {
      const { data, error } = await this.client.rpc('payscope_claim_queue_job', { p_worker_id: this.workerId });
      if (error) throw new Error(`PayScope queue claim failed: ${error.message}`);
      const row = (Array.isArray(data) ? data[0] : undefined) as ClaimedQueueRow | undefined;
      if (!row) return false;
      try {
        const rawPayload = asRecord(row.payload);
        const jobData = {
          jobId: String(rawPayload.jobId ?? rawPayload.job_id ?? row.id),
          organizationId: String(rawPayload.organizationId ?? rawPayload.organization_id ?? ''),
          type: String(rawPayload.type ?? 'investigate_incident'),
          attemptNumber: row.attempt_number ?? Number(rawPayload.attemptNumber ?? 1),
          createdAt: String(rawPayload.createdAt ?? rawPayload.created_at ?? new Date().toISOString()),
          eventId: rawPayload.eventId ?? rawPayload.event_id ? String(rawPayload.eventId ?? rawPayload.event_id) : undefined,
          incidentId: rawPayload.incidentId ?? rawPayload.incident_id ? String(rawPayload.incidentId ?? rawPayload.incident_id) : undefined,
          triggerEventId: rawPayload.triggerEventId ?? rawPayload.trigger_event_id ? String(rawPayload.triggerEventId ?? rawPayload.trigger_event_id) : undefined,
        };
        const job = QueueJobSchema.parse(jobData);
        await this.processJob(job);
        const { data: completed, error: completeError } = await this.client
          .from('payscope_queue_jobs')
          .update({ status: 'complete', updated_at: new Date().toISOString() })
          .eq('id', row.id)
          .eq('status', 'running')
          .eq('locked_by', this.workerId)
          .select('id')
          .maybeSingle();
        if (completeError) throw new Error(`PayScope queue completion failed: ${completeError.message}`);
        if (!completed) throw new Error('PayScope queue completion lost its lease');
      } catch (error) {
        await this.fail(row, error);
      }
      return true;
    } finally {
      this.processing = false;
    }
  }

  private async fail(row: ClaimedQueueRow, error: unknown): Promise<void> {
    const retryDecision = queueFailureDecision(row.attempt_number);
    const decision = isTerminalQueueJobError(error)
      ? { status: 'dead' as const, attemptNumber: row.attempt_number, nextAttemptAt: null }
      : retryDecision;
    const update = decision.status === 'dead'
      ? { status: 'dead', updated_at: new Date().toISOString(), locked_at: null, locked_by: null }
      : { status: 'pending', attempt_number: decision.attemptNumber, next_attempt_at: decision.nextAttemptAt, updated_at: new Date().toISOString(), locked_at: null, locked_by: null };
    const { data: failed, error: failureError } = await this.client
      .from('payscope_queue_jobs')
      .update(update)
      .eq('id', row.id)
      .eq('status', 'running')
      .eq('locked_by', this.workerId)
      .select('id')
      .maybeSingle();
    if (failureError) throw new Error(`PayScope queue failure update failed: ${failureError.message}`);
    if (!failed) throw new Error('PayScope queue failure update lost its lease');
    logger.error({ jobId: row.id, attempt: row.attempt_number, dead: decision.status === 'dead', errorClass: error instanceof Error ? error.name : 'unknown', errorMessage: error instanceof Error ? error.message : String(error) }, 'PayScope queue job failed');
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
