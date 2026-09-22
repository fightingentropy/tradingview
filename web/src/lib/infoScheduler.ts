type Task<T> = { run: () => Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void; priority: "high" | "low"; weight: number; signal?: AbortSignal };

/** Small concurrency with one slot reserved for the chart; a rolling weighted budget caps bursts. */
export class InfoScheduler {
  private queue: Task<any>[] = [];
  private active = 0;
  private starts: { at: number; weight: number }[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private nextStart = 0;
  constructor(private intervalMs = 100, private budget = 900, private windowMs = 60_000) {}

  schedule<T>(run: () => Promise<T>, options: { priority?: "high" | "low"; weight?: number; signal?: AbortSignal } = {}): Promise<T> {
    if (this.queue.length >= 200) return Promise.reject(new Error("Market request queue is full"));
    return new Promise((resolve, reject) => {
      this.queue.push({ run, resolve, reject, priority: options.priority ?? "low", weight: options.weight ?? 20, signal: options.signal });
      this.drain();
    });
  }

  private drain() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.queue = this.queue.filter(task => {
      if (!task.signal?.aborted) return true;
      task.reject(new DOMException("Request aborted", "AbortError"));
      return false;
    });
    if (!this.queue.length || this.active >= 3) return;
    const high = this.queue.findIndex(t => t.priority === "high");
    if (high < 0 && this.active >= 2) return;
    const index = high < 0 ? 0 : high;
    const task = this.queue[index];
    const now = Date.now();
    this.starts = this.starts.filter(s => s.at > now - this.windowMs);
    let weight = this.starts.reduce((sum, s) => sum + s.weight, 0);
    let readyAt = this.nextStart;
    for (const start of this.starts) {
      if (weight + task.weight <= this.budget) break;
      weight -= start.weight;
      readyAt = Math.max(readyAt, start.at + this.windowMs);
    }
    if (readyAt > now) {
      this.timer = setTimeout(() => this.drain(), readyAt - now);
      return;
    }
    this.queue.splice(index, 1);
    this.active++;
    this.nextStart = now + this.intervalMs;
    this.starts.push({ at: now, weight: task.weight });
    void Promise.resolve().then(task.run).then(task.resolve, task.reject).finally(() => { this.active--; this.drain(); });
    this.drain();
  }
}
