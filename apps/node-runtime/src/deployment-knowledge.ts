import type { SQLiteEventStore } from "@lervo/event-store-sqlite";
import type { ProjectStorage } from "@lervo/project-storage";
import {
  defaultConvergenceContinuityPolicyPath,
  knowledgeResidentHoldReason,
  loadConvergenceDelegation,
  readConvergenceContinuityPolicy,
  startKnowledgeResidentHold,
} from "@lervo/repository-knowledge-runtime";
import type { NodeRuntimeConfig } from "./config-types.js";
import { startRepositoryKnowledgeLoop } from "./repository-knowledge-loop.js";

/**
 * ADR-0469: the reviewed delegation's provider, else the active host continuity policy's
 * template provider, so a repository with no delegation yet still gets a resident that can seed
 * one. It does not depend on the writer schema: an outdated writer holds the resident instead.
 */
async function continuityProvider(root: string): Promise<"codex" | "claude" | undefined> {
  const delegated = await loadConvergenceDelegation(root).then(
    (loaded) => loaded?.delegation.providers[0],
    () => undefined,
  );
  if (delegated !== undefined) return delegated;
  const path = defaultConvergenceContinuityPolicyPath();
  if (path === null) return undefined;
  const policy = await readConvergenceContinuityPolicy(path);
  return policy.status === "loaded" && policy.policy.state === "active"
    ? policy.policy.template?.providers[0]
    : undefined;
}

function reportFailure(error: unknown): void {
  process.stderr.write(
    `Lervo repository knowledge cycle failed: ${(error as { code?: string })?.code ?? "knowledge_job_transient_failure"}\n`,
  );
}

/**
 * Reviewed repository delegation or a host continuity policy permits a resident host. Outcome
 * supervision's reasoning provider takes precedence. Under ADR-0470 a continuity resident whose
 * writer is older than schema 4 is held, never skipped: the resident child waits and resumes after
 * activation, or, without a child entry, an in-process hold reports the cause.
 */
export async function startDeploymentKnowledgeLoop(input: {
  storage: ProjectStorage;
  store: SQLiteEventStore;
  signal: AbortSignal;
  supervision?: NodeRuntimeConfig["outcomeSupervision"];
  workerEntry?: string;
  hub?: NodeRuntimeConfig["hub"];
}): Promise<() => Promise<void>> {
  const configured = input.supervision?.ownerReasoning.provider;
  const supervised = configured === "codex" || configured === "claude" ? configured : undefined;
  const root = input.storage.paths.repositoryRoot;
  const continuity = await continuityProvider(root);
  const hold = knowledgeResidentHoldReason(input.storage.writableEventSchemaVersion);
  const provider = supervised ?? continuity;
  if (provider === undefined) return async () => undefined;
  const executable = input.supervision?.runtimeReadiness?.providerExecutables?.[provider];
  const loop = (awaitAdmission: boolean) =>
    startRepositoryKnowledgeLoop({
      ...(input.workerEntry === undefined ? {} : { workerEntry: input.workerEntry }),
      ...(input.hub === undefined ? {} : { hub: input.hub }),
      repositoryRoot: root,
      storage: input.storage,
      store: input.store,
      artifacts: input.storage.artifacts,
      signal: input.signal,
      provider,
      ...(executable === undefined ? {} : { executable }),
      ...(awaitAdmission ? { awaitAdmission } : {}),
      onFailure: reportFailure,
    });
  if (hold === null || continuity === undefined) return loop(false);
  if (supervised === undefined && input.workerEntry !== undefined) return loop(true);
  const stops = [
    startKnowledgeResidentHold({
      repositoryRoot: root,
      workerId: `node-${process.pid}`,
      reason: hold,
      onFailure: reportFailure,
    }),
    ...(supervised === undefined ? [] : [loop(false)]),
  ];
  return async () => {
    await Promise.all(stops.map((stop) => stop()));
  };
}
