/** Owns one bounded connection attempt and closes it even if shutdown wins the race. */
export class WorkflowConnection<T extends { close(): Promise<void> }> {
  private client: T | null = null;
  private pending: Promise<void> | null = null;
  private retryAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(private readonly options: {
    disabled: boolean;
    connect(): Promise<T>;
    retryMs: number;
    onConnected(): void;
    onUnavailable(): void;
  }) {}

  get current(): T | null {
    // Timers may be frozen between serverless invocations. A request also drives recovery.
    void this.ensure();
    return this.client;
  }

  ensure(): Promise<void> {
    if (this.closed || this.options.disabled || this.client || Date.now() < this.retryAt) return Promise.resolve();
    if (this.pending) return this.pending;
    this.pending = this.connect().finally(() => { this.pending = null; });
    return this.pending;
  }

  private async connect(): Promise<void> {
    let client: T;
    try {
      client = await this.options.connect();
    } catch {
      if (this.closed) return;
      this.options.onUnavailable();
      this.retryAt = Date.now() + this.options.retryMs;
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.ensure();
      }, this.options.retryMs);
      this.timer.unref();
      return;
    }
    if (this.closed) {
      await client.close();
      return;
    }
    this.client = client;
    this.options.onConnected();
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    await this.pending;
    const client = this.client;
    this.client = null;
    await client?.close();
  }
}
