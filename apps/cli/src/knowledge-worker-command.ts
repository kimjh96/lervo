import {
  runAutonomousKnowledgeWorker,
  startAutonomousKnowledgeWorker,
  type ConvergenceOwnerVerdict,
} from "@lervo/repository-knowledge-runtime";
import { spawn } from "node:child_process";

import {
  createKnowledgeConvergenceOwnership,
  createKnowledgePublisher,
} from "./knowledge-convergence-ownership.js";
import { knowledgeWorkerFailureLine } from "./knowledge-worker-failure.js";

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
      return await runAutonomousKnowledgeWorker({
        storage,
        owner: () => ownership.observe(),
        workerId: `cli-${process.pid}`,
        provider: input.provider,
        ...(input.maximumJobs === undefined
          ? {}
          : { maximumStages: Math.min(8, input.maximumJobs) }),
      });
    }
    return await runRepositoryKnowledgeWorker({
      repositoryRoot: storage.paths.repositoryRoot,
      events: storage.events,
      artifacts: storage.artifacts,
      workerId: `cli-${process.pid}`,
      provider: input.provider,
      ...(input.host === undefined ? {} : { host: input.host }),
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
): Promise<number> {
  const provider = args[args.indexOf("--provider") + 1];
  if (
    (!args.includes("--once") && !args.includes("--watch")) ||
    (provider !== "claude" && provider !== "codex")
  ) {
    io.stderr("Usage: lervo knowledge worker <--once|--watch> --provider <claude|codex>\n");
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
        publish: createKnowledgePublisher(storage.paths.repositoryRoot),
        onCycle: (result) => io.stdout(`${JSON.stringify(result)}\n`),
        onFailure: (error) =>
          io.stderr(knowledgeWorkerFailureLine(error, storage.paths.repositoryRoot)),
      });
      try {
        await new Promise<void>((resolve) => {
          const stopped = () => {
            process.removeListener("SIGINT", stopped);
            process.removeListener("SIGTERM", stopped);
            resolve();
          };
          process.once("SIGINT", stopped);
          process.once("SIGTERM", stopped);
        });
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

/**
 * Starts a detached worker after a turn or run has finished; the caller never waits for it. A
 * launch failure leaves the job queued for the next worker (`knowledge_worker_launch_failed`).
 */
export function launchDetachedKnowledgeWorker(input: {
  root: string;
  entry: string;
  args: readonly string[];
}): boolean {
  try {
    const child = spawn(process.execPath, [input.entry, ...input.args], {
      cwd: input.root,
      detached: true,
      stdio: "ignore",
      env: process.env,
    });
    child.on("error", () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
}
