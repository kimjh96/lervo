import { KnowledgeConvergenceRuntimeError } from "./failure.js";

/** ADR-0587: how often an in-flight background provider call asks whether an upgrade waits. */
const UPGRADE_PREEMPTION_POLL_MILLISECONDS = 1_000;

/** A background context that a resident cycle runs; one-shot callers leave it unset. */
export interface UpgradePreemptionSource {
  /** ADR-0574: whether an upgrade waits for the host's full-cycle admission. */
  yieldToUpgrade?: () => Promise<boolean>;
}

/**
 * ADR-0587: the host's background capacity belongs to the waiting upgrade. Every background
 * provider path already defers on this code without spending a stage attempt. Its own class lets
 * a stage of several calls stop at once instead of retrying the call in smaller parts.
 */
class UpgradePreemptionError extends KnowledgeConvergenceRuntimeError {
  constructor(options?: ErrorOptions) {
    super("knowledge_capacity_unavailable", options);
    this.name = "UpgradePreemptionError";
  }
}

export function upgradePreemptionError(options?: ErrorOptions): KnowledgeConvergenceRuntimeError {
  return new UpgradePreemptionError(options);
}

export function isUpgradePreemption(error: unknown): boolean {
  return error instanceof UpgradePreemptionError;
}

/** An unreadable answer counts as no upgrade waiting, as `preempted()` itself answers. */
export async function upgradeWaiting(source: UpgradePreemptionSource): Promise<boolean> {
  if (source.yieldToUpgrade === undefined) return false;
  return source.yieldToUpgrade().catch(() => false);
}

/**
 * ADR-0587: while a provider call runs, aborts it once an upgrade waits. Only the provider call
 * listens, and its caller discards the answer, so no durable write is interrupted. The returned
 * stop ends polling and waits for a check in flight, so no abort lands after the caller's fence.
 */
export function abandonProviderCallOnUpgrade(
  source: UpgradePreemptionSource,
  abort: (reason: KnowledgeConvergenceRuntimeError) => void,
): () => Promise<void> {
  if (source.yieldToUpgrade === undefined) return async () => undefined;
  let checking: Promise<void> | null = null;
  // A check still in flight at stop may answer later; its answer must not abort the call.
  let stopped = false;
  const timer = setInterval(() => {
    if (checking !== null) return;
    checking = upgradeWaiting(source)
      .then((waiting) => {
        if (waiting && !stopped) abort(upgradePreemptionError());
      })
      .finally(() => {
        checking = null;
      });
  }, UPGRADE_PREEMPTION_POLL_MILLISECONDS);
  timer.unref();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await checking;
  };
}
