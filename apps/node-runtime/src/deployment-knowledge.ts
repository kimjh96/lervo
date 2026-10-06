import type { SQLiteEventStore } from "@lervo/event-store-sqlite";
import type { ProjectStorage } from "@lervo/project-storage";
import {
  defaultConvergenceContinuityPolicyPath,
  loadConvergenceDelegation,
  readConvergenceContinuityPolicy,
} from "@lervo/repository-knowledge-runtime";
import type { NodeRuntimeConfig } from "./config-types.js";
import { startRepositoryKnowledgeLoop } from "./repository-knowledge-loop.js";

/**
 * The resident's provider: outcome supervision's reasoning provider, else the reviewed
 * delegation's, else (ADR-0469) the active host continuity policy's template provider, so a
 * repository that has no delegation yet still gets a resident that can seed one.
 */
async function residentProvider(input: {
  storage: ProjectStorage;
  supervision?: NodeRuntimeConfig["outcomeSupervision"];
}): Promise<"codex" | "claude" | undefined> {
  const configured = input.supervision?.ownerReasoning.provider;
  if (configured === "codex" || configured === "claude") return configured;
  if ((input.storage.writableEventSchemaVersion ?? 1) < 4) return undefined;
  const delegated = await loadConvergenceDelegation(input.storage.paths.repositoryRoot).then(
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

/** Reviewed repository delegation or a host continuity policy permits a resident host. */
export async function startDeploymentKnowledgeLoop(input: {
  storage: ProjectStorage;
  store: SQLiteEventStore;
  signal: AbortSignal;
  supervision?: NodeRuntimeConfig["outcomeSupervision"];
  workerEntry?: string;
  hub?: NodeRuntimeConfig["hub"];
}): Promise<() => Promise<void>> {
  const provider = await residentProvider(input);
  if (provider === undefined) return async () => undefined;
  const executable = input.supervision?.runtimeReadiness?.providerExecutables?.[provider];
  return startRepositoryKnowledgeLoop({
    ...(input.workerEntry === undefined ? {} : { workerEntry: input.workerEntry }),
    ...(input.hub === undefined ? {} : { hub: input.hub }),
    repositoryRoot: input.storage.paths.repositoryRoot,
    storage: input.storage,
    store: input.store,
    artifacts: input.storage.artifacts,
    signal: input.signal,
    provider,
    ...(executable === undefined ? {} : { executable }),
    onFailure: (error) =>
      process.stderr.write(
        `Lervo repository knowledge cycle failed: ${(error as { code?: string })?.code ?? "knowledge_job_transient_failure"}\n`,
      ),
  });
}
