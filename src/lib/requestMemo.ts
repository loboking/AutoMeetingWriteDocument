/** Bounded, session-local memo. Only validated successes are reusable; failures never are. */
export class RequestMemo<T> {
  private values = new Map<string, { value: T; expires: number; size: number }>();
  private pending = new Map<string, { promise: Promise<T>; share: boolean }>();
  constructor(private maxBytes = 8_000_000, private ttlMs = 30 * 60_000) {}
  async run(key: string, task: () => Promise<T>, options: { force?: boolean; sharePending?: boolean; valid: (value: T) => boolean; size: (value: T) => number }): Promise<T> {
    for (const [k, entry] of this.values) if (entry.expires <= Date.now()) this.values.delete(k);
    const existing = this.values.get(key);
    if (!options.force && existing) return structuredClone(existing.value);
    const pending = this.pending.get(key);
    if (!options.force && options.sharePending !== false && pending?.share) return structuredClone(await pending.promise);
    if (options.force) this.values.delete(key);
    const request = task().then(value => {
      // An older in-flight response must never overwrite a later regeneration.
      if (this.pending.get(key)?.promise === request && options.valid(value)) {
        const size = options.size(value);
        if (size <= this.maxBytes) {
          this.values.delete(key);
          let bytes = [...this.values.values()].reduce((sum, v) => sum + v.size, 0);
          for (const [k, entry] of this.values) {
            if (bytes + size <= this.maxBytes) break;
            this.values.delete(k); bytes -= entry.size;
          }
          this.values.set(key, { value: structuredClone(value), expires: Date.now() + this.ttlMs, size });
        }
      }
      return value;
    });
    this.pending.set(key, { promise: request, share: options.sharePending !== false });
    try { return structuredClone(await request); }
    finally { if (this.pending.get(key)?.promise === request) this.pending.delete(key); }
  }
}
