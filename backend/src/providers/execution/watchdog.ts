import { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../../observability';

export class ExecutionWatchdog {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  constructor(private readonly client: SupabaseClient, private readonly intervalMs = 30_000) {
    if (!Number.isFinite(intervalMs) || intervalMs < 5_000) throw new Error('Watchdog interval must be >= 5000ms');
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.safeTick(); }, this.intervalMs);
    // unref so it doesn't keep VPS alive during drain/shutdown; explicit stop() still required.
    this.timer.unref();
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
  async safeTick(): Promise<void> {
    if (this.running) return; // bounded concurrency: skip if previous still running, never overlap
    this.running = true;
    try { await this.tick(); } catch (error) {
      logger.warn({ errorClass: error instanceof Error ? error.name : 'unknown', message: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240) }, 'PayScope watchdog tick failed');
    } finally { this.running = false; }
  }
  async tick(): Promise<void> {
    const { error } = await this.client.rpc('payscope_watchdog_requeue_stuck_actions');
    if (error) throw new Error(`Watchdog failed: ${error.message}`);
  }
}
