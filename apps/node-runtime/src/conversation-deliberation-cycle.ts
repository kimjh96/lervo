import type { ConversationApplication } from "@lervo/conversation-app";
import type {
  ConversationDeliberationResumeWorkerCycleResult,
  ConversationDeliberationWorkerCycleResult,
} from "@lervo/conversation-control";

import type { ConversationDeliberationArtifactSource } from "./conversation-deliberation-artifact-source.js";
import type { ConversationDeliberationOutcomeCoordinator } from "./conversation-deliberation-outcomes.js";

type WorkerResult =
  ConversationDeliberationWorkerCycleResult | ConversationDeliberationResumeWorkerCycleResult;

type SettledWorker =
  { status: "completed"; result: WorkerResult } | { status: "failed"; error: unknown };

function wait(milliseconds: number): Promise<null> {
  return new Promise((resolve) => setTimeout(() => resolve(null), milliseconds));
}

/** Keeps verified artifacts moving while a bounded CLI worker owns the long-running job. */
async function runWorkerWithProjection(input: {
  run(): Promise<WorkerResult>;
  artifacts: Pick<ConversationDeliberationArtifactSource, "runCycle"> | null;
  intervalMs: number;
}): Promise<WorkerResult> {
  const worker: Promise<SettledWorker> = input.run().then(
    (result) => ({ status: "completed", result }),
    (error: unknown) => ({ status: "failed", error }),
  );
  if (input.artifacts === null) {
    const settled = await worker;
    if (settled.status === "failed") throw settled.error;
    return settled.result;
  }
  let projectionError: unknown;
  for (;;) {
    const settled = await Promise.race([worker, wait(input.intervalMs)]);
    if (settled !== null) {
      if (settled.status === "failed") throw settled.error;
      if (projectionError !== undefined) throw projectionError;
      return settled.result;
    }
    if (projectionError === undefined) {
      try {
        await input.artifacts.runCycle();
      } catch (error: unknown) {
        projectionError = error;
      }
    }
  }
}

export async function runConversationDeliberationCycle(input: {
  application: ConversationApplication;
  artifacts: Pick<ConversationDeliberationArtifactSource, "runCycle"> | null;
  outcomes: ConversationDeliberationOutcomeCoordinator;
  projectionIntervalMs: number;
}): Promise<void> {
  await input.artifacts?.runCycle();
  const start = await runWorkerWithProjection({
    run: () => input.application.runDeliberationWorkerCycle(),
    artifacts: input.artifacts,
    intervalMs: input.projectionIntervalMs,
  });
  await input.artifacts?.runCycle();
  await input.outcomes.observe(input.application, start);

  const resume = await runWorkerWithProjection({
    run: () => input.application.runDeliberationResumeWorkerCycle(),
    artifacts: input.artifacts,
    intervalMs: input.projectionIntervalMs,
  });
  await input.artifacts?.runCycle();
  await input.outcomes.observe(input.application, resume);
  await input.outcomes.reconcilePending(input.application);
}
