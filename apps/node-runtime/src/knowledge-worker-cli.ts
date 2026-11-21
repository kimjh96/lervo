import { isAbsolute } from "node:path";

import { openProjectStorage } from "@lervo/project-storage";
import {
  applyStoredInstructionCandidates,
  knowledgeResidentHoldReason,
  startAutonomousKnowledgeWorker,
  subscribeKnowledgeWakeups,
} from "@lervo/repository-knowledge-runtime";

import {
  createKnowledgeConvergenceContinuity,
  createKnowledgeConvergenceOwnership,
  instructionCandidateTransport,
  knowledgeHubChangeTransport,
  createKnowledgePublisher,
} from "./knowledge-convergence-ownership.js";
import { awaitKnowledgeWorkerAdmission } from "./knowledge-worker-admission.js";
import {
  decodeKnowledgeHubCoordinates,
  KNOWLEDGE_HUB_COORDINATES_ENVIRONMENT,
} from "./knowledge-hub-coordinates.js";

function request(args: readonly string[]): {
  root: string;
  provider: "codex" | "claude";
  executable: string | undefined;
} {
  const [rootFlag, root, providerFlag, provider, ownerFlag, owner, ...rest] = args;
  if (
    rootFlag !== "--root" ||
    root === undefined ||
    !isAbsolute(root) ||
    providerFlag !== "--provider" ||
    (provider !== "codex" && provider !== "claude") ||
    ownerFlag !== "--owner" ||
    owner !== String(process.ppid) ||
    !process.connected ||
    (rest.length !== 0 &&
      (rest.length !== 2 ||
        rest[0] !== "--executable" ||
        rest[1] === undefined ||
        !isAbsolute(rest[1])))
  )
    throw new Error("The resident knowledge worker requires its owning Node IPC channel.");
  return { root, provider, executable: rest[1] };
}

/** The same immutable Node artifact hosts work outside the conversation event loop. */
export async function runKnowledgeWorkerCli(args: readonly string[]): Promise<number> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const message = (value: unknown) => {
    if (
      typeof value === "object" &&
      value !== null &&
      "type" in value &&
      value.type === "knowledge_worker_stop"
    )
      abort();
  };
  process.on("message", message);
  process.once("disconnect", abort);
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  let storage: Awaited<ReturnType<typeof openProjectStorage>> | undefined;
  let stop: (() => Promise<void>) | undefined;
  try {
    const parsed = request(args);
    storage = await openProjectStorage(parsed.root);
    if (controller.signal.aborted) return 0;
    const workerId = `node-${process.ppid}-${process.pid}`;
    if (knowledgeResidentHoldReason(storage.writableEventSchemaVersion) !== null) {
      // ADR-0470: hold with a visible reason until the writer is activated, then reopen.
      const initialSchemaVersion = storage.writableEventSchemaVersion;
      await storage.close();
      storage = undefined;
      const admitted = await awaitKnowledgeWorkerAdmission({
        repositoryRoot: parsed.root,
        workerId,
        initialSchemaVersion,
        signal: controller.signal,
        onFailure: () =>
          process.stderr.write("Lervo resident knowledge hold failed (knowledge_hold_failed).\n"),
      });
      if (!admitted) return 0;
      storage = await openProjectStorage(parsed.root);
      if (knowledgeResidentHoldReason(storage.writableEventSchemaVersion) !== null)
        throw new Error("The resident knowledge worker requires event writer version 4.");
    }
    const stopped = new Promise<void>((resolveStopped) =>
      controller.signal.addEventListener("abort", () => resolveStopped(), { once: true }),
    );
    const opened = storage;
    stop = startAutonomousKnowledgeWorker({
      storage,
      subscribe: (notify, owner) => subscribeKnowledgeWakeups(opened, notify, undefined, owner),
      workerId,
      provider: parsed.provider,
      ownership: createKnowledgeConvergenceOwnership(opened, parsed.provider),
      continuity: createKnowledgeConvergenceContinuity(
        opened,
        decodeKnowledgeHubCoordinates(process.env[KNOWLEDGE_HUB_COORDINATES_ENVIRONMENT]),
      ),
      instructionCandidateTransport,
      hubChanges: knowledgeHubChangeTransport,
      // ADR-0594: the owner applies stored owner rules here exactly as the CLI host does.
      applyOwnerStatedInstructions: () =>
        applyStoredInstructionCandidates({ repositoryRoot: parsed.root, now: () => new Date() }),
      publish: createKnowledgePublisher(parsed.root),
      ...(parsed.executable === undefined ? {} : { executable: parsed.executable }),
      signal: controller.signal,
      onFailure: (error) => {
        const code = (error as { code?: unknown } | null)?.code;
        process.stderr.write(
          `Lervo repository knowledge cycle failed: ${typeof code === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(code) ? code : "knowledge_job_transient_failure"}\n`,
        );
      },
    });
    await stopped;
    return 0;
  } catch {
    process.stderr.write(
      "Lervo resident knowledge worker failed (knowledge_worker_launch_failed).\n",
    );
    return 1;
  } finally {
    try {
      await stop?.();
    } finally {
      try {
        await storage?.close();
      } finally {
        process.off("message", message);
        process.off("disconnect", abort);
        process.off("SIGINT", abort);
        process.off("SIGTERM", abort);
        if (process.connected) process.disconnect();
      }
    }
  }
}
