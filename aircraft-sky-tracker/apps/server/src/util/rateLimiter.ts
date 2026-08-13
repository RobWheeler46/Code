/**
 * Minimum-interval request gate (FRD §70). Serialises calls through a single
 * queue and guarantees at least `minIntervalMs` between the start of each.
 */
export class MinIntervalGate {
  private readonly minIntervalMs: number;
  private chain: Promise<void> = Promise.resolve();
  private lastStart = 0;

  constructor(minIntervalMs: number) {
    this.minIntervalMs = minIntervalMs;
  }

  /** Run `task` no sooner than minIntervalMs after the previous task started. */
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(async () => {
      const wait = this.lastStart + this.minIntervalMs - Date.now();
      if (wait > 0) await delay(wait);
      this.lastStart = Date.now();
      return task();
    });
    // Keep the chain going regardless of task success/failure.
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
