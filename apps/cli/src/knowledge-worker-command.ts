import { spawn } from "node:child_process";

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
  { status: "processed"; outcomes: RepositoryKnowledgeJobOutcome[] } | { status: "busy" }
> {
  const storage = await (input.openStorage ?? openProjectStorage)(input.root);
  try {
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
  if (!args.includes("--once") || (provider !== "claude" && provider !== "codex")) {
    io.stderr("Usage: lervo knowledge worker --once --provider <claude|codex>\n");
    return 1;
  }
  try {
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
