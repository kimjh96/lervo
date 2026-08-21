import type {
  ConversationDeliberationExecutionPort,
  ConversationDeliberationJobStore,
} from "./deliberation-job.js";
import {
  runConversationDeliberationLeaseCycle,
  type ConversationDeliberationLeaseStore,
} from "./deliberation-lease-worker.js";
import type { ConversationDeliberationSummary } from "./types.js";

export type ConversationDeliberationWorkerCycleResult =
  | { status: "idle" }
  | {
      status: "settled";
      deliberationId: string;
      summary: ConversationDeliberationSummary;
    }
  | {
      status: "uncertain";
      deliberationId: string;
      failureCode: "deliberation_execution_uncertain";
    };

export async function runConversationDeliberationWorkerCycle(options: {
  store: ConversationDeliberationJobStore;
  executor: ConversationDeliberationExecutionPort;
  workerId: string;
  now?: () => Date;
  leaseDurationMs?: number;
}): Promise<ConversationDeliberationWorkerCycleResult> {
  const store: ConversationDeliberationLeaseStore<
    Parameters<ConversationDeliberationExecutionPort["execute"]>[0],
    "deliberation_execution_uncertain"
  > = options.store;
  return runConversationDeliberationLeaseCycle({
    store,
    execute: (job) => options.executor.execute(job),
    executionFailureCode: "deliberation_execution_uncertain",
    workerId: options.workerId,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.leaseDurationMs === undefined ? {} : {
      leaseDurationMs: options.leaseDurationMs,
    }),
  });
}
