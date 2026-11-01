import { applyOwnerStatedInstructionCandidates } from "./durable-instruction-auto-apply.js";
import {
  runAutonomousKnowledgeWorker,
  createChangeReviewHost,
  admittedBackgroundContext,
  startAutonomousKnowledgeWorker,
  type ConvergenceOwnerVerdict,
} from "@lervo/repository-knowledge-runtime";

import {
  createKnowledgeConvergenceContinuity,
  createKnowledgeConvergenceOwnership,
  createKnowledgePublisher,
  instructionCandidateTransport,
} from "./knowledge-convergence-ownership.js";
import { knowledgeWorkerFailureLine } from "./knowledge-worker-failure.js";
import { untilTerminated } from "./process-termination.js";

import { openProjectStorage } from "@lervo/project-storage";
import type {
  RepositoryKnowledgeJobOutcome,
  RepositoryKnowledgeWorkerHost,
} from "@lervo/repository-knowledge";
import {
  runRepositoryKnowledgeWorker,
  type RepositoryKnowledgeWorkerProvider as Provider,
} from "@lervo/repository-knowledge-compiler";

export async function runKnowledgeWorker(input: {
  root: string;
  provider: Provider;
  maximumJobs?: number;
  openStorage?: typeof openProjectStorage;
  host?: RepositoryKnowledgeWorkerHost;
}): Promise<
  | { status: "processed"; outcomes: RepositoryKnowledgeJobOutcome[] }
  | { status: "busy" }
  | { status: "waiting_owner"; owner: ConvergenceOwnerVerdict }
> {
  const storage = await (input.openStorage ?? openProjectStorage)(input.root);
  try {
    if ((storage.writableEventSchemaVersion ?? 1) >= 4 && input.host === undefined) {
      const ownership = createKnowledgeConvergenceOwnership(storage, input.provider);
      await createKnowledgeConvergenceContinuity(storage)
        .reconcile()
        .catch(() => undefined);
      return await runAutonomousKnowledgeWorker({
        storage,
        owner: () => ownership.observe(),
        instructionCandidateTransport,
        applyOwnerStatedInstructions: () =>
          applyOwnerStatedInstructionCandidates({
            repositoryRoot: storage.paths.repositoryRoot,
            now: () => new Date(),
          }),
        workerId: `cli-${process.pid}`,
        provider: input.provider,
        ...(input.maximumJobs === undefined
          ? {}
          : { maximumStages: Math.min(8, input.maximumJobs) }),
      });
    }
    const selected =
      input.host === undefined
        ? await admittedBackgroundContext({ storage, provider: input.provider })
        : null;
    return await runRepositoryKnowledgeWorker({
      repositoryRoot: storage.paths.repositoryRoot,
      events: storage.events,
      artifacts: storage.artifacts,
      workerId: `cli-${process.pid}`,
      provider: input.provider,
      host:
        input.host ??
        createChangeReviewHost({
          ...selected!,
          signal: new AbortController().signal,
          liveWorkPending: async () => false,
        }),
      ...(input.maximumJobs === undefined ? {} : { maximumJobs: input.maximumJobs }),
    });
  } finally {
    await storage.close();
  }
}

/** `lervo knowledge worker --once --provider <claude|codex>` */
export async function runKnowledgeWorkerCommand(
  args: readonly string[],
  io: { cwd: string; stdout(message: string): void; stderr(message: string): void },
  /**
   * The full CLI refreshes the core health projection each watch cycle. One-shot cycles
   * leave that projection to their resident. No worker implementation enters the hook bundle.
   */
  options: { refreshHealth?: (root: string) => Promise<void> } = {},
): Promise<number> {
  const provider = args.includes("--provider") ? args[args.indexOf("--provider") + 1] : undefined;
  if (
    (!args.includes("--once") && !args.includes("--watch")) ||
    (provider !== "claude" && provider !== "codex")
  ) {
    io.stderr(
      "Usage: lervo knowledge worker <--once|--watch> --provider <claude|codex>\n       lervo knowledge worker --watch --host [--provider <claude|codex>] [--config <absolute-path>]\n",
    );
    return 1;
  }
  try {
    if (args.includes("--watch")) {
      const storage = await openProjectStorage(io.cwd);
      const stop = startAutonomousKnowledgeWorker({
        storage,
        workerId: `cli-${process.pid}`,
        provider,
        ownership: createKnowledgeConvergenceOwnership(storage, provider),
        continuity: createKnowledgeConvergenceContinuity(storage),
        instructionCandidateTransport,
        applyOwnerStatedInstructions: () =>
          applyOwnerStatedInstructionCandidates({
            repositoryRoot: storage.paths.repositoryRoot,
            now: () => new Date(),
          }),
        publish: createKnowledgePublisher(storage.paths.repositoryRoot),
        ...(options.refreshHealth === undefined
          ? {}
          : { refreshHealth: () => options.refreshHealth!(storage.paths.repositoryRoot) }),
        onCycle: (result) => io.stdout(`${JSON.stringify(result)}\n`),
        onFailure: (error) =>
          io.stderr(knowledgeWorkerFailureLine(error, storage.paths.repositoryRoot)),
      });
      try {
        await untilTerminated();
      } finally {
        await stop();
        await storage.close();
      }
      return 0;
    }
    io.stdout(`${JSON.stringify(await runKnowledgeWorker({ root: io.cwd, provider }))}\n`);
    return 0;
  } catch (error) {
    io.stderr(`Knowledge worker failed: ${error instanceof Error ? error.message : "unknown"}\n`);
    return 1;
  }
}

export { launchDetachedKnowledgeWorker } from "./detached-knowledge-worker.js";
