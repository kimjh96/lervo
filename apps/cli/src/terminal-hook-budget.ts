import { RepositorySnapshotError } from "@lervo/orchestrator";
import type { ExecutionStageId } from "@lervo/execution-contract";
import type { TerminalHookFailureReason } from "@lervo/schemas";

import { TerminalWorkspaceIsolationError } from "./terminal-workspace-contract.js";
import type { TerminalStageObservationPort } from "./terminal-stage-observation.js";

/** Leave half the provider's 30-second limit for startup, output, and process teardown. */
export const TERMINAL_HOOK_BUDGET_MS = 15_000;

export class TerminalHookFailure extends Error {
  constructor(readonly code: TerminalHookFailureReason) {
    super(code);
  }
}

export function terminalHookFailureReason(error: unknown): TerminalHookFailureReason {
  if (error instanceof TerminalHookFailure || error instanceof RepositorySnapshotError)
    return error.code;
  return "unexpected_error";
}

export async function withinTerminalDeadline<T>(
  deadlineMs: number,
  operation: () => Promise<T>,
  reason: TerminalHookFailureReason = "hook_deadline_exceeded",
): Promise<T> {
  const remaining = deadlineMs - performance.now();
  if (remaining <= 0) throw new TerminalHookFailure(reason);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TerminalHookFailure(reason)), remaining);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function stageFailure(stage: ExecutionStageId): TerminalHookFailureReason {
  if (stage === "repository_snapshot") return "repository_snapshot_failed";
  if (["corpus_preparation", "query_projection", "context_assembly", "search"].includes(stage))
    return "knowledge_inspection_failed";
  if (stage === "event_commit") return "event_persistence_failed";
  if (stage === "lifecycle_inspection") return "lifecycle_inspection_failed";
  if (stage === "repository_discovery") return "repository_discovery_failed";
  if (stage === "ingress_integrity") return "hook_input_invalid";
  return "unexpected_error";
}

/** Shared absolute deadlines prevent sequential stages from each spending a full hook budget. */
export function budgetTerminalStages(
  timing: TerminalStageObservationPort,
  startedAt = performance.now(),
): TerminalStageObservationPort & { deadlineMs: number } {
  const deadlineMs = startedAt + (TERMINAL_HOOK_BUDGET_MS * 2) / 3;
  const snapshotDeadlineMs = startedAt + TERMINAL_HOOK_BUDGET_MS / 2;
  const cancelled = new AbortController();
  const pending = new Set<Promise<unknown>>();
  const measure = <T>(
    stage: ExecutionStageId,
    operation: () => Promise<T>,
    parent?: ExecutionStageId,
  ): Promise<T> => {
    if (cancelled.signal.aborted) return Promise.reject(cancelled.signal.reason);
    const bounded = () =>
      withinTerminalDeadline(
        stage === "repository_snapshot" ? snapshotDeadlineMs : deadlineMs,
        () =>
          new Promise<T>((resolve, reject) => {
            const abort = () => reject(cancelled.signal.reason);
            cancelled.signal.addEventListener("abort", abort, { once: true });
            Promise.resolve()
              .then(() => {
                if (cancelled.signal.aborted) throw cancelled.signal.reason;
                const work = operation();
                timing.trackWork?.(work);
                return work;
              })
              .then(resolve, reject)
              .finally(() => cancelled.signal.removeEventListener("abort", abort));
          }),
        stage === "repository_snapshot"
          ? "repository_snapshot_deadline_exceeded"
          : "hook_deadline_exceeded",
      );
    const result = (
      parent === undefined
        ? timing.measure(stage, bounded)
        : timing.measureChild(stage, parent, bounded)
    ).catch((error: unknown) => {
      const failure =
        error instanceof TerminalHookFailure ||
        error instanceof RepositorySnapshotError ||
        error instanceof TerminalWorkspaceIsolationError
          ? error
          : new TerminalHookFailure(stageFailure(stage));
      cancelled.abort(failure);
      throw failure;
    });
    pending.add(result);
    void result.then(
      () => pending.delete(result),
      () => pending.delete(result),
    );
    return result;
  };
  return {
    deadlineMs: snapshotDeadlineMs,
    observationDeadlineMs: startedAt + TERMINAL_HOOK_BUDGET_MS,
    measure: (stage, operation) => measure(stage, operation),
    measureChild: (stage, parent, operation) => measure(stage, operation, parent),
    settle: async () => {
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },
    finalize: (...args) => timing.finalize(...args),
    delivery: () => timing.delivery?.(),
  };
}
