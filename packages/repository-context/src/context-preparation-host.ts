import { ContextQualityError } from "@lervo/context";

type Budget = { signal: AbortSignal; chargeProviderCall(): void };
type Job = {
  key: string;
  bytes: number;
  controller: AbortController;
  work: (budget: Budget) => Promise<unknown>;
  providerLimit: number;
  waiters: Set<Waiter>;
  running: boolean;
};
type Waiter = { resolve(value: unknown): void; reject(error: unknown): void };

/** Process-local admission. Scope and freshness are resolved by the application before joining. */
export class ContextPreparationHost {
  private readonly jobs = new Map<string, Job>();
  private readonly queue: Job[] = [];
  private running = 0;
  private retainedBytes = 0;
  constructor(
    private readonly limits: {
      maximumConcurrent: number;
      maximumPending: number;
      maximumRetainedBytes: number;
    } = { maximumConcurrent: 2, maximumPending: 32, maximumRetainedBytes: 64 * 1024 * 1024 },
  ) {
    if (
      !Number.isInteger(limits.maximumConcurrent) ||
      limits.maximumConcurrent < 1 ||
      limits.maximumConcurrent > 2 ||
      !Number.isInteger(limits.maximumPending) ||
      limits.maximumPending < 0 ||
      limits.maximumPending > 32 ||
      !Number.isSafeInteger(limits.maximumRetainedBytes) ||
      limits.maximumRetainedBytes < 1
    )
      throw new ContextQualityError("context_contract_invalid");
  }

  run<T>(input: {
    key: string;
    reservedBytes: number;
    deadlineMs: number;
    maximumProviderCalls: number;
    signal: AbortSignal;
    work(budget: Budget): Promise<T>;
  }): Promise<T> {
    if (
      !input.key ||
      input.key.length > 256 ||
      !Number.isSafeInteger(input.reservedBytes) ||
      input.reservedBytes < 1 ||
      !Number.isSafeInteger(input.deadlineMs) ||
      input.deadlineMs < 1 ||
      input.deadlineMs > 600000 ||
      !Number.isInteger(input.maximumProviderCalls) ||
      input.maximumProviderCalls < 0 ||
      input.maximumProviderCalls > 16
    )
      return Promise.reject(new ContextQualityError("context_contract_invalid"));
    if (input.signal.aborted) return Promise.reject(new ContextQualityError("context_cancelled"));
    let job = this.jobs.get(input.key);
    if (
      job &&
      (job.bytes !== input.reservedBytes || job.providerLimit !== input.maximumProviderCalls)
    )
      return Promise.reject(new ContextQualityError("context_contract_invalid"));
    if (!job) {
      if (
        (this.running >= this.limits.maximumConcurrent &&
          this.queue.length >= this.limits.maximumPending) ||
        this.retainedBytes + input.reservedBytes > this.limits.maximumRetainedBytes
      )
        return Promise.reject(new ContextQualityError("context_budget_exceeded"));
      job = {
        key: input.key,
        bytes: input.reservedBytes,
        controller: new AbortController(),
        work: input.work,
        providerLimit: input.maximumProviderCalls,
        waiters: new Set(),
        running: false,
      };
      this.jobs.set(input.key, job);
      this.retainedBytes += job.bytes;
      this.queue.push(job);
    }
    const shared = job;
    // Bound waiters too: semantic deduplication must not create an unbounded timer/listener cache.
    if (shared.waiters.size >= 32)
      return Promise.reject(new ContextQualityError("context_budget_exceeded"));
    return new Promise<T>((resolve, reject) => {
      let done = false;
      const finish = (callback: () => void) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        input.signal.removeEventListener("abort", cancel);
        shared.waiters.delete(waiter);
        callback();
        if (!shared.waiters.size) {
          shared.controller.abort();
          if (this.jobs.get(shared.key) === shared) this.jobs.delete(shared.key);
          if (!shared.running) {
            this.queue.splice(this.queue.indexOf(shared), 1);
            this.retainedBytes -= shared.bytes;
          }
        }
      };
      const cancel = () => finish(() => reject(new ContextQualityError("context_cancelled")));
      const timer = setTimeout(
        () => finish(() => reject(new ContextQualityError("context_budget_exceeded"))),
        input.deadlineMs,
      );
      const waiter: Waiter = {
        resolve: (value) => {
          try {
            const detached = structuredClone(value) as T;
            finish(() => resolve(detached));
          } catch {
            finish(() => reject(new ContextQualityError("context_contract_invalid")));
          }
        },
        reject: (error) => finish(() => reject(error)),
      };
      shared.waiters.add(waiter);
      input.signal.addEventListener("abort", cancel, { once: true });
      if (input.signal.aborted) cancel();
      this.drain();
    });
  }

  private drain(): void {
    while (this.running < this.limits.maximumConcurrent && this.queue.length) {
      const job = this.queue.shift()!;
      job.running = true;
      this.running += 1;
      let calls = 0;
      const budget: Budget = {
        signal: job.controller.signal,
        chargeProviderCall: () => {
          if (job.controller.signal.aborted) throw new ContextQualityError("context_cancelled");
          if (++calls > job.providerLimit) throw new ContextQualityError("context_budget_exceeded");
        },
      };
      void Promise.resolve()
        .then(() => job.work(budget))
        .then(
          (value) => {
            for (const waiter of [...job.waiters]) waiter.resolve(value);
          },
          (error: unknown) => {
            for (const waiter of [...job.waiters]) waiter.reject(error);
          },
        )
        .finally(() => {
          if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
          this.running -= 1;
          this.retainedBytes -= job.bytes;
          this.drain();
        });
    }
  }
}

export const contextPreparationHost = new ContextPreparationHost();
