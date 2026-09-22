type Entry<T> = { controller: AbortController; promise: Promise<T | null>; users: number; settled: boolean; expiresAt: number };

/** Share a parsed public response while keeping each consumer's cancellation independent. */
export class SharedRead<T> {
  private entries = new Map<string, Entry<T>>();
  constructor(private ttlMs: number, private maxEntries = 32) {}

  read(key: string, load: (signal: AbortSignal) => Promise<T | null>, signal?: AbortSignal): Promise<T | null> {
    if (signal?.aborted) return Promise.resolve(null);
    let entry = this.entries.get(key);
    if (entry && (entry.controller.signal.aborted || (entry.settled && entry.expiresAt <= Date.now()))) {
      this.entries.delete(key);
      entry = undefined;
    }
    if (!entry) {
      const next: Entry<T> = { controller: new AbortController(), promise: Promise.resolve(null), users: 0, settled: false, expiresAt: 0 };
      this.entries.set(key, next);
      next.promise = Promise.resolve().then(() => load(next.controller.signal)).then(value => {
        next.settled = true;
        next.expiresAt = Date.now() + this.ttlMs;
        if (value == null || this.ttlMs === 0) {
          if (this.entries.get(key) === next) this.entries.delete(key);
        }
        // Only evict finished reads; never orphan another consumer's in-flight work.
        for (const [oldKey, old] of this.entries) {
          if (this.entries.size <= this.maxEntries) break;
          if (old.settled) this.entries.delete(oldKey);
        }
        return value;
      }, error => {
        next.settled = true;
        if (this.entries.get(key) === next) this.entries.delete(key);
        throw error;
      });
      entry = next;
    }
    const current = entry;
    current.users++;
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (value: T | null, error?: unknown) => {
        if (done) return;
        done = true;
        signal?.removeEventListener("abort", abort);
        current.users--;
        if (!current.users && !current.settled) current.controller.abort();
        if (error !== undefined) reject(error); else resolve(value);
      };
      const abort = () => finish(null);
      signal?.addEventListener("abort", abort, { once: true });
      current.promise.then(value => finish(value), error => finish(null, error));
    });
  }
}
