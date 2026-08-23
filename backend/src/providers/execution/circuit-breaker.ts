type State = 'closed' | 'open' | 'half_open';

export class CircuitBreaker {
  private failures = 0;
  private successesInHalfOpen = 0;
  private state: State = 'closed';
  private openedAt = 0;
  private halfOpenProbeInFlight = false;
  constructor(
    private readonly name: string,
    private readonly failureThreshold = 5,
    private readonly resetMs = 30_000,
    private readonly halfOpenProbe = true,
  ) {
    if (!name || name.length > 80) throw new Error('Circuit breaker name invalid');
    if (failureThreshold < 1 || failureThreshold > 100) throw new Error('failureThreshold out of range');
    if (resetMs < 1_000 || resetMs > 300_000) throw new Error('resetMs out of range');
  }

  canExecute(): boolean {
    if (this.state === 'closed') return true;
    if (this.state === 'open' && Date.now() - this.openedAt >= this.resetMs) {
      this.state = 'half_open';
      this.successesInHalfOpen = 0;
      if (!this.halfOpenProbe) return false;
      this.halfOpenProbeInFlight = true;
      return true;
    }
    if (this.state === 'half_open' && this.halfOpenProbe && !this.halfOpenProbeInFlight) {
      this.halfOpenProbeInFlight = true;
      return true;
    }
    return false;
  }

  onSuccess(): void {
    if (this.state === 'half_open') {
      this.successesInHalfOpen += 1;
      // Require 2 consecutive successes to close from half-open (avoid flapping)
      if (this.successesInHalfOpen >= 2) {
        this.failures = 0;
        this.state = 'closed';
        this.successesInHalfOpen = 0;
      }
      this.halfOpenProbeInFlight = false;
      return;
    }
    this.failures = 0;
    this.state = 'closed';
    this.halfOpenProbeInFlight = false;
  }
  onFailure(): void {
    this.failures += 1;
    if (this.state === 'half_open') {
      this.state = 'open';
      this.openedAt = Date.now();
      this.successesInHalfOpen = 0;
      this.halfOpenProbeInFlight = false;
      return;
    }
    if (this.failures >= this.failureThreshold) {
      this.state = 'open';
      this.openedAt = Date.now();
    }
  }
  getState(): State { return this.state; }
  getFailures(): number { return this.failures; }
}

export class BoundedConcurrency {
  private running = 0;
  private queue: Array<() => void> = [];
  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Concurrency limit must be 1-100');
  }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    let transferred = false;
    if (this.running >= this.limit) await new Promise<void>(resolve => this.queue.push(() => { transferred = true; resolve(); }));
    if (!transferred) this.running += 1;
    try { return await fn(); }
    finally {
      const next = this.queue.shift();
      if (next) next();
      else this.running -= 1;
    }
  }
  pending(): number { return this.queue.length; }
  active(): number { return this.running; }
}
