import type { SQLiteEventStore } from "@lervo/event-store-sqlite";
import type { ProjectStorage } from "@lervo/project-storage";
import { loadConvergenceDelegation } from "@lervo/repository-knowledge-runtime";
import type { NodeRuntimeConfig } from "./config-types.js";
import { startRepositoryKnowledgeLoop } from "./repository-knowledge-loop.js";

/** Reviewed repository delegation also permits a resident host without outcome supervision. */
export async function startDeploymentKnowledgeLoop(input: {
  storage: ProjectStorage;
  store: SQLiteEventStore;
  signal: AbortSignal;
  supervision?: NodeRuntimeConfig["outcomeSupervision"];
  workerEntry?: string;
}): Promise<() => Promise<void>> {
  const configured = input.supervision?.ownerReasoning.provider;
  const delegated =
    (input.storage.writableEventSchemaVersion ?? 1) >= 4
      ? (await loadConvergenceDelegation(input.storage.paths.repositoryRoot))?.delegation
          .providers[0]
      : undefined;
  const provider = configured ?? delegated;
  if (provider !== "claude" && provider !== "codex") return async () => undefined;
  const executable = input.supervision?.runtimeReadiness?.providerExecutables?.[provider];
  return startRepositoryKnowledgeLoop({
    ...(input.workerEntry === undefined ? {} : { workerEntry: input.workerEntry }),
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
