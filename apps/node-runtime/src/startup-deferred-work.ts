/**
 * ADR-0480: work that only warms caches runs after the Node first settles its readiness, so it
 * never delays the components that `lervo upgrade` waits for. Tasks run one at a time, a failure
 * is reported and never fails the runtime, and a bounded fallback releases the queue when
 * readiness never settles.
 */
export interface NodeRuntimeDeferredWork {
  /** Queues `task`; it runs after release, or not at all once the runtime closes. */
  schedule(name: string, task: () => Promise<void>): void;
  /** Starts queued and future tasks; later calls have no effect. */
  release(): void;
  /** Drops queued tasks and the fallback timer; a running task finishes in the background. */
  close(): void;
}

export const NODE_RUNTIME_DEFERRED_WORK_FALLBACK_MS = 120_000;

function reportDeferredWorkFailure(name: string, error: unknown): void {
  const code = (error as { code?: unknown } | null)?.code;
  process.stderr.write(
    `Lervo Node deferred work ${name} failed: ${typeof code === "string" && /^[A-Za-z0-9_-]{1,64}$/u.test(code) ? code : "unknown"}\n`,
  );
}

export function createNodeRuntimeDeferredWork(
  input: {
    onFailure?(name: string, error: unknown): void;
    fallbackMs?: number;
    setTimer?(callback: () => void, delayMs: number): { cancel(): void };
  } = {},
): NodeRuntimeDeferredWork {
  const onFailure = input.onFailure ?? reportDeferredWorkFailure;
  const queued: Array<{ name: string; task: () => Promise<void> }> = [];
  let released = false;
  let closed = false;
  let chain: Promise<void> = Promise.resolve();
  const run = (name: string, task: () => Promise<void>): void => {
    chain = chain.then(async () => {
      if (closed) return;
      try {
        await task();
      } catch (error) {
        onFailure(name, error);
      }
    });
  };
  const setTimer =
    input.setTimer ??
    ((callback: () => void, delayMs: number) => {
      const timer = setTimeout(callback, delayMs);
      timer.unref();
      return { cancel: () => clearTimeout(timer) };
    });
  let fallback: { cancel(): void } | undefined;
  const work: NodeRuntimeDeferredWork = {
    schedule(name, task) {
      if (closed) return;
      if (released) run(name, task);
      else queued.push({ name, task });
    },
    release() {
      if (released || closed) return;
      released = true;
      fallback?.cancel();
      for (const item of queued.splice(0)) run(item.name, item.task);
    },
    close() {
      closed = true;
      queued.length = 0;
      fallback?.cancel();
    },
  };
  fallback = setTimer(
    () => work.release(),
    input.fallbackMs ?? NODE_RUNTIME_DEFERRED_WORK_FALLBACK_MS,
  );
  return work;
}
