import {
  runConversationDeliberationLeaseCycle,
  type ConversationDeliberationLeaseStore,
} from "./deliberation-lease-worker.js";
import type {
  ConversationDeliberationResumeJob,
  ConversationDeliberationResumeExecutionPort,
  ConversationDeliberationResumeJobStore,
} from "./deliberation-resume-job.js";
import type { ConversationDeliberationSummary } from "./types.js";

export type ConversationDeliberationResumeWorkerCycleResult =
  | { status: "idle" }
  | { status: "settled"; deliberationId: string; summary: ConversationDeliberationSummary }
  | {
      status: "uncertain";
      deliberationId: string;
      failureCode: "deliberation_resume_execution_uncertain";
    };

export function runConversationDeliberationResumeWorkerCycle(options: {
  store: ConversationDeliberationResumeJobStore;
  executor: ConversationDeliberationResumeExecutionPort;
  workerId: string;
  now?: () => Date;
  leaseDurationMs?: number;
}): Promise<ConversationDeliberationResumeWorkerCycleResult> {
  const store: ConversationDeliberationLeaseStore<
    ConversationDeliberationResumeJob,
    "deliberation_resume_execution_uncertain"
  > = options.store;
  return runConversationDeliberationLeaseCycle({
    store,
    execute: (job) => options.executor.execute(job),
    executionFailureCode: "deliberation_resume_execution_uncertain",
    workerId: options.workerId,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.leaseDurationMs === undefined ? {} : {
      leaseDurationMs: options.leaseDurationMs,
    }),
  });
}
